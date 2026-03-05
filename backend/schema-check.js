const { Client } = require('pg');
const fs = require('fs');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function check() {
  await c.connect();
  const res = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'detalle_factura'`);
  let output = '-- detalle_factura --\n';
  res.rows.forEach(r => output += `${r.column_name}: ${r.data_type}\n`);
  fs.writeFileSync('schema_dump2.txt', output);
  await c.end();
}
check();
