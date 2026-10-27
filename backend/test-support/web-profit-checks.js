const assert = require('node:assert/strict');

// This helper is deliberately restricted to the financial verifier's own schema.
// It never repairs costs or assigns commercial origins in operational tables.
async function verifyWebProfit({ db, report, mainSale, returnedSale, usdSale, note, checked }) {
  assert.match((await db.query('SELECT current_schema() name'))[0].name, /^verify_web_financial_[a-f0-9]{16}$/);
  const inserted = [];
  const original = await db.query('SELECT * FROM conceptofactura ORDER BY id_concepto');
  const money = async (currency='MXN') => (await report()).finance.currencies.find(row=>row.moneda===currency);
  const add = async (invoice, product, quantity, amount, discount, tax, cost) => {
    const id = (await db.query(`INSERT INTO conceptofactura(id_factura,id_producto,cantidad,importe,descuento,importe_iva,importe_ret_isr,costo_unitario_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,0,$7) RETURNING id_concepto AS id`,[invoice,product,quantity,amount,discount,tax,cost]))[0].id;
    inserted.push(id); return id;
  };
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=30 WHERE id_factura=$1',[mainSale]);
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=1.111111 WHERE id_factura=$1',[returnedSale]);
  const noteConcept = await add(note,2,'0.4','20','0','3.20','999');
  await add(usdSale,3,'1','50','0','8','30');
  const known = await money();
  assert.deepEqual(known.profit,{ baseCosto:'snapshot-local-MXN',costoVentaNeto:'48.00',utilidadBruta:'32.00',margenBrutoPct:'40.00',
    documentosConRentabilidad:2,documentosRentabilidadDesconocida:0,documentosSinCostoValido:0,
    documentosMonedaCostoNoComparable:0,documentosDetalleNoConciliado:0 });
  assert.equal(known.ventasNetasSinImpuestos,'80.00'); assert.equal(known.cobrosRegistrados,'70.00');
  checked('Costo congelado original tras NC/fracciones devueltas; no costo actual de NC ni cobros confundidos con utilidad');
  await db.query(`UPDATE conceptofactura SET cantidad=1,importe=55,descuento=5,importe_iva=8 WHERE id_factura=$1`,[mainSale]);
  const duplicate = await add(mainSale,2,'1','55','5','8','50');
  assert.equal((await money()).profit.costoVentaNeto,'64.00'); assert.equal((await money()).profit.utilidadBruta,'16.00');
  assert.equal((await money()).profit.margenBrutoPct,'20.00');
  const weighted = (await money()).profit;
  checked('Producto repetido con snapshots diferentes: promedio ponderado histórico y una reducción por cantidad devuelta');
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=80 WHERE id_factura=$1',[mainSale]);
  const loss = (await money()).profit;
  assert.equal(loss.costoVentaNeto,'128.00'); assert.equal(loss.utilidadBruta,'-48.00'); assert.equal(loss.margenBrutoPct,'-60.00');
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=30 WHERE id_factura=$1',[mainSale]);
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=50 WHERE id_concepto=$1',[duplicate]);
  checked('Venta por debajo del costo conserva pérdida/margen negativos sin recortarlos a cero');
  await db.query('UPDATE factura SET subtotal=100,total_impuestos_trasladados=16,total=116 WHERE id_factura=$1',[note]);
  await db.query('UPDATE conceptofactura SET cantidad=2,importe=100,importe_iva=16 WHERE id_concepto=$1',[noteConcept]);
  assert.equal((await money()).profit.costoVentaNeto,'0.00'); assert.equal((await money()).profit.utilidadBruta,'0.00');
  assert.equal((await money()).profit.margenBrutoPct,null); assert.equal((await money()).profit.documentosRentabilidadDesconocida,0);
  await db.query('UPDATE factura SET subtotal=20,total_impuestos_trasladados=3.20,total=23.20 WHERE id_factura=$1',[note]);
  await db.query('UPDATE conceptofactura SET cantidad=0.4,importe=20,importe_iva=3.20 WHERE id_concepto=$1',[noteConcept]);
  checked('Devolución completa con neto/costo/utilidad cero conserva margen indefinido por falta de base positiva');
  const first = original.find(row=>row.id_factura===mainSale).id_concepto;
  for (const bad of [null,'NaN','-1']) {
    await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=$2 WHERE id_concepto=$1',[first,bad]);
    const row = await money(); assert.equal(row.profit.costoVentaNeto,null); assert.equal(row.profit.utilidadBruta,null);
    assert.equal(row.profit.margenBrutoPct,null); assert.equal(row.profit.documentosSinCostoValido,1);
    assert.equal(row.ventasNetasSinImpuestos,'80.00'); assert.equal(row.cobrosRegistrados,'70.00');
  }
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=30 WHERE id_concepto=$1',[first]);
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=0 WHERE id_factura=$1',[mainSale]);
  assert.equal((await money()).profit.costoVentaNeto,'0.00'); assert.equal((await money()).profit.utilidadBruta,'80.00');
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=30 WHERE id_concepto=$1',[first]);
  await db.query('UPDATE conceptofactura SET costo_unitario_snapshot=50 WHERE id_concepto=$1',[duplicate]);
  checked('Snapshot NULL/NaN/negativo deja total desconocido; costo cero explícito válido y ventas/cobros independientes');
  for (const [column,bad,restore] of [['cantidad','2.1','0.4'],['id_producto',999,2],['importe','21','20']]) {
    await db.query(`UPDATE conceptofactura SET ${column}=$2 WHERE id_concepto=$1`,[noteConcept,bad]);
    assert.equal((await money()).profit.utilidadBruta,null); assert.equal((await money()).profit.documentosDetalleNoConciliado,1);
    await db.query(`UPDATE conceptofactura SET ${column}=$2 WHERE id_concepto=$1`,[noteConcept,restore]);
  }
  await db.query("UPDATE factura SET estatus='Cancelada' WHERE id_factura=$1",[note]);
  assert.equal((await money()).profit.costoVentaNeto,'80.00'); assert.equal((await money()).profit.utilidadBruta,'20.00');
  await db.query("UPDATE factura SET estatus='Pagada' WHERE id_factura=$1",[note]);
  const cancellation = (await db.query("INSERT INTO fiscal_documento(id_factura,estado) VALUES($1,'Cancelado') RETURNING id_documento AS id",[note]))[0].id;
  assert.equal((await money()).profit.utilidadBruta,'20.00'); await db.query('DELETE FROM fiscal_documento WHERE id_documento=$1',[cancellation]);
  checked('Detalle NC desconocido/excesivo/incompatible impide rentabilidad; cancelaciones local/fiscal revierten su ajuste');
  const usd = await money('USD'); assert.equal(usd.profit.utilidadBruta,null); assert.equal(usd.profit.documentosMonedaCostoNoComparable,1);
  assert.equal(usd.profit.documentosSinCostoValido,0); assert.equal(usd.ventasNetasSinImpuestos,'50.00');
  for (const factor of [null,'0','2','NaN']) {
    await db.query('UPDATE factura SET tipo_cambio=$2 WHERE id_factura=$1',[mainSale,factor]);
    assert.equal((await money()).profit.utilidadBruta,null); assert.equal((await money()).profit.documentosMonedaCostoNoComparable,1);
  }
  await db.query('UPDATE factura SET tipo_cambio=1 WHERE id_factura=$1',[mainSale]);
  checked('Costo local no convertido a USD; MXN con factor ausente/inconsistente conserva costos no comparables');
  await db.query('UPDATE factura SET total=117 WHERE id_factura=$1',[mainSale]);
  assert.equal((await money()).profit.utilidadBruta,null); await db.query('UPDATE factura SET total=116 WHERE id_factura=$1',[mainSale]);
  await db.query('UPDATE conceptofactura SET cantidad=0 WHERE id_factura=$1',[mainSale]);
  assert.equal((await money()).profit.utilidadBruta,null);
  await db.query('UPDATE conceptofactura SET cantidad=1 WHERE id_factura=$1',[mainSale]);
  assert.equal((await money()).profit.utilidadBruta,'16.00');
  checked('Encabezado no conciliado o cantidad cero no fabrican utilidad ni causan división por cero');
  const fractional = await db.query(`INSERT INTO factura(id_cliente,id_cotizacion,estatus,tipo_comprobante,serie,moneda,tipo_cambio,
    subtotal,descuento,total_impuestos_trasladados,total_impuestos_retenidos,total,saldo_pendiente)
    SELECT id_cliente,id_cotizacion,'Pendiente','I','A','MXN',1,1,0,0,0,1,1 FROM factura WHERE id_factura=$1 RETURNING id_factura AS id`,[mainSale]);
  const extraInvoice = fractional[0].id; const extraConcept = await add(extraInvoice,4,'1','1','0','0','0.333333');
  const rounding = await money(); assert.equal(rounding.profit.costoVentaNeto,'64.33'); assert.equal(rounding.profit.utilidadBruta,'16.67');
  assert.equal(rounding.profit.margenBrutoPct,'20.58');
  await db.query('DELETE FROM conceptofactura WHERE id_concepto=$1',[extraConcept]); await db.query('DELETE FROM factura WHERE id_factura=$1',[extraInvoice]);
  checked('Costo neto redondeado por documento y margen sobre sumas; costo + utilidad reconcilian al neto exacto');
  // A tiny positive net after discount and two valid, large cost snapshots can
  // exceed a numeric(30,2) percentage. The report must preserve numeric precision.
  const largeInvoice = (await db.query(`INSERT INTO factura(id_cliente,id_cotizacion,estatus,tipo_comprobante,serie,moneda,tipo_cambio,
    subtotal,descuento,total_impuestos_trasladados,total_impuestos_retenidos,total,saldo_pendiente)
    SELECT id_cliente,id_cotizacion,'Pendiente','I','A','MXN',1,2,1.99,0,0,0.01,0.01 FROM factura WHERE id_factura=$1 RETURNING id_factura AS id`,[mainSale]))[0].id;
  const bigA = await add(largeInvoice,5,'999999999999','1','0.99','0','999999999999');
  const bigB = await add(largeInvoice,5,'999999999999','1','1','0','999999999999');
  await db.query("UPDATE factura SET estatus='Cancelada' WHERE id_factura=ANY($1::int[])",[[mainSale,returnedSale]]);
  const large = (await money()).profit;
  assert.equal(large.costoVentaNeto,'1999999999996000000000002.00');
  assert.equal(large.utilidadBruta,'-1999999999996000000000001.99');
  assert.equal(large.margenBrutoPct,'-19999999999960000000000019900.00');
  await db.query('DELETE FROM conceptofactura WHERE id_concepto=ANY($1::int[])',[[bigA,bigB]]);
  await db.query('DELETE FROM factura WHERE id_factura=$1',[largeInvoice]);
  await db.query("UPDATE factura SET estatus='Pendiente' WHERE id_factura=$1",[mainSale]);
  await db.query("UPDATE factura SET estatus='Pagada' WHERE id_factura=$1",[returnedSale]);
  checked('Costo/margen enormes calculados en numeric sin límite artificial de 30 dígitos ni error de desbordamiento');
  await db.query('DELETE FROM conceptofactura WHERE id_concepto=ANY($1::int[])',[inserted]);
  for (const row of original) await db.query(`UPDATE conceptofactura SET cantidad=$2,importe=$3,descuento=$4,importe_iva=$5,costo_unitario_snapshot=$6 WHERE id_concepto=$1`,
    [row.id_concepto,row.cantidad,row.importe,row.descuento,row.importe_iva,row.costo_unitario_snapshot]);
  return { known:known.profit,weighted,loss,rounding:rounding.profit,large };
}
module.exports = { verifyWebProfit };
