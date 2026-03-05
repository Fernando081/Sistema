const { Client } = require('pg');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function check() {
  await c.connect();
  let r = await c.query("SELECT enumlabel FROM pg_enum WHERE enumtypid = 'tipo_movimiento_enum'::regtype");
  console.log("Kardex enum labels:", r.rows.map(x=>x.enumlabel));
  await c.end();
}
check();
