import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';
for (const theme of ['light', 'dark'])
  for (const width of [390, 1280]) {
    test(`Lote visual completo ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await installErpApiMock(page);
      await page.route('**/api/v1/web-catalog/admin/products?**', (route) =>
        route.fulfill({ json: { data: [], total: 0 } }),
      );
      for (const id of [1, 2]) {
        await page.route(`**/api/v1/web-catalog/admin/products/${id}`, (route) =>
          route.fulfill({ json: { ficha: { version: 1 } } }),
        );
        await page.route(`**/api/v1/web-catalog/admin/products/${id}/export-candidate`, (route) =>
          route.fulfill({
            json: {
              schemaVersion: 1,
              products: [
                {
                  slug: `fixture-${id}`,
                  code: `TEST-${id}`,
                  title: `Fixture ${id}`,
                  status: 'draft',
                  approved: false,
                },
              ],
            },
          }),
        );
      }
      let revoked = false;
      await page.route('**/api/v1/web-catalog/admin/products/batch/approve', async (route) => {
        const body = route.request().postDataJSON() as { raw: string; confirmed: boolean };
        const manifest = JSON.parse(body.raw);
        expect(body.confirmed).toBe(true);
        expect(manifest.products[0].images[0].authorized).toBe(true);
        expect(manifest.products[0].images[0].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(manifest.products[0].images[0].variants[0].width).toBe(320);
        expect(manifest.products[0].images[0].variants[0].authorized).toBe(true);
        expect(manifest.products[0].alternatives).toEqual(['fixture-2']);
        await route.fulfill({
          json: { raw: body.raw, sha256: 'a'.repeat(64), receipt: { id: 9 } },
        });
      });
      await page.route('**/api/v1/web-catalog/admin/products/batch/approvals/9', (route) =>
        route.fulfill({
          json: {
            receiptId: 9,
            scope: 'batch',
            active: !revoked,
            revoked,
            productCount: 2,
            sha256: 'a'.repeat(64),
          },
        }),
      );
      await page.route('**/api/v1/web-catalog/admin/products/batch/approvals/9/revoke', (route) => {
        revoked = true;
        return route.fulfill({ json: { revoked: true } });
      });
      await login(page, '/catalogo-web');
      const panel = page.getByRole('region', { name: 'Revisión de lotes' });
      await panel.getByLabel('IDs de productos, separados por comas').fill('1,2');
      await panel.getByRole('button', { name: 'Preparar lote', exact: true }).click();
      await expect(panel.getByRole('heading', { name: 'TEST-1 · Fixture 1' })).toBeVisible();
      await panel.getByLabel('Seleccionar PNG para TEST-1').setInputFiles({
        name: 'fixture.png',
        mimeType: 'image/png',
        buffer: await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 390 } }),
      });
      await panel.getByLabel('Texto alternativo de fixture.png').fill('Imagen de prueba aislada');
      await panel.getByLabel('Confirmo derechos de fixture.png').check();
      await panel
        .getByRole('button', { name: 'Generar variantes de fixture.png', exact: true })
        .click();
      await expect(panel.getByLabel('Confirmo derechos de fixture-320.png')).toBeVisible();
      await panel.getByLabel('Confirmo derechos de fixture-320.png').check();
      const variantDownload = page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Descargar fixture-320.png', exact: true }).click();
      expect((await variantDownload).suggestedFilename()).toBe('fixture-320.png');
      await panel
        .getByRole('group', { name: 'Alternativas de TEST-1' })
        .getByLabel('TEST-2 · Fixture 2')
        .check();
      const approve = panel.getByRole('button', { name: 'Aprobar y descargar lote' });
      await expect(approve).toBeDisabled();
      await panel
        .getByLabel('Confirmo la revisión de todas las fichas, imágenes y alternativas del lote')
        .check();
      const download = page.waitForEvent('download');
      await approve.click();
      expect((await download).suggestedFilename()).toBe('catalogo-lote-aprobado.json');
      await panel.getByRole('button', { name: 'Consultar vigencia del lote' }).click();
      await expect(panel.getByText('Estado: Vigente al consultar', { exact: false })).toBeVisible();
      await panel.getByLabel('Confirmo revocar este recibo de lote').check();
      await panel.getByRole('button', { name: 'Revocar lote', exact: true }).click();
      await expect(panel.getByText('Estado: Revocado', { exact: false })).toBeVisible();
      const issues = await new AxeBuilder({ page })
        .include('app-web-batch-editor')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        issues.violations.filter(
          (issue) => issue.impact === 'serious' || issue.impact === 'critical',
        ),
      ).toEqual([]);
      expect(await panel.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    });
  }
