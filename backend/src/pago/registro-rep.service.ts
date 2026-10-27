import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarRepDto } from './pago.dto';
import { createHash } from 'node:crypto';
import { queryRows } from '../common/database/typed-query';
import { FiscalService } from '../fiscal/fiscal.service';
import { CancelFiscalDocumentDto } from '../fiscal/fiscal.dto';
import {
  RepIdRow,
  FacturaRepRow,
  RepEstadoRow,
  FacturaPagadaRow,
} from './pago.types';
@Injectable()
export class RegistroRepService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fiscalService?: FiscalService,
  ) {}
  async registrarRepComplejo(dto: RegistrarRepDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            idCliente: dto.idCliente,
            fechaPago: dto.fechaPago,
            formaPago: dto.formaPago,
            moneda: dto.moneda || 'MXN',
            montoTotal: dto.montoTotal,
            cuentaBeneficiario: dto.cuentaBeneficiario || null,
            rfcBeneficiario: dto.rfcBeneficiario || null,
            facturas: [...dto.facturas]
              .sort((a, b) => a.idFactura - b.idFactura)
              .map((x) => ({
                idFactura: x.idFactura,
                montoSaldado: x.montoSaldado,
              })),
          }),
        )
        .digest('hex');
      if (dto.requestId) {
        await queryRunner.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          ['rep-request:' + dto.requestId.toLowerCase()],
        );
        const previous = await queryRows<{
          operation_type: string;
          payload_hash: string;
          response: { message: string; idRep: number };
        }>(
          queryRunner,
          'SELECT operation_type,payload_hash,response FROM operation_idempotency WHERE request_id=$1',
          [dto.requestId],
        );
        if (previous.length) {
          if (
            previous[0].operation_type !== 'rep' ||
            previous[0].payload_hash !== hash
          )
            throw new ConflictException(
              'El identificador de reintento ya fue usado con datos diferentes',
            );
          await queryRunner.commitTransaction();
          return previous[0].response;
        }
      }
      const facturaIds = dto.facturas.map((item) => item.idFactura);
      if (new Set(facturaIds).size !== facturaIds.length) {
        throw new BadRequestException(
          'Una factura no puede repetirse en el mismo REP',
        );
      }
      const appliedTotal = dto.facturas.reduce(
        (sum, item) => sum + Number(item.montoSaldado),
        0,
      );
      if (Math.round(appliedTotal * 100) !== Math.round(dto.montoTotal * 100)) {
        throw new BadRequestException(
          'La suma aplicada a facturas debe coincidir con el monto total del REP',
        );
      }

      // 1. Insertar Cabecera REP
      const repInsert = await queryRows<RepIdRow>(
        queryRunner,
        `INSERT INTO rep (
          id_cliente, fecha_pago, forma_pago, moneda, monto_total, 
          cuenta_beneficiario, rfc_beneficiario,
          uuid, no_serie_certificado, no_certificado_emisor, 
          lugar_emision, fecha_emision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          NULL, NULL, NULL,
          NULL, NOW()
        ) RETURNING id_rep`,
        [
          dto.idCliente,
          dto.fechaPago,
          dto.formaPago,
          dto.moneda || 'MXN',
          dto.montoTotal,
          dto.cuentaBeneficiario,
          dto.rfcBeneficiario,
        ],
      );
      const idRep = repInsert[0].id_rep;

      // 2. Procesar cada Factura PPD
      for (const item of [...dto.facturas].sort(
        (a, b) => a.idFactura - b.idFactura,
      )) {
        // Encontrar saldo actual y calcular parcialidad
        const factData = await queryRows<FacturaRepRow>(
          queryRunner,
          `SELECT f.saldo_pendiente, f.id_cliente, f.estatus::text AS estatus, f.moneda,
             mp."Clave" AS metodo_clave,
             (SELECT COUNT(*) FROM rep_factura WHERE id_factura = $1) + 1 AS nueva_parcialidad
           FROM factura f
           LEFT JOIN metododepago mp ON mp."IdMetodoDePago" = f.id_metodo_pago
           WHERE f.id_factura = $1 FOR UPDATE OF f`,
          [item.idFactura],
        );

        if (!factData.length)
          throw new NotFoundException(
            `Factura ${item.idFactura} no encontrada`,
          );
        if (Number(factData[0].id_cliente) !== dto.idCliente) {
          throw new BadRequestException(
            `La factura ${item.idFactura} no pertenece al cliente del REP`,
          );
        }
        if (factData[0].estatus === 'Cancelada') {
          throw new BadRequestException(
            `La factura ${item.idFactura} está cancelada`,
          );
        }
        if (factData[0].metodo_clave !== 'PPD') {
          throw new BadRequestException(
            `La factura ${item.idFactura} no tiene método PPD`,
          );
        }
        if (factData[0].moneda !== (dto.moneda || 'MXN')) {
          throw new BadRequestException(
            'La moneda del REP debe coincidir con la de cada factura',
          );
        }
        const saldoAnterior = Number(factData[0].saldo_pendiente);
        const montoPagado = item.montoSaldado;
        const saldoInsoluto =
          (Math.round(saldoAnterior * 100) - Math.round(montoPagado * 100)) /
          100;
        const numParcialidad = Number(factData[0].nueva_parcialidad);

        if (saldoInsoluto < 0) {
          throw new BadRequestException(
            `El abono a la factura ${item.idFactura} supera el saldo pendiente`,
          );
        }

        // Insertar en rep_factura
        await queryRunner.query(
          `INSERT INTO rep_factura (
            id_rep, id_factura, num_parcialidad, saldo_anterior, monto_pagado, saldo_insoluto
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            idRep,
            item.idFactura,
            numParcialidad,
            saldoAnterior,
            montoPagado,
            saldoInsoluto,
          ],
        );

        // Actualizar saldo factura
        await queryRunner.query(
          `UPDATE factura SET saldo_pendiente = $1,
             estatus = CASE WHEN $1::numeric = 0 THEN 'Pagada'::estatus_factura_enum ELSE 'Pendiente'::estatus_factura_enum END
           WHERE id_factura = $2`,
          [saldoInsoluto, item.idFactura],
        );

        // Guardar compatibilidad antigua en 'pago' (Opcional, pero bueno para el app viejo)
        await queryRunner.query(
          `INSERT INTO pago (id_factura, fecha_pago, monto, forma_pago, referencia, notas, id_rep)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            item.idFactura,
            dto.fechaPago,
            montoPagado,
            dto.formaPago,
            'REP-' + idRep,
            'Generado via Módulo REP',
            idRep,
          ],
        );
      }

      const response = { message: 'REP Registrado correctamente', idRep };
      if (dto.requestId)
        await queryRunner.query(
          "INSERT INTO operation_idempotency(request_id,operation_type,payload_hash,response) VALUES($1,'rep',$2,$3::jsonb)",
          [dto.requestId, hash, JSON.stringify(response)],
        );
      await queryRunner.commitTransaction();
      return response;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async getHistorialReps() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT r.*, c."RazonSocial" as cliente_nombre,
        COALESCE(fd.estado,'Borrador') AS estado_fiscal,
        (fd.xml_timbrado IS NOT NULL) AS tiene_xml_fiscal,
        (fd.acuse_cancelacion IS NOT NULL) AS tiene_acuse,
        fd.ultimo_error AS error_fiscal
       FROM rep r
       JOIN cliente c ON r.id_cliente = c."IdCliente"
       LEFT JOIN fiscal_documento fd ON fd.id_rep=r.id_rep
       ORDER BY r.fecha_pago DESC`,
    );
  }

  async cancelarRep(
    idRep: number,
    fiscalDto: CancelFiscalDocumentDto = {},
    idUsuario?: number,
  ) {
    const fiscalResult = this.fiscalService
      ? await this.fiscalService.cancel('REP', idRep, fiscalDto, idUsuario)
      : { fiscal: false, cancelled: true, state: 'Sin timbrar' };
    if (!fiscalResult.cancelled) {
      return {
        message:
          'La cancelación del REP está pendiente de confirmación del SAT; los saldos permanecen sin cambios.',
        ...fiscalResult,
      };
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Verificar si existe y no está ya cancelado
      const repInfo = await queryRows<RepEstadoRow>(
        queryRunner,
        `SELECT estado FROM rep WHERE id_rep = $1 FOR UPDATE`,
        [idRep],
      );
      if (!repInfo.length)
        throw new NotFoundException('Recibo Electrónico de Pago no encontrado');
      if (repInfo[0].estado === 'Cancelado')
        throw new BadRequestException('El REP ya se encuentra cancelado');

      // 2. Marcar como Cancelado
      await queryRunner.query(
        `UPDATE rep SET estado = 'Cancelado' WHERE id_rep = $1`,
        [idRep],
      );

      // 3. Revertir saldos de factura
      // Seleccionamos todos los pagos hechos por este REP
      const facturasPagadas = await queryRows<FacturaPagadaRow>(
        queryRunner,
        `
        SELECT rf.id_factura, rf.monto_pagado, f.estatus::text AS estatus,
               f.saldo_pendiente, f.total,
               EXISTS (SELECT 1 FROM devolucion d WHERE d.id_factura=f.id_factura) AS tiene_devolucion,
               EXISTS (SELECT 1 FROM factura nc WHERE nc.id_factura_origen=f.id_factura AND nc.estatus::text <> 'Cancelada') AS tiene_nota
          FROM rep_factura rf JOIN factura f ON f.id_factura=rf.id_factura
         WHERE rf.id_rep=$1 ORDER BY f.id_factura FOR UPDATE OF f`,
        [idRep],
      );

      for (const fp of facturasPagadas) {
        if (
          fp.estatus === 'Cancelada' ||
          fp.tiene_devolucion ||
          fp.tiene_nota
        ) {
          throw new BadRequestException(
            'Concilia la cancelación o devolución de la factura antes de cancelar su REP',
          );
        }
        if (
          Math.round(
            (Number(fp.saldo_pendiente) + Number(fp.monto_pagado)) * 100,
          ) > Math.round(Number(fp.total) * 100)
        ) {
          throw new BadRequestException(
            'El reverso excedería el total de la factura; revisa su conciliación',
          );
        }
        // Le sumamos de regreso el monto pagado al saldo pendiente
        await queryRunner.query(
          `UPDATE factura SET saldo_pendiente = saldo_pendiente + $1, estatus='Pendiente' WHERE id_factura = $2`,
          [fp.monto_pagado, fp.id_factura],
        );
      }

      // El alta del REP crea pagos de compatibilidad que afectan caja/banco.
      // Al cancelar, se eliminan dentro de la misma transacción; el trigger de
      // reverso definido en la migración 027 revierte esos saldos.
      await queryRunner.query(`DELETE FROM pago WHERE id_rep = $1`, [idRep]);

      await queryRunner.commitTransaction();
      return { message: 'REP cancelado correctamente', idRep, ...fiscalResult };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
