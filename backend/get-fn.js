const { Client } = require('pg');
const client = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');
async function start() {
  await client.connect();
  const res = await client.query(`
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'fn_create_producto'
  `);
  res.rows.forEach(r => console.log(r.pg_get_functiondef));
  
  const res2 = await client.query(`
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'fn_update_producto'
  `);
  console.log('---');
  res2.rows.forEach(r => console.log(r.pg_get_functiondef));
  await client.end();
}
start();
