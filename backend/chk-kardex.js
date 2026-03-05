const { Client } = require('pg');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function check() {
  await c.connect();
  let r = await c.query(`
    SELECT data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_name = 'kardex' AND column_name = 'tipo_movimiento';
  `);
  console.log("Kاردex tipo_movimiento type:", r.rows);
  await c.end();
}
check();
