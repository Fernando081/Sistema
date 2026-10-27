// Prueba SQL con datos controlados en un esquema transaccional; siempre revierte.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');

async function verify() {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `analytics_verify_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    // No fallback a public: la migración solo puede tocar objetos de prueba.
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE producto ("IdProducto" int, "Codigo" text, "Descripcion" text,
        "Existencia" numeric, "PrecioUnitario" numeric);
      CREATE TABLE kardex (id_producto int, precio_unitario numeric, tipo_movimiento text,
        stock_resultante numeric, fecha timestamptz, cantidad numeric, referencia text);
      CREATE TABLE factura (id_factura int, fecha_emision timestamptz, estatus text, tipo_comprobante text);
      CREATE TABLE conceptofactura (id_producto int, id_factura int, cantidad numeric);
      INSERT INTO producto VALUES (1,'ANTIGUO','Antiguo',10,100),(2,'NUEVO','Sin ventas',4,100),
        (3,'ACTIVO','Venta reciente',2,100),(4,'CANCELADO','Solo cancelaciones',1,100),
        (5,'EGRESO','Solo nota de crédito',1,100);
      INSERT INTO factura VALUES (1,CURRENT_DATE-120,'Pagada','I'),
        (2,CURRENT_DATE-3,'Pagada','I'),(3,CURRENT_DATE-2,'Cancelada','I'),
        (4,CURRENT_DATE-1,'Pagada','E');
      INSERT INTO conceptofactura VALUES (1,1,2),(3,2,1),(4,3,1),(5,4,1);
      CREATE MATERIALIZED VIEW mv_inventario_almacen AS SELECT 1 AS id;
    `);
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/077_indicadores_inventario_honestos.sql'), 'utf8'));
    const { rows: [metrics] } = await client.query('SELECT * FROM mv_inventario_almacen');
    assert.equal(metrics.retorno_inversion_inventario, null, 'GMROI desconocido debe ser NULL, no 1.5 ni cero');
    const slow = metrics.mercancia_lento_movimiento;
    assert.equal(slow.find(p => p.codigo === 'ANTIGUO').dias_sin_ventas, 120);
    for (const code of ['NUEVO', 'CANCELADO', 'EGRESO']) {
      assert.equal(slow.find(p => p.codigo === code).dias_sin_ventas, null, `${code}: no inventar días`);
    }
    assert.equal(slow.some(p => p.codigo === 'ACTIVO'), false);
    await client.query("UPDATE factura SET fecha_emision=CURRENT_DATE-150 WHERE id_factura=1");
    await client.query('REFRESH MATERIALIZED VIEW mv_inventario_almacen');
    const updated = await client.query('SELECT mercancia_lento_movimiento FROM mv_inventario_almacen');
    assert.equal(updated.rows[0].mercancia_lento_movimiento.find(p => p.codigo === 'ANTIGUO').dias_sin_ventas, 150);
    console.log('Analítica verificada: 120/150 días reales, sin ventas, cancelación, egreso, venta reciente y GMROI NULL.');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

verify().catch(error => { console.error(error.message); process.exitCode = 1; });
