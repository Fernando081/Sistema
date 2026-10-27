import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const [path, resource, label, sort, apiSort] of [
  ['/producto', 'producto', 'Buscar producto', 'codigo', 'sort'],
  ['/facturas', 'venta', 'Buscar en todas las ventas', 'total', 'sortBy'],
]) {
  test(`${path}: URL restaura filtro, página, orden y tipo fiscal cuando aplica`, async ({ page }) => {
    await installErpApiMock(page);
    const queries: URLSearchParams[] = [];
    await page.route(`**/api/v1/${resource}?*`, route => {
      const params = new URL(route.request().url()).searchParams; queries.push(params);
      const row = { IdProducto: 1, Codigo: 'FILTRO', Descripcion: 'Filtro', PrecioUnitario: 850, Existencia: 10,
        id_factura: 1, serie: 'NC', folio: 101, nombre_receptor: 'Diesel', rfc_receptor: 'AAA', total: 100, estatus: 'Timbrada', estado_fiscal: 'Borrador' };
      return route.fulfill({ json: { data: [row], total: 100, page: Number(params.get('page')), totalPages: 4 } });
    });
    await login(page, path);
    await page.goto(`${path}?q=Diesel&page=3&limit=25&sort=${sort}&order=asc&tipo=E&origen=prueba`);
    await expect(page.getByLabel(label)).toHaveValue('Diesel');
    await expect.poll(() => queries.at(-1)?.get('page')).toBe('3');
    expect(queries.at(-1)?.get('limit')).toBe('25'); expect(queries.at(-1)?.get(apiSort)).toBe(sort);
    expect(queries.at(-1)?.get(resource === 'producto' ? 'order' : 'sortOrder')).toBe('asc');
    if (resource === 'venta') {
      await expect(page.getByRole('radio', { name: 'Egresos' })).toBeChecked();
      expect(queries.at(-1)?.get('tipo')).toBe('E');
    }
    await page.reload();
    await expect(page.getByLabel(label)).toHaveValue('Diesel');
    await expect.poll(() => queries.at(-1)?.get('page')).toBe('3');
    await page.locator('.mat-mdc-paginator-navigation-next').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('4');
    expect(new URL(page.url()).searchParams.get('origen')).toBe('prueba');
    if (resource === 'venta') {
      await page.getByRole('radio', { name: 'Ingresos' }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('tipo')).toBe('I');
      expect(new URL(page.url()).searchParams.get('page')).toBeNull();
    }
    await page.getByLabel(label).fill('RFC');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('RFC');
    await page.goto(`${path}?page=-1&limit=999&sort=__proto__&order=SQL&tipo=SQL`);
    await expect.poll(() => queries.at(-1)?.get('limit')).toBe('10');
    expect(queries.at(-1)?.get('page')).toBe('1');
    if (resource === 'venta') await expect(page.getByRole('radio', { name: 'Todas', exact: true })).toBeChecked();
  });
}
