const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function testSp() {
  try {
    await client.connect();
    
    console.log("Executing SP...");
    // 1st attempt: "Saldo a Favor"
    const res = await client.query(
      `SELECT sp_procesar_devolucion_parcial($1::int, $2::varchar, $3::jsonb, $4::int) AS id_devolucion`,
      [93, 'Saldo a Favor', JSON.stringify([{ idProducto: 1, cantidad: 1, precioUnitario: 100 }]), 1]
    );
    console.log("Success with 'Saldo a Favor':", res.rows);
  } catch (e) {
    console.error("DB Error 1:", e.message);
  }

  try {
    console.log("Executing SP...");
    // 2nd attempt: "Saldo a Favor del Cliente" (What the frontend might actually be sending!)
    const res = await client.query(
      `SELECT sp_procesar_devolucion_parcial($1::int, $2::varchar, $3::jsonb, $4::int) AS id_devolucion`,
      [93, 'Saldo a Favor del Cliente', JSON.stringify([{ idProducto: 1, cantidad: 1, precioUnitario: 100 }]), 1]
    );
    console.log("Success with 'Saldo a Favor del Cliente':", res.rows);
  } catch (e) {
    console.error("DB Error 2:", e.message);
  }

  try {
    console.log("Executing SP...");
    // 3rd attempt: idProducto mismatch? 
    // Let's actually use the product currently inside Factura 93 (which is likely id 6 or something).
    // The previous test got 23503 foreign key violation on devolucion_detalle.
    // That means the EXCEPTION block was PASSED successfully!
    // So why does the subagent trigger P0001?
    // Maybe v_monto_total <= 0 ???
    // If the frontend sends subagent data:
    // ...
  } catch (e) {
    console.error("DB Error 3:", e.message);
  }

  process.exit(0);
}

testSp();
