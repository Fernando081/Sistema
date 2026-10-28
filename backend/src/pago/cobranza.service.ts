import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoDto } from './pago.dto';
import { queryRows } from '../common/database/typed-query';
import { FacturaSaldoRow, PagoIdRow } from './pago.types';
import { createHash } from 'node:crypto';
import { setAuditActor } from '../auth/audit-actor';
@Injectable()
export class CobranzaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async registrarPago(dto: RegistrarPagoDto, idUser?: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await setAuditActor(queryRunner, idUser);
      const payloadHash = createHash('sha256')
        .update(
          JSON.stringify({
            idFactura: dto.idFactura,
            monto: dto.monto,
            formaPago: dto.formaPago,
            referencia: dto.referencia || '',
            notas: dto.notas || '',
          }),
        )
        .digest('hex');
      if (dto.requestId) {
        await queryRunner.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          ['pago-request:' + dto.requestId.toLowerCase()],
        );
        const previous = await queryRows<{
          operation_type: string;
          payload_hash: string;
          response: { message: string; idPago: number };
        }>(
          queryRunner,
          'SELECT operation_type,payload_hash,response FROM operation_idempotency WHERE request_id=$1',
          [dto.requestId],
        );
        if (previous.length) {
          if (
            previous[0].operation_type !== 'pago' ||
            previous[0].payload_hash !== payloadHash
          )
            throw new ConflictException(
              'El identificador de reintento ya fue usado con datos diferentes',
            );
          await queryRunner.commitTransaction();
          return previous[0].response;
        }
      }
      const factura = await queryRows<FacturaSaldoRow>(
        queryRunner,
        `SELECT saldo_pendiente, estatus::text AS estatus
           FROM factura WHERE id_factura = $1 FOR UPDATE`,
        [dto.idFactura],
      );
      if (!factura.length) throw new NotFoundException('Factura no encontrada');
      if (factura[0].estatus === 'Cancelada') {
        throw new BadRequestException(
          'No se puede pagar una factura cancelada',
        );
      }
      const saldo = Number(factura[0].saldo_pendiente);
      if (Math.round(dto.monto * 100) > Math.round(saldo * 100)) {
        throw new BadRequestException('El pago supera el saldo pendiente');
      }

      const result = await queryRows<PagoIdRow>(
        queryRunner,
        `SELECT fn_registrar_pago($1, $2, $3, $4, $5) as id_pago`,
        [
          dto.idFactura,
          dto.monto,
          dto.formaPago,
          dto.referencia || '',
          dto.notas || '',
        ],
      );
      const response = {
        message: 'Pago registrado con éxito',
        idPago: result[0].id_pago,
      };
      if (dto.requestId)
        await queryRunner.query(
          "INSERT INTO operation_idempotency(request_id,operation_type,payload_hash,response) VALUES($1,'pago',$2,$3::jsonb)",
          [dto.requestId, payloadHash, JSON.stringify(response)],
        );
      await queryRunner.commitTransaction();
      return response;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getPagosPorFactura(idFactura: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT * FROM pago WHERE id_factura = $1 ORDER BY fecha_pago DESC`,
      [idFactura],
    );
  }

  async getPendientesPorCliente(idCliente: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE f.id_cliente = $1 AND saldo_pendiente > 0 AND f.estatus::text <> 'Cancelada'
         AND COALESCE(f.tipo_comprobante, 'I') = 'I'
       ORDER BY fecha_emision ASC`,
      [idCliente],
    );
  }

  async getAllPendientes() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE saldo_pendiente > 0 AND f.estatus::text <> 'Cancelada'
         AND COALESCE(f.tipo_comprobante, 'I') = 'I'
       ORDER BY fecha_emision ASC`,
    );
  }

  async getPpdPendientesPorCliente(idCliente: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       JOIN metododepago mp ON mp."IdMetodoDePago" = f.id_metodo_pago
       WHERE f.id_cliente = $1 AND saldo_pendiente > 0 AND mp."Clave" = 'PPD'
         AND f.estatus::text <> 'Cancelada' AND COALESCE(f.tipo_comprobante, 'I') = 'I'
       ORDER BY fecha_emision ASC`,
      [idCliente],
    );
  }
}
