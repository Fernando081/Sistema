const { Client } = require('pg');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function check() {
  await c.connect();
  let r = await c.query(`
    SELECT t.typname, e.enumlabel 
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid 
    WHERE t.typname IN ('tipo_movimiento_kardex_enum', 'estatus_factura_enum');
  `);
  console.log(r.rows);
  await c.end();
}
check();
