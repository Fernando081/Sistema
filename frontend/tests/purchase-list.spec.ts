import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';
test('compras: página/orden remotos y CSV conservan el término visible', async ({ page }) => {
  await installErpApiMock(page);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/compra?*', route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    return route.fulfill({ json: { data: [{ id_compra: 1, nombre_proveedor: 'Diesel Parts', rfc_proveedor: 'AAA', total: '100.50', folio_factura: 'F1', fecha_compra: '2026-10-01' }], total: 21, page: Number(params.get('page')), totalPages: 3 } });
  });
  await page.route('**/api/v1/compra/exportar?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('term')).toBe('F1'); expect(params.get('sortBy')).toBe('nombre_proveedor');
    return route.fulfill({ contentType: 'text/csv', body: 'folio,total\r\nF1,100.50\r\n' });
  });
  await login(page, '/compra/historial');
  await expect(page.getByText('Diesel Parts', { exact: true }).first()).toBeVisible();
  await page.locator('.mat-mdc-paginator-navigation-next').click();
  await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
  await page.getByRole('columnheader', { name: 'Proveedor', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('sortBy')).toBe('nombre_proveedor');
  expect(queries.at(-1)?.get('page')).toBe('1');
  await page.getByLabel('Buscar compra...').fill('F1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click();
  expect((await download).suggestedFilename()).toMatch(/^compras_.*\.csv$/);
  await page.goto('/compra/historial?q=RFC');
  await expect(page.getByLabel('Buscar compra...')).toHaveValue('RFC');
  await expect.poll(() => queries.at(-1)?.get('term')).toBe('RFC');
});
