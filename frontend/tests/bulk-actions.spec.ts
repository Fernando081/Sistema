import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// U02.3 · Acciones en lote: descarga de facturas, precios de productos y pago agrupado a proveedor.

test('facturas: seleccionar varias y descargar PDF/XML en un ZIP', async ({ page }) => {
  await installErpApiMock(page);
  const row = (id: number, folio: number) => ({ id_factura: id, serie: 'F', folio, fecha_emision: '2026-10-20', nombre_receptor: 'Transportes del Golfo', rfc_receptor: 'TGO010101AAA', total: 1160, estatus: 'Pendiente', estado_fiscal: 'Timbrado' });
  await page.route('**/api/v1/venta?*', (route) => route.fulfill({ json: { data: [row(104, 5), row(105, 6), row(106, 7)], total: 3, page: 1, totalPages: 1 } }));
  let requested = '';
  await page.route('**/api/v1/venta/documentos-lote?*', (route) => {
    requested = new URL(route.request().url()).searchParams.get('ids') ?? '';
    return route.fulfill({ contentType: 'application/zip', body: Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18)) });
  });
  await login(page, '/facturas');
  await page.getByRole('checkbox', { name: 'Seleccionar factura F5' }).check();
  await page.getByRole('checkbox', { name: 'Seleccionar factura F7' }).check();
  const bar = page.getByRole('region', { name: 'Acciones con las facturas seleccionadas' });
  await expect(bar).toContainText('2 seleccionadas');
  const download = page.waitForEvent('download');
  await bar.getByRole('button', { name: 'Descargar PDF y XML (ZIP)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^facturas_.*\.zip$/);
  expect(requested.split(',').sort()).toEqual(['104', '106']);
  // Seleccionar toda la página y quitar la selección.
  await page.getByRole('checkbox', { name: 'Seleccionar las facturas de esta página' }).check();
  await expect(bar).toContainText('3 seleccionadas');
  await bar.getByRole('button', { name: 'Quitar selección' }).click();
  await expect(bar).toHaveCount(0);
});

test('productos: cambiar precio en lote con vista previa y aplicar', async ({ page }) => {
  await installErpApiMock(page);
  await page.route('**/api/v1/producto?*', (route) => route.fulfill({ json: { data: [
    { IdProducto: 1, Codigo: 'FILTRO-ISX', Descripcion: 'Filtro ISX', PrecioUnitario: 850, Existencia: 10 },
    { IdProducto: 2, Codigo: 'BANDA-01', Descripcion: 'Banda', PrecioUnitario: 120, Existencia: 4 },
  ], total: 2, page: 1, totalPages: 1 } }));
  const previews: unknown[] = [];
  let applied: { esperados: unknown[]; requestId: string; porcentaje: number } | null = null;
  const vista = { cambios: [
    { idProducto: 1, codigo: 'FILTRO-ISX', descripcion: 'Filtro ISX', precioActual: 850, precioNuevo: 935, idCategoriaActual: null, categoriaActual: null, idCategoriaNueva: null, categoriaNueva: null, cambia: true },
    { idProducto: 2, codigo: 'BANDA-01', descripcion: 'Banda', precioActual: 120, precioNuevo: 132, idCategoriaActual: null, categoriaActual: null, idCategoriaNueva: null, categoriaNueva: null, cambia: true },
  ], resumen: { productos: 2, conCambio: 2, totalActual: 970, totalNuevo: 1067 } };
  await page.route('**/api/v1/producto/lote/vista-previa', (route) => { previews.push(route.request().postDataJSON()); return route.fulfill({ json: vista }); });
  await page.route('**/api/v1/producto/lote/aplicar', (route) => { applied = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { message: 'Se actualizaron 2 producto(s)', actualizados: 2, sinCambio: 0 } }); });
  await login(page, '/producto');
  await page.getByRole('checkbox', { name: 'Seleccionar los productos de esta página' }).check();
  const bar = page.getByRole('region', { name: 'Acciones con los productos seleccionados' });
  await expect(bar).toContainText('2 seleccionados');
  await bar.getByRole('button', { name: 'Cambiar precio…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Aplicar a 0 productos' })).toBeDisabled();
  await dialog.getByLabel('Porcentaje').fill('10');
  await dialog.getByRole('button', { name: 'Ver vista previa' }).click();
  await expect(dialog.getByRole('status')).toContainText('2 de 2 productos cambian');
  await expect(dialog.getByRole('region', { name: 'Vista previa de cambios' })).toContainText('$935.00');
  expect(previews[0]).toEqual({ ids: [1, 2], accion: 'precio', porcentaje: 10, redondeo: 'centavos' });
  await dialog.getByRole('button', { name: 'Aplicar a 2 productos' }).click();
  await expect(dialog).toHaveCount(0);
  expect(applied!.porcentaje).toBe(10);
  expect(applied!.esperados).toEqual([{ idProducto: 1, precio: 850, idCategoria: null }, { idProducto: 2, precio: 120, idCategoria: null }]);
  expect(applied!.requestId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(bar).toHaveCount(0);
});

