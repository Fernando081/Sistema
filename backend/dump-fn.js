const { Client } = require('pg');
const fs = require('fs');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function check() {
  await c.connect();
  const res = await c.query("SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'fn_crear_venta'");
  fs.writeFileSync('fn_crear_venta_dump.sql', res.rows[0].def);
  await c.end();
}
check();
