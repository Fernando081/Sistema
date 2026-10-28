// backend/verify-direct-purchase.js · H02-b: ejecuta CompraService.create contra la base configurada dentro de una transacción que se REVIERTE.
// Comprueba orden/recepción/factura/pago, inventario, kárdex, pólizas, saldos e idempotencia. No deja datos.
const req = require('module').createRequire(require('node:path').join(__dirname, 'package.json'));
req('reflect-metadata');
const { DataSource } = req('typeorm');
const { databaseConfig } = require('./db-config');
const { CompraService } = require('./dist/compra/compra.service.js');
const { AbastecimientoService } = require('./dist/abastecimiento/abastecimiento.service.js');
const { FacturasProveedorService } = require('./dist/cuentas-proveedor/facturas-proveedor.service.js');
const { PagosProveedorService } = require('./dist/cuentas-proveedor/pagos-proveedor.service.js');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };

(async () => {
  const cfg = databaseConfig();
  const ds = new DataSource({ type: 'postgres', ...(cfg.connectionString ? { url: cfg.connectionString } : { host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, database: cfg.database }), ssl: cfg.ssl });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  const m = qr.manager;
  // Todos los servicios trabajan sobre la misma transacción; transaction() no confirma.
  const fakeDs = { transaction: (work) => work(m) };
  const abas = new AbastecimientoService(fakeDs);
  const facturas = new FacturasProveedorService(fakeDs);
  const pagos = new PagosProveedorService(fakeDs);
  const compra = new CompraService(fakeDs, abas, facturas, pagos);
  try {
    const [prov] = await m.query(`SELECT "IdProveedor" AS id FROM proveedor ORDER BY "IdProveedor" LIMIT 1`);
    const prods = await m.query(`SELECT "IdProducto" AS id, "Descripcion" AS d, "Existencia" AS e FROM producto ORDER BY "IdProducto" LIMIT 2`);
    const admin = (await m.query(`SELECT id_user AS id FROM auth_user WHERE role='admin' ORDER BY id_user LIMIT 1`))[0]?.id;
    const saldos0 = (await m.query(`SELECT caja_chica, cuenta_banco FROM saldos LIMIT 1`))[0];
    const legacyBefore = (await m.query(`SELECT count(*)::int n, coalesce(sum(saldo_pendiente),0) s FROM compra`))[0];
    const conceptos = prods.map((p, i) => ({ idProducto: p.id, codigo: '', descripcion: p.d, cantidad: i + 2, costoUnitario: 125.5 + i, importe: Math.round((i + 2) * (125.5 + i) * 100) / 100 }));
    const total = Math.round(conceptos.reduce((s, c) => s + c.importe, 0) * 100) / 100;

    // --- Contado (efectivo) con requestId para probar idempotencia
    const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-' + Date.now().toString(16).padStart(12, '0').slice(-12);
    const dto = { requestId, idProveedor: prov.id, folioFactura: 'H02B-PRUEBA-' + Date.now(), esCredito: false, formaPago: 'Efectivo', observaciones: 'Prueba revertida H02-b', total, conceptos };
    const r1 = await compra.create(dto, admin);
    const orden = (await m.query(`SELECT estado, origen, total FROM orden_compra WHERE id_orden=$1`, [r1.idOrden]))[0];
    check('orden creada como Compra directa y Recibida', orden.origen === 'Compra directa' && orden.estado === 'Recibida', JSON.stringify(orden));
    check('total de la orden = total capturado', Number(orden.total) === total, `${orden.total} vs ${total}`);
    const stock = await m.query(`SELECT "IdProducto" AS id, "Existencia" AS e FROM producto WHERE "IdProducto" = ANY($1::int[]) ORDER BY "IdProducto"`, [prods.map((p) => p.id)]);
    check('inventario aumentó lo comprado', stock.every((s, i) => Math.abs(Number(s.e) - Number(prods[i].e) - (i + 2)) < 1e-6), JSON.stringify(stock));
    const kardex = await m.query(`SELECT count(*)::int n FROM kardex WHERE id_referencia=$1 AND referencia=$2`, [r1.idRecepcion, `Recepción OC-${r1.idOrden}`]);
    check('kárdex con un movimiento por partida', kardex[0].n === conceptos.length, JSON.stringify(kardex[0]));
    const fac = (await m.query(`SELECT estado, saldo_pendiente, total, folio, fecha_emision::text fe, fecha_vencimiento::text fv FROM factura_proveedor WHERE id_factura_proveedor=$1`, [r1.idFacturaProveedor]))[0];
    check('factura de contado Pagada con saldo 0', fac.estado === 'Pagada' && Number(fac.saldo_pendiente) === 0, JSON.stringify(fac));
    check('folio de factura = folio capturado', fac.folio === dto.folioFactura, fac.folio);
    const polizas = await m.query(`SELECT p.origen_tipo, d.debe, d.haber, c.codigo FROM poliza_contable p JOIN poliza_contable_detalle d ON d.id_poliza=p.id_poliza JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE (p.origen_tipo='FacturaProveedor' AND p.origen_id=$1) OR (p.origen_tipo='PagoFacturaProveedor' AND p.origen_id=$2) ORDER BY p.origen_tipo, c.codigo`, [r1.idFacturaProveedor, r1.idPago]);
    const sum = (tipo, codigo, col) => polizas.filter((x) => x.origen_tipo === tipo && x.codigo === codigo).reduce((s, x) => s + Number(x[col] || 0), 0);
    check('póliza de factura: inventario 1130 contra proveedores 2100', sum('FacturaProveedor', '1130', 'debe') === total && sum('FacturaProveedor', '2100', 'haber') === total, JSON.stringify(polizas));
    check('póliza de pago en efectivo: 2100 contra caja 1100', sum('PagoFacturaProveedor', '2100', 'debe') === total && sum('PagoFacturaProveedor', '1100', 'haber') === total);
    const saldos1 = (await m.query(`SELECT caja_chica, cuenta_banco FROM saldos LIMIT 1`))[0];
    check('caja chica bajó por el total, banco igual', Math.abs(Number(saldos0.caja_chica) - Number(saldos1.caja_chica) - total) < 0.005 && Number(saldos0.cuenta_banco) === Number(saldos1.cuenta_banco), `${saldos0.caja_chica}→${saldos1.caja_chica}`);
    const legacyAfter = (await m.query(`SELECT count(*)::int n, coalesce(sum(saldo_pendiente),0) s FROM compra`))[0];
    check('no se creó compra ni saldo en el modelo anterior', legacyAfter.n === legacyBefore.n && Number(legacyAfter.s) === Number(legacyBefore.s), JSON.stringify(legacyAfter));
    const r1b = await compra.create(dto, admin);
    check('reintento idéntico devuelve la misma respuesta sin duplicar', r1b.idOrden === r1.idOrden && r1b.idFacturaProveedor === r1.idFacturaProveedor);
    let conflict = '';
    try { await compra.create({ ...dto, observaciones: 'cambiado' }, admin); } catch (e) { conflict = e.message; }
    check('reintento con datos distintos se rechaza', conflict.includes('datos diferentes'), conflict);

    // --- Crédito sin folio: factura aprobada por pagar a 30 días, folio OC-<folio>
    const r2 = await compra.create({ idProveedor: prov.id, folioFactura: '', esCredito: true, observaciones: '', total: conceptos[0].importe, conceptos: [conceptos[0]] }, admin);
    const fac2 = (await m.query(`SELECT estado, saldo_pendiente, folio, (fecha_vencimiento - fecha_emision) dias FROM factura_proveedor WHERE id_factura_proveedor=$1`, [r2.idFacturaProveedor]))[0];
    check('crédito: factura Aprobada con saldo completo', fac2.estado === 'Aprobada' && Number(fac2.saldo_pendiente) === conceptos[0].importe, JSON.stringify(fac2));
    check('crédito: folio automático OC-<folio de orden>', fac2.folio === `OC-${r2.folioOrden}`, fac2.folio);
    check('crédito: vence a 30 días', Number(fac2.dias) === 30, String(fac2.dias));
    const prog = await m.query(`SELECT count(*)::int n FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1 AND estado='Pendiente'`, [r2.idFacturaProveedor]);
    check('crédito: programación de pago pendiente creada', prog[0].n === 1);

    // --- Historial: ambas compras aparecen con fuente orden y su detalle se lee
    const { compraPage, CompraQueryDto } = require('./dist/compra/compra-query.js');
    const page = await compraPage({ query: (s, p) => m.query(s, p) }, Object.assign(new CompraQueryDto(), { limit: 50 }));
    const mine = page.data.filter((x) => x.fuente === 'orden' && [r1.idOrden, r2.idOrden].includes(Number(x.id_compra)));
    check('historial muestra las dos compras directas', mine.length === 2, JSON.stringify(mine.map((x) => [x.id_compra, x.estatus, x.folio_factura])));
    check('historial: contado Pagada y crédito Pendiente', mine.find((x) => Number(x.id_compra) === r1.idOrden)?.estatus === 'Pagada' && mine.find((x) => Number(x.id_compra) === r2.idOrden)?.estatus === 'Pendiente');
    const detalle = await new CompraService({ query: (s, p) => m.query(s, p) }, abas, facturas, pagos).findDetalle(r1.idOrden, 'orden');
    check('detalle de compra directa por fuente orden', detalle.length === conceptos.length && Number(detalle[0].importe) === conceptos[0].importe, JSON.stringify(detalle));
  } catch (error) {
    check('ejecución sin errores', false, error.stack || String(error));
  } finally {
    await qr.rollbackTransaction();
    await qr.release();
    const left = await ds.query(`SELECT count(*)::int n FROM factura_proveedor WHERE folio LIKE 'H02B-PRUEBA-%'`);
    check('transacción revertida: no quedaron datos de prueba', left[0].n === 0);
    await ds.destroy();
  }
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : ' :: ' + r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones aprobadas`);
  process.exit(failed ? 1 : 0);
})();
