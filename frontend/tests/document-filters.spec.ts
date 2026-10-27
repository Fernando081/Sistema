import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const config of [
  { path: '/cotizacion/historial', api: 'cotizacion', estado: 'Vigente' },
  { path: '/compra/historial', api: 'compra', estado: 'Completada' },
]) {
  test(`${config.api}: estado y fechas restauran URL y filtran CSV`, async ({ page }) => {
    await installErpApiMock(page);
    const queries: URLSearchParams[] = [];
    await page.route(`**/api/v1/${config.api}?*`, route => {
      const params = new URL(route.request().url()).searchParams; queries.push(params);
      return route.fulfill({ json: { data: [], total: 0, page: 1, totalPages: 0 } });
    });
    await page.route(`**/api/v1/${config.api}/exportar?*`, route => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get('estado')).toBe(config.estado);
      expect(params.get('desde')).toBe('2026-09-30'); expect(params.get('hasta')).toBe('2026-10-01');
      return route.fulfill({ contentType: 'text/csv', body: 'id,estatus\r\n' });
    });
    await login(page, config.path);
    await page.goto(`${config.path}?estado=${config.estado}&desde=2026-09-30&hasta=2026-10-01`);
    await expect(page.getByRole('combobox', { name: 'Estado comercial' })).toContainText(config.estado);
    await expect.poll(() => queries.at(-1)?.get('desde')).toBe('2026-09-30');
    await page.reload();
    await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('2026-10-01');
    await page.getByLabel('Desde', { exact: true }).fill('2026-10-02');
    await page.getByRole('button', { name: 'Aplicar fechas', exact: true }).click();
    await expect(page.getByText('Revisa las fechas: Desde debe ser anterior o igual a Hasta.')).toBeVisible();
    expect(queries.at(-1)?.get('desde')).toBe('2026-09-30');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click(); await download;
    await page.getByRole('button', { name: 'Limpiar fechas', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('hasta')).toBe('');
    expect(queries.at(-1)?.get('estado')).toBe(config.estado);
    await page.getByRole('combobox', { name: 'Estado comercial' }).click();
    await page.getByRole('option', { name: 'Pendiente', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.get('estado')).toBe('Pendiente');
    expect(queries.at(-1)?.get('page')).toBe('1');
    await page.goto(`${config.path}?estado=NoExiste&desde=2026-02-30`);
    await expect(page.getByRole('combobox', { name: 'Estado comercial' })).toContainText('Todos los estados');
    await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('');
  });
}
