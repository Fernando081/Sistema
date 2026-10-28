import { CompraQueryDto, compraPage, compraCsv } from './compra-query';
// frontend/src/app/compra/compra.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCompraDto } from './compra.dto';
import { createHash } from 'node:crypto';
import { queryRows } from '../common/database/typed-query';
import { setAuditActor } from '../auth/audit-actor';

interface IdempotencyRow { response: Record<string, unknown>; payload_hash: string; }
interface ProductoIdRow { IdProducto: number; }
interface CompraIdRow { id_compra: number; }
interface BackorderRow { idBackorder: number; idPedido: number; idDetalle: number; pendiente: string | number; }

@Injectable()
export class CompraService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async create(createCompraDto: CreateCompraDto, idUser?: number) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await setAuditActor(queryRunner, idUser);
      const requestPayload = { ...createCompraDto };
      delete requestPayload.requestId;
      const payloadHash = createHash('sha256')
        .update(JSON.stringify(requestPayload))
        .digest('hex');
      if (createCompraDto.requestId) {
        await queryRunner.query(
          `SELECT pg_advisory_xact_lock(hashtext('compra-request:' || $1))`,
          [createCompraDto.requestId],
        );
        const previous = await queryRows<IdempotencyRow>(queryRunner,
          `SELECT response, payload_hash FROM operation_idempotency
            WHERE request_id = $1 AND operation_type = 'compra'`,
          [createCompraDto.requestId],
        );
        if (previous.length) {
          if (previous[0].payload_hash !== payloadHash) {
            throw new BadRequestException(
              'El identificador de reintento ya fue usado con datos diferentes',
            );
          }
          await queryRunner.commitTransaction();
          return previous[0].response;
        }
      }

      const productIds = [...new Set(createCompraDto.conceptos.map((c) => c.idProducto))].sort(
        (a, b) => a - b,
      );
      const products = await queryRows<ProductoIdRow>(queryRunner,
        `SELECT "IdProducto" FROM producto
          WHERE "IdProducto" = ANY($1::int[])
          ORDER BY "IdProducto" FOR UPDATE`,
        [productIds],
      );
      if (products.length !== productIds.length) {
        throw new BadRequestException('Uno o más productos ya no existen');
      }

      const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
      const conceptos = createCompraDto.conceptos.map((concepto) => ({
        ...concepto,
        importe: money(Number(concepto.cantidad) * Number(concepto.costoUnitario)),
      }));
      const total = money(conceptos.reduce((sum, concepto) => sum + concepto.importe, 0));
      if (Math.abs(total - createCompraDto.total) > 0.01) {
        throw new BadRequestException(
          'El total de la compra no coincide con el cálculo del servidor',
        );
      }
      const conceptosJson = JSON.stringify(conceptos);

      const result = await queryRows<CompraIdRow>(queryRunner,
        // Llamamos a la función con 6 parámetros ($1 a $6)
        `SELECT fn_crear_compra($1, $2, $3, $4, $5, $6) as id_compra`,
        [
          createCompraDto.idProveedor,
          createCompraDto.folioFactura || '',
          createCompraDto.esCredito, // <--- Nuevo
          total,
          createCompraDto.observaciones || '',
          conceptosJson,
        ],
      );
      const backordersAsignados = await this.allocateBackorders(queryRunner, productIds);
      if (!createCompraDto.esCredito) {
        await queryRunner.query(`INSERT INTO pago_proveedor (id_compra,monto,forma_pago,referencia,notas)
          VALUES ($1,$2,$3,'','Pago automático compra contado')`,
          [result[0].id_compra, total, createCompraDto.formaPago || 'Efectivo']);
      }

      const response = {
        message: 'Compra registrada con éxito. Inventario actualizado.',
        idCompra: result[0].id_compra,
        backordersAsignados,
      };
      if (createCompraDto.requestId) {
        await queryRunner.query(
          `INSERT INTO operation_idempotency(request_id, operation_type, id_user, payload_hash, response)
           VALUES ($1, 'compra', $2, $3, $4::jsonb)`,
          [createCompraDto.requestId, idUser ?? null, payloadHash, JSON.stringify(response)],
        );
      }
      await queryRunner.commitTransaction();
      return response;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async allocateBackorders(source: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, productIds: number[]) {
    let allocated = 0;
    for (const idProducto of productIds) {
      const stock = await queryRows<{ disponible: string | number }>(source, `SELECT GREATEST(0,p."Existencia"-
        COALESCE((SELECT sum(r.cantidad-r.cantidad_liberada) FROM reserva_inventario r
          WHERE r.id_producto=p."IdProducto" AND r.estado IN ('Activa','Surtida')),0)) AS disponible
        FROM producto p WHERE p."IdProducto"=$1 FOR UPDATE`, [idProducto]);
      let available = Number(stock[0]?.disponible || 0);
      if (available <= 0) continue;
      const backorders = await queryRows<BackorderRow>(source, `SELECT id_backorder AS "idBackorder",id_pedido AS "idPedido",
        id_detalle AS "idDetalle",cantidad-cantidad_asignada AS pendiente FROM backorder_cliente
        WHERE id_producto=$1 AND estado IN ('Pendiente','Parcial')
        ORDER BY prioridad,created_at,id_backorder FOR UPDATE SKIP LOCKED`, [idProducto]);
      for (const backorder of backorders) {
        if (available <= 0) break;
        const quantity = Math.min(available, Number(backorder.pendiente));
        if (quantity <= 0) continue;
        await source.query(`INSERT INTO reserva_inventario(id_pedido,id_detalle,id_producto,cantidad)
          VALUES($1,$2,$3,$4)`, [backorder.idPedido, backorder.idDetalle, idProducto, quantity]);
        await source.query(`UPDATE pedido_venta_detalle SET cantidad_reservada=cantidad_reservada+$2
          WHERE id_detalle=$1`, [backorder.idDetalle, quantity]);
        await source.query(`UPDATE backorder_cliente SET cantidad_asignada=cantidad_asignada+$2,
          estado=CASE WHEN cantidad_asignada+$2>=cantidad THEN 'Cubierto' ELSE 'Parcial' END,updated_at=now()
          WHERE id_backorder=$1`, [backorder.idBackorder, quantity]);
        await source.query(`UPDATE pedido_venta pv SET estado=CASE
          WHEN EXISTS(SELECT 1 FROM backorder_cliente b WHERE b.id_pedido=pv.id_pedido
            AND b.estado IN ('Pendiente','Parcial')) THEN pv.estado
          WHEN EXISTS(SELECT 1 FROM pedido_venta_detalle d WHERE d.id_pedido=pv.id_pedido AND d.cantidad_surtida>0)
            THEN 'Parcialmente surtido' ELSE 'Confirmado' END,
          updated_at=now(),version=version+1 WHERE pv.id_pedido=$1 AND pv.estado IN ('En espera','Parcialmente surtido')`, [backorder.idPedido]);
        allocated += quantity;
        available -= quantity;
      }
    }
    return allocated;
  }

  async findAll(page = 1, limit = 10, term = '', sortBy = '', sortOrder = '', estado = '', desde = '', hasta = '') {
    return compraPage(this.dataSource, Object.assign(new CompraQueryDto(), { page: Math.max(1, page), limit: Math.min(100, Math.max(1, limit)), term, sortBy, sortOrder, estado, desde, hasta }));
  }
  exportCsv(query: CompraQueryDto) { return compraCsv(this.dataSource, query); }

  async findDetalle(idCompra: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, 'SELECT * FROM fn_get_detalle_compra($1)', [
      idCompra,
    ]);
  }
}
