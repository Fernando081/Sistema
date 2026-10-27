import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

for (const value of [null, 0, 2.5]) {
  test(`GMROI ${value}: distingue dato desconocido de cero y valor calculado`, async ({ page }) => {
    await installErpApiMock(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/v1/dashboard**', async route => {
      const endpoint = new URL(route.request().url()).pathname;
      const body = endpoint.endsWith('/scheduled-jobs') ? [] : endpoint.endsWith('/refresh-status')
        ? { checkedAt: new Date().toISOString(), expectedAt: new Date().toISOString(), lastSuccessAt: null, overdue: false, freshness: 'pending', lastRun: null, recentRuns: [] }
        : endpoint.endsWith('/inventario')
        ? [{ retorno_inversion_inventario: value, gmroi_dias_historial: value === null ? 1 : 90 }]
        : endpoint.endsWith('/operaciones')
          ? [{ tasa_cumplimiento: value, tasa_conversion_cotizaciones: value }]
        : endpoint.endsWith('/clientes')
          ? [{ dias_cuentas_por_pagar: value }]
        : endpoint.endsWith('/ventas')
          ? [{ margen_utilidad_bruta: value }]
        : endpoint.endsWith('/dashboard')
          ? { ventasHoy: 0, porCobrar: 0, porPagar: 0, conteoBajos: 0, grafica: [], topProductos: [] }
          : [{}];
      await route.fulfill({ json: body });
    });
    await login(page, '/dashboard');
    await page.locator('.advanced-analysis summary').click();
    const metric = page.locator('.advanced-metrics > div').filter({ hasText: 'Rentabilidad del inventario' });
    await expect(metric).toBeVisible();
    if (value === null) await expect(metric.locator('strong')).toHaveText('No disponible');
    else await expect(metric.locator('strong')).toHaveText(value === 0 ? /^0[.,]0{1,2}$/ : /^2[.,]5[0]?$/);
    for (const name of ['Nivel de surtido','Plazo efectivo de pago','Conversión de cotizaciones','Margen bruto']) {
      const indicator = page.locator('.advanced-metrics > div').filter({ hasText: name });
      if (value === null) await expect(indicator.locator('strong')).toHaveText('No disponible');
      else await expect(indicator.locator('strong')).not.toHaveText('No disponible');
    }
  });
}
