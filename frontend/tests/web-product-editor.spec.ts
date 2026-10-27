import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    test(`Ficha web: edición, persistencia y accesibilidad ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await installErpApiMock(page);
      await page.route('**/uploads/**', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ddd"/><circle cx="50" cy="50" r="30" fill="#587080"/></svg>',
        }),
      );
      const producto = {
        codigo: 'FILTRO-ISX',
        nombre: 'Filtro de combustible ISX',
        marca: 'Marca de prueba',
        imagenes: ['/uploads/test-a.png', '/uploads/test-b.png'],
        numerosParte: [{ numero: 'OEM-123', tipo: 'OEM', fabricante: 'Fabricante de prueba' }],
        aplicaciones: [],
      };
      let ficha: Record<string, unknown> | null = null;
      let conflict = true;
      await page.route('**/api/v1/web-catalog/admin/products/101', async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { producto, ficha } });
        if (conflict) {
          conflict = false;
          return route.fulfill({ status: 409, json: { message: 'La ficha cambió' } });
        }
        const body = route.request().postDataJSON();
        expect(body.imagenes).toEqual(['/uploads/test-a.png']);
        expect(body.especificaciones).toEqual([{ nombre: 'Altura', valor: '120', unidad: 'mm' }]);
        ficha = {
          ...body,
          version: 1,
          snapshot: { imagenes: body.imagenes, especificaciones: body.especificaciones },
        };
        return route.fulfill({ json: ficha });
      });
      await page.route('**/api/v1/web-catalog/admin/products/101/export-candidate', (route) =>
        route.fulfill({ json: { schemaVersion: 1, products: [] } }),
      );
      await page.route('**/api/v1/web-catalog/admin/products/101/approve-candidate', (route) =>
        route.fulfill({
          json: {
            raw: '{ "schemaVersion": 1, "products": [] }',
            sha256: 'a'.repeat(64),
            receipt: { id: 9, timestamp: '2026-10-05' },
          },
        }),
      );
      await page.route('**/api/v1/web-catalog/admin/products/101/approvals/9', (route) =>
        route.fulfill({
          json: { receiptId: 9, version: 1, sha256: 'a'.repeat(64), active: true, revoked: false },
        }),
      );
      await page.route('**/api/v1/web-catalog/admin/products/101/approvals/9/revoke', (route) =>
        route.fulfill({ json: { revoked: true } }),
      );
      await login(page, '/producto');
      await page.getByRole('button', { name: 'Editar producto', exact: true }).click();
      await page.getByRole('tab', { name: 'Ficha web', exact: true }).click();
      const editor = page.getByRole('region', { name: 'Ficha comercial web' });
      await expect(
        editor.getByRole('heading', { name: 'Ficha comercial web', exact: true }),
      ).toBeVisible();
      await editor
        .getByLabel('Descripción comercial', { exact: true })
        .fill('Descripción de prueba únicamente para comprobar la interfaz del editor.');
      await editor.getByLabel('Incluir fotografía 2', { exact: true }).uncheck();
      await editor.getByRole('button', { name: 'Agregar característica' }).click();
      await editor.getByLabel('Característica 1', { exact: true }).fill('Altura');
      await editor.getByLabel('Valor 1', { exact: true }).fill('120');
      await editor.getByLabel('Unidad 1', { exact: true }).fill('mm');
      await editor.getByLabel('Unidad 1', { exact: true }).press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0);
      await editor.getByRole('button', { name: 'Guardar borrador' }).click();
      await expect(
        editor.getByText('La versión cambió o la URL está ocupada.', { exact: false }),
      ).toBeVisible();
      await editor
        .getByRole('button', { name: 'Cargar versión actual conservando mi texto' })
        .click();
      await expect(editor.getByLabel('Valor 1', { exact: true })).toHaveValue('120');
      await expect(editor.getByLabel('Incluir fotografía 2', { exact: true })).not.toBeChecked();
      await editor.getByRole('button', { name: 'Guardar borrador' }).click();
      await expect(editor.getByText('Ficha guardada.', { exact: false })).toBeVisible();
      await expect(editor.locator('.preview img')).toHaveCount(1);
      await expect(editor.locator('.preview img')).toBeVisible();
      const overflow = await editor.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      );
      expect(overflow).toBe(false);
      const issues = await new AxeBuilder({ page })
        .include('app-web-product-editor')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        issues.violations.filter(
          (issue) => issue.impact === 'serious' || issue.impact === 'critical',
        ),
      ).toEqual([]);
      await page.screenshot({ path: `../.artifacts/web012-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Cerrar ficha de producto' }).click();
      await page.getByRole('button', { name: 'Editar producto', exact: true }).click();
      await page.getByRole('tab', { name: 'Ficha web', exact: true }).click();
      await expect(editor.getByLabel('Valor 1', { exact: true })).toHaveValue('120');
      await expect(editor.getByLabel('Incluir fotografía 2', { exact: true })).not.toBeChecked();
      await expect(editor.getByLabel('Confirmé que los datos son reales')).not.toBeChecked();
      await expect(editor.getByRole('button', { name: 'Descargar candidata' })).toBeDisabled();
      await editor.getByLabel('Confirmé que los datos son reales').check();
      await editor.getByLabel('Tengo autorización para usar estas imágenes').check();
      await editor.getByLabel('Revisé referencias, aplicaciones y restricciones').check();
      await editor.getByRole('button', { name: 'Marcar lista', exact: true }).click();
      await expect(editor.getByRole('button', { name: 'Descargar candidata' })).toBeEnabled();
      const downloaded = page.waitForEvent('download');
      await editor.getByRole('button', { name: 'Descargar candidata' }).click();
      expect((await downloaded).suggestedFilename()).toBe('ficha-candidata-101.json');
      await expect(
        editor.getByText('Exportar no publica la ficha.', { exact: false }),
      ).toBeVisible();
      const approveButton = editor.getByRole('button', {
        name: 'Registrar aprobación y descargar',
      });
      await expect(approveButton).toBeDisabled();
      await editor
        .getByLabel('Revisé la versión guardada y autorizo registrar su aprobación editorial')
        .check();
      const approvalDownload = page.waitForEvent('download');
      await approveButton.click();
      expect((await approvalDownload).suggestedFilename()).toBe('ficha-aprobada-101.json');
      await expect(editor.getByText('Recibo 9', { exact: false })).toBeVisible();
      await editor.getByRole('button', { name: 'Consultar vigencia' }).click();
      await expect(editor.getByText('Vigente al consultar', { exact: false })).toBeVisible();
      await expect(
        editor.getByRole('button', { name: 'Revocar recibo', exact: true }),
      ).toBeDisabled();
      await editor.getByLabel('Confirmo revocar este recibo').check();
      await editor.getByRole('button', { name: 'Revocar recibo', exact: true }).click();
      await expect(editor.getByRole('region', {name:'Vigencia de aprobación'}).getByText('Revocado', { exact: false })).toBeVisible();
      expect(
        await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
    });
  }
}
