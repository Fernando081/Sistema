import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { DetailRow, OrderRow } from './pedido.types';
@Injectable()
export class PersistenciaPedidoService {
  history(
    manager: EntityManager,
    idPedido: number,
    previous: string | null,
    next: string,
    detail: string,
    idUser?: number,
  ) {
    return manager.query(
      'INSERT INTO pedido_estado_historial(id_pedido,estado_anterior,estado_nuevo,detalle,id_user) VALUES($1,$2,$3,$4,$5)',
      [idPedido, previous, next, detail, idUser ?? null],
    );
  }

  async lockOrder(manager: EntityManager, idPedido: number) {
    const rows = await queryRows<OrderRow>(
      manager,
      'SELECT id_pedido AS "idPedido",estado,version FROM pedido_venta WHERE id_pedido=$1 FOR UPDATE',
      [idPedido],
    );
    if (!rows.length) throw new NotFoundException('Pedido no encontrado');
    return rows[0];
  }

  details(source: EntityManager, idPedido: number, lock = false) {
    return queryRows<DetailRow>(
      source,
      `SELECT id_detalle AS "idDetalle",id_producto AS "idProducto",cantidad,cantidad_reservada AS reservada,cantidad_surtida AS surtida,descripcion
      FROM pedido_venta_detalle WHERE id_pedido=$1 ORDER BY id_producto${lock ? ' FOR UPDATE' : ''}`,
      [idPedido],
    );
  }

  async findOneWith(source: DataSource | EntityManager, idPedido: number) {
    const rows = await queryRows<Record<string, unknown>>(
      source,
      `SELECT pv.*,pv.id_pedido AS "idPedido",pv.id_cliente AS "idCliente",pv.id_unidad AS "idUnidad",c."RazonSocial" AS cliente
      FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente WHERE pv.id_pedido=$1`,
      [idPedido],
    );
    if (!rows.length) throw new NotFoundException('Pedido no encontrado');
    const partidas = await queryRows<Record<string, unknown>>(
      source,
      `SELECT pd.id_detalle AS "idDetalle",pd.id_producto AS "idProducto",p."Codigo" AS codigo,pd.descripcion,pd.cantidad,pd.valor_unitario AS "valorUnitario",
      pd.importe,pd.importe_iva AS "importeIva",pd.cantidad_reservada AS "cantidadReservada",pd.cantidad_surtida AS "cantidadSurtida"
      FROM pedido_venta_detalle pd JOIN producto p ON p."IdProducto"=pd.id_producto WHERE pd.id_pedido=$1 ORDER BY pd.id_detalle`,
      [idPedido],
    );
    const picking = await queryRows<{
      idDetalle: number;
      ubicacion: string;
      almacen: string;
      cantidad: string | number;
      estado: string;
    }>(
      source,
      `
      SELECT ps.id_detalle AS "idDetalle",u.codigo AS ubicacion,a.nombre AS almacen,
        ps.cantidad,ps.estado FROM pedido_surtido_ubicacion ps
      JOIN almacen_ubicacion u ON u.id_ubicacion=ps.id_ubicacion
      JOIN almacen a ON a.id_almacen=u.id_almacen
      WHERE ps.id_pedido=$1 ORDER BY ps.id_surtido`,
      [idPedido],
    );
    return {
      ...rows[0],
      partidas: partidas.map((partida) => ({
        ...partida,
        picking: picking.filter(
          (pick) => Number(pick.idDetalle) === Number(partida.idDetalle),
        ),
      })),
    };
  }
}
