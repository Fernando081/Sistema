import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';
for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    test(`Revisión catálogo: filtros, vacío, error y editor ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await installErpApiMock(page);
      let fail = true;
      await page.route('**/api/v1/web-catalog/admin/products?**', async (route) => {
        if (fail) {
          fail = false;
          return route.fulfill({ status: 503, json: { message: 'fallo simulado' } });
        }
        const params = new URL(route.request().url()).searchParams;
        const data =
          params.get('term') === 'inexistente'
            ? []
            : [
                {
                  id: 42,
                  codigo: 'ABC-42',
                  nombre: 'Filtro de prueba',
                  marca: 'Marca prueba',
                  categoria: 'Filtros',
                  estado: 'borrador',
                  duplicados: '2',
                  pendientes: [
                    'Confirmar datos reales',
                    'Registrar fuente de compatibilidad',
                    'Revisar posible código duplicado en la marca',
                  ],
                },
              ];
        return route.fulfill({ json: { data, total: data.length, page: 1, limit: 25 } });
      });
      await page.route('**/api/v1/web-catalog/admin/products/42', (route) =>
        route.fulfill({
          json: {
            producto: {
              codigo: 'ABC-42',
              nombre: 'Filtro de prueba',
              marca: 'Marca prueba',
              categoria: 'Filtros',
              imagenes: [],
              numerosParte: [],
              aplicaciones: [],
            },
            ficha: null,
          },
        }),
      );
      await login(page, '/catalogo-web');
      await expect(page.locator('.quality').getByRole('alert')).toContainText('No se pudo cargar');
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await expect(page.getByText('Posible duplicado:', { exact: false })).toBeVisible();
      await page.getByLabel('Buscar código, descripción, marca o categoría').fill('inexistente');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await expect(page.getByText('No hay productos para estos filtros.')).toBeVisible();
      await page.getByLabel('Buscar código, descripción, marca o categoría').fill('');
      await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('borrador');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Revisar ficha ABC-42' })).toBeVisible();
      const issues = await new AxeBuilder({ page })
        .include('.quality')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        issues.violations.filter(
          (issue) => issue.impact === 'serious' || issue.impact === 'critical',
        ),
      ).toEqual([]);
      expect(
        await page
          .locator('.quality')
          .evaluate((element) => element.scrollWidth > element.clientWidth + 1),
      ).toBe(false);
      await page.screenshot({ path: `../.artifacts/web013-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Revisar ficha ABC-42' }).click();
      await expect(
        page.getByRole('heading', { name: 'Ficha comercial web', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Fuente de compatibilidad', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar editor', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }
}
