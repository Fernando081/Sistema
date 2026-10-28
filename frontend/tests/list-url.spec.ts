import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const [path, resource, label, sort, apiSort] of [
  ['/cliente', 'cliente/pagina', 'Buscar cliente', 'razonSocial', 'razonSocial'],
  ['/proveedor', 'proveedores/pagina', 'Buscar proveedor', 'razonSocial', 'razonSocial'],
  ['/cotizacion/historial', 'cotizacion', 'Buscar cotización', 'total', 'total'],
  ['/compra/historial', 'compra', 'Buscar compra', 'total', 'total'],
]) {
  test(`${path}: restaura página, tamaño, filtro y orden desde URL`, async ({ page }) => {
    await installErpApiMock(page);
    const queries: URLSearchParams[] = [];
    await page.route(`**/api/v1/${resource}?*`, route => {
      const params = new URL(route.request().url()).searchParams; queries.push(params);
      const row = { IdCliente: 1, IdProveedor: 1, RazonSocial: 'Diesel', RFC: 'AAA', id_cotizacion: 1, id_compra: 1, folio: 101, nombre_receptor: 'Diesel', nombre_proveedor: 'Diesel', total: 100 };
      return route.fulfill({ json: { data: [row], total: 100, page: Number(params.get('page')), totalPages: 4 } });
    });
    await login(page, path);
    await page.goto(`${path}?q=Diesel&page=3&limit=25&sort=${sort}&order=asc&origen=prueba`);
    await expect(page.getByLabel(label)).toHaveValue('Diesel');
    await expect.poll(() => queries.at(-1)?.get('page')).toBe('3');
    expect(queries.at(-1)?.get('limit')).toBe('25'); expect(queries.at(-1)?.get('sortBy')).toBe(apiSort);
    expect(queries.at(-1)?.get('sortOrder')).toBe('asc');
    await page.reload();
    await expect(page.getByLabel(label)).toHaveValue('Diesel');
    await expect.poll(() => queries.at(-1)?.get('page')).toBe('3');
    await page.locator('.mat-mdc-paginator-navigation-next').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('4');
    expect(new URL(page.url()).searchParams.get('origen')).toBe('prueba');
    await page.getByLabel(label).fill('RFC');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('RFC');
    expect(new URL(page.url()).searchParams.get('page')).toBeNull();
    await page.goto(`${path}?page=-1&limit=999&sort=__proto__&order=SQL`);
    await expect.poll(() => queries.at(-1)?.get('limit')).toBe('10');
    expect(queries.at(-1)?.get('page')).toBe('1');
    if (path === '/cliente' || path === '/proveedor') {
      await page.getByRole('columnheader', { name: 'ID', exact: true }).click();
      await expect.poll(() => queries.at(-1)?.get('sortOrder')).toBe('asc');
      await page.getByRole('columnheader', { name: 'ID', exact: true }).click();
      await expect.poll(() => queries.at(-1)?.get('sortOrder')).toBe('desc');
    }
  });
}
