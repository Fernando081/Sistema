const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function query() {
  await client.connect();
  const res = await client.query('SELECT id_factura, serie, folio, id_cliente FROM factura WHERE id_factura IN (85, 92, 93) OR folio IN (49, 56, 57)');
  console.log(res.rows);
  process.exit(0);
}
query();
