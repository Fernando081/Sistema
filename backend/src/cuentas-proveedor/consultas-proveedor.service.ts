import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
@Injectable()
export class ConsultasProveedorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  listInvoices() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT f.id_factura_proveedor AS "idFacturaProveedor",f.id_proveedor AS "idProveedor",f.id_orden AS "idOrden",
    f.serie,f.folio,f.uuid,f.fecha_emision AS "fechaEmision",f.fecha_vencimiento AS "fechaVencimiento",f.total,f.saldo_pendiente AS saldo,
    f.estado,f.moneda,p."RazonSocial" AS proveedor,o.folio AS "folioOrden",(f.xml_original IS NOT NULL) AS "tieneXml",(f.pdf_original IS NOT NULL) AS "tienePdf",
    count(d.id_discrepancia) FILTER(WHERE d.estado='Pendiente')::int AS "discrepanciasPendientes"
    FROM factura_proveedor f JOIN proveedor p ON p."IdProveedor"=f.id_proveedor JOIN orden_compra o ON o.id_orden=f.id_orden
    LEFT JOIN factura_proveedor_discrepancia d ON d.id_factura_proveedor=f.id_factura_proveedor
    GROUP BY f.id_factura_proveedor,p."RazonSocial",o.folio ORDER BY f.created_at DESC LIMIT 250`,
    );
  }

  async invoice(id: number) {
    const rows = await queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT f.*,f.id_factura_proveedor AS "idFacturaProveedor",f.id_proveedor AS "idProveedor",
      f.fecha_emision AS "fechaEmision",f.fecha_vencimiento AS "fechaVencimiento",f.saldo_pendiente AS saldo,
      f.cancelada_at AS "canceladaAt",f.motivo_cancelacion AS "motivoCancelacion",cu.username AS "canceladaPor",
      (f.xml_original IS NOT NULL) AS "tieneXml",(f.pdf_original IS NOT NULL) AS "tienePdf",
      p."RazonSocial" AS proveedor,o.folio AS "folioOrden" FROM factura_proveedor f JOIN proveedor p ON p."IdProveedor"=f.id_proveedor
      JOIN orden_compra o ON o.id_orden=f.id_orden LEFT JOIN auth_user cu ON cu.id_user=f.cancelada_por WHERE f.id_factura_proveedor=$1`,
      [id],
    );
    if (!rows.length)
      throw new NotFoundException('Factura de proveedor no encontrada');
    const [details, discrepancies, schedules, payments, applications] =
      await Promise.all([
        queryRows<Record<string, unknown>>(
          this.dataSource,
          `SELECT d.id_detalle AS "idDetalle",d.id_producto AS "idProducto",p."Codigo" AS codigo,d.descripcion,d.cantidad,
        d.costo_unitario AS "costoUnitario",d.tasa_iva AS "tasaIva",d.importe,coalesce(sum(r.cantidad),0) AS conciliada
        FROM factura_proveedor_detalle d JOIN producto p ON p."IdProducto"=d.id_producto LEFT JOIN factura_proveedor_recepcion r ON r.id_factura_detalle=d.id_detalle
        WHERE d.id_factura_proveedor=$1 GROUP BY d.id_detalle,p."Codigo" ORDER BY d.id_detalle`,
          [id],
        ),
        queryRows<Record<string, unknown>>(
          this.dataSource,
          `SELECT id_discrepancia AS "idDiscrepancia",tipo,esperado,recibido,diferencia,estado,justificacion,created_at AS "createdAt"
        FROM factura_proveedor_discrepancia WHERE id_factura_proveedor=$1 ORDER BY id_discrepancia`,
          [id],
        ),
        queryRows<Record<string, unknown>>(
          this.dataSource,
          `SELECT id_programacion AS "idProgramacion",fecha_programada AS "fechaProgramada",monto,estado,notas
        FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1 ORDER BY fecha_programada`,
          [id],
        ),
        queryRows<Record<string, unknown>>(
          this.dataSource,
          `SELECT p.id_pago AS "idPago",p.fecha,p.monto,p.forma_pago AS "formaPago",p.referencia,p.estado,
        p.revertido_at AS "revertidoAt",p.motivo_reversion AS "motivoReversion",u.username AS "revertidoPor"
        FROM factura_proveedor_pago p LEFT JOIN auth_user u ON u.id_user=p.revertido_por
        WHERE p.id_factura_proveedor=$1 ORDER BY p.fecha DESC,p.id_pago DESC`,
          [id],
        ),
        queryRows<Record<string, unknown>>(
          this.dataSource,
          `SELECT tipo,monto,estado,created_at AS "createdAt",motivo_reversion AS "motivoReversion"
        FROM aplicacion_proveedor WHERE id_factura_proveedor=$1 ORDER BY created_at DESC`,
          [id],
        ),
      ]);
    return {
      ...rows[0],
      partidas: details,
      discrepancias: discrepancies,
      programaciones: schedules,
      pagos: payments,
      aplicaciones: applications,
    };
  }

  dashboard() {
    return Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT coalesce(sum(saldo_pendiente*tipo_cambio),0) AS total,
      coalesce(sum(saldo_pendiente*tipo_cambio) FILTER(WHERE fecha_vencimiento<current_date),0) AS vencido,
      count(*) FILTER(WHERE estado='Con discrepancias')::int AS discrepancias,
      count(*) FILTER(WHERE estado='Por conciliar')::int AS "porConciliar" FROM factura_proveedor WHERE estado<>'Cancelada'`,
      ),
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT CASE WHEN fecha_vencimiento>=current_date THEN 'Por vencer'
      WHEN current_date-fecha_vencimiento BETWEEN 1 AND 30 THEN '1-30' WHEN current_date-fecha_vencimiento BETWEEN 31 AND 60 THEN '31-60'
      WHEN current_date-fecha_vencimiento BETWEEN 61 AND 90 THEN '61-90' ELSE 'Más de 90' END AS rango,
      count(*)::int AS facturas,coalesce(sum(saldo_pendiente*tipo_cambio),0) AS saldo FROM factura_proveedor
      WHERE saldo_pendiente>0 AND estado IN ('Aprobada','Parcialmente pagada') GROUP BY 1 ORDER BY min(fecha_vencimiento)`,
      ),
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT rd.id_detalle AS "idRecepcionDetalle",r.id_recepcion AS "idRecepcion",o.folio AS "folioOrden",
      p."RazonSocial" AS proveedor,pr."Codigo" AS codigo,pr."Descripcion" AS producto,r.created_at AS "fechaRecepcion",
      rd.cantidad-coalesce(sum(fr.cantidad),0) AS pendiente
      FROM recepcion_compra_detalle rd JOIN recepcion_compra r ON r.id_recepcion=rd.id_recepcion JOIN orden_compra o ON o.id_orden=r.id_orden
      JOIN proveedor p ON p."IdProveedor"=o.id_proveedor JOIN producto pr ON pr."IdProducto"=rd.id_producto
      LEFT JOIN factura_proveedor_recepcion fr ON fr.id_recepcion_detalle=rd.id_detalle
      LEFT JOIN factura_proveedor_detalle fd ON fd.id_detalle=fr.id_factura_detalle
      LEFT JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor AND f.estado<>'Cancelada'
      GROUP BY rd.id_detalle,r.id_recepcion,o.folio,p."RazonSocial",pr."Codigo",pr."Descripcion",r.created_at
      HAVING rd.cantidad-coalesce(sum(fr.cantidad) FILTER(WHERE f.id_factura_proveedor IS NOT NULL),0)>.000001 ORDER BY r.created_at LIMIT 200`,
      ),
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT id_anticipo AS id,id_proveedor AS "idProveedor",fecha,monto,saldo_disponible AS saldo,
      forma_pago AS "formaPago",referencia FROM anticipo_proveedor WHERE saldo_disponible>0 AND estado='Disponible' ORDER BY fecha`,
      ),
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT id_nota AS id,id_proveedor AS "idProveedor",fecha,folio,total,saldo_disponible AS saldo
      FROM nota_credito_proveedor WHERE saldo_disponible>0 AND estado='Disponible' ORDER BY fecha`,
      ),
    ]).then(([summary, aging, unbilled, advances, credits]) => ({
      resumen: summary[0],
      antiguedad: aging,
      recibidoSinFactura: unbilled,
      anticipos: advances,
      notasCredito: credits,
    }));
  }
}
