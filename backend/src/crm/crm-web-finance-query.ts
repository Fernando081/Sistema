// These CTEs consume valid_sales from the explicit CRM document chain. Amounts
// stay PostgreSQL numeric until serialized as fixed-point strings. No FX, PUE
// assumption, balance-derived payment or global-invoice container is a sale here.
import { WebProfitMetrics, webProfitCtes, webProfitProjection } from './crm-web-profit-query';
import { WebCashMetrics, webCashCtes, webCashProjection } from './crm-web-cash-query';

export interface WebFinancialCurrency {
  moneda: string; documentos: number;
  importeDocumentado: string | null; ventasNetasSinImpuestos: string | null;
  notasCredito: string | null; devoluciones: string | null;
  cobrosRegistrados: string | null; saldoRegistrado: string | null;
  documentosNetoDesconocido: number; documentosCobroDesconocido: number;
  documentosSaldoDesconocido: number; documentosSinPagos: number; documentosSaldoNoConciliado: number;
  profit: WebProfitMetrics;
  cash: WebCashMetrics;
}
export interface WebFinancialMetrics {
  currencies: WebFinancialCurrency[];
  coverage: { documentosVinculados: number; documentosFinancieros: number;
    globalesExcluidas: number; monedaDesconocida: number; importesInconsistentes: number;
    notasCanceladasExcluidas: number; repsCanceladosExcluidos: number; pagosRepCompatibilidadOmitidos: number };
}

// Server-owned currency allowlist from Node 24's ICU data. Unknown/XXX codes
// remain in coverage but never become a fabricated currency total.
export const webFinancialCurrencies = Intl.supportedValuesOf('currency');

const finite = (value: string) => `${value} IS NOT NULL AND ${value}::text NOT IN ('NaN','Infinity','-Infinity')`;
const nonnegative = (value: string) => `(${finite(value)} AND ${value}>=0)`;
const positive = (value: string) => `(${finite(value)} AND ${value}>0)`;
const headerValid = (alias: string) => `COALESCE((${['subtotal','descuento','total_impuestos_trasladados','total_impuestos_retenidos','total']
  .map(field => nonnegative(`${alias}.${field}`)).join(' AND ')} AND ${alias}.descuento<=${alias}.subtotal
  AND ${alias}.total=${alias}.subtotal-${alias}.descuento+${alias}.total_impuestos_trasladados-${alias}.total_impuestos_retenidos),false)`;

