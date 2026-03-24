const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

const sql = `
ALTER TABLE devolucion ADD COLUMN IF NOT EXISTS cfdi_json JSONB;
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('CFDI JSONB columna añadida a tabla devolucion');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
