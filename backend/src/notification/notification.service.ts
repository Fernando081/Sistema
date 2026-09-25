import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';

export interface AppNotification {
  idNotification: number; type: string; title: string; message: string;
  severity: 'info'|'warning'|'critical'; route?: string; readAt?: string; createdAt: string;
}

@Injectable()
export class NotificationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron('0 */10 * * * *')
  async refreshOperationalAlerts() {
    await this.dataSource.transaction(async manager => {
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT u.id_user,'crm_overdue','Seguimiento CRM vencido',
          concat(o.empresa,': ',coalesce(o.siguiente_accion,'Seguimiento pendiente')),'warning','/crm','crm_oportunidad',o.id_oportunidad,
          concat('crm-overdue:',o.id_oportunidad,':',u.id_user)
        FROM crm_oportunidad o JOIN auth_user u ON u.is_active AND
          (u.id_user=o.id_responsable OR (o.id_responsable IS NULL AND u.role='admin'))
        WHERE o.etapa NOT IN ('Ganada','Perdida') AND o.fecha_siguiente_accion<clock_timestamp()
        ON CONFLICT(dedupe_key) DO NOTHING`);
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT u.id_user,'backorder','Backorder pendiente',concat('Pedido ',p.folio,' · ',b.cantidad-b.cantidad_asignada,' piezas pendientes'),
          CASE WHEN b.created_at<clock_timestamp()-interval '7 days' THEN 'critical' ELSE 'warning' END,
          '/pedidos','backorder_cliente',b.id_backorder,concat('backorder:',b.id_backorder,':',u.id_user)
        FROM backorder_cliente b JOIN pedido_venta p ON p.id_pedido=b.id_pedido
        CROSS JOIN auth_user u WHERE u.is_active AND u.role='admin' AND b.estado IN ('Pendiente','Parcial')
        ON CONFLICT(dedupe_key) DO NOTHING`);
      await manager.query(`UPDATE app_notification n SET read_at=coalesce(n.read_at,clock_timestamp())
        WHERE n.type='crm_task_overdue' AND n.read_at IS NULL AND NOT EXISTS(
          SELECT 1 FROM crm_tarea t WHERE t.id_tarea=n.source_id
          AND t.estado IN ('Pendiente','En progreso') AND t.fecha_vencimiento<clock_timestamp())`);
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT t.id_responsable,'crm_task_overdue','Tarea CRM vencida',t.titulo,
          CASE WHEN t.prioridad='Urgente' OR t.fecha_vencimiento<clock_timestamp()-interval '1 day' THEN 'critical' ELSE 'warning' END,
          '/crm','crm_tarea',t.id_tarea,concat('crm-task-overdue:',t.id_tarea,':',t.id_responsable)
        FROM crm_tarea t JOIN auth_user u ON u.id_user=t.id_responsable AND u.is_active
        WHERE t.estado IN ('Pendiente','En progreso') AND t.fecha_vencimiento<clock_timestamp()
        ON CONFLICT(dedupe_key) DO UPDATE SET message=excluded.message,severity=excluded.severity`);
      await manager.query(`UPDATE app_notification n SET read_at=coalesce(n.read_at,clock_timestamp())
        WHERE n.read_at IS NULL AND (
          (n.type='quote_expiring' AND NOT EXISTS(SELECT 1 FROM cotizacion c WHERE c.id_cotizacion=n.source_id AND c.estatus='Pendiente' AND c.fecha_vencimiento<=clock_timestamp()+interval '3 days')) OR
          (n.type='warranty_due' AND NOT EXISTS(SELECT 1 FROM garantia g WHERE g.id_garantia=n.source_id AND g.estado NOT IN('Cerrada','Rechazada') AND g.fecha_compromiso<=clock_timestamp()+interval '2 days')) OR
          (n.type='collection_overdue' AND NOT EXISTS(SELECT 1 FROM factura f LEFT JOIN cliente_comercial cc ON cc.id_cliente=f.id_cliente JOIN metododepago mp ON mp."IdMetodoDePago"=f.id_metodo_pago WHERE f.id_factura=n.source_id AND f.saldo_pendiente>0 AND f.estatus::text<>'Cancelada' AND mp."Clave"='PPD' AND f.fecha_emision::date+coalesce(nullif(cc.dias_credito,0),30)<current_date)) OR
          (n.type='critical_stock' AND NOT EXISTS(SELECT 1 FROM vw_prediccion_demanda v WHERE v.id_producto=n.source_id AND v.cantidad_sugerida_compra>0 AND v.stock_actual<=greatest(1,ceil(v.vendido_30d/7.0))))
        )`);
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT u.id_user,'quote_expiring','Cotización por vencer',concat('Cotización ',c.folio,' · ',c.nombre_receptor,' · vence ',to_char(c.fecha_vencimiento,'DD/MM/YYYY')),
          CASE WHEN c.fecha_vencimiento<clock_timestamp() THEN 'critical' ELSE 'warning' END,'/cotizacion/historial','cotizacion',c.id_cotizacion,concat('quote-expiring:',c.id_cotizacion,':',u.id_user)
        FROM cotizacion c CROSS JOIN auth_user u
        WHERE u.is_active AND u.role='admin' AND c.estatus='Pendiente' AND c.fecha_vencimiento<=clock_timestamp()+interval '3 days'
        ON CONFLICT(dedupe_key) DO UPDATE SET message=excluded.message,severity=excluded.severity`);
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT u.id_user,'collection_overdue','Cobranza vencida',concat(f.serie,'-',f.folio,' · ',f.nombre_receptor,' · saldo $',to_char(f.saldo_pendiente,'FM999G999G990D00')),
          CASE WHEN f.fecha_emision::date+coalesce(nullif(cc.dias_credito,0),30)<current_date-30 THEN 'critical' ELSE 'warning' END,
          '/cobranza','factura',f.id_factura,concat('collection-overdue:',f.id_factura,':',u.id_user)
        FROM factura f LEFT JOIN cliente_comercial cc ON cc.id_cliente=f.id_cliente JOIN metododepago mp ON mp."IdMetodoDePago"=f.id_metodo_pago CROSS JOIN auth_user u
        WHERE u.is_active AND u.role='admin' AND f.saldo_pendiente>0 AND f.estatus::text<>'Cancelada' AND mp."Clave"='PPD'
          AND f.fecha_emision::date+coalesce(nullif(cc.dias_credito,0),30)<current_date
        ON CONFLICT(dedupe_key) DO UPDATE SET message=excluded.message,severity=excluded.severity`);
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT u.id_user,'warranty_due','Garantía próxima al compromiso',concat('Garantía ',g.id_garantia,' · ',c."RazonSocial",' · ',p."Codigo"),
          CASE WHEN g.fecha_compromiso<clock_timestamp() THEN 'critical' ELSE 'warning' END,'/garantias','garantia',g.id_garantia,concat('warranty-due:',g.id_garantia,':',u.id_user)
        FROM garantia g JOIN factura f ON f.id_factura=g.id_factura JOIN cliente c ON c."IdCliente"=f.id_cliente
        JOIN conceptofactura cf ON cf.id_concepto=g.id_concepto LEFT JOIN producto p ON p."IdProducto"=cf.id_producto
        JOIN auth_user u ON u.is_active AND (u.id_user=g.id_user OR (g.id_user IS NULL AND u.role='admin'))
        WHERE g.estado NOT IN('Cerrada','Rechazada') AND g.fecha_compromiso<=clock_timestamp()+interval '2 days'
        ON CONFLICT(dedupe_key) DO UPDATE SET message=excluded.message,severity=excluded.severity`);
      await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
        SELECT u.id_user,'critical_stock','Stock crítico',concat(v.codigo,' · ',v.descripcion,' · existencia ',v.stock_actual),
          CASE WHEN v.stock_actual<=0 THEN 'critical' ELSE 'warning' END,'/operaciones/smart-restock','producto',v.id_producto,concat('critical-stock:',v.id_producto,':',u.id_user)
        FROM vw_prediccion_demanda v CROSS JOIN auth_user u
        WHERE u.is_active AND u.role='admin' AND v.cantidad_sugerida_compra>0 AND v.stock_actual<=greatest(1,ceil(v.vendido_30d/7.0))
        ON CONFLICT(dedupe_key) DO UPDATE SET message=excluded.message,severity=excluded.severity`);
    });
  }

  async list(idUser: number) {
    await this.refreshOperationalAlerts();
    const items=await queryRows<AppNotification>(this.dataSource,`SELECT id_notification AS "idNotification",type,title,message,severity,route,
      read_at AS "readAt",created_at AS "createdAt" FROM app_notification WHERE id_user=$1
      ORDER BY (read_at IS NULL) DESC,created_at DESC LIMIT 40`,[idUser]);
    const total=await queryRows<{unread:number|string}>(this.dataSource,'SELECT count(*) AS unread FROM app_notification WHERE id_user=$1 AND read_at IS NULL',[idUser]);
    return {unread:Number(total[0]?.unread||0),items};
  }

  async markRead(idUser:number,idNotification:number){
    await this.dataSource.query('UPDATE app_notification SET read_at=coalesce(read_at,clock_timestamp()) WHERE id_notification=$1 AND id_user=$2',[idNotification,idUser]);
    return {message:'Notificación leída'};
  }

  async markAllRead(idUser:number){
    await this.dataSource.query('UPDATE app_notification SET read_at=clock_timestamp() WHERE id_user=$1 AND read_at IS NULL',[idUser]);
    return {message:'Notificaciones leídas'};
  }
}