export const webFinanceCtes = `finance_documents AS MATERIALIZED (
  SELECT f.*,f.subtotal-f.descuento AS neto,${headerValid('f')} AS header_ok,
    COALESCE((f.moneda=ANY($3::text[])),false) AS currency_ok,
    (COALESCE(f.serie='G',false) OR EXISTS(SELECT 1 FROM factura t WHERE t.id_factura_global=f.id_factura)) AS is_global
  FROM factura f JOIN (SELECT DISTINCT id_factura FROM valid_sales) v USING(id_factura)
), finance_base AS MATERIALIZED (
  SELECT * FROM finance_documents WHERE NOT is_global
), credit_links AS MATERIALIZED (
  SELECT nc.*,b.id_factura AS sale_id,
    COALESCE((nc.estatus::text IN ('Cancelada','Cancelado') OR EXISTS
      (SELECT 1 FROM fiscal_documento fd WHERE fd.id_factura=nc.id_factura AND fd.estado='Cancelado')),false) AS cancelled,
    COALESCE((nc.estatus IS NOT NULL AND nc.id_cliente=b.id_cliente AND nc.moneda=b.moneda
      AND ${headerValid('nc')} AND nc.id_factura_global IS NULL AND nc.serie<>'G'),false) AS coherent
  FROM finance_base b JOIN factura nc ON nc.id_factura_origen=b.id_factura AND nc.tipo_comprobante='E'
), credits AS (
  SELECT sale_id,count(*) FILTER(WHERE NOT cancelled)::int AS count,
    COALESCE(bool_and(coherent) FILTER(WHERE NOT cancelled),true) AS ok,
    COALESCE(sum(total) FILTER(WHERE NOT cancelled),0) AS gross,
    COALESCE(sum(subtotal-descuento) FILTER(WHERE NOT cancelled),0) AS net
  FROM credit_links GROUP BY sale_id
), sale_products AS MATERIALIZED (
  SELECT cf.id_factura,cf.id_producto,sum(cf.cantidad) AS quantity,
    sum(cf.importe-cf.descuento) AS net,
    sum(cf.importe-cf.descuento+cf.importe_iva-cf.importe_ret_isr) AS gross,
    bool_and(${positive('cf.cantidad')} AND ${nonnegative('cf.importe')} AND ${nonnegative('cf.descuento')}
      AND cf.descuento<=cf.importe AND ${nonnegative('cf.importe_iva')} AND ${nonnegative('cf.importe_ret_isr')}
      AND cf.importe-cf.descuento+cf.importe_iva-cf.importe_ret_isr>=0) AS ok
  FROM finance_base b JOIN conceptofactura cf USING(id_factura)
  WHERE EXISTS(SELECT 1 FROM devolucion d WHERE d.id_factura=b.id_factura)
  GROUP BY cf.id_factura,cf.id_producto
), sale_product_totals AS (
  SELECT id_factura,sum(net) AS net,sum(gross) AS gross,bool_and(ok) AS ok FROM sale_products GROUP BY id_factura
), return_documents AS MATERIALIZED (
  SELECT d.*,b.moneda,
    COALESCE((${nonnegative('d.monto_total')} AND d.metodo_reembolso IN ('Efectivo','Saldo a Favor')
      AND count(dd.id_devolucion)>0 AND bool_and(${positive('dd.cantidad')} AND ${nonnegative('dd.importe_reembolso')})
      AND sum(dd.importe_reembolso)=d.monto_total),false) AS ok
  FROM finance_base b JOIN devolucion d USING(id_factura)
  LEFT JOIN devolucion_detalle dd USING(id_devolucion)
  GROUP BY d.id_devolucion,d.id_factura,d.monto_total,d.metodo_reembolso,b.moneda
), returned_products AS MATERIALIZED (
  SELECT d.id_factura,dd.id_producto,sum(dd.cantidad) AS quantity,sum(dd.importe_reembolso) AS gross
  FROM return_documents d JOIN devolucion_detalle dd USING(id_devolucion) GROUP BY d.id_factura,dd.id_producto
), return_products_summary AS (
  SELECT r.id_factura,
    bool_and(COALESCE((s.ok AND r.quantity>0 AND r.quantity<=s.quantity
      AND r.gross=round(s.gross*r.quantity/NULLIF(s.quantity,0),2)),false)) AS ok,
    sum(round(s.net*r.quantity/NULLIF(s.quantity,0),2)) AS net
  FROM returned_products r LEFT JOIN sale_products s ON s.id_factura=r.id_factura AND s.id_producto=r.id_producto
  GROUP BY r.id_factura
), returns AS (
  SELECT d.id_factura,count(*)::int AS count,bool_and(d.ok) AND COALESCE(r.ok,false) AS ok,
    sum(d.monto_total) AS gross,r.net
  FROM return_documents d LEFT JOIN return_products_summary r USING(id_factura) GROUP BY d.id_factura,r.ok,r.net
), linked_reps AS MATERIALIZED (
  SELECT DISTINCT r.id_rep FROM finance_base b JOIN rep_factura rf USING(id_factura) JOIN rep r USING(id_rep)
  UNION SELECT DISTINCT p.id_rep FROM finance_base b JOIN pago p USING(id_factura) WHERE p.id_rep IS NOT NULL
), rep_summary AS MATERIALIZED (
  SELECT r.id_rep,r.id_cliente,r.moneda,
    COALESCE((r.estado IN ('Cancelado','Cancelada') OR EXISTS
      (SELECT 1 FROM fiscal_documento fd WHERE fd.id_rep=r.id_rep AND fd.estado='Cancelado')),false) AS cancelled,
    COALESCE((r.estado IS NOT NULL AND ${positive('r.monto_total')}
      AND sum(rf.monto_pagado)=r.monto_total
      AND count(DISTINCT rf.id_factura)=count(rf.id_factura)
      AND bool_and(${positive('rf.monto_pagado')} AND f.id_cliente=r.id_cliente AND f.moneda=r.moneda)),false) AS ok
  FROM linked_reps selected JOIN rep r USING(id_rep) LEFT JOIN rep_factura rf USING(id_rep)
  LEFT JOIN factura f ON f.id_factura=rf.id_factura
  GROUP BY r.id_rep,r.id_cliente,r.moneda,r.estado,r.monto_total
), payment_entries AS MATERIALIZED (
  SELECT p.id_factura,p.monto,COALESCE(${positive('p.monto')},false) AS ok
  FROM finance_base b JOIN pago p USING(id_factura) WHERE p.id_rep IS NULL
  UNION ALL
  SELECT rf.id_factura,rf.monto_pagado,
    COALESCE((r.ok AND r.id_cliente=b.id_cliente AND r.moneda=b.moneda),false)
  FROM finance_base b JOIN rep_factura rf USING(id_factura) JOIN rep_summary r USING(id_rep) WHERE NOT r.cancelled
), payment_copy_errors AS (
  SELECT p.id_factura,bool_or(COALESCE((NOT r.cancelled AND NOT EXISTS
    (SELECT 1 FROM rep_factura rf WHERE rf.id_rep=p.id_rep AND rf.id_factura=p.id_factura AND rf.monto_pagado=p.monto)),true)) AS bad
  FROM finance_base b JOIN pago p USING(id_factura) LEFT JOIN rep_summary r USING(id_rep)
  WHERE p.id_rep IS NOT NULL GROUP BY p.id_factura
), payments AS (
  SELECT id_factura,bool_and(ok) AS ok,sum(monto) AS amount,count(*)::int AS count
  FROM payment_entries GROUP BY id_factura
), finance_rows AS MATERIALIZED (
  SELECT b.*,COALESCE(c.gross,0) AS credit_gross,COALESCE(d.gross,0) AS return_gross,
    COALESCE(p.amount,0) AS payments,COALESCE(p.count,0)=0 AS no_payments,
    COALESCE(p.ok,true) AND NOT COALESCE(pc.bad,false) AS payments_ok,
    COALESCE((${nonnegative('b.saldo_pendiente')} AND b.saldo_pendiente<=b.total AND b.header_ok),false) AS balance_ok,
    COALESCE(c.ok,true) AS credit_ok,COALESCE(d.ok,true) AS return_ok,
    b.neto-COALESCE(c.net,0)-COALESCE(d.net,0) AS net_sales,
    COALESCE((b.header_ok AND COALESCE(c.ok,true) AND COALESCE(d.ok,true)
      AND NOT (COALESCE(c.count,0)>0 AND COALESCE(d.count,0)>0)
      AND (d.id_factura IS NULL OR (st.ok AND st.net=b.neto AND st.gross=b.total))
      AND COALESCE(c.gross,0)+COALESCE(d.gross,0)<=b.total
      AND COALESCE(c.net,0)+COALESCE(d.net,0)<=b.neto),false) AS net_ok
  FROM finance_base b LEFT JOIN credits c ON c.sale_id=b.id_factura LEFT JOIN returns d USING(id_factura)
  LEFT JOIN sale_product_totals st USING(id_factura) LEFT JOIN payments p USING(id_factura)
  LEFT JOIN payment_copy_errors pc USING(id_factura)
), ${webProfitCtes}, ${webCashCtes}, finance_currency AS (
  SELECT moneda,count(*)::int AS documentos,
    ${webProfitProjection},
    ${webCashProjection},
    CASE WHEN bool_and(header_ok) THEN sum(total)::numeric(30,2)::text END AS "importeDocumentado",
    CASE WHEN bool_and(net_ok) THEN sum(net_sales)::numeric(30,2)::text END AS "ventasNetasSinImpuestos",
    CASE WHEN bool_and(credit_ok) THEN sum(credit_gross)::numeric(30,2)::text END AS "notasCredito",
    CASE WHEN bool_and(return_ok) THEN sum(return_gross)::numeric(30,2)::text END AS devoluciones,
    CASE WHEN bool_and(payments_ok) THEN sum(payments)::numeric(30,2)::text END AS "cobrosRegistrados",
    CASE WHEN bool_and(balance_ok) THEN sum(saldo_pendiente)::numeric(30,2)::text END AS "saldoRegistrado",
    count(*) FILTER(WHERE NOT net_ok)::int AS "documentosNetoDesconocido",
    count(*) FILTER(WHERE NOT payments_ok)::int AS "documentosCobroDesconocido",
    count(*) FILTER(WHERE NOT balance_ok)::int AS "documentosSaldoDesconocido",
    count(*) FILTER(WHERE no_payments AND payments_ok)::int AS "documentosSinPagos",
    count(*) FILTER(WHERE payments_ok AND balance_ok AND abs(total-saldo_pendiente-payments)>0.01)::int AS "documentosSaldoNoConciliado"
  FROM finance_rows WHERE currency_ok GROUP BY moneda
)`;

export const webFinanceProjection = `json_build_object(
  'currencies',(SELECT COALESCE(json_agg(finance_currency ORDER BY moneda),'[]'::json) FROM finance_currency),
  'coverage',json_build_object(
    'documentosVinculados',(SELECT count(*)::int FROM finance_documents),
    'documentosFinancieros',(SELECT count(*)::int FROM finance_base),
    'globalesExcluidas',(SELECT count(*)::int FROM finance_documents WHERE is_global),
    'monedaDesconocida',(SELECT count(*)::int FROM finance_base WHERE NOT currency_ok),
    'importesInconsistentes',(SELECT count(*)::int FROM finance_base WHERE NOT header_ok),
    'notasCanceladasExcluidas',(SELECT count(*)::int FROM credit_links WHERE cancelled),
    'repsCanceladosExcluidos',(SELECT count(*)::int FROM rep_summary WHERE cancelled),
    'pagosRepCompatibilidadOmitidos',(SELECT count(*)::int FROM pago p JOIN finance_base b USING(id_factura) WHERE p.id_rep IS NOT NULL)
  )) AS finance`;
