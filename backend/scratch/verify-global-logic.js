const { Client } = require('pg');

const client = new Client({ connectionString: 'postgresql://postgres:F8pz6u4oi**@127.0.0.1:5432/BD_local_Proyecto' });

async function verify() {
  await client.connect();
  console.log('Conectado a la DB.');

  // 1. Probar la consulta de tickets pendientes
  console.log('\n--- Probando consulta de tickets pendientes (getTicketsPendientesGlobal) ---');
  const fechaInicio = '2026-01-01';
  const fechaFin = '2026-12-31';

  const ticketsQuery = `
    SELECT 
      id_factura AS "idFactura",
      serie,
      folio,
      fecha_emision AS "fechaEmision",
      rfc_receptor AS "rfcReceptor",
      nombre_receptor AS "nombreReceptor",
      subtotal,
      total_impuestos_trasladados AS "totalImpuestosTrasladados",
      total_impuestos_retenidos AS "totalImpuestosRetenidos",
      total
    FROM factura
    WHERE fecha_emision::date >= $1::date 
      AND fecha_emision::date <= $2::date
      AND uuid IS NULL
      AND id_factura_global IS NULL
      AND estatus != 'Cancelada'
      AND rfc_receptor != 'XAXX010101000'
    ORDER BY id_factura ASC
  `;
  const ticketsRes = await client.query(ticketsQuery, [fechaInicio, fechaFin]);
  const tickets = ticketsRes.rows;
  console.log(`Se encontraron ${tickets.length} tickets pendientes.`);

  let subtotalSum = 0;
  let totalSum = 0;
  for (const t of tickets) {
    subtotalSum += Number(t.subtotal || 0);
    totalSum += Number(t.total || 0);
  }
  console.log(`Subtotal sumado: $${subtotalSum.toFixed(2)}`);
  console.log(`Total sumado: $${totalSum.toFixed(2)}`);

  if (tickets.length === 0) {
    console.log('No hay tickets para agrupar. Terminando verificación de transacción.');
    await client.end();
    return;
  }

  // 2. Probar la generación de la Factura Global
  console.log('\n--- Probando generación de Factura Global (generarFacturaGlobal) ---');
  const idsTickets = [tickets[0].idFactura, tickets[1].idFactura].filter(Boolean);
  console.log(`Agrupando tickets con IDs: ${idsTickets.join(', ')}`);

  // Comenzar transacción
  await client.query('BEGIN');

  try {
    // Buscar datos de los tickets
    const querySel = `
      SELECT id_factura, subtotal, total_impuestos_trasladados, total
      FROM factura
      WHERE id_factura = ANY($1)
    `;
    const ticketsGrouped = (await client.query(querySel, [idsTickets])).rows;
    console.log(`Cargados ${ticketsGrouped.length} tickets para agrupar.`);

    // Obtener cliente Público en General
    const clientRes = await client.query(`SELECT "IdCliente", "RFC", "RazonSocial", "CodigoPostal" FROM cliente WHERE "RFC" = 'XAXX010101000'`);
    if (clientRes.rows.length === 0) {
      throw new Error('El cliente PUBLICO EN GENERAL no existe en la base de datos.');
    }
    const genericClient = clientRes.rows[0];
    console.log('Cliente genérico cargado:', genericClient);

    // Calcular totales
    let subtotal = 0;
    let totalImpuestosTrasladados = 0;
    let total = 0;
    const conceptos = [];

    for (const t of ticketsGrouped) {
      const ticketSub = Number(t.subtotal || 0);
      const ticketIva = Number(t.total_impuestos_trasladados || 0);
      const ticketTot = Number(t.total || 0);

      subtotal += ticketSub;
      totalImpuestosTrasladados += ticketIva;
      total += ticketTot;

      conceptos.push({
        idProducto: null,
        claveProdServ: '84111506',
        claveUnidad: 'ACT',
        objetoImpuesto: '02',
        descripcion: 'Venta',
        cantidad: 1,
        valorUnitario: ticketSub,
        importe: ticketSub,
        descuento: 0,
        baseIva: ticketSub,
        tasaIva: 0.16,
        importeIva: ticketIva,
        baseRetIsr: 0,
        tasaRetIsr: 0,
        importeRetIsr: 0
      });
    }

    subtotal = Number(subtotal.toFixed(2));
    totalImpuestosTrasladados = Number(totalImpuestosTrasladados.toFixed(2));
    total = Number(total.toFixed(2));

    const serie = 'G';
    const folioRes = await client.query('SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1', [serie]);
    const folio = parseInt(folioRes.rows[0].next_folio, 10);
    console.log(`Nuevo Folio calculado: ${folio} para serie ${serie}`);

    const conceptosJson = JSON.stringify(conceptos);
    const createVentaRes = await client.query(
      `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) as id_factura`,
      [
        genericClient.IdCliente,
        genericClient.RFC,
        genericClient.RazonSocial,
        genericClient.CodigoPostal,
        '616',
        'S01',
        1, // Forma pago Efectivo
        1, // Metodo pago PUE
        'MXN',
        1,
        subtotal,
        totalImpuestosTrasladados,
        0,
        total,
        'Factura Global del periodo ' + fechaInicio + ' al ' + fechaFin,
        conceptosJson,
        null, // Vendedor ID
        folio,
        serie,
        'I'
      ]
    );

    const idGlobalInvoice = createVentaRes.rows[0].id_factura;
    console.log(`Factura Global insertada con ID: ${idGlobalInvoice}`);

    // Vincular tickets
    const updateRes = await client.query(
      'UPDATE factura SET id_factura_global = $1 WHERE id_factura = ANY($2)',
      [idGlobalInvoice, idsTickets]
    );
    console.log(`Actualizado id_factura_global para los tickets agrupados: ${updateRes.rowCount} filas afectadas.`);

    // Verificar que los tickets quedaron bien guardados en la base de datos
    const checkTickets = (await client.query('SELECT id_factura, folio, serie, id_factura_global FROM factura WHERE id_factura = ANY($1)', [idsTickets])).rows;
    console.log('Estado de los tickets agrupados:', checkTickets);

    // Verificar la factura global en sí
    const checkGlobal = (await client.query('SELECT * FROM factura WHERE id_factura = $1', [idGlobalInvoice])).rows[0];
    console.log('Datos de la Factura Global creada:', {
      idFactura: checkGlobal.id_factura,
      serie: checkGlobal.serie,
      folio: checkGlobal.folio,
      rfc: checkGlobal.rfc_receptor,
      nombre: checkGlobal.nombre_receptor,
      subtotal: checkGlobal.subtotal,
      total: checkGlobal.total,
      tipoComprobante: checkGlobal.tipo_comprobante
    });

    console.log('Todo verificado correctamente. Aplicando ROLLBACK para mantener la DB limpia.');
    await client.query('ROLLBACK');
    console.log('DB limpia.');
  } catch (err) {
    console.log('Error durante la simulación, aplicando ROLLBACK:', err);
    await client.query('ROLLBACK');
  }

  await client.end();
}

verify().catch(console.error);
