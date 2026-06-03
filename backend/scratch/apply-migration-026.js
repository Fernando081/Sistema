const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function main() {
  await client.connect();
  console.log('Conectado a la base de datos.');
  const sqlPath = path.join(__dirname, '../migrations/026_ajuste_inventario.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Leyendo archivo de migración...');
  await client.query(sql);
  console.log('Migración 026 aplicada con éxito!');
  await client.end();
}

main().catch(err => {
  console.error('Error al aplicar la migración 026:', err);
  process.exit(1);
});
