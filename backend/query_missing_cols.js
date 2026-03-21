const fs = require('fs');
const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

client.connect()
  .then(() => client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('gasto', 'cliente', 'devolucion', 'devolucion_detalle') ORDER BY table_name, ordinal_position"))
  .then((res) => {
    const lines = res.rows.map(r => `${r.table_name}.${r.column_name}`);
    fs.writeFileSync('schema_dump.txt', lines.join('\n'));
    console.log('done');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
