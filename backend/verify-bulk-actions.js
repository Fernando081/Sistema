// backend/verify-bulk-actions.js · U02.3: acciones en lote contra la base configurada dentro de una transacción que se REVIERTE.
// Precios/categoría en lote (vista previa, aplicación, conflicto, idempotencia, kárdex) y pago agrupado a proveedor
// (reparto, saldos, pólizas con IVA 1160→1170, caja/banco, idempotencia). No deja datos.
const req = require('module').createRequire(require('node:path').join(__dirname, 'package.json'));
req('reflect-metadata');
const { randomUUID } = require('node:crypto');
const { DataSource } = req('typeorm');
const { databaseConfig } = require('./db-config');
const { ProductoLoteService } = require('./dist/producto/producto-lote.service.js');
const { CompraService } = require('./dist/compra/compra.service.js');
const { AbastecimientoService } = require('./dist/abastecimiento/abastecimiento.service.js');
const { FacturasProveedorService } = require('./dist/cuentas-proveedor/facturas-proveedor.service.js');
const { PagosProveedorService } = require('./dist/cuentas-proveedor/pagos-proveedor.service.js');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const cfg = databaseConfig();
  const ds = new DataSource({ type: 'postgres', ...(cfg.connectionString ? { url: cfg.connectionString } : { host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, database: cfg.database }), ssl: cfg.ssl });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  const m = qr.manager;
  const fakeDs = { query: (s, p) => m.query(s, p), transaction: (work) => work(m) };
  try {
    const [admin] = await m.query(`SELECT id_user AS id FROM auth_user WHERE role='admin' ORDER BY id_user LIMIT 1`);
    // --- Productos: precios en lote
    const lote = new ProductoLoteService(fakeDs);
    const prods = await m.query(`SELECT "IdProducto" AS id, "PrecioUnitario" AS precio, "IdCategoria" AS cat FROM producto ORDER BY "IdProducto" LIMIT 3`);
    const ids = prods.map((p) => p.id);
    const preview = await lote.vistaPrevia({ ids, accion: 'precio', porcentaje: 12.5, redondeo: 'pesos' });
    const after0 = await m.query(`SELECT "PrecioUnitario" AS precio FROM producto WHERE "IdProducto"=ANY($1::int[]) ORDER BY "IdProducto"`, [ids]);
    check('vista previa no modifica precios', after0.every((r, i) => near(r.precio, prods[i].precio)));
    check('vista previa calcula +12.5 % redondeado a pesos', preview.cambios.every((c, i) => c.precioNuevo === Math.max(1, Math.round(Number(prods[i].precio) * 1.125))));
    const esperados = preview.cambios.map((c) => ({ idProducto: c.idProducto, precio: c.precioActual, idCategoria: c.idCategoriaActual }));
    const requestId = randomUUID();
    const kardex0 = (await m.query(`SELECT count(*)::int n FROM kardex WHERE tipo_movimiento='CAMBIO_PRECIO' AND id_producto=ANY($1::int[])`, [ids]))[0].n;
    const applied = await lote.aplicar({ requestId, ids, accion: 'precio', porcentaje: 12.5, redondeo: 'pesos', esperados }, admin.id);
    const after1 = await m.query(`SELECT "PrecioUnitario" AS precio FROM producto WHERE "IdProducto"=ANY($1::int[]) ORDER BY "IdProducto"`, [ids]);
    check('aplicar actualiza los precios de la vista previa', after1.every((r, i) => near(r.precio, preview.cambios[i].precioNuevo)), JSON.stringify(after1));
    const kardex1 = (await m.query(`SELECT count(*)::int n FROM kardex WHERE tipo_movimiento='CAMBIO_PRECIO' AND id_producto=ANY($1::int[])`, [ids]))[0].n;
    check('kárdex registra un CAMBIO_PRECIO por producto cambiado', kardex1 - kardex0 === applied.actualizados, `${kardex0}→${kardex1}`);
    const audit = (await m.query(`SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='producto' AND action='UPDATE' AND app_user_id=$1 AND timestamp > now() - interval '1 minute'`, [admin.id]))[0].n;
    check('auditoría registra cada cambio con el usuario que aplicó el lote', audit >= applied.actualizados, `${audit} eventos, ${applied.actualizados} cambios`);
    const replay = await lote.aplicar({ requestId, ids, accion: 'precio', porcentaje: 12.5, redondeo: 'pesos', esperados }, admin.id);
    check('reintento idéntico no vuelve a aplicar', replay.actualizados === applied.actualizados && (await m.query(`SELECT count(*)::int n FROM kardex WHERE tipo_movimiento='CAMBIO_PRECIO' AND id_producto=ANY($1::int[])`, [ids]))[0].n === kardex1);
    let stale = '';
    try { await lote.aplicar({ requestId: randomUUID(), ids, accion: 'precio', porcentaje: 5, redondeo: 'centavos', esperados }, admin.id); } catch (e) { stale = e.message; }
    check('vista previa vieja (precios ya cambiados) se rechaza completa', stale.includes('desde la vista previa'), stale);
    const [cat] = await m.query(`SELECT "IdCategoria" AS id FROM categoria ORDER BY "IdCategoria" DESC LIMIT 1`);
    const prevCat = await lote.vistaPrevia({ ids, accion: 'categoria', idCategoria: cat.id });
    await lote.aplicar({ requestId: randomUUID(), ids, accion: 'categoria', idCategoria: cat.id, esperados: prevCat.cambios.map((c) => ({ idProducto: c.idProducto, precio: c.precioActual, idCategoria: c.idCategoriaActual })) }, admin.id);
    const cats = await m.query(`SELECT "IdCategoria" AS cat FROM producto WHERE "IdProducto"=ANY($1::int[])`, [ids]);
    check('categoría en lote aplicada a todos', cats.every((r) => r.cat === cat.id));

    // --- Pago agrupado: dos compras a crédito con IVA del mismo proveedor
    const abas = new AbastecimientoService(fakeDs);
    const facturas = new FacturasProveedorService(fakeDs);
    const pagos = new PagosProveedorService(fakeDs);
    const compra = new CompraService(fakeDs, abas, facturas, pagos);
    const [prov] = await m.query(`SELECT "IdProveedor" AS id FROM proveedor ORDER BY "IdProveedor" LIMIT 1`);
    const linea = (p, cant, costo) => ({ idProducto: p, codigo: '', descripcion: 'x', cantidad: cant, costoUnitario: costo, importe: Math.round(cant * costo * 100) / 100, tasaIva: 0.16 });
    const total = (l) => Math.round(l.importe * 1.16 * 100) / 100;
    const l1 = linea(ids[0], 2, 100); const l2 = linea(ids[1], 1, 250);
    const c1 = await compra.create({ idProveedor: prov.id, folioFactura: 'U023-A-' + Date.now(), esCredito: true, observaciones: '', total: total(l1), conceptos: [l1] }, admin.id);
    const c2 = await compra.create({ idProveedor: prov.id, folioFactura: 'U023-B-' + Date.now(), esCredito: true, observaciones: '', total: total(l2), conceptos: [l2] }, admin.id);
    const saldos0 = (await m.query(`SELECT caja_chica, cuenta_banco FROM saldos LIMIT 1`))[0];
    const parcial = 300;
    const batchId = randomUUID();
    const r = await pagos.payGrouped({ requestId: batchId, idsFacturas: [c2.idFacturaProveedor, c1.idFacturaProveedor], fecha: (await m.query('SELECT current_date::text d'))[0].d, monto: parcial, formaPago: 'Transferencia', referencia: 'TRF-U023' }, admin.id);
    const fac = await m.query(`SELECT id_factura_proveedor AS id, saldo_pendiente AS saldo, estado FROM factura_proveedor WHERE id_factura_proveedor=ANY($1::bigint[]) ORDER BY id_factura_proveedor`, [[c1.idFacturaProveedor, c2.idFacturaProveedor]]);
    const sumPagado = r.pagos.reduce((s, p) => s + p.monto, 0);
    check('pago agrupado parcial reparte exactamente el monto', near(sumPagado, parcial) && r.pagos.length === 2, JSON.stringify(r.pagos));
    check('la primera factura (vence igual, folio menor) queda liquidada y la otra con abono', fac[0].estado === 'Pagada' && near(fac[0].saldo, 0) && fac[1].estado === 'Parcialmente pagada' && near(fac[1].saldo, total(l1) + total(l2) - parcial), JSON.stringify(fac));
    const pol = await m.query(`SELECT c.codigo, sum(d.debe) debe, sum(d.haber) haber FROM poliza_contable p JOIN poliza_contable_detalle d ON d.id_poliza=p.id_poliza JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta
      WHERE p.origen_tipo='PagoFacturaProveedor' AND p.origen_id=ANY($1::bigint[]) GROUP BY c.codigo`, [r.pagos.map((p) => p.idPago)]);
    const by = Object.fromEntries(pol.map((x) => [x.codigo, x]));
    const ivaEsperado = r.pagos.reduce((s, p) => s + Math.round(p.monto * 0.16 / 1.16 * 100) / 100, 0);
    check('pólizas: 2100 contra bancos 1110 por el total y traspaso de IVA 1160→1170', near(by['2100']?.debe, parcial) && near(by['1110']?.haber, parcial) && near(by['1170']?.debe, ivaEsperado) && near(by['1160']?.haber, ivaEsperado), JSON.stringify(pol));
    const saldos1 = (await m.query(`SELECT caja_chica, cuenta_banco FROM saldos LIMIT 1`))[0];
    check('banco baja por el total y caja no cambia', near(Number(saldos0.cuenta_banco) - Number(saldos1.cuenta_banco), parcial) && near(saldos0.caja_chica, saldos1.caja_chica));
    const again = await pagos.payGrouped({ requestId: batchId, idsFacturas: [c2.idFacturaProveedor, c1.idFacturaProveedor], fecha: (await m.query('SELECT current_date::text d'))[0].d, monto: parcial, formaPago: 'Transferencia', referencia: 'TRF-U023' }, admin.id);
    const npagos = (await m.query(`SELECT count(*)::int n FROM factura_proveedor_pago WHERE id_factura_proveedor=ANY($1::bigint[])`, [[c1.idFacturaProveedor, c2.idFacturaProveedor]]))[0].n;
    check('reintento del mismo pago agrupado no duplica pagos', again.pagos.map((p) => p.idPago).join() === r.pagos.map((p) => p.idPago).join() && npagos === 2, String(npagos));
    const rest = await pagos.payGrouped({ requestId: randomUUID(), idsFacturas: [c1.idFacturaProveedor, c2.idFacturaProveedor].sort(), fecha: (await m.query('SELECT current_date::text d'))[0].d, formaPago: 'Transferencia' }, admin.id).catch((e) => ({ error: e.message }));
    check('una factura ya pagada impide el lote completo', rest.error && rest.error.includes('No admiten pagos'), JSON.stringify(rest));
    const last = await pagos.payGrouped({ requestId: randomUUID(), idsFacturas: [c1.idFacturaProveedor, c2.idFacturaProveedor].filter((id) => id !== fac[0].id).concat([]), fecha: (await m.query('SELECT current_date::text d'))[0].d, formaPago: 'Efectivo' }, admin.id).catch((e) => ({ error: e.message }));
    check('saldo restante liquidado en efectivo (el mínimo de 2 facturas lo exige el DTO en HTTP, no el servicio)', !last.error, JSON.stringify(last).slice(0, 200));
    const fin = await m.query(`SELECT estado, saldo_pendiente AS saldo FROM factura_proveedor WHERE id_factura_proveedor=ANY($1::bigint[])`, [[c1.idFacturaProveedor, c2.idFacturaProveedor]]);
    check('liquidar el saldo restante deja ambas facturas Pagadas', fin.every((f) => f.estado === 'Pagada' && near(f.saldo, 0)), JSON.stringify(fin));
  } catch (error) {
    check('ejecución sin errores', false, error.stack || String(error));
  } finally {
    await qr.rollbackTransaction();
    await qr.release();
    const left = await ds.query(`SELECT count(*)::int n FROM factura_proveedor WHERE folio LIKE 'U023-%'`);
    check('transacción revertida: no quedaron datos de prueba', left[0].n === 0);
    await ds.destroy();
  }
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : ' :: ' + r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones aprobadas`);
  process.exit(failed ? 1 : 0);
})();
