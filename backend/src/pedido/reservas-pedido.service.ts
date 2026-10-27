import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { OrderRow, ExpiredReservationRow } from './pedido.types';
import { PersistenciaPedidoService } from './persistencia-pedido.service';
@Injectable()
export class ReservasPedidoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly persistencia: PersistenciaPedidoService,
  ) {}
  async releaseExpiredReservations(idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const expired = await queryRows<ExpiredReservationRow>(
        manager,
        `SELECT r.id_reserva AS "idReserva",r.id_pedido AS "idPedido",
        r.id_detalle AS "idDetalle",r.cantidad-r.cantidad_liberada AS "cantidadPendiente"
        FROM reserva_inventario r JOIN pedido_venta pv ON pv.id_pedido=r.id_pedido
        WHERE r.estado='Activa' AND r.expires_at IS NOT NULL AND r.expires_at<=now()
          AND pv.estado IN ('Confirmado','En espera','Parcialmente surtido')
        ORDER BY r.id_pedido,r.id_reserva FOR UPDATE OF r,pv`,
        [],
      );
      const affectedOrders = new Set<number>();
      for (const reservation of expired) {
        const quantity = Number(reservation.cantidadPendiente);
        if (quantity <= 0) continue;
        await manager.query(
          `UPDATE reserva_inventario SET cantidad_liberada=cantidad,estado='Liberada',updated_at=now()
          WHERE id_reserva=$1`,
          [reservation.idReserva],
        );
        await manager.query(
          `UPDATE pedido_venta_detalle SET cantidad_reservada=GREATEST(cantidad_surtida,cantidad_reservada-$2)
          WHERE id_detalle=$1`,
          [reservation.idDetalle, quantity],
        );
        await manager.query(
          `INSERT INTO backorder_cliente(id_pedido,id_detalle,id_cliente,id_producto,cantidad)
          SELECT d.id_pedido,d.id_detalle,pv.id_cliente,d.id_producto,$2 FROM pedido_venta_detalle d
          JOIN pedido_venta pv ON pv.id_pedido=d.id_pedido WHERE d.id_detalle=$1
          ON CONFLICT(id_detalle) DO UPDATE SET cantidad=backorder_cliente.cantidad+$2,
            estado='Pendiente',updated_at=now()`,
          [reservation.idDetalle, quantity],
        );
        affectedOrders.add(reservation.idPedido);
      }
      for (const idPedido of affectedOrders) {
        const orders = await queryRows<OrderRow>(
          manager,
          `SELECT id_pedido AS "idPedido",estado,version
          FROM pedido_venta WHERE id_pedido=$1 FOR UPDATE`,
          [idPedido],
        );
        const previous = orders[0].estado;
        const next =
          previous === 'Parcialmente surtido' ? previous : 'En espera';
        if (previous !== next)
          await manager.query(
            `UPDATE pedido_venta SET estado=$2,updated_at=now(),version=version+1
          WHERE id_pedido=$1`,
            [idPedido, next],
          );
        await this.persistencia.history(
          manager,
          idPedido,
          previous,
          next,
          'Reserva vencida; mercancía liberada y pendiente restituido',
          idUser,
        );
      }
      return {
        reservasLiberadas: expired.length,
        pedidosAfectados: affectedOrders.size,
      };
    });
  }
}
