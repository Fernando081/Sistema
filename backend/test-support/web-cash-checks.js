const assert = require('node:assert/strict');

async function verifyWebCash({ db,report,mainSale,returnedSale,usdSale,note,returns,activeRep,invoice,checked }) {
  assert.match((await db.query('SELECT current_schema() name'))[0].name,/^verify_web_financial_[a-f0-9]{16}$/);
  const originalNote = (await db.query('SELECT * FROM factura WHERE id_factura=$1',[note]))[0];
  const money = async (code='MXN') => (await report()).finance.currencies.find(row=>row.moneda===code).cash;
  const expenses = [], createdInvoices = [], createdPayments = [];
  const expense = async amount => {
    const id = (await db.query("INSERT INTO gasto(monto,metodo_pago,categoria) VALUES($1,'Efectivo','Devoluciones y Reembolsos') RETURNING id_gasto id",[amount]))[0].id;
    expenses.push(id); return id;
  };
  let returnedPayment;
  const examples = {};
  try {
    await db.query("UPDATE factura SET metodo_reembolso='Saldo a Favor' WHERE id_factura=$1",[note]);
    returnedPayment = (await db.query('INSERT INTO pago(id_factura,monto) VALUES($1,11.60) RETURNING id_pago id',[returnedSale]))[0].id;
    createdPayments.push(returnedPayment);
    examples.creditOnly = await money();
    assert.equal(examples.creditOnly.reembolsosEfectivo,'0.00');
    assert.equal(examples.creditOnly.saldoAFavorGenerado,'34.80');
    assert.equal(examples.creditOnly.cobrosNetosRegistrados,'81.60');
    assert.equal(examples.creditOnly.documentosConCobroNeto,2);
    checked('Saldo a favor generado separado: no reduce cobros ni se presenta como saldo disponible del cliente');

    const noteExpense = await expense('23.20'), returnExpense = await expense('3.87');
    await db.query("UPDATE factura SET metodo_reembolso='Efectivo',id_gasto_reembolso=$2 WHERE id_factura=$1",[note,noteExpense]);
    await db.query("UPDATE devolucion SET metodo_reembolso='Efectivo',id_gasto_reembolso=$2 WHERE id_devolucion=$1",[returns[0],returnExpense]);
    examples.cashAndCredit = await money();
    assert.equal(examples.cashAndCredit.reembolsosEfectivo,'27.07');
    assert.equal(examples.cashAndCredit.saldoAFavorGenerado,'7.73');
    assert.equal(examples.cashAndCredit.cobrosNetosRegistrados,'54.53');
    checked('Nota y devolución usan gastos explícitos una vez; REP canónico y dos espejos no duplican cobros; centavos 3.87/3.86/3.87 exactos');

    await db.query('UPDATE devolucion SET id_gasto_reembolso=NULL WHERE id_devolucion=$1',[returns[0]]);
    const missing = await money();
    assert.equal(missing.reembolsosSinGastoVinculado,1); assert.equal(missing.reembolsosEfectivo,null);
    assert.equal(missing.cobrosNetosRegistrados,null); assert.equal(missing.documentosCobroNetoDesconocido,1);
    await db.query('UPDATE devolucion SET id_gasto_reembolso=$2 WHERE id_devolucion=$1',[returns[0],returnExpense]);
    checked('Devolución histórica en efectivo sin vínculo deja total desconocido pese a existir un gasto del mismo importe');

    for (const [column,value,restore] of [['anulado',true,false],['monto','23.21','23.20'],['monto','NaN','23.20'],
      ['monto','-23.20','23.20'],['metodo_pago','Transferencia','Efectivo'],['categoria','Otro','Devoluciones y Reembolsos']]) {
      await db.query(`UPDATE gasto SET ${column}=$2 WHERE id_gasto=$1`,[noteExpense,value]);
      assert.equal((await money()).cobrosNetosRegistrados,null); assert.equal((await money()).gastosNoConciliados,1);
      await db.query(`UPDATE gasto SET ${column}=$2 WHERE id_gasto=$1`,[noteExpense,restore]);
    }
    checked('Gasto anulado, NaN, negativo, importe, método o categoría incongruentes no fabrican salida de efectivo');

    const reused = await invoice({quotation:null,type:'E',state:'Cancelada'}); createdInvoices.push(reused);
    await db.query('UPDATE factura SET id_gasto_reembolso=$2 WHERE id_factura=$1',[reused,noteExpense]);
    assert.equal((await money()).gastosNoConciliados,1); assert.equal((await money()).cobrosNetosRegistrados,null);
    await db.query('UPDATE factura SET id_gasto_reembolso=NULL WHERE id_factura=$1',[reused]);
    checked('Gasto reutilizado por otro documento, incluso cancelado y fuera de la cohorte, queda no conciliado');

    await db.query("UPDATE factura SET estatus='Cancelada' WHERE id_factura=$1",[note]);
    assert.equal((await money()).reembolsosEfectivo,'3.87'); assert.equal((await money()).cobrosNetosRegistrados,'77.73');
    await db.query("UPDATE factura SET estatus='Pagada' WHERE id_factura=$1",[note]);
    const fd = (await db.query("INSERT INTO fiscal_documento(id_factura,estado) VALUES($1,'Cancelado') RETURNING id_documento id",[note]))[0].id;
    assert.equal((await money()).cobrosNetosRegistrados,'77.73');
    await db.query('DELETE FROM fiscal_documento WHERE id_documento=$1',[fd]);
    checked('Cancelación local o fiscal de la nota excluye su reembolso; no descuenta el gasto huérfano por descripción');

    await db.query('UPDATE factura SET metodo_reembolso=NULL WHERE id_factura=$1',[note]);
    assert.equal((await money()).cobrosNetosRegistrados,null);
    await db.query("UPDATE factura SET metodo_reembolso='Saldo a Favor' WHERE id_factura=$1",[note]);
    assert.equal((await money()).gastosNoConciliados,1);
    await db.query("UPDATE factura SET metodo_reembolso='Efectivo' WHERE id_factura=$1",[note]);
    await db.query('UPDATE devolucion_detalle SET importe_reembolso=3.88 WHERE id_devolucion=$1',[returns[0]]);
    assert.equal((await money()).documentosReembolsoDesconocido,1); assert.equal((await money()).cobrosNetosRegistrados,null);
    await db.query('UPDATE devolucion_detalle SET importe_reembolso=3.87 WHERE id_devolucion=$1',[returns[0]]);
    checked('Método histórico desconocido, saldo a favor con gasto o detalle de devolución inválido conservan desconocidos explícitos');

    const usd = await money('USD'); assert.equal(usd.documentosMonedaNoComparable,1); assert.equal(usd.cobrosNetosRegistrados,null);
    await db.query('UPDATE factura SET tipo_cambio=2 WHERE id_factura=$1',[mainSale]);
    assert.equal((await money()).documentosMonedaNoComparable,1); assert.equal((await money()).cobrosNetosRegistrados,null);
    await db.query('UPDATE factura SET tipo_cambio=1 WHERE id_factura=$1',[mainSale]);
    await db.query('UPDATE factura SET tipo_cambio=2 WHERE id_factura=$1',[note]);
    assert.equal((await money()).documentosMonedaNoComparable,1); assert.equal((await money()).reembolsosEfectivo,null);
    await db.query('UPDATE factura SET tipo_cambio=1 WHERE id_factura=$1',[note]);
    assert.equal((await report()).finance.currencies.find(row=>row.moneda==='USD').cobrosRegistrados,'7.10');
    assert.ok((await db.query('SELECT 1 FROM factura WHERE id_factura=$1',[usdSale])).length);
    checked('Gastos sin moneda propia sólo comparables MXN/factor1; USD conserva cobro bruto, sin conversión supuesta');

    await db.query('DELETE FROM pago WHERE id_pago=$1',[returnedPayment]);
    const noHistory = await money(); assert.equal(noHistory.documentosPagosNoConciliados,1);
    assert.equal(noHistory.reembolsosEfectivo,'27.07'); assert.equal(noHistory.cobrosNetosRegistrados,null);
    await db.query('INSERT INTO pago(id_pago,id_factura,monto) VALUES($1,$2,11.60)',[returnedPayment,returnedSale]);
    await db.query('UPDATE pago SET monto=31 WHERE id_pago=(SELECT max(id_pago) FROM pago WHERE id_rep=$1)',[activeRep]);
    assert.equal((await money()).documentosPagosNoConciliados,1); assert.equal((await money()).cobrosNetosRegistrados,null);
    await db.query('UPDATE pago SET monto=30 WHERE id_pago=(SELECT max(id_pago) FROM pago WHERE id_rep=$1)',[activeRep]);
    checked('Pagada sin historial y espejo REP incongruente no prueban cobro neto; gastos comprobados mantienen su indicador independiente');

    const zeroSale = await invoice({subtotal:'0.00',tax:'0.00',total:'0.00',balance:'0.00'});
    createdInvoices.push(zeroSale);
    const zeroNote = await invoice({type:'E',origin:zeroSale,subtotal:'0.00',tax:'0.00',total:'0.00',balance:'0.00',state:'Pagada'});
    createdInvoices.push(zeroNote); await db.query("UPDATE factura SET metodo_reembolso='Efectivo' WHERE id_factura=$1",[zeroNote]);
    assert.equal((await money()).documentosConCobroNeto,3); assert.equal((await money()).cobrosNetosRegistrados,'54.53');
    checked('Documento y reembolso cero comprobados no exigen gasto ficticio ni se confunden con información desconocida');

    const big = await invoice({subtotal:'9999999999999999.99',tax:'0.00',total:'9999999999999999.99',balance:'0.00'});
    createdInvoices.push(big);
    const pay = (await db.query('INSERT INTO pago(id_factura,monto) VALUES($1,9999999999999999.99) RETURNING id_pago id',[big]))[0].id;
    createdPayments.push(pay); examples.largeNet = await money();
    assert.equal(examples.largeNet.cobrosNetosRegistrados,'10000000000000054.52');
    checked('Cobro neto superior a Number.MAX_SAFE_INTEGER conserva todos sus centavos como cadena decimal');
  } finally {
    await db.query('DELETE FROM pago WHERE id_pago=ANY($1::int[])',[createdPayments]);
    await db.query('DELETE FROM factura WHERE id_factura=ANY($1::int[]) AND tipo_comprobante=$2',[createdInvoices,'E']);
    await db.query('DELETE FROM factura WHERE id_factura=ANY($1::int[])',[createdInvoices]);
    await db.query('UPDATE factura SET metodo_reembolso=$2,id_gasto_reembolso=$3,estatus=$4,tipo_cambio=$5 WHERE id_factura=$1',
      [note,originalNote.metodo_reembolso,originalNote.id_gasto_reembolso,originalNote.estatus,originalNote.tipo_cambio]);
    await db.query("UPDATE devolucion SET metodo_reembolso='Saldo a Favor',id_gasto_reembolso=NULL WHERE id_devolucion=ANY($1::int[])",[returns]);
    await db.query('DELETE FROM gasto WHERE id_gasto=ANY($1::int[])',[expenses]);
  }
  return examples;
}
module.exports = {verifyWebCash};
