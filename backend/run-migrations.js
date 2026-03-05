const { Client } = require('pg');
const fs = require('fs');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function runSQL() {
  try {
    await c.connect();
    console.log("Conectado");
    
    const mig1 = fs.readFileSync('./migrations/007_create_sp_cancelar_factura.sql', 'utf8');
    await c.query(mig1);
    console.log("007_create_sp_cancelar_factura.sql procesado con éxito.");
    
    const mig2 = fs.readFileSync('./migrations/008_create_vw_smart_restock.sql', 'utf8');
    await c.query(mig2);
    console.log("008_create_vw_smart_restock.sql procesado con éxito.");
    
  } catch(e) {
    console.error(e.message);
  } finally {
    await c.end();
  }
}
runSQL();
