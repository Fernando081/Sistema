const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgres://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto'
  });

  try {
    await client.connect();
    const res = await client.query('SELECT COUNT(*) FROM auditoria_jsonb;');
    console.log(`Auditoria rows: ${res.rows[0].count}`);
    
    if (parseInt(res.rows[0].count) > 0) {
      const sample = await client.query('SELECT * FROM auditoria_jsonb ORDER BY timestamp DESC LIMIT 2');
      console.log('Sample Action 1:', sample.rows[0].action);
    }
  } catch (err) {
    console.error('Database Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
