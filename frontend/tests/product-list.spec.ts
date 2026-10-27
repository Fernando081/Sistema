import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('productos: filtro visible, orden remoto y exportación del término recién escrito', async ({ page }) => {
  await installErpApiMock(page);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/producto?*', route => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params);
    return route.fulfill({ json: { data: [{ IdProducto: 1, Codigo: 'FILTRO', Descripcion: params.get('term') || 'Producto remoto', PrecioUnitario: 850, Existencia: 10 }], total: 1, page: 1, totalPages: 1 } });
  });
  await page.route('**/api/v1/producto/exportar?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('term')).toBe('OEM-123'); expect(params.get('sort')).toBe('codigo');
    return route.fulfill({ contentType: 'text/csv', body: 'Codigo,Descripcion\r\nFILTRO,Filtro\r\n' });
  });
  await login(page, '/producto');
  await expect(page.getByText('Producto remoto', { exact: true }).first()).toBeVisible();
  await page.getByRole('columnheader', { name: 'Código', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('sort')).toBe('codigo');
  await page.getByLabel('Buscar producto').fill('Filtros');
  await expect.poll(() => queries.at(-1)?.get('term')).toBe('Filtros');
  await page.getByLabel('Buscar producto').fill('OEM-123');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click();
  expect((await download).suggestedFilename()).toMatch(/^productos_.*\.csv$/);
  await page.goto('/producto?q=ISX');
  await expect(page.getByLabel('Buscar producto')).toHaveValue('ISX');
  await expect.poll(() => queries.at(-1)?.get('term')).toBe('ISX');
});
