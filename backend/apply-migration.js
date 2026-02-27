const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'F8pz6u4oi**',
  database: 'BD_local_Proyecto',
});

async function run() {
  await client.connect();
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '003_create_fn_get_utilidad_productos.sql'), 'utf-8');
  await client.query(sql);
  console.log("Migration applied successfully!");
  
  const testRes = await client.query('SELECT * FROM fn_get_utilidad_productos()');
  console.log("TEST RUN ROWS:", testRes.rows.length);
  if(testRes.rows.length > 0) console.log(testRes.rows[0]);
  
  await client.end();
}

run().catch(console.error);
