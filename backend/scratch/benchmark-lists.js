const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { directoryPage, DirectoryQueryDto } = require('../dist/common/directory-query');
const { facturaPage, FacturaQueryDto } = require('../dist/venta/factura-query');
const { cotizacionPage, CotizacionQueryDto } = require('../dist/cotizacion/cotizacion-query');
const { compraPage, CompraQueryDto, COMPRA_SOURCE } = require('../dist/compra/compra-query');
const { ProductoService, PRODUCT_SOURCE } = require('../dist/producto/producto.service');
const scenarios = [
  { name: 'sin-filtro', term: '' },
  { name: 'texto-selectivo', term: 'Q04TARGET' },
  { name: 'texto-frecuente', term: 'Cliente' },
  { name: 'signo-literal', term: '%' },
  { name: 'pagina-profunda', term: '', page: 100 },
];
function domainScenarios(domain) {
  const extras = domain === 'cliente' ? [{ name: 'vin', term: 'VIN1000' }, { name: 'esn', term: 'ESN1000' }] :
    domain === 'producto' ? [{ name: 'oem', term: 'OEM-1000' }, { name: 'aplicacion', term: 'Motor' }] :
    ['factura','cotizacion','compra'].includes(domain) ? [{ name: 'fecha-estado', term: '', desde: '2026-10-01', hasta: '2026-10-01', estado: domain === 'cotizacion' ? 'Vigente' : 'Pagada' }] : [];
  return [...scenarios, ...extras];
}
async function capture(domain, filters, probe) {
  const statements = [];
  const source = { query: async (sql, params) => {
    assert.match(sql.trim(), /^SELECT\b/i);
    statements.push({ sql, params });
    if (/^SELECT 1 /.test(sql)) return probe ? probe(sql, params) : [];
    return /count\(/i.test(sql) && !/LIMIT/i.test(sql) ? [{ total: 0, count: 0 }] : [];
  } };
  if (domain === 'cliente' || domain === 'proveedor') await directoryPage(source, domain, Object.assign(new DirectoryQueryDto(), filters));
  if (domain === 'factura') await facturaPage(source, Object.assign(new FacturaQueryDto(), filters));
  if (domain === 'cotizacion') await cotizacionPage(source, Object.assign(new CotizacionQueryDto(), filters));
  if (domain === 'compra') await compraPage(source, Object.assign(new CompraQueryDto(), filters));
  if (domain === 'producto') await new ProductoService(source).findAll(filters.page || 1, 10, '', '', filters.term);
  assert.ok(statements.length >= 2 && statements.length <= 3);
  return statements;
}
function summarize(node, result = { nodes: {}, loops: {} }) {
  const type = node['Node Type'];
  result.nodes[type] = (result.nodes[type] || 0) + 1;
  result.loops[type] = (result.loops[type] || 0) + (node['Actual Loops'] || 0);
  for (const child of node.Plans || []) summarize(child, result);
  return result;
}
async function fixtures(connection, count, shared = false) {
  const client = { query: (sql, params) => connection.query(shared ? sql.replaceAll('CREATE TEMP TABLE', 'CREATE TABLE').replaceAll('pg_temp.', 'q04_load.') : sql, params) };
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='30s'; SET LOCAL TIME ZONE 'America/Mexico_City'");
  await client.query(`
    CREATE TEMP TABLE cliente ("IdCliente" int PRIMARY KEY,"RFC" text,"RazonSocial" text,"CodigoPostal" text);
    CREATE TEMP TABLE proveedor ("IdProveedor" int PRIMARY KEY,"RFC" text,"RazonSocial" text,"CodigoPostal" text);
    CREATE TEMP TABLE crm_unidad_cliente (id_cliente int,vin text,esn text,numero_economico text,placas text);
    CREATE TEMP TABLE factura (id_factura int PRIMARY KEY,serie text,folio int,fecha_emision timestamptz,nombre_receptor text,rfc_receptor text,tipo_comprobante text,total numeric,estatus text);
    CREATE TEMP TABLE cotizacion (id_cotizacion int PRIMARY KEY,folio int,fecha_emision timestamptz,nombre_receptor text,rfc_receptor text,total numeric,estatus text);
    CREATE TEMP TABLE pedido_venta (id_pedido int,id_cotizacion int);
    CREATE TEMP TABLE fixture_compras (id_compra int PRIMARY KEY,fecha_compra timestamptz,nombre_proveedor text,rfc_proveedor text,folio_factura text,total numeric,estatus text);
    CREATE TEMP TABLE fixture_products ("IdProducto" int PRIMARY KEY,"Codigo" text,"Descripcion" text,"CategoriaNombre" text,"Marca" text,"Ubicacion" text,"PrecioUnitario" numeric,"Existencia" numeric);
    CREATE TEMP TABLE producto_numero_parte (id_producto int,numero_normalizado text);
    CREATE TEMP TABLE producto_aplicacion (id_producto int,fabricante_equipo text,modelo text,motor text,restricciones text);
    CREATE TEMP TABLE reserva_inventario (id_producto int,cantidad numeric,cantidad_liberada numeric,estado text);
  `);
  await client.query(`INSERT INTO cliente SELECT n,'RFC'||n,CASE WHEN n%1000=0 THEN 'Q04TARGET%'  ELSE 'Cliente '||n END,'89000' FROM generate_series(1,$1::int) n;
  `, [count]);
  await client.query(`INSERT INTO proveedor SELECT "IdCliente","RFC","RazonSocial","CodigoPostal" FROM cliente;
    INSERT INTO crm_unidad_cliente SELECT "IdCliente",'VIN'||"IdCliente",'ESN'||"IdCliente",'N'||"IdCliente",'P'||"IdCliente" FROM cliente;
    INSERT INTO factura SELECT "IdCliente",'A',"IdCliente",'2026-10-01 12:00:00'::timestamptz,"RazonSocial","RFC",'I',100,'Pagada' FROM cliente;
    INSERT INTO cotizacion SELECT id_factura,folio,fecha_emision,nombre_receptor,rfc_receptor,total,'Vigente' FROM factura;
    INSERT INTO pedido_venta SELECT id_cotizacion,id_cotizacion FROM cotizacion;
    INSERT INTO fixture_compras SELECT id_factura,fecha_emision,nombre_receptor,rfc_receptor,'F'||folio,total,'Pagada' FROM factura;
    INSERT INTO fixture_products SELECT "IdCliente",'COD'||"IdCliente","RazonSocial",'Filtros','Diesel','A',100,10 FROM cliente;
    INSERT INTO producto_numero_parte SELECT "IdProducto",'oem'||"IdProducto" FROM fixture_products;
    INSERT INTO producto_aplicacion SELECT "IdProducto",'Camion','Modelo','Motor','' FROM fixture_products;
    INSERT INTO reserva_inventario SELECT "IdProducto",3,1,'Activa' FROM fixture_products;
    UPDATE factura SET fecha_emision=fecha_emision-(id_factura%90)*INTERVAL '1 day';
    UPDATE cotizacion SET fecha_emision=fecha_emision-(id_cotizacion%90)*INTERVAL '1 day';
    UPDATE fixture_compras SET fecha_compra=fecha_compra-(id_compra%90)*INTERVAL '1 day';
    CREATE FUNCTION pg_temp.benchmark_get_compras() RETURNS SETOF pg_temp.fixture_compras LANGUAGE plpgsql AS $body$
      BEGIN RETURN QUERY SELECT * FROM pg_temp.fixture_compras ORDER BY id_compra DESC; END; $body$;
    CREATE TEMP TABLE compra AS SELECT id_compra,id_compra AS id_proveedor,folio_factura::varchar AS folio_factura_proveedor FROM fixture_compras;
    CREATE INDEX ON compra USING gin(public.directory_search_document(ARRAY[id_compra::text,folio_factura_proveedor::text]) public.gin_trgm_ops);
    CREATE INDEX ON compra(id_proveedor); ANALYZE compra;
    CREATE TEMP TABLE producto AS SELECT "IdProducto","Codigo"::varchar,"Descripcion"::varchar,"Marca"::varchar,1::int AS "IdCategoria" FROM fixture_products;
    CREATE TEMP TABLE categoria("IdCategoria" int PRIMARY KEY,"Descripcion" varchar);
    INSERT INTO categoria VALUES(1,'Filtros');
    CREATE INDEX ON producto("IdProducto");CREATE INDEX ON producto("IdCategoria");
    CREATE INDEX ON producto USING gin(COALESCE("Codigo",'') public.gin_trgm_ops);
    CREATE INDEX ON producto USING gin(COALESCE("Descripcion",'') public.gin_trgm_ops);
    CREATE INDEX ON producto USING gin(COALESCE("Marca",'') public.gin_trgm_ops);
    CREATE INDEX ON categoria USING gin(COALESCE("Descripcion",'') public.gin_trgm_ops);
    CREATE INDEX ON producto_numero_parte USING gin(numero_normalizado public.gin_trgm_ops);
    CREATE INDEX ON producto_aplicacion USING gin(public.product_application_text(ARRAY[fabricante_equipo,modelo,motor,restricciones]) public.gin_trgm_ops);
    ANALYZE producto;ANALYZE categoria;
    CREATE INDEX ON cliente USING gin(public.directory_search_document(ARRAY["IdCliente"::text,"RFC"::text,"RazonSocial"::text,"CodigoPostal"::text]) public.gin_trgm_ops);
    CREATE INDEX ON proveedor USING gin(public.directory_search_document(ARRAY["IdProveedor"::text,"RFC"::text,"RazonSocial"::text,"CodigoPostal"::text]) public.gin_trgm_ops);
    CREATE INDEX ON crm_unidad_cliente USING gin(public.directory_search_document(ARRAY[vin::text,esn::text,numero_economico::text,placas::text]) public.gin_trgm_ops);
    CREATE INDEX ON crm_unidad_cliente(id_cliente);
    CREATE INDEX ON factura USING gin(public.directory_search_document(ARRAY[folio::text,serie::text||folio::text,serie::text||'-'||folio::text,nombre_receptor::text,rfc_receptor::text]) public.gin_trgm_ops);
    CREATE INDEX ON cotizacion USING gin(public.directory_search_document(ARRAY[folio::text,'C-'||folio::text,nombre_receptor::text,rfc_receptor::text]) public.gin_trgm_ops);
    CREATE INDEX ON pedido_venta(id_cotizacion);
    CREATE INDEX ON reserva_inventario(id_producto);
    CREATE INDEX ON producto_numero_parte(id_producto);
    CREATE INDEX ON producto_aplicacion(id_producto);
  `);
  for (const table of ['cliente','proveedor','crm_unidad_cliente','factura','cotizacion','pedido_venta','fixture_compras','fixture_products','producto_numero_parte','producto_aplicacion','reserva_inventario']) await client.query(`ANALYZE pg_temp.${table}`);
}
async function main() {
  const client = new Client(databaseConfig()); await client.connect();
  const rows = [];
  try {
    for (const volume of ['real', 1000, 20000]) {
      if (volume === 'real') await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='30s'");
      else await fixtures(client, volume);
      for (const domain of ['cliente','proveedor','producto','factura','cotizacion','compra']) {
        for (const scenario of domainScenarios(domain)) {
          const transform = sql => volume === 'real' ? sql : sql.replace(PRODUCT_SOURCE, '(SELECT * FROM pg_temp.fixture_products)').replace(COMPRA_SOURCE || 'fn_get_compras()', COMPRA_SOURCE ? '(SELECT * FROM pg_temp.fixture_compras)' : 'pg_temp.benchmark_get_compras()');
          const statements = await capture(domain, scenario, async (sql,params)=>(await client.query(transform(sql),params)).rows);
          for (const [index, statement] of statements.entries()) {
            let sql = statement.sql;
            if (volume !== 'real') sql = sql.replace(PRODUCT_SOURCE, '(SELECT * FROM pg_temp.fixture_products)').replace(COMPRA_SOURCE || 'fn_get_compras()', COMPRA_SOURCE ? '(SELECT * FROM pg_temp.fixture_compras)' : 'pg_temp.benchmark_get_compras()');
            const samples = [];
            for (let repeat = 0; repeat < 3; repeat++) {
              const plans = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, statement.params);
              samples.push(plans.rows[0]['QUERY PLAN'][0]);
            }
            assert.ok(samples.every(plan => plan.Plan['Actual Rows'] === samples[0].Plan['Actual Rows']));
            samples.sort((a,b) => a['Execution Time'] - b['Execution Time']);
            const plan = samples[1];
            rows.push({ volume, domain, scenario: scenario.name, operation: /^SELECT 1 /.test(statement.sql) ? 'sondeo' : /SELECT count\(/i.test(statement.sql) ? 'conteo' : 'pagina', planningMs: plan['Planning Time'], executionMs: plan['Execution Time'], samplesMs: samples.map(sample => sample['Execution Time']), returnedRows: plan.Plan['Actual Rows'], sharedHits: plan.Plan['Shared Hit Blocks'] || 0, ...summarize(plan.Plan) });
          }
        }
      }
      await client.query('ROLLBACK');
    }
    const report = { generatedAt: new Date().toISOString(), node: process.versions.node, fixtureSizes: [1000,20000], repetitions: 3, limitations: ['Mediana de tres ejecuciones por caso; tiempos orientativos, sin SLA.', 'Fixtures sinteticos con indices de relacion; no reproducen distribucion ni concurrencia reales.', 'Planes resumidos sin SQL, valores de filas, parametros privados ni credenciales.'], rows };
    const output = process.argv[2];
    if (output && !/^q0452-(baseline|after)\.json$/.test(output)) throw new Error('Nombre de reporte no permitido');
    if (output) fs.writeFileSync(path.join(__dirname, '../../docs', output), JSON.stringify(report, null, 2) + '\n');
    console.table(rows.filter(row => row.volume === 20000 && row.domain === 'compra').map(({domain,scenario,operation,executionMs,loops}) => ({domain,scenario,operation,executionMs,aggregateLoops:loops.Aggregate || 0})));
    console.log(`${rows.length} casos, ${rows.length * 3} planes verificados; tablas temporales revertidas; lectura real READ ONLY.`);
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
module.exports = { fixtures };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
