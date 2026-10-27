const { Client } = require('pg');
const { databaseConfig } = require('../backend/db-config');
(async () => {
  const db = new Client({ ...databaseConfig(), connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const columns = await db.query(`SELECT table_name,column_name,data_type,numeric_precision,numeric_scale
      FROM information_schema.columns WHERE table_schema='public'
      AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,
      [['factura','conceptofactura','pago','rep','rep_factura','devolucion','devolucion_detalle','gasto']]);
    console.log(JSON.stringify(columns.rows));
    const functions = await db.query(`SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[])`,
      [['fn_registrar_pago','fn_sync_pago_saldos','fn_revertir_pago_saldos']]);
    console.log(JSON.stringify(functions.rows));
    const coverage = await db.query(`SELECT count(*)::int AS quotes_with_sale FROM cotizacion q WHERE q.id_cliente IS NOT NULL
      AND EXISTS(SELECT 1 FROM factura f WHERE f.id_cotizacion=q.id_cotizacion AND f.id_cliente=q.id_cliente
        AND f.tipo_comprobante='I' AND f.estatus::text NOT IN ('Cancelada','Cancelado') AND f.serie<>'G')`);
    console.log(JSON.stringify(coverage.rows));
    await db.query('ROLLBACK');
  } finally { await db.end(); }
})().catch(() => { console.error('No se pudo leer el esquema financiero local.'); process.exitCode=1; });
