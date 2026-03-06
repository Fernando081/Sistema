const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function runSQL() {
  try {
    await c.connect();
    console.log("Conectado");
    
    const mig1 = fs.readFileSync(path.join(__dirname, "migrations/007_create_sp_cancelar_factura.sql"), "utf8");
    const mig2 = fs.readFileSync(path.join(__dirname, "migrations/008_create_vw_smart_restock.sql"), "utf8");
    const mig3 = fs.readFileSync(path.join(__dirname, "migrations/009_add_imagen_producto.sql"), "utf8");
    const mig4 = fs.readFileSync(path.join(__dirname, "migrations/010_setup_audit_triggers.sql"), "utf8");
    const mig5 = fs.readFileSync(path.join(__dirname, "migrations/011_add_imagen_to_producto_functions.sql"), "utf8");
    const mig6 = fs.readFileSync(path.join(__dirname, "migrations/012_add_imagen_to_get_productos_functions.sql"), "utf8");
    const mig7 = fs.readFileSync(path.join(__dirname, "migrations/013_add_multiple_images_producto.sql"), "utf8");

    console.log("Ejecutando 007_create_sp...");
    await c.query(mig1);
    console.log("007 procesado con éxito.");

    console.log("Ejecutando 008_create_vw...");
    await c.query(mig2);    
    console.log("008_create_vw_smart_restock.sql procesado con éxito.");

    console.log("Ejecutando 009_add_imagen_producto...");
    await c.query(mig3);
    console.log("009_add_imagen_producto.sql procesado con éxito.");

    console.log("Ejecutando 010_setup_audit_triggers...");
    await c.query(mig4);
    console.log("010_setup_audit_triggers.sql procesado con éxito.");

    console.log("Ejecutando 011_add_imagen_to_producto_functions...");
    await c.query(mig5);
    console.log("011_add_imagen_to_producto_functions.sql procesado con éxito.");

    console.log("Ejecutando 012_add_imagen_to_get_productos_functions...");
    await c.query(mig6);
    console.log("012_add_imagen_to_get_productos_functions.sql procesado con éxito.");

    console.log("Ejecutando 013_add_multiple_images_producto...");
    await c.query(mig7);
    console.log("013_add_multiple_images_producto.sql procesado con éxito.");
    
  } catch(e) {
    console.error(e.message);
  } finally {
    await c.end();
  }
}
runSQL();
