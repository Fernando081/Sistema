import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { PedidoQueryDto } from './pedido.dto';
import { PersistenciaPedidoService } from './persistencia-pedido.service';
@Injectable()
export class ConsultasPedidoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly persistencia: PersistenciaPedidoService,
  ) {}
  async findAll(query: PedidoQueryDto) {
    const page = query.page || 1,
      limit = query.limit || 25,
      offset = (page - 1) * limit;
    const q = `%${(query.q || '').replace(/[\\%_]/g, '\\$&')}%`;
    const params = [query.estado || null, q, limit, offset];
    const where = `WHERE ($1::text IS NULL OR pv.estado=$1) AND (pv.folio::text ILIKE $2 ESCAPE '\\' OR c."RazonSocial" ILIKE $2 ESCAPE '\\' OR c."RFC" ILIKE $2 ESCAPE '\\')`;
    const [data, counts] = await Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT pv.id_pedido AS "idPedido",pv.folio,pv.estado,pv.total,pv.created_at AS "createdAt",pv.updated_at AS "updatedAt",
        c."RazonSocial" AS cliente,c."RFC" AS rfc,COALESCE(sum(pd.cantidad-pd.cantidad_reservada),0) AS "cantidadPendiente"
        FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente JOIN pedido_venta_detalle pd ON pd.id_pedido=pv.id_pedido ${where}
        GROUP BY pv.id_pedido,c."RazonSocial",c."RFC" ORDER BY pv.created_at DESC LIMIT $3 OFFSET $4`,
        params,
      ),
      queryRows<{ total: string | number }>(
        this.dataSource,
        `SELECT count(*) AS total FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente ${where}`,
        params.slice(0, 2),
      ),
    ]);
    return { data, total: Number(counts[0].total), page, limit };
  }

  findOne(idPedido: number) {
    return this.persistencia.findOneWith(this.dataSource, idPedido);
  }

  async backorders() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT b.id_backorder AS "idBackorder",b.id_pedido AS "idPedido",pv.folio,b.cantidad,b.cantidad_asignada AS "cantidadAsignada",b.prioridad,b.estado,b.created_at AS "createdAt",
      c."RazonSocial" AS cliente,p."Codigo" AS codigo,p."Descripcion" AS producto FROM backorder_cliente b
      JOIN pedido_venta pv ON pv.id_pedido=b.id_pedido JOIN cliente c ON c."IdCliente"=b.id_cliente JOIN producto p ON p."IdProducto"=b.id_producto
      WHERE b.estado IN ('Pendiente','Parcial') ORDER BY b.prioridad,b.created_at`,
    );
  }

  async expiredReservations() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT r.id_reserva AS "idReserva",r.id_pedido AS "idPedido",pv.folio,
      r.id_producto AS "idProducto",p."Codigo" AS codigo,p."Descripcion" AS producto,
      r.cantidad-r.cantidad_liberada AS cantidad,r.expires_at AS "expiresAt",c."RazonSocial" AS cliente
      FROM reserva_inventario r JOIN pedido_venta pv ON pv.id_pedido=r.id_pedido
      JOIN cliente c ON c."IdCliente"=pv.id_cliente JOIN producto p ON p."IdProducto"=r.id_producto
      WHERE r.estado='Activa' AND r.expires_at IS NOT NULL AND r.expires_at<=now()
      ORDER BY r.expires_at,r.id_reserva`,
    );
  }

  async availability(idProducto: number) {
    const rows = await queryRows<{
      existencia: string | number;
      reservada: string | number;
    }>(
      this.dataSource,
      `SELECT p."Existencia" AS existencia,
      COALESCE(sum(r.cantidad-r.cantidad_liberada) FILTER(WHERE r.estado IN ('Activa','Surtida')),0) AS reservada
      FROM producto p LEFT JOIN reserva_inventario r ON r.id_producto=p."IdProducto" WHERE p."IdProducto"=$1 GROUP BY p."IdProducto"`,
      [idProducto],
    );
    if (!rows.length) throw new NotFoundException('Producto no encontrado');
    const physical = Number(rows[0].existencia),
      reserved = Number(rows[0].reservada);
    return {
      existenciaFisica: physical,
      reservada: reserved,
      disponible: Math.max(0, physical - reserved),
    };
  }
}
