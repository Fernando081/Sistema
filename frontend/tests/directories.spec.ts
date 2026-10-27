import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const directory of ['cliente', 'proveedor']) {
  test(`${directory}: página remota, búsqueda y exportación conservan filtro`, async ({ page }) => {
    await installErpApiMock(page);
    const resource = directory === 'cliente' ? 'cliente' : 'proveedores';
    const queries: URLSearchParams[] = [];
    await page.route(`**/api/v1/${resource}/pagina?*`, route => {
      const params = new URL(route.request().url()).searchParams;
      queries.push(params);
      const id = directory === 'cliente' ? 'IdCliente' : 'IdProveedor';
      return route.fulfill({ json: { data: [{ [id]: 1, RFC: 'AAA', RazonSocial: params.get('term') || 'Directorio remoto', CodigoPostal: '08900' }], total: params.get('term') ? 1 : 21, page: Number(params.get('page')), totalPages: params.get('term') ? 1 : 3 } });
    });
    await page.route(`**/api/v1/${resource}/exportar?*`, route => {
      expect(new URL(route.request().url()).searchParams.get('term')).toBe('ESN-PRUEBA');
      return route.fulfill({ contentType: 'text/csv', body: 'RFC,Nombre\r\nAAA,ESN-PRUEBA\r\n' });
    });
    await login(page, `/${directory}`);
    await expect(page.getByText('Directorio remoto', { exact: true }).first()).toBeVisible();
    await page.locator('.mat-mdc-paginator-navigation-next').click();
    await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
    await page.getByLabel(directory === 'cliente' ? 'Buscar cliente' : 'Buscar proveedor').fill('ESN-PRUEBA');
    await expect(page.getByText('ESN-PRUEBA', { exact: true }).first()).toBeVisible();
    expect(queries.at(-1)?.get('page')).toBe('1');
    await page.getByRole('columnheader', { name: 'Razón Social' }).click();
    await expect.poll(() => queries.at(-1)?.get('sortBy')).toBe('razonSocial');
    expect(queries.at(-1)?.get('term')).toBe('ESN-PRUEBA');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV filtrado' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });
}
