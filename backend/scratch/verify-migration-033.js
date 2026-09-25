const { Client } = require('pg');
const { databaseConfig } = require('../db-config');

async function run() {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const sample = await client.query(`
      SELECT f.id_factura, cf.id_producto, SUM(cf.cantidad)::numeric AS cantidad,
             p."Existencia"::numeric AS existencia
        FROM factura f
        JOIN conceptofactura cf ON cf.id_factura = f.id_factura
        JOIN producto p ON p."IdProducto" = cf.id_producto
       WHERE f.estatus <> 'Cancelada'
         AND f.tipo_comprobante = 'I'
         AND NOT EXISTS (SELECT 1 FROM devolucion d WHERE d.id_factura = f.id_factura)
       GROUP BY f.id_factura, cf.id_producto, p."Existencia"
       ORDER BY f.id_factura DESC
       LIMIT 1
    `);
    if (!sample.rows.length) {
      console.log('Sin factura elegible; verificación transaccional omitida.');
      return;
    }

    const row = sample.rows[0];
    await client.query('BEGIN');
    await client.query('CALL sp_cancelar_factura($1, $2)', [row.id_factura, null]);
    const canceled = await client.query(
      'SELECT estatus::text FROM factura WHERE id_factura=$1', [row.id_factura],
    );
    const stock = await client.query(
      'SELECT "Existencia"::numeric AS existencia FROM producto WHERE "IdProducto"=$1',
      [row.id_producto],
    );
    if (canceled.rows[0].estatus !== 'Cancelada') throw new Error('La cancelación no cambió el estado.');
    if (Number(stock.rows[0].existencia) !== Number(row.existencia) + Number(row.cantidad)) {
      throw new Error('La cancelación no restauró la cantidad esperada.');
    }
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    let rejected = false;
    try {
      await client.query(
        'SELECT sp_procesar_devolucion_parcial($1,$2,$3::jsonb,$4)',
        [
          row.id_factura,
          'Saldo a Favor',
          JSON.stringify([{ idProducto: row.id_producto, cantidad: Number(row.cantidad) + 1 }]),
          null,
        ],
      );
    } catch (error) {
      rejected = error.code === 'P0001' && error.message.includes('excede lo vendido');
    }
    await client.query('ROLLBACK');
    if (!rejected) throw new Error('La devolución excesiva no fue rechazada correctamente.');

    const finalStock = await client.query(
      'SELECT "Existencia"::numeric AS existencia FROM producto WHERE "IdProducto"=$1',
      [row.id_producto],
    );
    if (Number(finalStock.rows[0].existencia) !== Number(row.existencia)) {
      throw new Error('La prueba dejó cambios persistentes en inventario.');
    }
    console.log('Cancelación y límite de devolución verificados; transacciones revertidas.');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
