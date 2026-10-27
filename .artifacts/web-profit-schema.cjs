const { Client } = require('pg');
const { databaseConfig } = require('../backend/db-config');
(async () => {
  const db = new Client({ ...databaseConfig(), connectionTimeoutMillis: 5000 }); await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const metadata = await db.query(`SELECT table_name,column_name,data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('compra','detalle_compra','conceptofactura','factura')
      AND (column_name LIKE '%costo%' OR column_name IN ('moneda','tipo_cambio','importe','cantidad')) ORDER BY table_name,column_name`);
    console.log(JSON.stringify(metadata.rows));
    const source = await db.query(`SELECT pg_get_functiondef('public.fn_asignar_costo_venta()'::regprocedure) AS definition`);
    console.log(source.rows[0].definition);
    await db.query('ROLLBACK');
  } finally { await db.end(); }
})().catch(() => { console.error('No se pudo comprobar la fuente del costo local.'); process.exitCode=1; });
