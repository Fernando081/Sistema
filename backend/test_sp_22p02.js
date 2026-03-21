const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function testSp() {
  try {
    await client.connect();
    const idFactura = "93"; // Example string id as passed by NestJS
    const dto = {
      metodoReembolso: "Saldo a Favor", // or "Entregar Efectivo (Caja)" -- wait, the method is "Saldo a Favor del Cliente"?
      articulos: [
        { idProducto: 1, cantidad: 1, precioUnitario: 100 }
      ]
    };
    
    // Wait, the frontend sends "Saldo a Favor del Cliente" but the SP only expects "Saldo a Favor" or "Efectivo"!
    // Wait... look at devolucion-dialog.component.ts:
    // <mat-radio-button value="Efectivo" color="primary">Entregar Efectivo (Caja)</mat-radio-button>
    // <mat-radio-button value="Saldo a Favor" color="primary">Saldo a Favor del Cliente</mat-radio-button>
    // So the value IS "Saldo a Favor".
    
    console.log("Executing SP...");
    const res = await client.query(
      `SELECT sp_procesar_devolucion_parcial($1, $2, $3::jsonb, $4) AS id_devolucion`,
      [idFactura, dto.metodoReembolso, JSON.stringify(dto.articulos), 1]
    );
    console.log("Success:", res.rows);
  } catch (e) {
    console.error("DB Error:", e.code, e.message);
  } finally {
    process.exit(0);
  }
}

testSp();
