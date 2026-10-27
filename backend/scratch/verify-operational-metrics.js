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
    const schema = `metrics_verify_${randomBytes(8).toString('hex')}`;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    for (const table of ['producto','cliente','factura','conceptofactura','cotizacion',
      'pedido_venta','pedido_venta_detalle','devolucion','devolucion_detalle',
      'factura_proveedor','factura_proveedor_pago','compra','pago_proveedor','kardex','categoria']) {
      await client.query(`CREATE TABLE "${table}" AS SELECT * FROM public."${table}" WITH NO DATA`);
    }
    const functionDefinition = (await client.query("SELECT pg_get_functiondef('public.fn_get_margen_productos()'::regprocedure) AS sql")).rows[0].sql;
    await client.query(functionDefinition.replace('public.fn_get_margen_productos', 'fn_get_margen_productos'));
    await client.query(`
      INSERT INTO producto("IdProducto","Codigo","Descripcion","Marca")
        VALUES(1,'A','A','Conocida'),(2,'B','B','Costo desconocido');
      INSERT INTO cliente("IdCliente") VALUES(1);
      INSERT INTO cotizacion(id_cotizacion,fecha_emision,total) VALUES
        (200,CURRENT_DATE-20,100),(201,CURRENT_DATE-20,100),(202,CURRENT_DATE-20,100),
        (203,CURRENT_DATE-100,100);
      INSERT INTO factura(id_factura,id_cliente,id_cotizacion,id_pedido,fecha_emision,estatus,tipo_comprobante,total,saldo_pendiente)
        VALUES(301,1,200,NULL,CURRENT_DATE-10,'Pagada','I',100,0),
        (302,1,200,NULL,CURRENT_DATE-10,'Pagada','I',100,0),
        (303,1,201,NULL,CURRENT_DATE-10,'Cancelada','I',100,0),
        (304,1,NULL,NULL,CURRENT_DATE-10,'Pagada','I',100,0),
        (305,1,202,NULL,CURRENT_DATE-10,'Pagada','E',100,0);
      INSERT INTO conceptofactura(id_factura,id_producto,cantidad,importe,descuento,costo_unitario_snapshot)
        VALUES(301,1,2,100,0,60),(302,2,1,100,0,NULL),(303,1,500,100,0,60),(305,1,500,100,0,60);
      INSERT INTO pedido_venta(id_pedido,estado,created_at,id_cotizacion)
        VALUES(1,'Surtido',CURRENT_DATE-10,NULL),(2,'En espera',CURRENT_DATE-10,NULL),
          (3,'Borrador',CURRENT_DATE-10,NULL),(4,'Cancelado',CURRENT_DATE-10,NULL);
      INSERT INTO pedido_venta_detalle(id_pedido,cantidad,cantidad_surtida)
        VALUES(1,10,8),(2,10,0),(3,1000,1000),(4,1000,1000);
      INSERT INTO devolucion(id_devolucion,id_factura,fecha) VALUES(1,301,CURRENT_DATE-1);
      INSERT INTO devolucion_detalle(id_devolucion,id_producto,cantidad) VALUES(1,1,1);
      INSERT INTO factura_proveedor(id_factura_proveedor,fecha_emision,estado)
        VALUES(1,CURRENT_DATE-20,'Pagada'),(2,CURRENT_DATE-20,'Cancelada');
      INSERT INTO factura_proveedor_pago(id_factura_proveedor,fecha,monto,estado)
        VALUES(1,CURRENT_DATE-10,100,'Activo'),(1,CURRENT_DATE-1,10000,'Revertido'),
          (2,CURRENT_DATE-1,10000,'Activo');
      INSERT INTO compra(id_compra,fecha_compra,estatus) VALUES(1,CURRENT_DATE-40,'Pagada');
      INSERT INTO pago_proveedor(id_compra,fecha_pago,monto) VALUES(1,CURRENT_DATE-10,300);
      CREATE MATERIALIZED VIEW mv_operaciones_avanzadas AS SELECT 1 AS id;
      CREATE MATERIALIZED VIEW mv_clientes_cobranza AS SELECT 1 AS id;
    `);
    const migration = fs.readFileSync(path.join(__dirname,'../migrations/078_metricas_operativas_verificables.sql'),'utf8');
    await client.query(migration.replaceAll('search_path TO public, pg_temp', `search_path TO "${schema}", pg_temp`));
    let metrics = (await client.query('SELECT * FROM mv_operaciones_avanzadas')).rows[0];
    assert.equal(Number(metrics.tasa_cumplimiento),40);
    assert.ok(Math.abs(Number(metrics.tasa_conversion_cotizaciones)-100/3)<1e-8);
    assert.ok(Math.abs(Number(metrics.tasa_devoluciones)-100/3)<1e-8);
    assert.equal(metrics.rentabilidad_proveedor_marca.find(r=>r.marca==='Costo desconocido').rentabilidad,null);
    assert.equal(Number(metrics.rentabilidad_proveedor_marca.find(r=>r.marca==='Conocida').rentabilidad),-10);
    assert.equal(Number((await client.query('SELECT fn_plazo_pago_proveedores_90d() AS dias')).rows[0].dias),25);
    // La factura de pedido conserva el enlace, aunque id_cotizacion directo sea NULL.
    await client.query("UPDATE pedido_venta SET id_cotizacion=201 WHERE id_pedido=1");
    await client.query('UPDATE factura SET id_pedido=1 WHERE id_factura=304');
    await client.query('REFRESH MATERIALIZED VIEW mv_operaciones_avanzadas');
    metrics = (await client.query('SELECT * FROM mv_operaciones_avanzadas')).rows[0];
    assert.ok(Math.abs(Number(metrics.tasa_conversion_cotizaciones)-200/3)<1e-8);
    await client.query('TRUNCATE pedido_venta_detalle,cotizacion,factura_proveedor_pago,pago_proveedor');
    await client.query('REFRESH MATERIALIZED VIEW mv_operaciones_avanzadas');
    metrics = (await client.query('SELECT * FROM mv_operaciones_avanzadas')).rows[0];
    assert.equal(metrics.tasa_cumplimiento,null);
    assert.equal(metrics.tasa_conversion_cotizaciones,null);
    assert.equal((await client.query('SELECT fn_plazo_pago_proveedores_90d() AS dias')).rows[0].dias,null);
    const gmroiMigration = fs.readFileSync(path.join(__dirname,'../migrations/079_historial_valoracion_gmroi.sql'),'utf8');
    await client.query(gmroiMigration.replaceAll('search_path TO public, pg_temp', `search_path TO "${schema}", pg_temp`));
    await client.query('TRUNCATE analytics_inventario_diario,producto,factura,conceptofactura,devolucion,devolucion_detalle');
    await client.query(`
      INSERT INTO producto("IdProducto","Existencia") VALUES(1,10);
      INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,precio_unitario,fecha)
        VALUES(1,'COMPRA',1,10,now()),(1,'COMPRA',9,30,now());
      INSERT INTO factura(id_factura,fecha_emision,estatus,tipo_comprobante)
        VALUES(1,now(),'Pagada','I');
      INSERT INTO conceptofactura(id_factura,id_producto,cantidad,importe,descuento,costo_unitario_snapshot)
        VALUES(1,1,10,400,0,28);
      SELECT fn_capturar_valor_inventario_diario();
    `);
    assert.equal(Number((await client.query('SELECT valor FROM analytics_inventario_diario')).rows[0].valor),280);
    assert.equal((await client.query('SELECT fn_gmroi_90d() AS gmroi')).rows[0].gmroi,null,'No inventar 89 días anteriores');
    await client.query(`INSERT INTO analytics_inventario_diario(fecha,valor,productos_sin_costo)
      SELECT (now() AT TIME ZONE 'America/Mexico_City')::date-n,280,0 FROM generate_series(1,89) n`);
    assert.ok(Math.abs(Number((await client.query('SELECT fn_gmroi_90d() AS gmroi')).rows[0].gmroi)-120/280)<1e-8);
    await client.query(`INSERT INTO devolucion(id_devolucion,id_factura,fecha) VALUES(1,1,now());
      INSERT INTO devolucion_detalle(id_devolucion,id_producto,cantidad) VALUES(1,1,2)`);
    assert.ok(Math.abs(Number((await client.query('SELECT fn_gmroi_90d() AS gmroi')).rows[0].gmroi)-96/280)<1e-8);
    await client.query('UPDATE conceptofactura SET costo_unitario_snapshot=NULL');
    assert.equal((await client.query('SELECT fn_gmroi_90d() AS gmroi')).rows[0].gmroi,null,'Costo de venta desconocido');
    await client.query('UPDATE conceptofactura SET costo_unitario_snapshot=28');
    await client.query("UPDATE analytics_inventario_diario SET valor=NULL WHERE fecha=(now() AT TIME ZONE 'America/Mexico_City')::date-5");
    assert.equal((await client.query('SELECT fn_gmroi_90d() AS gmroi')).rows[0].gmroi,null,'Una captura incompleta invalida el promedio');
    await client.query('SELECT fn_capturar_valor_inventario_diario()');
    assert.equal(Number((await client.query('SELECT count(*) AS cantidad FROM analytics_inventario_diario')).rows[0].cantidad),90,'Captura diaria idempotente');
    await client.query('CREATE MATERIALIZED VIEW mv_inventario_almacen AS SELECT 1 AS id');
    await client.query('CREATE MATERIALIZED VIEW mv_ventas_facturacion AS SELECT 1 AS id');
    const valuation = fs.readFileSync(path.join(__dirname,'../migrations/080_valoracion_y_margen_sin_costos_supuestos.sql'),'utf8');
    await client.query(valuation);
    assert.equal(Number((await client.query('SELECT valor_total_inventario FROM mv_inventario_almacen')).rows[0].valor_total_inventario),280);
    assert.ok(Math.abs(Number((await client.query('SELECT margen_utilidad_bruta FROM mv_ventas_facturacion')).rows[0].margen_utilidad_bruta)-30)<1e-8);
    await client.query('UPDATE conceptofactura SET costo_unitario_snapshot=NULL');
    await client.query('REFRESH MATERIALIZED VIEW mv_ventas_facturacion');
    assert.equal((await client.query('SELECT margen_utilidad_bruta FROM mv_ventas_facturacion')).rows[0].margen_utilidad_bruta,null);
    await client.query('TRUNCATE kardex');
    await client.query('REFRESH MATERIALIZED VIEW mv_inventario_almacen');
    assert.equal((await client.query('SELECT valor_total_inventario FROM mv_inventario_almacen')).rows[0].valor_total_inventario,null,'No usar precio de venta * 0.6');
    console.log('GMROI verificado: costo ponderado 28, inventario 280, margen 120/96 tras devolución, cobertura 90 días, costos desconocidos y captura idempotente.');
    console.log('Métricas operativas verificadas: surtido 40%, conversión 1/3 y 2/3 sin duplicados, devoluciones, costo desconocido/pérdida, plazo ponderado 25 días y ausencia de datos.');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}
verify().catch(error=>{console.error(error.message);process.exitCode=1;});
