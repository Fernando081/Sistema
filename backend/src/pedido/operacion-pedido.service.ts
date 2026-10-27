import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { EntregarPedidoDto, SurtirPedidoDto } from './pedido.dto';
import { DetailRow } from './pedido.types';
import { PersistenciaPedidoService } from './persistencia-pedido.service';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
@Injectable()
export class OperacionPedidoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly persistencia: PersistenciaPedidoService,
  ) {}
  async confirm(idPedido: number, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.persistencia.lockOrder(manager, idPedido);
      if (order.estado !== 'Borrador')
        throw new ConflictException(
          'Solo se puede confirmar un pedido en borrador',
        );
      const details = await this.persistencia.details(manager, idPedido, true);
      let hasBackorder = false;
      for (const detail of details.sort(
        (a, b) => a.idProducto - b.idProducto,
      )) {
        const products = await queryRows<{ existencia: string | number }>(
          manager,
          'SELECT "Existencia" AS existencia FROM producto WHERE "IdProducto"=$1 FOR UPDATE',
          [detail.idProducto],
        );
        const reserved = await queryRows<{ total: string | number }>(
          manager,
          `SELECT COALESCE(sum(cantidad-cantidad_liberada),0) AS total FROM reserva_inventario
          WHERE id_producto=$1 AND estado IN ('Activa','Surtida')`,
          [detail.idProducto],
        );
        const available = Math.max(
          0,
          Number(products[0].existencia) - Number(reserved[0].total),
        );
        const requested = Number(detail.cantidad);
        const quantity = Math.min(requested, available);
        if (quantity > 0)
          await manager.query(
            `INSERT INTO reserva_inventario(id_pedido,id_detalle,id_producto,cantidad) VALUES($1,$2,$3,$4)`,
            [idPedido, detail.idDetalle, detail.idProducto, quantity],
          );
        if (requested > quantity) {
          hasBackorder = true;
          await manager.query(
            `INSERT INTO backorder_cliente(id_pedido,id_detalle,id_cliente,id_producto,cantidad)
            SELECT $1,$2,id_cliente,$3,$4 FROM pedido_venta WHERE id_pedido=$1`,
            [
              idPedido,
              detail.idDetalle,
              detail.idProducto,
              requested - quantity,
            ],
          );
        }
        await manager.query(
          'UPDATE pedido_venta_detalle SET cantidad_reservada=$2 WHERE id_detalle=$1',
          [detail.idDetalle, quantity],
        );
      }
      const next = hasBackorder ? 'En espera' : 'Confirmado';
      await manager.query(
        'UPDATE pedido_venta SET estado=$2,updated_at=now(),version=version+1 WHERE id_pedido=$1',
        [idPedido, next],
      );
      await this.persistencia.history(
        manager,
        idPedido,
        order.estado,
        next,
        hasBackorder
          ? 'Confirmado con partidas pendientes'
          : 'Existencia reservada',
        idUser,
      );
      return this.persistencia.findOneWith(manager, idPedido);
    });
  }

  async fulfill(idPedido: number, dto: SurtirPedidoDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.persistencia.lockOrder(manager, idPedido);
      if (
        !['Confirmado', 'En espera', 'Parcialmente surtido'].includes(
          order.estado,
        )
      )
        throw new ConflictException(
          'El pedido no está disponible para surtido',
        );
      const details = await this.persistencia.details(manager, idPedido, true);
      const map = new Map(details.map((d) => [d.idDetalle, d]));
      if (
        new Set(dto.partidas.map((p) => p.idDetalle)).size !==
        dto.partidas.length
      )
        throw new BadRequestException('Hay partidas repetidas');
      for (const item of dto.partidas) {
        const detail = map.get(item.idDetalle);
        if (!detail)
          throw new BadRequestException('Una partida no pertenece al pedido');
        if (
          Number(detail.surtida) + item.cantidad >
          Number(detail.reservada) + 0.000001
        )
          throw new BadRequestException(
            `La cantidad surtida de ${detail.descripcion} supera lo reservado`,
          );
        await this.allocatePicking(
          manager,
          idPedido,
          detail,
          item.cantidad,
          idUser,
        );
        await manager.query(
          'UPDATE pedido_venta_detalle SET cantidad_surtida=cantidad_surtida+$2 WHERE id_detalle=$1',
          [item.idDetalle, item.cantidad],
        );
      }
      const pending = await queryRows<{
        reservedPending: string | number;
        backorderPending: string | number;
      }>(
        manager,
        `SELECT
        COALESCE((SELECT sum(cantidad_reservada-cantidad_surtida) FROM pedido_venta_detalle WHERE id_pedido=$1),0) AS "reservedPending",
        COALESCE((SELECT sum(cantidad-cantidad_asignada) FROM backorder_cliente WHERE id_pedido=$1 AND estado IN ('Pendiente','Parcial')),0) AS "backorderPending"`,
        [idPedido],
      );
      const hasReservedPending = Number(pending[0].reservedPending) > 0;
      const hasBackorderPending = Number(pending[0].backorderPending) > 0;
      const next =
        hasReservedPending || hasBackorderPending
          ? 'Parcialmente surtido'
          : 'Surtido';
      await manager.query(
        `UPDATE reserva_inventario r SET estado=CASE WHEN d.cantidad_surtida>=d.cantidad_reservada THEN 'Surtida' ELSE r.estado END,updated_at=now()
        FROM pedido_venta_detalle d WHERE r.id_detalle=d.id_detalle AND r.id_pedido=$1 AND r.estado='Activa'`,
        [idPedido],
      );
      await manager.query(
        'UPDATE pedido_venta SET estado=$2,updated_at=now(),version=version+1 WHERE id_pedido=$1',
        [idPedido, next],
      );
      await this.persistencia.history(
        manager,
        idPedido,
        order.estado,
        next,
        'Surtido registrado',
        idUser,
      );
      return this.persistencia.findOneWith(manager, idPedido);
    });
  }

  async cancel(idPedido: number, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.persistencia.lockOrder(manager, idPedido);
      if (['Cancelado', 'Entregado', 'Facturado'].includes(order.estado))
        throw new ConflictException('El pedido ya no se puede cancelar');
      await manager.query(
        `UPDATE reserva_inventario SET cantidad_liberada=cantidad,estado='Liberada',updated_at=now() WHERE id_pedido=$1 AND estado IN ('Activa','Surtida')`,
        [idPedido],
      );
      await manager.query(
        `UPDATE pedido_surtido_ubicacion SET estado='Liberada',updated_at=now()
        WHERE id_pedido=$1 AND estado='Reservada'`,
        [idPedido],
      );
      await manager.query(
        `UPDATE backorder_cliente SET estado='Cancelado',updated_at=now() WHERE id_pedido=$1 AND estado IN ('Pendiente','Parcial')`,
        [idPedido],
      );
      await manager.query(
        `UPDATE pedido_venta SET estado='Cancelado',updated_at=now(),version=version+1 WHERE id_pedido=$1`,
        [idPedido],
      );
      await this.persistencia.history(
        manager,
        idPedido,
        order.estado,
        'Cancelado',
        'Reservas y pendientes liberados',
        idUser,
      );
      return { message: 'Pedido cancelado' };
    });
  }

  async deliver(idPedido: number, dto: EntregarPedidoDto, idUser?: number, actor?: JwtPayload) {
    return this.dataSource.transaction(async (manager) => {
      if(actor){
        const users=await queryRows(manager,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3
          AND fn_effective_permission(id_user,role,'pedidos.entregas') FOR SHARE`,[actor.idUser??null,actor.role,actor.version]);
        if(!users.length)throw new ForbiddenException('Tu cuenta o permiso de entregas cambió.');
        idUser=actor.idUser;await setAuditActor(manager,idUser);
      }
      const order = await this.persistencia.lockOrder(manager, idPedido);
      if (order.estado !== 'Surtido')
        throw new ConflictException(
          'Solo un pedido completamente surtido puede entregarse',
        );
      await manager.query(
        'INSERT INTO entrega_pedido(id_pedido,recibido_por,notas,id_user) VALUES($1,$2,$3,$4)',
        [idPedido, dto.recibidoPor || null, dto.notas || null, idUser ?? null],
      );
      await manager.query(
        `UPDATE pedido_venta SET estado='Entregado',updated_at=now(),version=version+1 WHERE id_pedido=$1`,
        [idPedido],
      );
      await this.persistencia.history(
        manager,
        idPedido,
        order.estado,
        'Entregado',
        dto.recibidoPor ? `Recibió: ${dto.recibidoPor}` : 'Entrega registrada',
        idUser,
      );
      return this.persistencia.findOneWith(manager, idPedido);
    });
  }

  private async allocatePicking(
    manager: EntityManager,
    idPedido: number,
    detail: DetailRow,
    quantity: number,
    idUser?: number,
  ) {
    const locations = await queryRows<{
      idUbicacion: number;
      disponible: string | number;
    }>(
      manager,
      `
      SELECT i.id_ubicacion AS "idUbicacion",i.cantidad-COALESCE((SELECT sum(ps.cantidad-ps.cantidad_consumida)
        FROM pedido_surtido_ubicacion ps WHERE ps.id_ubicacion=i.id_ubicacion AND ps.id_producto=i.id_producto
          AND ps.estado='Reservada'),0) AS disponible
      FROM inventario_ubicacion i JOIN almacen_ubicacion u ON u.id_ubicacion=i.id_ubicacion
      JOIN almacen a ON a.id_almacen=u.id_almacen
      WHERE i.id_producto=$1 AND i.cantidad>0 AND u.activa AND a.activo
      ORDER BY(a.es_principal AND u.codigo='GENERAL')DESC,a.es_principal DESC,i.id_ubicacion
      FOR UPDATE OF i`,
      [detail.idProducto],
    );
    let pending = quantity;
    for (const location of locations) {
      if (pending < 0.000001) break;
      const picked = Math.min(
        pending,
        Math.max(0, Number(location.disponible)),
      );
      if (picked <= 0) continue;
      await manager.query(
        `INSERT INTO pedido_surtido_ubicacion(id_pedido,id_detalle,id_producto,id_ubicacion,cantidad,id_user)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [
          idPedido,
          detail.idDetalle,
          detail.idProducto,
          location.idUbicacion,
          picked,
          idUser ?? null,
        ],
      );
      pending -= picked;
    }
    if (pending >= 0.000001)
      throw new ConflictException(
        `No hay existencia libre por ubicación para surtir ${detail.descripcion}`,
      );
  }
}
