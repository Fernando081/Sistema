const { Client } = require('pg');

const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function verify() {
  await client.connect();
  console.log('Conectado a la base de datos.');

  const prodRes = await client.query('SELECT "IdProducto", "Codigo", "Descripcion", "Existencia" FROM producto LIMIT 1');
  if (prodRes.rows.length === 0) {
    console.log('No hay productos en la base de datos.');
    await client.end();
    return;
  }
  
  const product = prodRes.rows[0];
  const idProducto = product.IdProducto;
  const stockInicial = Number(product.Existencia);
  console.log(`Producto de prueba: ${product.Codigo} - ${product.Descripcion}`);
  console.log(`Existencia inicial: ${stockInicial}`);

  // Test 1: Entrada y Salida válidas
  console.log('\n--- CASO 1: Ajustes válidos ---');
  await client.query('BEGIN');
  try {
    await client.query('CALL sp_ajustar_inventario($1, $2, $3, $4)', [idProducto, 5.00, 'ENTRADA POR AJUSTE', 'Test entrada']);
    const res1 = await client.query('SELECT "Existencia" FROM producto WHERE "IdProducto" = $1', [idProducto]);
    console.log(`Existencia tras Entrada (+5): ${Number(res1.rows[0].Existencia)}`);

    await client.query('CALL sp_ajustar_inventario($1, $2, $3, $4)', [idProducto, 3.00, 'SALIDA POR MERMA/AJUSTE', 'Test salida']);
    const res2 = await client.query('SELECT "Existencia" FROM producto WHERE "IdProducto" = $1', [idProducto]);
    console.log(`Existencia tras Salida (-3): ${Number(res2.rows[0].Existencia)}`);
  } finally {
    await client.query('ROLLBACK');
  }

  // Test 2: Validación stock negativo
  console.log('\n--- CASO 2: Validación de stock negativo ---');
  await client.query('BEGIN');
  try {
    const cantidadExcesiva = stockInicial + 999;
    await client.query('CALL sp_ajustar_inventario($1, $2, $3, $4)', [
      idProducto,
      cantidadExcesiva,
      'SALIDA POR MERMA/AJUSTE',
      'Intento negativo'
    ]);
    console.error('ERROR: Permitió ajuste que genera stock negativo!');
  } catch (err) {
    console.log('Éxito: Error esperado capturado ->', err.message);
  } finally {
    await client.query('ROLLBACK');
  }

  // Test 3: Validación motivo obligatorio
  console.log('\n--- CASO 3: Validación de motivo obligatorio ---');
  await client.query('BEGIN');
  try {
    await client.query('CALL sp_ajustar_inventario($1, $2, $3, $4)', [
      idProducto,
      1,
      'ENTRADA POR AJUSTE',
      '   ' // Espacios en blanco
    ]);
    console.error('ERROR: Permitió ajuste con motivo vacío!');
  } catch (err) {
    console.log('Éxito: Error esperado capturado ->', err.message);
  } finally {
    await client.query('ROLLBACK');
  }

  await client.end();
}

verify().catch(console.error);
