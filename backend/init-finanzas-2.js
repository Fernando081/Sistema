const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto'
});

async function run() {
  try {
    await client.connect();
    
    // First drop the wrong tables
    await client.query(`DROP TABLE IF EXISTS saldo CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS gasto CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS saldos CASCADE;`);

    console.log("Creando tabla saldos...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS saldos (
        id_saldo SERIAL PRIMARY KEY,
        caja_chica DECIMAL(18,2) DEFAULT 0.00,
        cuenta_banco DECIMAL(18,2) DEFAULT 0.00,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insertar fila de saldos iniciales
    await client.query(`
      INSERT INTO saldos (caja_chica, cuenta_banco) 
      SELECT 0, 0 
      WHERE NOT EXISTS (SELECT 1 FROM saldos);
    `);

    console.log("Creando tabla gasto...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS gasto (
        id_gasto SERIAL PRIMARY KEY,
        fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        concepto VARCHAR(255) NOT NULL,
        monto DECIMAL(18,2) NOT NULL,
        categoria VARCHAR(100) NOT NULL,
        metodo_pago VARCHAR(50) NOT NULL,
        id_user INT,
        id_compra INT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log("Tablas creadas exitosamente.");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
