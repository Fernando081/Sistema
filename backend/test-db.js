const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'F8pz6u4oi**',
  database: 'BD_local_Proyecto',
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT * FROM kardex LIMIT 1`);
  console.log("KARDEX:", res.rows);

  const res2 = await client.query(`SELECT * FROM detalle_compra LIMIT 1`);
  console.log("DETALLE_COMPRA:", res2.rows);
  
  const res3 = await client.query(`SELECT estatus FROM factura GROUP BY estatus`);
  console.log("ESTATUS FACTURA:", res3.rows);

  await client.end();
}

run().catch(console.error);
