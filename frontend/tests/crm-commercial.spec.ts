import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const theme of ['light', 'dark']) {
  test(`Origen comercial: cliente, confirmación, reintento y retiro ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    const opportunity = { idOportunidad: 12, idCliente: null as number | null, empresa: 'Oportunidad fixture',
      etapa: 'Prospecto', tipoCliente: 'Otro', montoEstimado: 0, version: 1 };
    const quotes: Record<string, unknown>[] = [];
    const bodies: unknown[] = [];
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/cliente/pagina**', route => {
      expect(new URL(route.request().url()).searchParams.get('term')).toBe('Transportes');
      return route.fulfill({ json: { data: [{ IdCliente: 7, RazonSocial: 'Transportes fixture', RFC: 'XAXX010101000' }], total: 1, page: 1, totalPages: 1 } });
    });
    await page.route('**/api/v1/crm/oportunidades**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('/documentos-comerciales')) {
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON();
          if (path.endsWith('/cliente')) {
            expect(body).toEqual({ idCliente: 7, expectedVersion: 1, confirmado: true });
            opportunity.idCliente = 7; opportunity.version = 2; return route.fulfill({ json: { version: 2, idCliente: 7 } });
          }
          if (path.endsWith('/retirar')) {
            expect(body).toEqual({ expectedVersion: 3, confirmado: true }); quotes.length = 0; opportunity.version = 4;
            return route.fulfill({ json: { version: 4, removed: true } });
          }
          expect(path).toContain('/cotizaciones/81'); bodies.push(body);
          expect(body).toEqual({ expectedVersion: 2, confirmado: true });
          if (bodies.length === 1) {
            opportunity.version = 3; quotes.push({ idCotizacion: 81, folio: 801, estatus: 'Convertida',
              fechaEmision: '2026-10-10T12:00:00Z', linkedAt: '2026-10-11T12:00:00Z', documentosVenta: 1, cancelados: 0, inconsistentes: 0 });
            await pending; return route.fulfill({ status: 503, json: {} });
          }
          expect(body).toEqual(bodies[0]); return route.fulfill({ json: { version: 3, idCotizacion: 81 } });
        }
        if (path.endsWith('/disponibles')) return route.fulfill({ json: quotes.length ? [] : [{ idCotizacion: 81, folio: 801, estatus: 'Convertida', fechaEmision: '2026-10-10T12:00:00Z' }] });
        return route.fulfill({ json: { opportunity: { ...opportunity, cliente: opportunity.idCliente ? 'Transportes fixture' : null }, quotes, truncated: false } });
      }
      if (path.endsWith('/consulta-web')) return route.fulfill({ json: null });
      if (path.endsWith('/seguimientos')) return route.fulfill({ json: { data: [], total: 0 } });
      if (path.endsWith('/unidades')) return route.fulfill({ json: [] });
      return route.fulfill({ json: path.endsWith('/12') ? opportunity : { data: [opportunity], total: 1 } });
    });
    await login(page, '/crm'); await page.getByRole('button', { name: opportunity.empresa, exact: true }).click();
    const dialog = page.getByRole('dialog'); const panel = page.locator('app-crm-documentos');
    await panel.getByText('Cliente ERP, cotizaciones y ventas vinculadas', { exact: true }).click();
    await expect(panel).toContainText('Sin asociar');
    await panel.getByText('Asociar cliente existente', { exact: true }).click();
    await panel.getByLabel('Nombre o RFC del cliente').fill('Transportes');
    await panel.getByRole('button', { name: 'Buscar cliente ERP', exact: true }).click();
    await panel.getByLabel('Cliente encontrado').selectOption({ label: 'Transportes fixture · XAXX010101000' });
    await expect(panel.getByRole('button', { name: 'Asociar cliente ERP', exact: true })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /este cliente corresponde/ }).check();
    await panel.getByRole('button', { name: 'Asociar cliente ERP', exact: true }).click();
    await expect(panel).toContainText('Cliente ERP: Transportes fixture');
    await panel.getByRole('button', { name: 'Buscar cotizaciones del cliente' }).click();
    await panel.getByLabel('Cotización a vincular').selectOption({ label: 'C-801 · Convertida' });
    await expect(panel.getByRole('button', { name: 'Vincular cotización', exact: true })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /esta cotización proviene/ }).check();
    await panel.getByRole('button', { name: 'Vincular cotización', exact: true }).click();
    await expect(dialog.getByLabel('Empresa o prospecto')).toBeDisabled();
    await expect(panel.getByLabel('Cotización a vincular')).toBeDisabled();
    release?.();
    await expect(panel.getByRole('alert')).toContainText('Reintenta la misma operación');
    await expect(page.locator('.app-notification')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Reintentar la misma operación' }).click();
    await expect(panel.locator('.linked-quotes li')).toContainText('Documentos de venta vigentes: 1');
    expect(bodies.length).toBe(2);
    await expect(dialog.getByLabel('Empresa o prospecto')).toBeEnabled();
    expect((await new AxeBuilder({ page }).include('app-crm-documentos').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `../.artifacts/crm-commercial-${theme}.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Retirar vínculo C-801' }).click();
    await panel.getByRole('checkbox', { name: /Confirmo retirar este vínculo/ }).check();
    await panel.getByRole('button', { name: 'Confirmar retiro del vínculo' }).click();
    await expect(panel).toContainText('No hay cotizaciones vinculadas');
    await dialog.getByLabel('Empresa o prospecto').fill('Cambio sin guardar');
    await expect(panel.getByRole('button', { name: 'Recargar oportunidad completa' })).toBeDisabled();
    await expect(panel).toContainText('Guarda los cambios de la oportunidad');
  });

  test(`Origen comercial: error, búsqueda vacía y recuperación ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    const opportunity = { idOportunidad: 12, idCliente: 7, empresa: 'Recuperación fixture',
      etapa: 'Prospecto', tipoCliente: 'Otro', montoEstimado: 0, version: 1 };
    let failed = true;
    await page.route('**/api/v1/crm/oportunidades**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('/documentos-comerciales')) {
        if (path.endsWith('/disponibles')) return route.fulfill({ json: [] });
        if (failed) { failed = false; return route.fulfill({ status: 503, json: {} }); }
        return route.fulfill({ json: { opportunity: { ...opportunity, cliente: 'Cliente fixture' }, quotes: [], truncated: false } });
      }
      if (path.endsWith('/consulta-web')) return route.fulfill({ json: null });
      if (path.endsWith('/seguimientos')) return route.fulfill({ json: { data: [], total: 0 } });
      if (path.endsWith('/unidades')) return route.fulfill({ json: [] });
      return route.fulfill({ json: path.endsWith('/12') ? opportunity : { data: [opportunity], total: 1 } });
    });
    await login(page, '/crm'); await page.getByRole('button', { name: opportunity.empresa, exact: true }).click();
    const panel = page.locator('app-crm-documentos');
    await panel.getByText('Cliente ERP, cotizaciones y ventas vinculadas', { exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('No se pudieron cargar');
    await panel.getByRole('button', { name: 'Actualizar vínculos' }).click();
    await expect(panel).toContainText('Cliente ERP: Cliente fixture');
    await panel.getByLabel('Folio de cotización (opcional)').fill('C-999');
    await panel.getByRole('button', { name: 'Buscar cotizaciones del cliente' }).click();
    await expect(panel.getByRole('alert')).toContainText('No hay cotizaciones disponibles');
    await expect(panel.getByLabel('Folio de cotización (opcional)')).toHaveValue('C-999');
    expect((await new AxeBuilder({ page }).include('app-crm-documentos').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
