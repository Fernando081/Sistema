const { Client } = require('pg');

async function runSQL() {
  const client = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');
  await client.connect();
  
  try {
    const res = await client.query(`
      SELECT pg_get_functiondef(oid) 
      FROM pg_proc 
      WHERE proname IN ('fn_get_productos', 'fn_get_producto_by_id')
    `);
    
    res.rows.forEach(r => {
      console.log('--- DEFINITION ---');
      console.log(r.pg_get_functiondef);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

runSQL();
