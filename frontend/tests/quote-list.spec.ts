import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('cotizaciones: orden remoto, filtro URL y exportación independiente de página', async ({ page }) => {
  await installErpApiMock(page);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/cotizacion?*', route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    return route.fulfill({ json: { data: [{ id_cotizacion: 1, folio: 101, nombre_receptor: 'Transportes', rfc_receptor: 'AAA', total: '100.50', estatus: 'Vigente', fecha_emision: '2026-09-30', id_pedido: null }], total: params.get('term') ? 1 : 21, page: Number(params.get('page')), totalPages: params.get('term') ? 1 : 3 } });
  });
  await page.route('**/api/v1/cotizacion/exportar?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('term')).toBe('C-101'); expect(params.get('sortBy')).toBe('total');
    return route.fulfill({ contentType: 'text/csv', body: 'folio,total\r\n101,100.50\r\n' });
  });
  await login(page, '/cotizacion/historial');
  await expect(page.getByText('C-101', { exact: true }).first()).toBeVisible();
  await page.locator('.mat-mdc-paginator-navigation-next').click();
  await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
  await page.getByRole('columnheader', { name: 'Total', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('sortBy')).toBe('total');
  expect(queries.at(-1)?.get('page')).toBe('1');
  await page.getByLabel('Buscar cotización').fill('C-101');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click();
  expect((await download).suggestedFilename()).toMatch(/^cotizaciones_.*\.csv$/);
  await page.goto('/cotizacion/historial?q=RFC');
  await expect(page.getByLabel('Buscar cotización')).toHaveValue('RFC');
  await expect.poll(() => queries.at(-1)?.get('term')).toBe('RFC');
});
