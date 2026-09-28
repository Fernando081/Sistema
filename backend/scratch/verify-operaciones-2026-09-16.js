/* Ejecutar exclusivamente sobre una copia desechable restaurada y migrada.
 * No envuelve todo en ROLLBACK: prueba transacciones reales de los servicios.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('../db-config');
const { VentaService } = require('../dist/venta/venta.service');
const { CompraService } = require('../dist/compra/compra.service');
const { PagoService } = require('../dist/pago/pago.service');
const { CotizacionService } = require('../dist/cotizacion/cotizacion.service');
const { PedidoService } = require('../dist/pedido/pedido.service');
const { AbastecimientoService } = require('../dist/abastecimiento/abastecimiento.service');
const { GarantiaService } = require('../dist/garantia/garantia.service');
const { FiscalService } = require('../dist/fiscal/fiscal.service');
const { FiscalXmlBuilder } = require('../dist/fiscal/fiscal-xml.builder');
const { MockFiscalProvider } = require('../dist/fiscal/providers/mock-fiscal.provider');
const { CuentasProveedorService } = require('../dist/cuentas-proveedor/cuentas-proveedor.service');
const { FinanzasService } = require('../dist/finanzas/finanzas.service');

async function verifyOperations(ds) {
  if (process.env.TEST_DATABASE_ISOLATED !== 'true') throw new Error('Se requiere TEST_DATABASE_ISOLATED=true; nunca ejecutar sobre la base de trabajo');
  const [client] = await ds.query('SELECT "IdCliente" AS id,"RFC" AS rfc,"RazonSocial" AS nombre,"CodigoPostal" AS cp FROM cliente ORDER BY "IdCliente" LIMIT 1');
  const [supplier] = await ds.query('SELECT "IdProveedor" AS id FROM proveedor ORDER BY "IdProveedor" LIMIT 1');
  const [user] = await ds.query('SELECT id_user AS id FROM auth_user ORDER BY id_user LIMIT 1');
  const [pue] = await ds.query('SELECT "IdMetodoDePago" AS id FROM metododepago WHERE "Clave"=$1', ['PUE']);
  const [ppd] = await ds.query('SELECT "IdMetodoDePago" AS id FROM metododepago WHERE "Clave"=$1', ['PPD']);
  const [form] = await ds.query('SELECT "IdFormaPago" AS id FROM formadepago WHERE "Clave"=$1', ['01']);
  const [tax] = await ds.query('SELECT "IdObjetoImpuesto" AS id FROM objetoimpuesto WHERE "Clave"=$1', ['01']);
  assert(client && supplier && user && pue && ppd && form && tax, 'La copia necesita catálogos y un cliente/proveedor/usuario');
  const [product] = await ds.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR")
    VALUES($1,'Fixture aislado integridad',$2,10,100,'01',0,false) RETURNING "IdProducto" AS id`, ['TEST-'+randomUUID().slice(0,12), tax.id]);
  const venta = new VentaService(ds, {});
  const compra = new CompraService(ds);
  const pago = new PagoService(ds);
  const quote = new CotizacionService(ds);
  const stock = async () => Number((await ds.query('SELECT "Existencia" AS n FROM producto WHERE "IdProducto"=$1',[product.id]))[0].n);
  const cash = async () => Number((await ds.query('SELECT caja_chica AS n FROM saldos ORDER BY id_saldo LIMIT 1'))[0].n);
  const cents = (n) => Math.round(n*100);
  const sale = (qty, price, credit = false) => ({ requestId: randomUUID(), idCliente: client.id,
    rfcReceptor: client.rfc, nombreReceptor: client.nombre, cpReceptor: client.cp,
    regimenReceptor: '616', usoCfdi: 'G03', idFormaPago: form.id, idMetodoPago: credit ? ppd.id : pue.id,
    moneda: 'MXN', tipoCambio: 1, subtotal: Math.round(qty*price*100)/100,
    totalImpuestosTrasladados: 0, totalImpuestosRetenidos: 0, total: Math.round(qty*price*100)/100,
    tipoComprobante: 'I', serie: 'A', conceptos: [{ idProducto: product.id, cantidad: qty, valorUnitario: price,
      importe: Math.round(qty*price*100)/100, descuento: 0, claveProdServ: '31171500', claveUnidad: 'H87',
      objetoImpuesto: '01', codigo: 'TEST', descripcion: 'Fixture aislado', unidadDescripcion: 'Pieza',
      baseIva: 0, tasaIva: 0, importeIva: 0, baseRetIsr: 0, tasaRetIsr: 0, importeRetIsr: 0 }],
  });
  const beforePurchase = await cash();
  const purchase = { requestId: randomUUID(), idProveedor: supplier.id, folioFactura: 'TEST-'+randomUUID().slice(0,8),
    esCredito: false, formaPago: 'Efectivo', total: 10, observaciones: 'Fixture aislado',
    conceptos: [{ idProducto: product.id, descripcion: 'Fixture aislado', cantidad: 5, costoUnitario: 2, importe: 10 }] };
  const purchases = await Promise.all([compra.create(purchase), compra.create(purchase)]);
  assert.equal(purchases[0].idCompra,purchases[1].idCompra);
  assert.equal(await stock(),105);
  assert.equal(cents(await cash()),cents(beforePurchase)-1000);

  const thirdSale = sale(3,3.333333);
  const sales = await Promise.all([venta.create(thirdSale,user.id),venta.create(thirdSale,user.id)]);
  assert.equal(sales[0].idFactura,sales[1].idFactura);
  assert.equal(await stock(),102);
  await assert.rejects(() => venta.create({ ...thirdSale,total: 50 },user.id), /reintento/);
  for(let i=0;i<3;i++) await venta.procesarDevolucion(sales[0].idFactura,{ metodoReembolso:'Efectivo',articulos:[{idProducto:product.id,cantidad:1}]},user.id);
  const refunds=await ds.query('SELECT monto_total FROM devolucion WHERE id_factura=$1 ORDER BY id_devolucion',[sales[0].idFactura]);
  assert.deepEqual(refunds.map(r=>cents(Number(r.monto_total))),[333,334,333]);
  assert.equal(await stock(),105);
  await assert.rejects(()=>venta.procesarDevolucion(sales[0].idFactura,{metodoReembolso:'Efectivo',articulos:[{idProducto:product.id,cantidad:1}]},user.id),/excede/);
  const [margin]=await ds.query('SELECT * FROM fn_get_margen_productos() WHERE id_producto=$1',[product.id]);
  assert.equal(Number(margin.cantidad_vendida),0);
  assert.equal(Number(margin.ingresos_totales),0);
  assert.equal(Number(margin.costo_total),0);

  const original=await venta.create(sale(2,10),user.id);
  const cashBeforeNote=await cash();
  const noteDto={...sale(1,10),tipoComprobante:'E',serie:'NC',idFacturaOrigen:original.idFactura,metodoReembolso:'Efectivo',
    cfdisRelacionados:[{tipoRelacion:'01',uuidRelacionado:'00000000-0000-0000-0000-000000000000'}]};
  const note=await venta.create(noteDto,user.id);
  assert.equal(cents(await cash()),cents(cashBeforeNote)-1000);
  assert.equal(Number((await ds.query('SELECT count(*) AS n FROM pago WHERE id_factura=$1',[note.idFactura]))[0].n),0);
  await assert.rejects(()=>venta.cancelarFactura(original.idFactura,user.id),/notas de crédito/);
  await venta.cancelarFactura(note.idFactura,user.id);
  assert.equal(cents(await cash()),cents(cashBeforeNote));
  await venta.cancelarFactura(original.idFactura,user.id);
  assert.equal(await stock(),105);

  const unpaid=await venta.create(sale(2,10,true),user.id);
  await assert.rejects(()=>venta.procesarDevolucion(unpaid.idFactura,{metodoReembolso:'Efectivo',articulos:[{idProducto:product.id,cantidad:1}]},user.id),/Liquida/);
  const rep=await pago.registrarRepComplejo({idCliente:client.id,fechaPago:new Date().toISOString(),formaPago:'Efectivo',moneda:'MXN',montoTotal:20,facturas:[{idFactura:unpaid.idFactura,montoSaldado:20}]});
  await assert.rejects(()=>venta.cancelarFactura(unpaid.idFactura,user.id),/REP/);
  await ds.query(`INSERT INTO pago(id_factura,monto,forma_pago,referencia,notas) VALUES($1,1,'Efectivo',$2,'Referencia manual homónima')`,[unpaid.idFactura,'REP-'+rep.idRep]);
  await pago.cancelarRep(rep.idRep);
  assert.equal(Number((await ds.query('SELECT count(*) AS n FROM pago WHERE id_factura=$1',[unpaid.idFactura]))[0].n),1);
  const [pending]=await ds.query('SELECT saldo_pendiente,estatus FROM factura WHERE id_factura=$1',[unpaid.idFactura]);
  assert.equal(Number(pending.saldo_pendiente),20);
  assert.equal(pending.estatus,'Pendiente');
  await assert.rejects(()=>pago.registrarPago({idFactura:unpaid.idFactura,monto:20.01,formaPago:'Efectivo'}),/supera/);

  // Ciclo fiscal mock: el timbrado persiste XML/UUID y la cancelación fiscal
  // ocurre antes del reverso operativo. No se realiza ninguna llamada externa.
  const fiscalConfig = { get: key => ({
    FISCAL_MODE: 'mock', FISCAL_ISSUER_RFC: 'EKU9003173C9',
    FISCAL_ISSUER_NAME: 'EMISOR DE PRUEBA', FISCAL_ISSUER_TAX_REGIME: '601',
    FISCAL_ISSUER_POSTAL_CODE: '26015',
  })[key] };
  const fiscalBuilder = new FiscalXmlBuilder(ds, fiscalConfig);
  const fiscal = new FiscalService(ds, fiscalConfig, fiscalBuilder, new MockFiscalProvider());
  const ventaFiscal = new VentaService(ds, {}, fiscal);
  const pagoFiscal = new PagoService(ds, fiscal);
  const fiscalInvoice = await venta.create(sale(1,10),user.id);
  const stampedInvoice = await fiscal.stamp('FACTURA',fiscalInvoice.idFactura,user.id);
  assert.equal(stampedInvoice.estado,'Timbrado');
  assert.match(stampedInvoice.uuid,/^[0-9a-f-]{36}$/i);
  assert.match(await fiscal.xml('FACTURA',fiscalInvoice.idFactura),/SIN VALIDEZ FISCAL/);
  const cancelledInvoice = await ventaFiscal.cancelarFactura(fiscalInvoice.idFactura,user.id,{motivo:'03'});
  assert.equal(cancelledInvoice.cancelled,true);
  assert.equal((await fiscal.getDocument('FACTURA',fiscalInvoice.idFactura)).estado,'Cancelado');
  assert.equal((await ds.query('SELECT estatus FROM factura WHERE id_factura=$1',[fiscalInvoice.idFactura]))[0].estatus,'Cancelada');

  const fiscalCreditInvoice = await venta.create(sale(1,10,true),user.id);
  await fiscal.stamp('FACTURA',fiscalCreditInvoice.idFactura,user.id);
  const fiscalRep = await pago.registrarRepComplejo({idCliente:client.id,fechaPago:new Date().toISOString(),
    formaPago:'Efectivo',moneda:'MXN',montoTotal:10,facturas:[{idFactura:fiscalCreditInvoice.idFactura,montoSaldado:10}]});
  const stampedRep = await fiscal.stamp('REP',fiscalRep.idRep,user.id);
  assert.equal(stampedRep.estado,'Timbrado');
  const cancelledRep = await pagoFiscal.cancelarRep(fiscalRep.idRep,{motivo:'03'},user.id);
  assert.equal(cancelledRep.cancelled,true);
  assert.equal((await fiscal.getDocument('REP',fiscalRep.idRep)).estado,'Cancelado');
  assert.equal(Number((await ds.query('SELECT saldo_pendiente FROM factura WHERE id_factura=$1',[fiscalCreditInvoice.idFactura]))[0].saldo_pendiente),10);

  const source=sale(1,10);
  const cot=await quote.create({idCliente:client.id,nombreReceptor:client.nombre,rfcReceptor:client.rfc,
    subtotal:10,totalImpuestos:0,totalRetenciones:0,total:10,conceptos:[source.conceptos[0],{...source.conceptos[0]}]}
    // two lines must have matching total: retain only one for this conversion fixture
    .constructor === Object ? {idCliente:client.id,nombreReceptor:client.nombre,rfcReceptor:client.rfc,
      subtotal:10,totalImpuestos:0,totalRetenciones:0,total:10,conceptos:[source.conceptos[0]]} : null);
  const detail=await quote.findOne(cot.id);
  const decision={idFormaPago:form.id,idMetodoPago:pue.id,articulosAceptados:[{idConcepto:detail.conceptos[0].id_concepto,precioCierre:10}],articulosRechazados:[]};
  await quote.convertirParcial(cot.id,decision,form.id,pue.id,user.id);
  await assert.rejects(()=>quote.convertirParcial(cot.id,decision,form.id,pue.id,user.id),/cerrada|convertida|pendientes/);

  // Ciclo comercial completo con unidad VIN/ESN: pedido, apartado, surtido, entrega, factura y garantía.
  const pedidos = new PedidoService(ds);
  const garantias = new GarantiaService(ds);
  const unitCode = String(parseInt(randomUUID().replace(/-/g,'').slice(0,8),16)%1000000).padStart(6,'0');
  const [unit] = await ds.query(`INSERT INTO crm_unidad_cliente(id_cliente,vin,esn,numero_economico,marca,modelo,motor)
    VALUES($1,$2,$3,$4,'Kenworth','T680','Cummins ISX') RETURNING id_unidad AS id`,
  [client.id,`1M8GDM9AXKP${unitCode}`,`ISX${unitCode}`,`E2E-${unitCode.slice(0,5)}`]);
  const order = await pedidos.create({requestId:randomUUID(),idCliente:client.id,idUnidad:unit.id,notas:'Flujo aislado E2E',
    partidas:[{idProducto:product.id,cantidad:2,valorUnitario:10}]},user.id);
  const confirmed = await pedidos.confirm(order.idPedido,user.id);
  assert.equal(confirmed.estado,'Confirmado');
  const orderLine = confirmed.partidas[0];
  const fulfilled = await pedidos.fulfill(order.idPedido,{partidas:[{idDetalle:orderLine.idDetalle,cantidad:2}]},user.id);
  assert.equal(fulfilled.estado,'Surtido');
  const delivered = await pedidos.deliver(order.idPedido,{recibidoPor:'Cliente de prueba aislada'},user.id);
  assert.equal(delivered.estado,'Entregado');
  const invoiceDto = await pedidos.prepareInvoice(order.idPedido,{requestId:randomUUID(),idFormaPago:form.id,idMetodoPago:pue.id});
  const orderInvoice = await venta.create(invoiceDto,user.id);
  const [invoicedOrder] = await ds.query('SELECT estado FROM pedido_venta WHERE id_pedido=$1',[order.idPedido]);
  assert.equal(invoicedOrder.estado,'Facturado');
  const [invoiceUnit] = await ds.query('SELECT id_unidad FROM factura WHERE id_factura=$1',[orderInvoice.idFactura]);
  assert.equal(Number(invoiceUnit.id_unidad),Number(unit.id));
  const [invoiceLine] = await ds.query('SELECT id_concepto FROM conceptofactura WHERE id_factura=$1 AND id_producto=$2',[orderInvoice.idFactura,product.id]);
  const warranty = await garantias.create({idFactura:orderInvoice.idFactura,idConcepto:invoiceLine.id_concepto,cantidad:1,
    motivo:'Validación de garantía ligada a VIN/ESN',destinoProducto:'Revision'},user.id);
  assert(warranty.idGarantia,'Debe abrir una garantía vinculada a la venta y su unidad');

  // Ciclo de faltante real: backorder, solicitud autorizada, orden de compra, recepción y apartado automático.
  const [shortProduct] = await ds.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR")
    VALUES($1,'Fixture backorder aislado',$2,25,0,'01',0,false) RETURNING "IdProducto" AS id`, ['BO-'+randomUUID().slice(0,10),tax.id]);
  const pendingOrder = await pedidos.create({requestId:randomUUID(),idCliente:client.id,notas:'Backorder aislado',
    partidas:[{idProducto:shortProduct.id,cantidad:4,valorUnitario:25}]},user.id);
  const waiting = await pedidos.confirm(pendingOrder.idPedido,user.id);
  assert.equal(waiting.estado,'En espera');
  const abastecimiento = new AbastecimientoService(ds);
  const requestResult = await abastecimiento.createRequest({requestId:randomUUID(),motivo:'Cubrir backorder aislado',
    partidas:[{idProducto:shortProduct.id,cantidad:4,costoEstimado:12,origen:'Backorder'}]},user.id);
  await abastecimiento.authorizeRequest(requestResult.idSolicitud,user.id);
  const purchaseOrder = await abastecimiento.createOrder({requestId:randomUUID(),idSolicitud:requestResult.idSolicitud,idProveedor:supplier.id,
    notas:'Recepción para backorder',partidas:[{idProducto:shortProduct.id,cantidad:4,costoUnitario:12,tasaIva:0.16}]},user.id);
  const [purchaseLine] = await ds.query('SELECT id_detalle FROM orden_compra_detalle WHERE id_orden=$1',[purchaseOrder.idOrden]);
  const receipt = await abastecimiento.receive(purchaseOrder.idOrden,{requestId:randomUUID(),referencia:'E2E-RECEPCION',
    partidas:[{idDetalle:purchaseLine.id_detalle,cantidad:4}]},user.id);
  assert.equal(receipt.estadoOrden,'Recibida');
  const [covered] = await ds.query('SELECT estado,cantidad_asignada FROM backorder_cliente WHERE id_pedido=$1',[pendingOrder.idPedido]);
  assert.equal(covered.estado,'Cubierto');
  assert.equal(Number(covered.cantidad_asignada),4);
  const [reservedLine] = await ds.query('SELECT cantidad_reservada FROM pedido_venta_detalle WHERE id_pedido=$1',[pendingOrder.idPedido]);
  assert.equal(Number(reservedLine.cantidad_reservada),4);

  // Conciliación de tres vías: la factura no vuelve a mover inventario, se
  // aprueba después de conciliar y se liquida con anticipo, nota y pago.
  const supplierAccounts = new CuentasProveedorService(ds);
  const today = new Date().toISOString().slice(0,10);
  const due = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const stockBeforeSupplierInvoice = await stock();
  const supplierInvoice = await supplierAccounts.createInvoice({requestId:randomUUID(),idProveedor:supplier.id,idOrden:purchaseOrder.idOrden,
    serie:'E2E',folio:'FP-'+randomUUID().slice(0,8),fechaEmision:today,fechaVencimiento:due,moneda:'MXN',tipoCambio:1,
    subtotal:48,impuestos:7.68,retenciones:0,total:55.68,partidas:[{idOrdenDetalle:purchaseLine.id_detalle,
      descripcion:'Fixture backorder aislado',cantidad:4,costoUnitario:12,tasaIva:.16}]},user.id);
  assert.equal(supplierInvoice.estado,'Conciliada');
  assert.equal(await stock(),stockBeforeSupplierInvoice,'La factura de proveedor no debe duplicar la entrada de inventario');
  await supplierAccounts.uploadPdf(supplierInvoice.idFacturaProveedor,{mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture\n%%EOF')} );
  assert(Buffer.isBuffer(await supplierAccounts.document(supplierInvoice.idFacturaProveedor,'pdf')));
  await supplierAccounts.approveInvoice(supplierInvoice.idFacturaProveedor,user.id);
  await supplierAccounts.createAdvance({requestId:randomUUID(),idProveedor:supplier.id,idFacturaProveedor:supplierInvoice.idFacturaProveedor,
    fecha:today,monto:10,montoAplicar:10,formaPago:'Transferencia',referencia:'E2E-ANT'},user.id);
  await supplierAccounts.createCredit({requestId:randomUUID(),idProveedor:supplier.id,idFacturaProveedor:supplierInvoice.idFacturaProveedor,
    folio:'NC-'+randomUUID().slice(0,8),fecha:today,total:5,montoAplicar:5},user.id);
  await supplierAccounts.pay(supplierInvoice.idFacturaProveedor,{requestId:randomUUID(),fecha:today,monto:40.68,
    formaPago:'Transferencia',referencia:'E2E-PAGO'},user.id);
  const [settledSupplierInvoice] = await ds.query('SELECT estado,saldo_pendiente FROM factura_proveedor WHERE id_factura_proveedor=$1',[supplierInvoice.idFacturaProveedor]);
  assert.equal(settledSupplierInvoice.estado,'Pagada');
  assert.equal(Number(settledSupplierInvoice.saldo_pendiente),0);
  const [openSupplierSchedules] = await ds.query(`SELECT count(*)::int AS total FROM factura_proveedor_programacion
    WHERE id_factura_proveedor=$1 AND estado='Pendiente'`,[supplierInvoice.idFacturaProveedor]);
  assert.equal(openSupplierSchedules.total,0,'Una factura liquidada no debe conservar pagos programados pendientes');

  // Estado de cuenta: importa por lote, evita reimportaciones, concilia sólo
  // una coincidencia exacta y permite corregir o ignorar la revisión.
  const treasury=new FinanzasService(ds,{},{});
  const bankAccount=await treasury.crearCuentaTesoreria({nombre:'Cuenta aislada',banco:'Banco prueba',moneda:'MXN',ultimosCuatro:'9876',saldoInicial:0});
  await ds.query('UPDATE saldos SET cuenta_banco=cuenta_banco+$1::numeric,updated_at=clock_timestamp()',[91357.24]);
  const csv=Buffer.from(`Fecha,Descripcion,Referencia,Monto\n${today},Depósito aislado,RASTREO-E2E,91357.24\n${today},Comisión informativa,COM-E2E,-19.50\nfecha-mal,Renglón inválido,ERR,20`);
  const bankImport=await treasury.importarEstadoCuenta({idCuenta:bankAccount.idCuenta,requestId:randomUUID(),autoConciliar:true},
    {mimetype:'text/csv',originalname:'estado-e2e.csv',buffer:csv},user.id);
  assert.equal(bankImport.insertados,2);assert.equal(bankImport.conciliadosAuto,1);assert.equal(bankImport.errores.length,1);
  const repeatedBankImport=await treasury.importarEstadoCuenta({idCuenta:bankAccount.idCuenta,requestId:randomUUID(),autoConciliar:true},
    {mimetype:'text/csv',originalname:'estado-e2e.csv',buffer:csv},user.id);
  assert.equal(repeatedBankImport.repeated,true,'Reimportar el mismo archivo no debe duplicar movimientos');
  const bankMovements=await treasury.getMovimientosTesoreria(bankAccount.idCuenta);
  const reconciled=bankMovements.find(row=>row.estado==='Conciliado');const pendingBank=bankMovements.find(row=>row.estado==='Pendiente');
  assert(reconciled&&pendingBank);await treasury.desconciliarMovimiento(Number(reconciled.idMovimiento),'Prueba de reversión');
  const candidates=await treasury.getCandidatosConciliacion(Number(reconciled.idMovimiento));
  const exactCandidates=candidates.filter(row=>Number(row.diferencia)===0);assert.equal(exactCandidates.length,1);
  await treasury.conciliarMovimiento(Number(reconciled.idMovimiento),{idCajaMovimiento:Number(exactCandidates[0].idCajaMovimiento)},user.id);

  // La comisión se concilia contra un egreso del sistema y genera el ajuste
  // restante con movimiento y póliza contable auditables.
  await ds.query("SELECT set_config('app.movement_origin','Egreso parcial comisión E2E',false)");
  await ds.query('UPDATE saldos SET cuenta_banco=cuenta_banco-15,updated_at=clock_timestamp()');
  const [partialSystem]=await ds.query("SELECT id_movimiento AS id FROM caja_movimiento WHERE origen='Egreso parcial comisión E2E' ORDER BY id_movimiento DESC LIMIT 1");
  const adjusted=await treasury.crearConciliacion({requestId:randomUUID(),movimientosBanco:[Number(pendingBank.idMovimiento)],
    movimientosSistema:[Number(partialSystem.id)],tipoAjuste:'Comision',motivo:'Comisión bancaria documentada E2E'},user.id);
  assert.equal(Number(adjusted.ajuste),-4.5);
  const [adjustmentPolicy]=await ds.query("SELECT estado FROM poliza_contable WHERE origen_tipo='AjusteBancario' AND origen_id=$1",[adjusted.idConciliacion]);
  assert.equal(adjustmentPolicy.estado,'Contabilizada');
  await treasury.desconciliarMovimiento(Number(pendingBank.idMovimiento),'Prueba de reverso agrupado',user.id);
  const [reversedGroup]=await ds.query('SELECT estado FROM tesoreria_conciliacion WHERE id_conciliacion=$1',[adjusted.idConciliacion]);
  assert.equal(reversedGroup.estado,'Revertida');
  await treasury.ignorarMovimiento(Number(pendingBank.idMovimiento),'Comisión ya validada en prueba de reverso');

  // Traspaso entre cuentas propias: dos renglones opuestos, sin crear ingreso o gasto.
  const secondAccount=await treasury.crearCuentaTesoreria({nombre:'Cuenta destino aislada',banco:'Banco prueba 2',moneda:'MXN',ultimosCuatro:'1234',saldoInicial:0});
  const transferOut=await treasury.crearMovimientoTesoreria({idCuenta:bankAccount.idCuenta,fecha:today,descripcion:'Traspaso salida',monto:-250});
  const transferIn=await treasury.crearMovimientoTesoreria({idCuenta:secondAccount.idCuenta,fecha:today,descripcion:'Traspaso entrada',monto:250});
  const transfer=await treasury.crearTransferencia({requestId:randomUUID(),idMovimientoSalida:transferOut.idMovimiento,
    idMovimientoEntrada:transferIn.idMovimiento,referencia:'TRASPASO-E2E'},user.id);
  assert(transfer.idTransferencia);

  // Cierre mensual: exige saldo exacto, no pendientes y bloquea cambios retroactivos.
  const past=new Date();past.setUTCMonth(past.getUTCMonth()-1,1);const pastYear=past.getUTCFullYear();const pastMonth=past.getUTCMonth()+1;
  const pastDate=`${pastYear}-${String(pastMonth).padStart(2,'0')}-15`;
  const closeAccount=await treasury.crearCuentaTesoreria({nombre:'Cuenta cierre aislada',banco:'Banco cierre',moneda:'MXN',saldoInicial:100});
  const closeMovement=await treasury.crearMovimientoTesoreria({idCuenta:closeAccount.idCuenta,fecha:pastDate,descripcion:'Movimiento revisado',monto:50});
  await treasury.ignorarMovimiento(closeMovement.idMovimiento,'Renglón informativo de cierre E2E');
  await treasury.cerrarTesoreria({idCuenta:closeAccount.idCuenta,anio:pastYear,mes:pastMonth,saldoEstadoCuenta:150},user.id);
  await assert.rejects(()=>treasury.crearMovimientoTesoreria({idCuenta:closeAccount.idCuenta,fecha:pastDate,descripcion:'Retroactivo',monto:1}),/cerrada/);

  console.log('Operaciones aisladas aprobadas: idempotencia, caja, devoluciones, NC/REP, fiscal mock, pedidos, backorder, abastecimiento, cuenta por pagar y tesorería local avanzada.');
}

module.exports={verifyOperations};
if(require.main===module){
  (async()=>{
    if(process.env.TEST_DATABASE_ISOLATED!=='true') throw new Error('Se requiere TEST_DATABASE_ISOLATED=true');
    const config=databaseConfig();
    const ds=new DataSource({type:'postgres',...(config.connectionString?{url:config.connectionString}:config),synchronize:false,entities:[]});
    await ds.initialize();
    try{await verifyOperations(ds);}finally{await ds.destroy();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
