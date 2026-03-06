const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const c = new Client('postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto');

async function fix() {
  try {
    await c.connect();
    const funcs = ['fn_create_producto', 'fn_update_producto', 'fn_get_productos', 'fn_get_producto_by_id'];
    for(let f of funcs) {
       const res = await c.query(`SELECT oid::regprocedure as sig FROM pg_proc WHERE proname = $1`, [f]);
       for(let row of res.rows) {
          await c.query(`DROP FUNCTION ${row.sig} CASCADE`);
          console.log(`Dropped ${row.sig}`);
       }
    }
    
    // Now run 013
    const mig7 = fs.readFileSync(path.join(__dirname, "migrations/013_add_multiple_images_producto.sql"), "utf8");
    await c.query(mig7);
    console.log("Migration 013 executed successfully!");
  } catch(e) {
    console.error(e);
  } finally {
    await c.end();
  }
}
fix();
