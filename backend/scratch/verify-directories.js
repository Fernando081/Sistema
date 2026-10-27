const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { directoryPage, directoryCsv, DirectoryQueryDto } = require('../dist/common/directory-query');

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    // Tablas temporales ocultan las reales solo en esta conexión.
    await client.query(`CREATE TEMP TABLE cliente ("IdCliente" integer, "RFC" text, "RazonSocial" text, "CodigoPostal" text);
      CREATE TEMP TABLE proveedor ("IdProveedor" integer, "RFC" text, "RazonSocial" text, "CodigoPostal" text);
      CREATE TEMP TABLE crm_unidad_cliente (id_cliente integer, vin text, esn text, numero_economico text, placas text);
      INSERT INTO cliente VALUES (1,'AAA','Diesel A','08900'),(2,'BBB','Diesel B','89000'),(3,'CCC','Literal %','89000');
      INSERT INTO proveedor VALUES (1,'AAA','Proveedor A','08900'),(2,'BBB','Proveedor B','89000');
      INSERT INTO crm_unidad_cliente VALUES (1,'VIN-PRUEBA','ESN-PRUEBA','ECO1','PLACA1'),(1,'VIN-PRUEBA','ESN-OTRO','ECO2','PLACA2');`);
    const source = { query: async (sql, params) => (await client.query(sql, params)).rows };
    const query = values => Object.assign(new DirectoryQueryDto(), values);
    for (const term of ['VIN-PRUEBA', 'ESN-PRUEBA', 'ECO1', 'PLACA1']) {
      const page = await directoryPage(source, 'cliente', query({ term }));
      assert.equal(page.total, 1); assert.equal(page.data[0].IdCliente, 1);
    }
    assert.equal((await directoryPage(source, 'cliente', query({ term: '%' }))).total, 1);
    const page = await directoryPage(source, 'proveedor', query({ limit: 1, page: 2, sortBy: 'razonSocial', sortOrder: 'asc' }));
    assert.equal(page.total, 2); assert.equal(page.data[0].IdProveedor, 2);
    const csv = await directoryCsv(source, 'cliente', query({ term: 'Diesel', limit: 1, page: 2 }));
    assert.ok(csv.includes('Diesel A') && csv.includes('Diesel B')); assert.ok(!csv.includes('Literal %'));
    console.log('Directorios PostgreSQL: VIN/ESN, unidades sin duplicados, búsqueda literal, página/orden y CSV filtrado aprobados.');
  } finally {
    await client.query('ROLLBACK'); await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
