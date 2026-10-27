const assert = require('node:assert/strict');
const { randomUUID,createHash } = require('node:crypto');

// Full business flows only in the verifier's disposable restored database.
async function verifyRefundAcceptance({ writer,apiCall,admin,other,inboxService,checked }) {
  const query = async (sql,params) => (await writer.query(sql,params)).rows;
  assert.match((await query('SELECT current_database() name'))[0].name,/^verify_web_auth_[a-f0-9]{16}$/);
  const [client] = await query('SELECT "IdCliente" id,"RFC" rfc,"RazonSocial" name,"CodigoPostal" cp FROM cliente ORDER BY "IdCliente" LIMIT 1');
  const catalog = async (table,column,key) => (await query(`SELECT "${column}" id FROM ${table} WHERE "Clave"=$1`,[key]))[0].id;
  const form = await catalog('formadepago','IdFormaPago','01'), ppd = await catalog('metododepago','IdMetodoDePago','PPD');
  const tax = await catalog('objetoimpuesto','IdObjetoImpuesto','01');
  const [product] = await query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR")
    VALUES($1,'WEB05.2e isolated refund fixture',$2,5,100,'01',0,false) RETURNING "IdProducto" id`,['REFUND-'+randomUUID().slice(0,12),tax]);
  const requestId = randomUUID();
  await inboxService.receive({ schemaVersion:1,requestId,origin:'public-web',
    contact:{name:'Isolated refund fixture',channel:'email',value:'refund@example.invalid'},
    items:[{kind:'reference',code:'REFUND-FIXTURE',brand:'',application:'',quantity:3}],privacy:{accepted:true,version:'fixture-auth-v1'} },'a'.repeat(64));
  await query('UPDATE crm_solicitud_web SET created_at=$2 WHERE request_id=$1',[requestId,'2026-09-01T12:00:00Z']);
  const opportunity = (await inboxService.convert(requestId,1,admin.id,admin.id)).idOportunidad;
  const [quote] = await query('INSERT INTO cotizacion(id_cliente,subtotal,total_impuestos,total_retenciones,total) VALUES($1,20,0,0,20) RETURNING id_cotizacion id',[client.id]);
  const commercial = 'crm/oportunidades/'+opportunity+'/documentos-comerciales';
  const before = await (await apiCall(commercial,admin.token,200)).json();
  const linkedClient = await (await apiCall(commercial+'/cliente',admin.token,200,'PUT',{
    idCliente:client.id,expectedVersion:before.opportunity.version,confirmado:true })).json();
  await apiCall(commercial+'/cotizaciones/'+quote.id,admin.token,200,'PUT',{expectedVersion:linkedClient.version,confirmado:true});
  const post = async (route,body,status=201,token=admin.token) => (await apiCall(route,token,status,'POST',body)).json();
  const saleBody = (quantity,price) => ({ requestId:randomUUID(),idCliente:client.id,rfcReceptor:client.rfc,nombreReceptor:client.name,
    cpReceptor:client.cp,regimenReceptor:'616',usoCfdi:'G03',idFormaPago:form,idMetodoPago:ppd,moneda:'MXN',tipoCambio:1,
    subtotal:10,totalImpuestosTrasladados:0,totalImpuestosRetenidos:0,total:10,tipoComprobante:'I',serie:'A',
    conceptos:[{idProducto:product.id,cantidad:quantity,valorUnitario:price,importe:10,descuento:0,claveProdServ:'31171500',
      claveUnidad:'H87',objetoImpuesto:'01',codigo:'REFUND',descripcion:'Isolated fixture',unidadDescripcion:'Pieza',
      baseIva:0,tasaIva:0,importeIva:0,baseRetIsr:0,tasaRetIsr:0,importeRetIsr:0}] });
  const returned = await post('venta',saleBody(3,3.333333));
  const credited = await post('venta',saleBody(2,5));
  // Explicit fixture lineage, never alter historical documents or guess origins.
  await query('UPDATE factura SET id_cotizacion=$2 WHERE id_factura=ANY($1::int[])',[[returned.idFactura,credited.idFactura],quote.id]);
  for (const sale of [returned,credited]) await post('pago/rep',{requestId:randomUUID(),idCliente:client.id,fechaPago:new Date().toISOString(),
    formaPago:'Efectivo',moneda:'MXN',montoTotal:10,facturas:[{idFactura:sale.idFactura,montoSaldado:10}]});
  const state = async () => (await query(`SELECT
    (SELECT "Existencia"::text FROM producto WHERE "IdProducto"=$1) stock,
    (SELECT caja_chica::text FROM saldos ORDER BY id_saldo LIMIT 1) cash,
    (SELECT saldo_a_favor::text FROM cliente WHERE "IdCliente"=$2) credit,
    (SELECT count(*)::int FROM devolucion WHERE id_factura=$3) returns,
    (SELECT count(*)::int FROM gasto) expenses,
    (SELECT count(*)::int FROM kardex WHERE id_producto=$1) movements,
    (SELECT sum(cantidad)::text FROM inventario_ubicacion WHERE id_producto=$1) location_stock`,[product.id,client.id,returned.idFactura]))[0];
  const metric = async () => (await (await apiCall('crm/solicitudes-web/metricas?desde=2026-09-01&hasta=2026-09-01',admin.token,200)).json()).finance.currencies[0];
  const fingerprint = async () => {
    const data=[];
    for(const table of ['factura','pago','rep','rep_factura','gasto','devolucion','devolucion_detalle','producto','kardex','poliza_contable','poliza_contable_detalle'])
      data.push(await query(`SELECT to_jsonb(t) r FROM ${table} t ORDER BY to_jsonb(t)::text`));
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  };
  const beforeReturns = await state();
  // The SQL function must preserve a caller's flag; a later direct adjustment
  // in that transaction still needs its manual kardex. Roll back both probes.
  for (const initial of ['false','true']) {
    await writer.query('BEGIN');
    try {
      await writer.query("SELECT set_config('app.stock_movement_managed',$1,true)",[initial]);
      await writer.query('SELECT sp_procesar_devolucion_parcial($1,$2,$3::jsonb,$4)',
        [returned.idFactura,'Efectivo',JSON.stringify([{idProducto:product.id,cantidad:1}]),admin.id]);
      assert.equal((await query("SELECT current_setting('app.stock_movement_managed') flag"))[0].flag,initial);
      assert.equal((await query("SELECT count(*)::int n FROM kardex WHERE id_producto=$1 AND tipo_movimiento::text='AJUSTE_MANUAL_STOCK'",[product.id]))[0].n,0);
      if(initial==='false') {
        await query('UPDATE producto SET "Existencia"="Existencia"+1 WHERE "IdProducto"=$1',[product.id]);
        assert.equal((await query("SELECT count(*)::int n FROM kardex WHERE id_producto=$1 AND tipo_movimiento::text='AJUSTE_MANUAL_STOCK'",[product.id]))[0].n,1);
      }
    } finally {await writer.query('ROLLBACK');}
  }
  assert.deepEqual(await state(),beforeReturns);
  checked('093 preserva el indicador de movimiento gestionado true/false; un ajuste manual posterior conserva kardex y las sondas revierten inventario/caja/pólizas');
  const returns=[];
  for(const amount of ['3.33','3.34','3.33']) {
    const body={metodoReembolso:'Efectivo',articulos:[{idProducto:product.id,cantidad:1}]};
    const untouched=await state();
    await apiCall('venta/'+returned.idFactura+'/devoluciones',null,401,'POST',body);
    await apiCall('venta/'+returned.idFactura+'/devoluciones',other.token,403,'POST',body);
    assert.deepEqual(await state(),untouched);
    const result=await post('venta/'+returned.idFactura+'/devoluciones',body);
    const [link]=await query(`SELECT d.monto_total::text amount,d.id_gasto_reembolso,g.monto::text expense,g.anulado,
      g.id_user,(SELECT count(*)::int FROM poliza_contable p WHERE p.origen_tipo='Gasto' AND p.origen_id=g.id_gasto) policies
      FROM devolucion d JOIN gasto g ON g.id_gasto=d.id_gasto_reembolso WHERE d.id_devolucion=$1`,[result.idDevolucion]);
    assert.ok(link); assert.equal(link.amount,amount); assert.equal(link.expense,amount);
    assert.equal(link.anulado,false); assert.equal(link.id_user,admin.id); assert.equal(link.policies,1);
    returns.push(link);
  }
  const afterReturns = await state();
  assert.equal(Number(afterReturns.stock)-Number(beforeReturns.stock),3,'Devuelve tres unidades al inventario');
  assert.equal(Math.round((Number(beforeReturns.cash)-Number(afterReturns.cash))*100),1000);
  assert.equal(afterReturns.expenses-beforeReturns.expenses,3,'Crea exactamente tres gastos');
  assert.equal(afterReturns.movements-beforeReturns.movements,3,'Un movimiento kardex por devolución, sin ajuste manual duplicado');
  assert.equal(Number(afterReturns.stock),Number(afterReturns.location_stock),'Existencia coincide con ubicaciones después de devolver');
  assert.equal(afterReturns.credit,beforeReturns.credit);
  const beforeBad = await fingerprint();
  await apiCall('venta/'+returned.idFactura+'/devoluciones',admin.token,400,'POST',{metodoReembolso:'Efectivo',articulos:[{idProducto:product.id,cantidad:0}]});
  await apiCall('venta/'+returned.idFactura+'/devoluciones',admin.token,400,'POST',{metodoReembolso:'Efectivo',articulos:[{idProducto:product.id,cantidad:1}]});
  await writer.query('BEGIN');
  try {
    await assert.rejects(()=>writer.query('SELECT sp_procesar_devolucion_parcial($1,$2,$3::jsonb,$4)',
      [returned.idFactura,'Efectivo',JSON.stringify([{idProducto:product.id,cantidad:1}]),admin.id]),e=>e.code==='P0001');
  } finally {await writer.query('ROLLBACK');}
  assert.equal(await fingerprint(),beforeBad);
  checked('093 en AppModule/copia: tres devoluciones API 3.33/3.34/3.33 con gasto/actor/póliza, caja y kardex exactos; 401/403 y exceso inválido sin cambios');

  const [origin] = await query('SELECT uuid FROM factura WHERE id_factura=$1',[credited.idFactura]);
  const noteBody = (quantity,total,method) => {
    const body=saleBody(quantity,5); Object.assign(body,{tipoComprobante:'E',serie:'NC',idFacturaOrigen:credited.idFactura,
      metodoReembolso:method,subtotal:total,total,cfdisRelacionados:[{tipoRelacion:'01',uuidRelacionado:origin.uuid||randomUUID()}]});
    body.conceptos[0].importe=total; return body;
  };
  const cashNote=await post('venta',noteBody(1,5,'Efectivo'));
  const creditState=await state();
  await post('venta',noteBody(0.4,2,'Saldo a Favor'));
  assert.equal(Math.round((Number((await state()).credit)-Number(creditState.credit))*100),200);
  const measured=await metric();
  assert.equal(measured.cobrosRegistrados,'20.00'); assert.equal(measured.cash.reembolsosEfectivo,'15.00');
  assert.equal(measured.cash.cobrosNetosRegistrados,'5.00'); assert.equal(measured.cash.saldoAFavorGenerado,'2.00');
  assert.equal(measured.cash.documentosConCobroNeto,2);
  const beforeReport=await fingerprint(); assert.deepEqual(await metric(),measured); assert.equal(await fingerprint(),beforeReport);
  checked('WEB05.2e real: dos ventas/REP y notas API, reembolso15/cobro20/neto5/saldo a favor2; consulta privada no altera caja, inventario, documentos ni libro');

  const [linkedExpense]=await query('SELECT id_gasto_reembolso id FROM factura WHERE id_factura=$1',[cashNote.idFactura]);
  assert.ok(linkedExpense.id);
  await post('venta/'+cashNote.idFactura+'/cancelar',{motivo:'02'});
  const [cancelled]=await query('SELECT anulado FROM gasto WHERE id_gasto=$1',[linkedExpense.id]); assert.equal(cancelled.anulado,true);
  const afterCancellation=await metric(); assert.equal(afterCancellation.cash.reembolsosEfectivo,'10.00');
  assert.equal(afterCancellation.cash.cobrosNetosRegistrados,'10.00'); assert.equal(afterCancellation.cash.saldoAFavorGenerado,'2.00');
  const afterCancelState=await state();
  assert.equal(Math.round((Number(afterCancelState.cash)-Number(creditState.cash))*100),500);
  assert.equal(Number(afterCancelState.stock),Number(afterCancelState.location_stock),'Cancelación mantiene existencias por ubicación');
  assert.equal(afterCancelState.movements-creditState.movements,2,'Una nota de saldo a favor y una cancelación sin ajustes manuales adicionales');
  checked('Cancelación de nota API/fiscal mock anula su gasto, devuelve caja y recompone cobro neto conservando evidencia y saldo a favor');
  return {passed:true,source:'isolated-restored-test-database',migration:'093',realBusinessApi:true,apiMocks:false,
    explicitFixtureLineage:true,returns,measured,afterCancellation,cohort:{desde:'2026-09-01',hasta:'2026-09-01'}};
}
module.exports={verifyRefundAcceptance};
