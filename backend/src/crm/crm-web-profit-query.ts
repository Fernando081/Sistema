export interface WebProfitMetrics {
  baseCosto: 'snapshot-local-MXN';
  costoVentaNeto: string | null; utilidadBruta: string | null; margenBrutoPct: string | null;
  documentosConRentabilidad: number; documentosRentabilidadDesconocida: number;
  documentosSinCostoValido: number; documentosMonedaCostoNoComparable: number; documentosDetalleNoConciliado: number;
}

const finite = (value: string) => `${value} IS NOT NULL AND ${value}::text NOT IN ('NaN','Infinity','-Infinity')`;
const nonnegative = (value: string) => `(${finite(value)} AND ${value}>=0)`;
const positive = (value: string) => `(${finite(value)} AND ${value}>0)`;
const lineValid = (alias: string) => `COALESCE((${alias}.id_producto IS NOT NULL AND ${positive(`${alias}.cantidad`)}
  AND ${nonnegative(`${alias}.importe`)} AND ${nonnegative(`${alias}.descuento`)} AND ${alias}.descuento<=${alias}.importe
  AND ${nonnegative(`${alias}.importe_iva`)} AND ${nonnegative(`${alias}.importe_ret_isr`)}
  AND ${alias}.importe-${alias}.descuento+${alias}.importe_iva-${alias}.importe_ret_isr>=0),false)`;

// Consumes finance_rows, credit_links and returned_products in the same snapshot.
// Classic purchase/snapshot costs have no own currency and use local MXN in the
// existing ERP. Never convert an unproven snapshot to the currency of a sale.
export const webProfitCtes = `profit_sale_products AS MATERIALIZED (
  SELECT cf.id_factura,cf.id_producto,sum(cf.cantidad) AS quantity,
    sum(cf.importe-cf.descuento) AS net,sum(cf.importe-cf.descuento+cf.importe_iva-cf.importe_ret_isr) AS gross,
    sum(cf.cantidad*cf.costo_unitario_snapshot) AS cost,
    bool_and(${lineValid('cf')}) AS lines_ok,
    bool_and(COALESCE(${nonnegative('cf.costo_unitario_snapshot')},false)) AS snapshot_ok
  FROM finance_rows b JOIN conceptofactura cf USING(id_factura) GROUP BY cf.id_factura,cf.id_producto
), profit_sale_summary AS (
  SELECT id_factura,sum(net) AS net,sum(gross) AS gross,bool_and(lines_ok) AS lines_ok,bool_and(snapshot_ok) AS snapshot_ok
  FROM profit_sale_products GROUP BY id_factura
), profit_note_documents AS MATERIALIZED (
  SELECT nc.id_factura,nc.sale_id,
    COALESCE((nc.coherent AND count(cf.id_factura)>0 AND bool_and(${lineValid('cf')})
      AND sum(cf.importe-cf.descuento)=nc.subtotal-nc.descuento
      AND sum(cf.importe-cf.descuento+cf.importe_iva-cf.importe_ret_isr)=nc.total),false) AS ok
  FROM credit_links nc LEFT JOIN conceptofactura cf ON cf.id_factura=nc.id_factura WHERE NOT nc.cancelled
  GROUP BY nc.id_factura,nc.sale_id,nc.coherent,nc.subtotal,nc.descuento,nc.total
), profit_note_quantities AS MATERIALIZED (
  SELECT nc.sale_id,cf.id_producto,sum(cf.cantidad) AS quantity
  FROM profit_note_documents nc JOIN conceptofactura cf ON cf.id_factura=nc.id_factura GROUP BY nc.sale_id,cf.id_producto
), profit_note_summary AS (
  SELECT nc.sale_id,bool_and(nc.ok) AND NOT EXISTS(SELECT 1 FROM profit_note_quantities n
    WHERE n.sale_id=nc.sale_id AND NOT EXISTS(SELECT 1 FROM profit_sale_products s
      WHERE s.id_factura=n.sale_id AND s.id_producto=n.id_producto)) AS ok
  FROM profit_note_documents nc GROUP BY nc.sale_id
), profit_cost_parts AS (
  SELECT s.id_factura,
    COALESCE((s.lines_ok AND COALESCE(r.quantity,0)+COALESCE(n.quantity,0)<=s.quantity),false) AS ok,
    s.cost*(s.quantity-COALESCE(r.quantity,0)-COALESCE(n.quantity,0))/NULLIF(s.quantity,0) AS net_cost
  FROM profit_sale_products s LEFT JOIN returned_products r ON r.id_factura=s.id_factura AND r.id_producto=s.id_producto
  LEFT JOIN profit_note_quantities n ON n.sale_id=s.id_factura AND n.id_producto=s.id_producto
), profit_cost_summary AS (
  SELECT id_factura,bool_and(ok) AS ok,round(sum(net_cost),2) AS net_cost FROM profit_cost_parts GROUP BY id_factura
), profit_documents AS MATERIALIZED (
  SELECT b.id_factura,b.moneda,b.net_sales,cs.net_cost,
    COALESCE(s.snapshot_ok,false) AS snapshot_ok,
    COALESCE((b.moneda='MXN' AND b.tipo_cambio=1),false) AS comparable,
    COALESCE((b.net_ok AND s.lines_ok AND s.net=b.neto AND s.gross=b.total AND cs.ok AND COALESCE(n.ok,true)),false) AS detail_ok
  FROM finance_rows b LEFT JOIN profit_sale_summary s USING(id_factura)
  LEFT JOIN profit_note_summary n ON n.sale_id=b.id_factura LEFT JOIN profit_cost_summary cs USING(id_factura)
), profit_currency AS (
  SELECT moneda,
    CASE WHEN bool_and(snapshot_ok AND comparable AND detail_ok) THEN round(sum(net_cost),2)::text END AS cost,
    CASE WHEN bool_and(snapshot_ok AND comparable AND detail_ok) THEN round(sum(net_sales-net_cost),2)::text END AS gross_profit,
    CASE WHEN bool_and(snapshot_ok AND comparable AND detail_ok) AND sum(net_sales)>0
      THEN round(sum(net_sales-net_cost)/NULLIF(sum(net_sales),0)*100,2)::text END AS margin,
    count(*) FILTER(WHERE snapshot_ok AND comparable AND detail_ok)::int AS known,
    count(*) FILTER(WHERE NOT(snapshot_ok AND comparable AND detail_ok))::int AS unknown,
    count(*) FILTER(WHERE NOT snapshot_ok)::int AS missing,
    count(*) FILTER(WHERE NOT comparable)::int AS currency_mismatch,
    count(*) FILTER(WHERE NOT detail_ok)::int AS detail_mismatch
  FROM profit_documents GROUP BY moneda
)`;

export const webProfitProjection = `json_build_object('baseCosto','snapshot-local-MXN',
  'costoVentaNeto',(SELECT cost FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'utilidadBruta',(SELECT gross_profit FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'margenBrutoPct',(SELECT margin FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'documentosConRentabilidad',(SELECT known FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'documentosRentabilidadDesconocida',(SELECT unknown FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'documentosSinCostoValido',(SELECT missing FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'documentosMonedaCostoNoComparable',(SELECT currency_mismatch FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda),
  'documentosDetalleNoConciliado',(SELECT detail_mismatch FROM profit_currency pc WHERE pc.moneda=finance_rows.moneda)) AS profit`;
