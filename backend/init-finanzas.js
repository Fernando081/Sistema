const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto'
});

async function run() {
  try {
    await client.connect();
    
    console.log("Creando tabla saldo...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS saldo (
        id_saldo SERIAL PRIMARY KEY,
        caja_chica DECIMAL(12,2) DEFAULT 0.00,
        cuenta_banco DECIMAL(12,2) DEFAULT 0.00,
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insertar fila de saldos iniciales
    await client.query(`
      INSERT INTO saldo (caja_chica, cuenta_banco) 
      SELECT 0, 0 
      WHERE NOT EXISTS (SELECT 1 FROM saldo);
    `);

    console.log("Creando tabla gasto...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS gasto (
        id_gasto SERIAL PRIMARY KEY,
        concepto VARCHAR(255) NOT NULL,
        monto DECIMAL(12,2) NOT NULL,
        categoria VARCHAR(100) NOT NULL,
        metodo_pago VARCHAR(50) NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        id_usuario INT
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
