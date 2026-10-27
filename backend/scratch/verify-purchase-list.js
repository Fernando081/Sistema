const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { compraPage, compraCsv, CompraQueryDto, COMPRA_SOURCE } = require('../dist/compra/compra-query');
async function main() {
  const client = new Client(databaseConfig()); await client.connect();
  const query = values => Object.assign(new CompraQueryDto(), values);
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL TIME ZONE 'America/Mexico_City'");
    await client.query(`CREATE TEMP TABLE fixture_compras (id_compra int, fecha_compra timestamptz, nombre_proveedor text, rfc_proveedor text, folio_factura text, total numeric, estatus text);
      INSERT INTO fixture_compras VALUES (1,'2026-10-01','Diesel 100%','AAA','F1',200,'Pagada'),(2,'2026-09-30','Diesel B','BBB','F2',100,'Pendiente'),(3,'2026-09-29','Otro','CCC','F3',300,'Pagada');`);
    const source = { query: async (sql, params) => sql.startsWith('SELECT 1 ')?Array.from({length:257},()=>({})):(await client.query(sql.replace(COMPRA_SOURCE, '(SELECT * FROM pg_temp.fixture_compras)'), params)).rows };
    const page = await compraPage(source, query({ term: 'Diesel', sortBy: 'total', sortOrder: 'asc', page: 2, limit: 1 }));
    assert.equal(page.total, 2); assert.equal(page.data[0].id_compra, 1);
    assert.equal((await compraPage(source, query({ term: '%' }))).total, 1);
    assert.equal((await compraPage(source, query({ term: 'BBB' }))).total, 1);
    const csv = await compraCsv(source, query({ term: 'Diesel', page: 2, limit: 1 }));
    assert.ok(csv.includes('Diesel 100%') && csv.includes('Diesel B')); assert.ok(!csv.includes('Otro'));
    await client.query("UPDATE fixture_compras SET fecha_compra='2026-10-01 23:59:59.999' WHERE id_compra=1");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const range = query({ desde: '2026-10-01', hasta: '2026-10-01', estado: 'Pagada' });
    assert.equal((await compraPage(source, range)).total, 1);
    assert.equal((await compraPage(source, query({ desde: '2026-10-02' }))).total, 0);
    assert.equal((await compraPage(source, query({ hasta: '2026-09-30' }))).total, 2);
    const datedCsv = await compraCsv(source, range);
    assert.ok(datedCsv.includes('100%')); assert.ok(!datedCsv.includes('BBB'));
    await client.query('ROLLBACK'); await client.query('BEGIN READ ONLY');
    const live = { query: async (sql, params) => (await client.query(sql, params)).rows };
    await compraPage(live, query({ term: 'Q04-verificacion-sin-coincidencias', estado: 'Pendiente', desde: '2026-10-01', hasta: '2026-10-01' }));
    await compraCsv(live, query({ term: 'Q04-verificacion-sin-coincidencias', estado: 'Pendiente', desde: '2026-10-01', hasta: '2026-10-01' }));
    const legacy = { query: async (sql, params) => sql.startsWith('SELECT 1 ')?Array.from({length:257},()=>({})):(await client.query(sql.replace(COMPRA_SOURCE, 'fn_get_compras()'), params)).rows };
    for (const values of [{}, { sortBy: 'nombre_proveedor', sortOrder: 'asc' }, { term: '%' }, { estado: 'Pagada', desde: '2026-01-01', hasta: '2026-10-01' }, { page: 2, limit: 1 }]) {
      assert.deepEqual(await compraPage(live, query(values)), await compraPage(legacy, query(values)));
      assert.equal(await compraCsv(live, query(values)), await compraCsv(legacy, query(values)));
    }
    console.log('Compras PostgreSQL: búsqueda literal/RFC, página/orden y CSV filtrado aprobados; función real compatible.');
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
