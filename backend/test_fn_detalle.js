const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function dotest() {
  await client.connect();
  const res = await client.query(`SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE proname = 'fn_get_detalle_factura'`);
  console.log(res.rows[0].pg_get_functiondef);
  process.exit();
}
dotest();
