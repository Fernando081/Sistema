const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { ProductoService, PRODUCT_SOURCE, PRODUCT_INDEXED_FROM, PRODUCT_LITERAL_FROM } = require('../dist/producto/producto.service');

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE fixture_products ("IdProducto" int, "Codigo" text, "Descripcion" text, "CategoriaNombre" text, "Marca" text, "Ubicacion" text, "PrecioUnitario" numeric, "Existencia" numeric);
      CREATE TEMP TABLE producto_numero_parte (id_producto int, numero_normalizado text);
      CREATE TEMP TABLE producto_aplicacion (id_producto int, fabricante_equipo text, modelo text, motor text, restricciones text);
      CREATE TEMP TABLE reserva_inventario (id_producto int, cantidad numeric, cantidad_liberada numeric, estado text);
      INSERT INTO fixture_products VALUES (1,'100%','Filtro A','Filtros','Marca A','A',850,10),(2,'OTRO','Filtro B','Filtros','Marca B','B',700,0),(3,'TERCERO','Otro','Motor','Marca C','C',100,5);
      INSERT INTO producto_numero_parte VALUES (2,'oem123'),(2,'oem1234'),(3,'algo');
      INSERT INTO producto_aplicacion VALUES (2,'Camion','Modelo','ISX',''),(2,'Camion','Modelo','ISX','');
      INSERT INTO reserva_inventario VALUES (1,3,0,'Activa'),(1,10,10,'Surtida'),(1,99,0,'Cancelada'),(2,20,0,'Activa');`);
    const source = { query: async (sql, params) => (await client.query(sql.replace(PRODUCT_INDEXED_FROM, PRODUCT_LITERAL_FROM).replace(PRODUCT_SOURCE, '(SELECT * FROM pg_temp.fixture_products)'), params)).rows };
    const service = new ProductoService(source);
    assert.equal((await service.findAll(1, 10, '', '', '%')).total, 1);
    assert.equal((await service.findAll(1, 10, '', '', '---')).total, 0);
    for (const term of ['OEM-123', 'ISX']) assert.equal((await service.findAll(1, 10, '', '', term)).total, 1);
    const page = await service.findAll(2, 1, 'codigo', 'asc', 'Filtros');
    assert.equal(page.total, 2); assert.equal(page.data[0].IdProducto, 2);
    const first = await service.findAll(1, 1, 'codigo', 'asc', 'Filtros');
    assert.equal(Number(first.data[0].Disponible), 7);
    const reserved = await service.findAll(1, 10, '', '', 'OTRO');
    const overReserved = reserved.data.find(row => row.IdProducto === 2);
    assert.equal(Number(overReserved.Reservada), 20); assert.equal(Number(overReserved.Disponible), 0);
    const csv = await service.exportCsv('codigo', 'asc', 'Filtros');
    assert.ok(csv.includes('Filtro A') && csv.includes('Filtro B')); assert.ok(!csv.includes('TERCERO'));
    await client.query('ROLLBACK');
    // Compatibilidad con la función real, sin datos privados en el resultado impreso.
    await client.query('BEGIN READ ONLY');
    const live = new ProductoService({ query: async (sql, params) => (await client.query(sql, params)).rows });
    await live.findAll(1, 1, 'categoriaNombre', 'asc', 'Q04-verificacion-sin-coincidencias');
    await live.exportCsv('codigo', 'asc', 'Q04-verificacion-sin-coincidencias');
    console.log('Productos PostgreSQL: categoría, signos literales, OEM/aplicaciones sin duplicados, reservas, página/orden y CSV aprobados; contrato real compatible.');
  } finally {
    await client.query('ROLLBACK'); await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
