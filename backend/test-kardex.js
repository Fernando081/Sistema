const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'F8pz6u4oi**',
  database: 'BD_local_Proyecto'
});

async function run() {
  await client.connect();
  try {
    const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'kardex'");
    console.log("kardex columns:", res.rows);
    
    // Also check the case sensitive "Kardex" table if lowercase doesn't exist
    const res2 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'Kardex'");
    console.log("Kardex columns (capitalized):", res2.rows);

    const data = await client.query("SELECT * FROM fn_get_productos() LIMIT 1");
    console.log("fn_get_productos data:", data.rows[0]);
  } catch (e) {
    console.error(e);
  }
  await client.end();
}
run();
