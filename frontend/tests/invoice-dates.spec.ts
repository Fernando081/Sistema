import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('rango de emisión restaura URL, valida orden y filtra CSV', async ({ page }) => {
  await installErpApiMock(page);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/venta?*', route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    return route.fulfill({ json: { data: [], total: 0, page: 1, totalPages: 0 } });
  });
  await page.route('**/api/v1/venta/exportar?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('desde')).toBe('2026-09-30'); expect(params.get('hasta')).toBe('2026-10-01');
    expect(params.get('estado')).toBe('Pagada'); expect(params.get('tipo')).toBe('I');
    return route.fulfill({ contentType: 'text/csv', body: 'folio,fecha\r\n' });
  });
  await login(page, '/facturas');
  await page.goto('/facturas?desde=2026-09-30&hasta=2026-10-01&estado=Pagada&tipo=I');
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2026-09-30');
  await expect.poll(() => queries.at(-1)?.get('hasta')).toBe('2026-10-01');
  await page.reload();
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('2026-10-01');
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-02');
  await page.getByRole('button', { name: 'Aplicar fechas', exact: true }).click();
  await expect(page.getByText('Revisa las fechas: Desde debe ser anterior o igual a Hasta.')).toBeVisible();
  expect(queries.at(-1)?.get('desde')).toBe('2026-09-30');
  await page.getByLabel('Desde', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Aplicar fechas', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click(); await download;
  await page.getByRole('button', { name: 'Limpiar fechas', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('desde')).toBe('');
  expect(queries.at(-1)?.get('estado')).toBe('Pagada');
  await expect.poll(() => new URL(page.url()).searchParams.has('desde')).toBe(false);
  await page.goto('/facturas?desde=2026-02-30&hasta=2026-10-01');
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('');
});
