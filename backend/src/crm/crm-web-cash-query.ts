export interface WebCashMetrics {
  baseMonetaria: 'registros-locales-MXN';
  reembolsosEfectivo: string | null; saldoAFavorGenerado: string | null; cobrosNetosRegistrados: string | null;
  documentosConCobroNeto: number; documentosCobroNetoDesconocido: number; documentosReembolsoDesconocido: number;
  reembolsosSinGastoVinculado: number; gastosNoConciliados: number;
  documentosPagosNoConciliados: number; documentosMonedaNoComparable: number;
}

const finite = (value: string) => `${value} IS NOT NULL AND ${value}::text NOT IN ('NaN','Infinity','-Infinity')`;

// Gasto has no independent currency: only local MXN/factor 1 is comparable.
// An explicit expense link is evidence; amounts, dates and descriptions are not
// a substitute. Historical returns without that link remain unreconciled.
export const webCashCtes = `cash_refunds AS MATERIALIZED (
  SELECT nc.sale_id,nc.total AS amount,nc.metodo_reembolso AS method,nc.id_gasto_reembolso AS expense_id,nc.coherent AS source_ok,
    COALESCE((nc.moneda='MXN' AND nc.tipo_cambio=1),false) AS comparable
  FROM credit_links nc WHERE NOT nc.cancelled
  UNION ALL
  SELECT d.id_factura,d.monto_total,d.metodo_reembolso,d.id_gasto_reembolso,d.ok,d.moneda='MXN' FROM return_documents d
), cash_refund_expenses AS MATERIALIZED (
  SELECT selected.expense_id,g.monto,g.anulado,g.metodo_pago,g.categoria,
    (SELECT count(*) FROM factura f WHERE f.id_gasto_reembolso=selected.expense_id)
    +(SELECT count(*) FROM devolucion d WHERE d.id_gasto_reembolso=selected.expense_id) AS uses
  FROM (SELECT DISTINCT expense_id FROM cash_refunds WHERE expense_id IS NOT NULL) selected
  LEFT JOIN gasto g ON g.id_gasto=selected.expense_id
), cash_refund_rows AS MATERIALIZED (
  SELECT r.*,COALESCE((r.method='Efectivo' AND r.amount>0 AND r.expense_id IS NULL),false) AS missing_expense,
    COALESCE((r.expense_id IS NOT NULL AND (r.method<>'Efectivo' OR g.uses<>1 OR g.anulado
      OR g.metodo_pago<>'Efectivo' OR g.categoria<>'Devoluciones y Reembolsos'
      OR NOT (${finite('g.monto')}) OR g.monto<>r.amount)),r.expense_id IS NOT NULL) AS bad_expense,
    COALESCE((r.source_ok AND ${finite('r.amount')} AND r.amount>=0 AND (
      (r.method='Saldo a Favor' AND r.expense_id IS NULL) OR
      (r.method='Efectivo' AND ((r.amount=0 AND r.expense_id IS NULL) OR
        (g.uses=1 AND NOT g.anulado AND g.metodo_pago='Efectivo' AND g.categoria='Devoluciones y Reembolsos'
          AND ${finite('g.monto')} AND g.monto=r.amount))))),false) AS ok
  FROM cash_refunds r LEFT JOIN cash_refund_expenses g USING(expense_id)
), cash_refund_summary AS (
  SELECT sale_id,bool_and(ok) AS ok,bool_and(comparable) AS comparable,
    COALESCE(sum(amount) FILTER(WHERE method='Efectivo'),0) AS cash,
    COALESCE(sum(amount) FILTER(WHERE method='Saldo a Favor'),0) AS credit,
    count(*) FILTER(WHERE missing_expense)::int AS missing_expenses,
    count(*) FILTER(WHERE bad_expense)::int AS bad_expenses
  FROM cash_refund_rows GROUP BY sale_id
), cash_documents AS MATERIALIZED (
  SELECT b.id_factura,b.moneda,b.payments,
    COALESCE((b.moneda='MXN' AND b.tipo_cambio=1),false) AND COALESCE(r.comparable,true) AS comparable,
    b.net_ok AND COALESCE(r.ok,true) AS refunds_ok,
    COALESCE((b.header_ok AND b.payments_ok AND b.balance_ok
      AND abs(b.total-b.saldo_pendiente-b.payments)<=0.01),false) AS payments_reconciled,
    COALESCE(r.cash,0) AS cash,COALESCE(r.credit,0) AS credit,
    COALESCE(r.missing_expenses,0) AS missing_expenses,COALESCE(r.bad_expenses,0) AS bad_expenses
  FROM finance_rows b LEFT JOIN cash_refund_summary r ON r.sale_id=b.id_factura
), cash_currency AS (
  SELECT moneda,
    CASE WHEN bool_and(comparable AND refunds_ok) THEN round(sum(cash),2)::text END AS cash,
    CASE WHEN bool_and(comparable AND refunds_ok) THEN round(sum(credit),2)::text END AS credit,
    CASE WHEN bool_and(comparable AND refunds_ok AND payments_reconciled)
      THEN round(sum(payments-cash),2)::text END AS net,
    count(*) FILTER(WHERE comparable AND refunds_ok AND payments_reconciled)::int AS known,
    count(*) FILTER(WHERE NOT (comparable AND refunds_ok AND payments_reconciled))::int AS unknown,
    count(*) FILTER(WHERE NOT refunds_ok)::int AS unknown_refunds,
    sum(missing_expenses)::int AS missing_expenses,sum(bad_expenses)::int AS bad_expenses,
    count(*) FILTER(WHERE NOT payments_reconciled)::int AS bad_payments,
    count(*) FILTER(WHERE NOT comparable)::int AS incomparable
  FROM cash_documents GROUP BY moneda
)`;

export const webCashProjection = `(SELECT json_build_object(
  'baseMonetaria','registros-locales-MXN','reembolsosEfectivo',c.cash,'saldoAFavorGenerado',c.credit,'cobrosNetosRegistrados',c.net,
  'documentosConCobroNeto',c.known,'documentosCobroNetoDesconocido',c.unknown,'documentosReembolsoDesconocido',c.unknown_refunds,
  'reembolsosSinGastoVinculado',c.missing_expenses,'gastosNoConciliados',c.bad_expenses,
  'documentosPagosNoConciliados',c.bad_payments,'documentosMonedaNoComparable',c.incomparable)
  FROM cash_currency c WHERE c.moneda=finance_rows.moneda) AS cash`;
