import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('facturas: tipo, orden y exportación conservan el filtro visible', async ({ page }) => {
  await installErpApiMock(page);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/venta?*', route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    return route.fulfill({ json: { data: [{ id_factura: 1, serie: 'NC', folio: 101, nombre_receptor: 'Transportes', rfc_receptor: 'AAA', total: '100.50', estatus: 'Timbrada', estado_fiscal: 'Borrador', fecha_emision: '2026-10-01' }], total: 21, page: Number(params.get('page')), totalPages: 3 } });
  });
  await page.route('**/api/v1/venta/exportar?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('term')).toBe('NC101'); expect(params.get('tipo')).toBe('E'); expect(params.get('sortBy')).toBe('total');
    return route.fulfill({ contentType: 'text/csv', body: 'folio,total\r\n101,100.50\r\n' });
  });
  await login(page, '/facturas');
  await expect(page.getByText('Transportes', { exact: true }).first()).toBeVisible();
  await page.locator('.mat-mdc-paginator-navigation-next').click();
  await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
  await page.getByRole('radio', { name: 'Egresos' }).click();
  await expect.poll(() => queries.at(-1)?.get('tipo')).toBe('E');
  expect(queries.at(-1)?.get('page')).toBe('1');
  await page.getByRole('columnheader', { name: 'Total', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('sortBy')).toBe('total');
  await page.getByLabel('Buscar en todas las ventas').fill('NC101');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click();
  expect((await download).suggestedFilename()).toMatch(/^facturas_.*\.csv$/);
  await page.goto('/facturas?q=RFC');
  await expect(page.getByLabel('Buscar en todas las ventas')).toHaveValue('RFC');
  await expect.poll(() => queries.at(-1)?.get('term')).toBe('RFC');
});
