import { supplierRequest } from './supplier-request';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import {
  PaySupplierInvoiceDto,
  ScheduleSupplierPaymentDto,
} from './cuentas-proveedor.dto';
import { IdRow, InvoiceRow } from './cuentas-proveedor.types';
@Injectable()
export class PagosProveedorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  schedule(id: number, dto: ScheduleSupplierPaymentDto, idUser?: number) {
    return this.dataSource
      .transaction(async (manager) => {
        const invoices = await queryRows<InvoiceRow>(
          manager,
          `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
        FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`,
          [id],
        );
        if (!invoices.length)
          throw new NotFoundException('Factura no encontrada');
        if (!['Aprobada', 'Parcialmente pagada'].includes(invoices[0].estado))
          throw new ConflictException('La factura no está aprobada');
        await manager.query(
          `DELETE FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1 AND estado='Pendiente' AND notas='Programación inicial'`,
          [id],
        );
        const pending = await queryRows<{ total: string | number }>(
          manager,
          `SELECT coalesce(sum(monto),0) AS total FROM factura_proveedor_programacion
        WHERE id_factura_proveedor=$1 AND estado='Pendiente'`,
          [id],
        );
        if (
          this.money(Number(pending[0].total) + dto.monto) >
          this.money(Number(invoices[0].saldo))
        )
          throw new BadRequestException(
            'La programación supera el saldo sin programar',
          );
        return queryRows<IdRow>(
          manager,
          `INSERT INTO factura_proveedor_programacion(id_factura_proveedor,fecha_programada,monto,notas,id_user)
        VALUES($1,$2,$3,$4,$5) RETURNING id_programacion AS id`,
          [
            id,
            dto.fechaProgramada,
            dto.monto,
            dto.notas || null,
            idUser ?? null,
          ],
        );
      })
      .then((rows) => ({ idProgramacion: rows[0].id }));
  }

  pay(id: number, dto: PaySupplierInvoiceDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) =>
      supplierRequest(
        manager,
        dto.requestId,
        'supplier-payment',
        {
          idFacturaProveedor: id,
          idProgramacion: dto.idProgramacion || null,
          fecha: dto.fecha,
          monto: dto.monto,
          formaPago: dto.formaPago,
          referencia: dto.referencia || null,
          notas: dto.notas || null,
        },
        async () => {
          const old = await queryRows<IdRow>(
            manager,
            'SELECT id_pago AS id FROM factura_proveedor_pago WHERE request_id=$1',
            [dto.requestId],
          );
          if (old.length)
            throw new ConflictException(
              'Operación anterior sin huella de contenido; revisa el registro antes de reintentar',
            );
          const invoices = await queryRows<InvoiceRow>(
            manager,
            `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
        FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`,
            [id],
          );
          if (!invoices.length)
            throw new NotFoundException('Factura no encontrada');
          if (!['Aprobada', 'Parcialmente pagada'].includes(invoices[0].estado))
            throw new ConflictException('La factura no admite pagos');
          if (this.money(dto.monto) > this.money(Number(invoices[0].saldo)))
            throw new BadRequestException('El pago supera el saldo pendiente');
          if (dto.idProgramacion) {
            const schedule = await queryRows<{ monto: number | string }>(
              manager,
              `SELECT monto FROM factura_proveedor_programacion WHERE id_programacion=$1
          AND id_factura_proveedor=$2 AND estado='Pendiente' FOR UPDATE`,
              [dto.idProgramacion, id],
            );
            if (!schedule.length)
              throw new BadRequestException(
                'La programación no está disponible',
              );
            if (this.money(Number(schedule[0].monto)) !== this.money(dto.monto))
              throw new BadRequestException(
                'El pago debe coincidir con la programación',
              );
          }
          const payment = await queryRows<IdRow>(
            manager,
            `INSERT INTO factura_proveedor_pago(request_id,id_factura_proveedor,id_programacion,fecha,monto,forma_pago,referencia,notas,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_pago AS id`,
            [
              dto.requestId,
              id,
              dto.idProgramacion || null,
              dto.fecha,
              dto.monto,
              dto.formaPago,
              dto.referencia || null,
              dto.notas || null,
              idUser ?? null,
            ],
          );
          const balance = this.money(Number(invoices[0].saldo) - dto.monto);
          await manager.query(
            `UPDATE factura_proveedor SET saldo_pendiente=$2::numeric,estado=CASE WHEN $2::numeric=0 THEN 'Pagada' ELSE 'Parcialmente pagada' END,
        updated_at=clock_timestamp() WHERE id_factura_proveedor=$1`,
            [id, balance],
          );
          if (dto.idProgramacion)
            await manager.query(
              `UPDATE factura_proveedor_programacion SET estado='Pagada' WHERE id_programacion=$1`,
              [dto.idProgramacion],
            );
          if (balance === 0)
            await manager.query(
              `UPDATE factura_proveedor_programacion SET estado='Cancelada'
        WHERE id_factura_proveedor=$1 AND estado='Pendiente'`,
              [id],
            );
          const mxnAmount = this.money(
            dto.monto * Number(invoices[0].tipoCambio),
          );
          await manager.query(
            `UPDATE saldos SET caja_chica=caja_chica-CASE WHEN $2 ILIKE '%Efectivo%' THEN $1::numeric ELSE 0::numeric END,
        cuenta_banco=cuenta_banco-CASE WHEN $2 ILIKE '%Efectivo%' THEN 0::numeric ELSE $1::numeric END,updated_at=now()`,
            [mxnAmount, dto.formaPago],
          );
          return { idPago: payment[0].id, saldo: balance };
        },
      ),
    );
  }

  reversePayment(id: number, reason: string, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const payments = await queryRows<{
        idInvoice: number;
        amount: number | string;
        paymentDate: string;
        paymentMethod: string;
        state: string;
        idSchedule: number | null;
        balance: number | string;
        total: number | string;
        invoiceState: string;
        exchangeRate: number | string;
      }>(
        manager,
        `SELECT
        p.id_factura_proveedor AS "idInvoice",p.monto AS amount,p.fecha AS "paymentDate",p.forma_pago AS "paymentMethod",
        p.estado AS state,p.id_programacion AS "idSchedule",f.saldo_pendiente AS balance,f.total,f.estado AS "invoiceState",f.tipo_cambio AS "exchangeRate"
        FROM factura_proveedor_pago p JOIN factura_proveedor f ON f.id_factura_proveedor=p.id_factura_proveedor
        WHERE p.id_pago=$1 FOR UPDATE OF p,f`,
        [id],
      );
      if (!payments.length)
        throw new NotFoundException('Pago de proveedor no encontrado');
      const payment = payments[0];
      if (payment.state !== 'Activo')
        throw new ConflictException('El pago ya fue revertido');
      if (payment.invoiceState === 'Cancelada')
        throw new ConflictException(
          'No se puede modificar una factura cancelada',
        );
      await manager.query(
        `SELECT set_config('app.current_user_id',$1,true),set_config('app.movement_origin',$2,true)`,
        [
          idUser ? String(idUser) : '',
          `Reverso pago proveedor #${id}: ${reason}`,
        ],
      );
      await manager.query(
        `UPDATE factura_proveedor_pago SET estado='Revertido',revertido_por=$2,revertido_at=clock_timestamp(),
        motivo_reversion=$3 WHERE id_pago=$1`,
        [id, idUser ?? null, reason],
      );
      const newBalance = this.money(
        Number(payment.balance) + Number(payment.amount),
      );
      if (newBalance > this.money(Number(payment.total)))
        throw new ConflictException(
          'El reverso excedería el total de la factura',
        );
      await manager.query(
        `UPDATE factura_proveedor SET saldo_pendiente=$2,estado=CASE WHEN $2::numeric=$3::numeric THEN 'Aprobada' ELSE 'Parcialmente pagada' END,
        updated_at=clock_timestamp() WHERE id_factura_proveedor=$1`,
        [payment.idInvoice, newBalance, payment.total],
      );
      if (payment.idSchedule)
        await manager.query(
          `UPDATE factura_proveedor_programacion SET estado='Pendiente' WHERE id_programacion=$1`,
          [payment.idSchedule],
        );
      else
        await manager.query(
          `INSERT INTO factura_proveedor_programacion(id_factura_proveedor,fecha_programada,monto,notas,id_user)
        VALUES($1,$2,$3,$4,$5)`,
          [
            payment.idInvoice,
            payment.paymentDate,
            payment.amount,
            `Pago revertido: ${reason}`,
            idUser ?? null,
          ],
        );
      const mxnAmount = this.money(
        Number(payment.amount) * Number(payment.exchangeRate),
      );
      await manager.query(
        `UPDATE saldos SET caja_chica=caja_chica+CASE WHEN $2 ILIKE '%Efectivo%' THEN $1::numeric ELSE 0::numeric END,
        cuenta_banco=cuenta_banco+CASE WHEN $2 ILIKE '%Efectivo%' THEN 0::numeric ELSE $1::numeric END,updated_at=clock_timestamp()`,
        [mxnAmount, payment.paymentMethod],
      );
      return {
        message: 'Pago de proveedor revertido',
        idFacturaProveedor: payment.idInvoice,
        saldo: newBalance,
      };
    });
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
