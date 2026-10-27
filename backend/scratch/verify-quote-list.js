const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { cotizacionPage, cotizacionCsv, CotizacionQueryDto } = require('../dist/cotizacion/cotizacion-query');

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();
  const source = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const query = values => Object.assign(new CotizacionQueryDto(), values);
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL TIME ZONE 'America/Mexico_City'");
    await client.query(`CREATE TEMP TABLE cotizacion (id_cotizacion int, folio int, fecha_emision timestamptz, nombre_receptor text, rfc_receptor text, total numeric, estatus text);
      CREATE TEMP TABLE pedido_venta (id_pedido int, id_cotizacion int);
      INSERT INTO cotizacion VALUES (1,101,'2026-09-30 12:00:00','Transportes 100%','AAA',200,'Vigente'),(2,102,'2026-09-29 12:00:00','Transportes B','BBB',100,'Convertida'),(3,103,'2026-09-28 12:00:00','Otro','CCC',300,'Vigente');
      INSERT INTO pedido_venta VALUES (11,1),(12,1);`);
    const first = await cotizacionPage(source, query({ term: 'Transportes', sortBy: 'total', sortOrder: 'asc', limit: 1 }));
    assert.equal(first.total, 2); assert.equal(first.data[0].id_cotizacion, 2);
    const second = await cotizacionPage(source, query({ term: 'Transportes', sortBy: 'total', sortOrder: 'asc', limit: 1, page: 2 }));
    assert.equal(second.data[0].id_cotizacion, 1); assert.equal(second.data[0].id_pedido, 12);
    assert.equal((await cotizacionPage(source, query({ term: '%' }))).total, 1);
    assert.equal((await cotizacionPage(source, query({ term: 'C-101' }))).total, 1);
    const csv = await cotizacionCsv(source, query({ term: 'Transportes', page: 2, limit: 1 }));
    assert.ok(csv.includes('Transportes 100%') && csv.includes('Transportes B')); assert.ok(!csv.includes('Otro'));
    await client.query("UPDATE cotizacion SET fecha_emision='2026-10-01 23:59:59.999' WHERE id_cotizacion=1");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const range = query({ desde: '2026-10-01', hasta: '2026-10-01', estado: 'Vigente' });
    assert.equal((await cotizacionPage(source, range)).total, 1);
    assert.equal((await cotizacionPage(source, query({ desde: '2026-10-02' }))).total, 0);
    assert.equal((await cotizacionPage(source, query({ hasta: '2026-09-30' }))).total, 2);
    const datedCsv = await cotizacionCsv(source, range);
    assert.ok(datedCsv.includes('100%')); assert.ok(!datedCsv.includes('BBB'));
    await client.query('ROLLBACK');
    await client.query('BEGIN READ ONLY');
    await cotizacionPage(source, query({ term: 'Q04-verificacion-sin-coincidencias', estado: 'Pendiente', desde: '2026-10-01', hasta: '2026-10-01' }));
    await cotizacionCsv(source, query({ term: 'Q04-verificacion-sin-coincidencias', estado: 'Pendiente', desde: '2026-10-01', hasta: '2026-10-01' }));
    console.log('Cotizaciones PostgreSQL: búsqueda literal/folio, orden/página, pedidos sin duplicados y CSV filtrado aprobados; contrato real compatible.');
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
