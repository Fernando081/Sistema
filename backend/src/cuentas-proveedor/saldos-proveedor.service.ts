import { supplierRequest } from './supplier-request';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import {
  CreateSupplierAdvanceDto,
  CreateSupplierCreditDto,
} from './cuentas-proveedor.dto';
import { IdRow, InvoiceRow } from './cuentas-proveedor.types';
@Injectable()
export class SaldosProveedorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  createCredit(dto: CreateSupplierCreditDto, idUser?: number) {
    return this.dataSource
      .transaction(async (manager) =>
        supplierRequest(
          manager,
          dto.requestId,
          'supplier-credit',
          {
            idProveedor: dto.idProveedor,
            idFacturaProveedor: dto.idFacturaProveedor || null,
            uuid: dto.uuid || null,
            folio: dto.folio,
            fecha: dto.fecha,
            total: dto.total,
            montoAplicar: dto.idFacturaProveedor
              ? dto.montoAplicar || dto.total
              : null,
            notas: dto.notas || null,
          },
          async () => {
            const old = await queryRows<IdRow>(
              manager,
              'SELECT id_nota AS id FROM nota_credito_proveedor WHERE request_id=$1',
              [dto.requestId],
            );
            if (old.length)
              throw new ConflictException(
                'Operación anterior sin huella de contenido; revisa el registro antes de reintentar',
              );
            const note = await queryRows<IdRow>(
              manager,
              `INSERT INTO nota_credito_proveedor(request_id,id_proveedor,uuid,folio,fecha,total,saldo_disponible,notas,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING id_nota AS id`,
              [
                dto.requestId,
                dto.idProveedor,
                dto.uuid || null,
                dto.folio,
                dto.fecha,
                dto.total,
                dto.notas || null,
                idUser ?? null,
              ],
            );
            if (dto.idFacturaProveedor)
              await this.applyBalance(
                manager,
                'NotaCredito',
                note[0].id,
                dto.idFacturaProveedor,
                dto.montoAplicar || dto.total,
                idUser,
              );
            return { idNota: note[0].id };
          },
        ),
      )
      .catch((error) => {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('La nota de crédito ya fue registrada');
        throw error;
      });
  }

  createAdvance(dto: CreateSupplierAdvanceDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) =>
      supplierRequest(
        manager,
        dto.requestId,
        'supplier-advance',
        {
          idProveedor: dto.idProveedor,
          idFacturaProveedor: dto.idFacturaProveedor || null,
          fecha: dto.fecha,
          monto: dto.monto,
          montoAplicar: dto.idFacturaProveedor
            ? dto.montoAplicar || dto.monto
            : null,
          formaPago: dto.formaPago,
          referencia: dto.referencia || null,
          notas: dto.notas || null,
        },
        async () => {
          const old = await queryRows<IdRow>(
            manager,
            'SELECT id_anticipo AS id FROM anticipo_proveedor WHERE request_id=$1',
            [dto.requestId],
          );
          if (old.length)
            throw new ConflictException(
              'Operación anterior sin huella de contenido; revisa el registro antes de reintentar',
            );
          const advance = await queryRows<IdRow>(
            manager,
            `INSERT INTO anticipo_proveedor(request_id,id_proveedor,fecha,monto,saldo_disponible,forma_pago,referencia,notas,id_user)
        VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING id_anticipo AS id`,
            [
              dto.requestId,
              dto.idProveedor,
              dto.fecha,
              dto.monto,
              dto.formaPago,
              dto.referencia || null,
              dto.notas || null,
              idUser ?? null,
            ],
          );
          await manager.query(
            `UPDATE saldos SET caja_chica=caja_chica-CASE WHEN $2 ILIKE '%Efectivo%' THEN $1::numeric ELSE 0::numeric END,
        cuenta_banco=cuenta_banco-CASE WHEN $2 ILIKE '%Efectivo%' THEN 0::numeric ELSE $1::numeric END,updated_at=now()`,
            [dto.monto, dto.formaPago],
          );
          if (dto.idFacturaProveedor)
            await this.applyBalance(
              manager,
              'Anticipo',
              advance[0].id,
              dto.idFacturaProveedor,
              dto.montoAplicar || dto.monto,
              idUser,
            );
          return { idAnticipo: advance[0].id };
        },
      ),
    );
  }

  private async applyBalance(
    manager: EntityManager,
    type: 'NotaCredito' | 'Anticipo',
    sourceId: number,
    invoiceId: number,
    amount: number,
    idUser?: number,
  ) {
    const invoice = await queryRows<InvoiceRow>(
      manager,
      `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
      FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`,
      [invoiceId],
    );
    if (
      !invoice.length ||
      !['Aprobada', 'Parcialmente pagada'].includes(invoice[0].estado)
    )
      throw new ConflictException(
        'La factura no está disponible para aplicaciones',
      );
    if (Number(invoice[0].tipoCambio) !== 1)
      throw new BadRequestException(
        'Anticipos y notas de crédito deben aplicarse en la misma moneda; esta pantalla opera saldos MXN',
      );
    const table =
      type === 'NotaCredito' ? 'nota_credito_proveedor' : 'anticipo_proveedor';
    const idColumn = type === 'NotaCredito' ? 'id_nota' : 'id_anticipo';
    const source = await queryRows<{
      saldo: number | string;
      idProveedor: number;
    }>(
      manager,
      `SELECT saldo_disponible AS saldo,id_proveedor AS "idProveedor" FROM ${table} WHERE ${idColumn}=$1 FOR UPDATE`,
      [sourceId],
    );
    if (!source.length || source[0].idProveedor !== invoice[0].idProveedor)
      throw new BadRequestException('El saldo pertenece a otro proveedor');
    if (
      amount > Number(source[0].saldo) + 0.001 ||
      amount > Number(invoice[0].saldo) + 0.001
    )
      throw new BadRequestException('La aplicación supera el saldo disponible');
    await manager.query(
      `INSERT INTO aplicacion_proveedor(id_factura_proveedor,tipo,id_nota,id_anticipo,monto,id_user)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [
        invoiceId,
        type,
        type === 'NotaCredito' ? sourceId : null,
        type === 'Anticipo' ? sourceId : null,
        amount,
        idUser ?? null,
      ],
    );
    const sourceBalance = this.money(Number(source[0].saldo) - amount);
    await manager.query(
      `UPDATE ${table} SET saldo_disponible=$2::numeric,estado=CASE WHEN $2::numeric=0 THEN $3 ELSE 'Disponible' END WHERE ${idColumn}=$1`,
      [
        sourceId,
        sourceBalance,
        type === 'NotaCredito' ? 'Aplicada' : 'Aplicado',
      ],
    );
    const invoiceBalance = this.money(Number(invoice[0].saldo) - amount);
    await manager.query(
      `UPDATE factura_proveedor SET saldo_pendiente=$2::numeric,estado=CASE WHEN $2::numeric=0 THEN 'Pagada' ELSE 'Parcialmente pagada' END,
      updated_at=clock_timestamp() WHERE id_factura_proveedor=$1`,
      [invoiceId, invoiceBalance],
    );
    if (invoiceBalance === 0)
      await manager.query(
        `UPDATE factura_proveedor_programacion SET estado='Cancelada'
      WHERE id_factura_proveedor=$1 AND estado='Pendiente'`,
        [invoiceId],
      );
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
