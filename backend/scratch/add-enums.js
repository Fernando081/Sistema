const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function main() {
  await client.connect();
  console.log('Conectado a la base de datos.');

  try {
    // Para evitar errores si ya existen, capturamos el error o usamos pg_enum
    // ALTER TYPE ADD VALUE no soporta IF NOT EXISTS en todas las versiones de pg,
    // así que consultamos si ya existen primero.
    const res = await client.query(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid 
      WHERE typname = 'tipo_movimiento_enum'
    `);
    const existing = res.rows.map(r => r.enumlabel);

    if (!existing.includes('ENTRADA POR AJUSTE')) {
      console.log("Agregando ENTRADA POR AJUSTE a tipo_movimiento_enum...");
      await client.query("ALTER TYPE tipo_movimiento_enum ADD VALUE 'ENTRADA POR AJUSTE'");
    }
    if (!existing.includes('SALIDA POR MERMA/AJUSTE')) {
      console.log("Agregando SALIDA POR MERMA/AJUSTE a tipo_movimiento_enum...");
      await client.query("ALTER TYPE tipo_movimiento_enum ADD VALUE 'SALIDA POR MERMA/AJUSTE'");
    }

    console.log('Enums actualizados correctamente.');
  } catch (err) {
    console.error('Error al actualizar enums:', err);
  } finally {
    await client.end();
  }
}
main();
