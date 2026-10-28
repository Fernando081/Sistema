import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const theme of ['light', 'dark']) {
  for (const state of ['current', 'pending', 'overdue', 'unavailable']) {
    test(`Actualización dashboard: ${state}, ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await installErpApiMock(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/v1/dashboard**', async (route) => {
        const endpoint = new URL(route.request().url()).pathname;
        if (endpoint.endsWith('/scheduled-jobs')) {
          if (state === 'unavailable') return route.fulfill({ status: 503, json: {} });
          return route.fulfill({
            json: ['operational_alerts', 'dashboard_freshness'].map((name) => ({
              name,
              checkedAt: '2026-10-05T09:00:00Z',
              expectedAt: '2026-10-05T09:00:00Z',
              lastSuccessAt: state === 'current' ? '2026-10-05T09:01:00Z' : null,
              overdue: state === 'overdue',
              lastRun:
                state === 'overdue'
                  ? {
                      id: name,
                      startedAt: '2026-10-05T09:00:00Z',
                      finishedAt: '2026-10-05T09:01:00Z',
                      status: 'failed',
                    }
                  : null,
              recentRuns: [],
            })),
          });
        }
        if (endpoint.endsWith('/refresh-status')) {
          if (state === 'unavailable') return route.fulfill({ status: 503, json: {} });
          return route.fulfill({
            json: {
              checkedAt: '2026-10-05T09:00:00Z',
              expectedAt: '2026-10-05T08:00:00Z',
              lastSuccessAt: state === 'current' ? '2026-10-05T08:10:00Z' : null,
              overdue: state === 'overdue',
              freshness: state,
              lastRun:
                state === 'overdue'
                  ? {
                      id: 'test-run',
                      startedAt: '2026-10-05T08:00:00Z',
                      finishedAt: '2026-10-05T08:01:00Z',
                      status: 'failed',
                    }
                  : null,
              recentRuns: [],
            },
          });
        }
        return route.fulfill({
          json: endpoint.endsWith('/dashboard')
            ? { ventasHoy: 0, grafica: [], topProductos: [] }
            : [{}],
        });
      });
      await login(page, '/dashboard');
      const panel = page.getByRole('region', { name: 'Actualización de las métricas' });
      await expect(panel).toContainText(
        state === 'current'
          ? 'Refresco diario al día'
          : state === 'pending'
            ? 'Sin refresco diario confirmado'
            : state === 'overdue'
              ? 'Métricas pendientes de actualización'
              : 'No se pudo verificar',
      );
      if (state === 'current') await expect(panel).toContainText('05/10/2026 02:10');
      if (state === 'overdue') await expect(panel).toContainText('El último intento falló');
      await expect(page.getByRole('heading', { name: 'Pulso del negocio' })).toBeVisible();
      await page.getByText('Procesos automáticos', { exact: true }).click();
      if (state === 'unavailable')
        await expect(panel).toContainText('No se pudo verificar el estado de los procesos');
      else {
        await expect(
          page.getByRole('region', { name: 'Generación de alertas', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('region', { name: 'Revisión de frescura', exact: true }),
        ).toBeVisible();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(panel).toBeVisible();
      const result = await new AxeBuilder({ page }).include('.dashboard-freshness').analyze();
      expect(result.violations).toEqual([]);
      if (state === 'overdue')
        await panel.screenshot({ path: `../.artifacts/local/o023-dashboard-${theme}.png` });
    });
  }
}