test('cuentas por pagar: pago agrupado de varias facturas del mismo proveedor', async ({ page }) => {
  await installErpApiMock(page);
  const factura = (id: number, idProveedor: number, folio: string, saldo: number, vence: string, estado = 'Aprobada') => ({
    idFacturaProveedor: id, idProveedor, idOrden: 40 + id, folioOrden: 1200 + id, serie: 'A', folio, fechaEmision: '2026-10-01', fechaVencimiento: vence,
    total: saldo, saldo, estado, moneda: 'MXN', proveedor: idProveedor === 7 ? 'Diesel Parts México' : 'Frenos del Norte', tieneXml: true, tienePdf: true, discrepanciasPendientes: 0 });
  await page.route('**/api/v1/cuentas-proveedor/dashboard', (route) => route.fulfill({ json: { resumen: { total: 0, vencido: 0, discrepancias: 0, porConciliar: 0 }, antiguedad: [], recibidoSinFactura: [], anticipos: [], notasCredito: [] } }));
  await page.route('**/api/v1/cuentas-proveedor/facturas', (route) => route.fulfill({ json: [
    factura(1, 7, '100', 1160, '2026-11-10'), factura(2, 7, '101', 580, '2026-11-20'), factura(3, 8, '900', 300, '2026-11-01'), factura(4, 7, '102', 50, '2026-11-01', 'Con discrepancias'),
  ] }));
  await page.route('**/api/v1/proveedores', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/pago-proveedor/deuda', (route) => route.fulfill({ json: [] }));
  let body: Record<string, unknown> | null = null;
  await page.route('**/api/v1/cuentas-proveedor/pagos-agrupados', (route) => { body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { message: 'Pago registrado en 2 facturas por 1000.00', total: 1000, referencia: 'TRF-1', pagos: [] } }); });
  await login(page, '/cuentas-por-pagar');
  // Una factura con discrepancias no se puede seleccionar.
  await expect(page.getByRole('checkbox', { name: /A-102/ })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /A-100 de Diesel/ }).check();
  await page.getByRole('checkbox', { name: /A-900 de Frenos/ }).check();
  const bar = page.getByRole('region', { name: 'Pago agrupado de facturas seleccionadas' });
  await expect(bar).toContainText('Las facturas deben ser del mismo proveedor');
  await expect(bar.getByRole('button', { name: 'Pagar juntas…' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /A-900 de Frenos/ }).uncheck();
  await page.getByRole('checkbox', { name: /A-101 de Diesel/ }).check();
  await expect(bar).toContainText('2 facturas · $1,740.00');
  await bar.getByRole('button', { name: 'Pagar juntas…' }).click();
  await expect(page.getByLabel('Monto total')).toHaveValue('1740');
  await page.getByLabel('Monto total').fill('1000');
  await page.getByLabel('Referencia').fill('TRF-1');
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect.poll(() => body).not.toBeNull();
  expect(body).toEqual(expect.objectContaining({ idsFacturas: [1, 2], monto: 1000, formaPago: 'Transferencia', referencia: 'TRF-1' }));
  expect(body!['requestId']).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  await expect(bar).toHaveCount(0);
});
