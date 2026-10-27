const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { facturaPage, facturaCsv, FacturaQueryDto } = require('../dist/venta/factura-query');
async function main() {
  const client = new Client(databaseConfig()); await client.connect();
  const source = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const query = values => Object.assign(new FacturaQueryDto(), values);
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL TIME ZONE 'America/Mexico_City'");
    await client.query(`CREATE TEMP TABLE factura (id_factura int, serie text, folio int, fecha_emision timestamptz, nombre_receptor text, rfc_receptor text, tipo_comprobante text, total numeric, estatus text);
      CREATE TEMP TABLE fiscal_documento (id_factura int UNIQUE, estado text);
      INSERT INTO factura VALUES (1,'A',101,'2026-10-01','Transportes 100%','AAA','I',200,'Pagada'),(2,'NC',102,'2026-09-30','Transportes B','BBB','E',100,'Timbrada'),(3,'A',103,'2026-09-29','Transportes C','CCC','I',300,'Cancelada');
      INSERT INTO fiscal_documento VALUES (1,'Timbrado'),(2,'Mock');`);
    const page = await facturaPage(source, query({ tipo: 'I', sortBy: 'total', sortOrder: 'asc', limit: 1, page: 2 }));
    assert.equal(page.total, 2); assert.equal(page.data[0].id_factura, 3);
    assert.equal((await facturaPage(source, query({ term: '%' }))).total, 1);
    assert.equal((await facturaPage(source, query({ term: 'NC-102' }))).total, 1);
    assert.equal((await facturaPage(source, query({ term: 'NC102', tipo: 'I' }))).total, 0);
    const csv = await facturaCsv(source, query({ tipo: 'I', limit: 1, page: 2 }));
    assert.ok(csv.includes('Transportes 100%') && csv.includes('Transportes C')); assert.ok(!csv.includes('Transportes B'));
    assert.ok(csv.includes('Timbrado') && csv.includes('Borrador'));
    const cancelled = await facturaPage(source, query({ tipo: 'I', estado: 'Cancelada' }));
    assert.equal(cancelled.total, 1); assert.equal(cancelled.data[0].id_factura, 3);
    assert.equal((await facturaPage(source, query({ tipo: 'E', estado: 'Pagada' }))).total, 0);
    const paidCsv = await facturaCsv(source, query({ estado: 'Pagada' }));
    assert.ok(paidCsv.includes('Transportes 100%')); assert.ok(!paidCsv.includes('Transportes C'));
    await client.query("UPDATE factura SET fecha_emision='2026-10-01 23:59:59.999' WHERE id_factura=1");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const dated = await facturaPage(source, query({ desde: '2026-09-30', hasta: '2026-10-01' }));
    assert.equal(dated.total, 2);
    assert.equal((await facturaPage(source, query({ hasta: '2026-09-30' }))).total, 2);
    assert.equal((await facturaPage(source, query({ desde: '2026-10-01', hasta: '2026-10-01', estado: 'Pagada' }))).total, 1);
    const datedCsv = await facturaCsv(source, query({ desde: '2026-10-01', hasta: '2026-10-01' }));
    assert.ok(datedCsv.includes('Transportes 100%')); assert.ok(!datedCsv.includes('Transportes B'));
    await client.query('ROLLBACK'); await client.query('BEGIN READ ONLY');
    await facturaPage(source, query({ term: 'Q04-verificacion-sin-coincidencias', desde: '2026-10-01', hasta: '2026-10-01' }));
    await facturaCsv(source, query({ term: 'Q04-verificacion-sin-coincidencias', desde: '2026-10-01', hasta: '2026-10-01' }));
    console.log('Facturas PostgreSQL: tipo, serie/folio, signos literales, página/orden y CSV/estado fiscal aprobados; contrato real compatible.');
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
