import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';
test('estado comercial de facturas se restaura, combina con tipo y llega al CSV', async ({ page }) => {
  await installErpApiMock(page);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/venta?*', route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    return route.fulfill({ json: { data: [{ id_factura: 1, serie: 'NC', folio: 101, nombre_receptor: 'Diesel', total: 100, estatus: params.get('estado') || 'Pendiente', estado_fiscal: 'Borrador' }], total: 100, page: Number(params.get('page')), totalPages: 4 } });
  });
  await page.route('**/api/v1/venta/exportar?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('estado')).toBe('Pagada'); expect(params.get('tipo')).toBe('E'); expect(params.get('term')).toBe('NC');
    return route.fulfill({ contentType: 'text/csv', body: 'folio,estatus\r\n101,Pagada\r\n' });
  });
  await login(page, '/facturas');
  await page.goto('/facturas?q=NC&tipo=E&estado=Cancelada&page=2&limit=25');
  await expect(page.getByRole('combobox', { name: 'Estado comercial' })).toContainText('Cancelada');
  await expect.poll(() => queries.at(-1)?.get('estado')).toBe('Cancelada');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Estado comercial' })).toContainText('Cancelada');
  await page.getByRole('combobox', { name: 'Estado comercial' }).click();
  await page.getByRole('option', { name: 'Pagada', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('estado')).toBe('Pagada');
  expect(queries.at(-1)?.get('page')).toBe('1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click(); await download;
  await expect.poll(() => new URL(page.url()).searchParams.get('estado')).toBe('Pagada');
  await page.getByRole('combobox', { name: 'Estado comercial' }).click();
  await page.getByRole('option', { name: 'Todos los estados', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('estado')).toBe('');
  expect(queries.at(-1)?.get('tipo')).toBe('E');
});
