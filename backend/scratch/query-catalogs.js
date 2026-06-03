const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function main() {
  await client.connect();
  const prodServ = await client.query('SELECT * FROM claveproductooservicio WHERE "Clave" = \'84111506\'');
  const unidad = await client.query('SELECT * FROM claveunidad WHERE "Clave" = \'ACT\'');
  console.log('ClaveProdServ 84111506:', prodServ.rows);
  console.log('ClaveUnidad ACT:', unidad.rows);
  await client.end();
}
main().catch(console.error);
