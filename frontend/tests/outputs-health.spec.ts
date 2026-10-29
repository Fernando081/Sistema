import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// O01.3a · Salud de las salidas: niveles por área, cifras y vista previa de retención sin eliminar nada.
const refresh = { checkedAt: '2026-10-28T20:00:00Z', expectedAt: '2026-10-28T08:00:00Z', lastSuccessAt: '2026-10-28T08:10:00Z', overdue: false, freshness: 'current', lastRun: null, recentRuns: [] };
const health = {
  revisadaEn: '2026-10-28T20:00:00Z',
  nivel: 'critico',
  areas: [
    { area: 'correo', titulo: 'Correo de documentos', nivel: 'critico', mensajes: ['El envío más antiguo lleva 3 h en espera con el correo activo; revisa el servidor de correo.', '1 envíos inciertos esperan conciliación en el correo de cada factura (Ventas → Facturas).'] },
    { area: 'reportes', titulo: 'Recuperación de reportes', nivel: 'ok', mensajes: [] },
    { area: 'fiscal', titulo: 'Cancelaciones fiscales', nivel: 'atencion', mensajes: ['1 cancelaciones llevan días sin respuesta del SAT.'] },
    { area: 'campanas', titulo: 'Simulaciones de campaña', nivel: 'ok', mensajes: [] },
    { area: 'almacenamiento', titulo: 'Almacenamiento', nivel: 'ok', mensajes: [] },
  ],
  metricas: {
    correo: { modo: 'smtp', pendientes: 4, enCurso: 0, inciertos: 1, fallidos7d: 0, aceptados7d: 12, masAntiguoMin: 180 },
    reportes: { pendientes: 0, enCurso: 0, agotados: 2, agotados7d: 0, masAntiguoMin: null },
    fiscal: { pendientes: 1, sinRespuesta: 1, errores7d: 0, masAntiguoHoras: 170 },
    campanas: { enCurso: 0, pendientes: 0, masAntiguoMin: null },
    almacenamiento: { baseBytes: 300 * 1048576, pdfBytes: 5 * 1048576, documentos: 40, historialJobs: 900, notificaciones: 120 },
    retencion: { dias: 90, pdfsCerrados: 7, pdfBytesCerrados: 2.5 * 1048576, historialJobs: 400, notificacionesLeidas: 60 },
  },
  umbrales: { colaMax: 200, baseMaxMb: 4096, pdfMaxMb: 1024, retencionDias: 90 },
};

for (const theme of ['light', 'dark']) {
  test(`salud de las salidas: niveles, cifras y retención sólo informativa (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/v1/dashboard**', (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      if (endpoint.endsWith('/salidas')) return route.fulfill({ json: health });
      if (endpoint.endsWith('/scheduled-jobs')) return route.fulfill({ json: [] });
      if (endpoint.endsWith('/refresh-status')) return route.fulfill({ json: refresh });
      return route.fulfill({ json: endpoint.endsWith('/dashboard') ? { ventasHoy: 0, grafica: [], topProductos: [] } : [{}] });
    });
    await login(page, '/dashboard?salidas=1');
    const panel = page.locator('details.outputs-health');
    await expect(panel).toHaveAttribute('open', '');
    await expect(panel.locator('summary')).toHaveText('Salud de las salidas · Requiere acción');
    const correo = panel.getByRole('region', { name: 'Correo de documentos' });
    await expect(correo).toContainText('Requiere acción');
    await expect(correo).toContainText('3 h en espera');
    await expect(correo).toContainText('Correo activo · 4 en espera · 1 inciertos · 12 aceptados en 7 días.');
    await expect(panel.getByRole('region', { name: 'Cancelaciones fiscales' })).toContainText('Requiere revisión');
    await expect(panel.getByRole('region', { name: 'Recuperación de reportes' })).toContainText('Sin pendientes');
    await expect(panel.getByRole('region', { name: 'Almacenamiento' })).toContainText('Base de datos 300 MB · PDF de salidas 5 MB (40 documentos).');
    const retention = panel.getByRole('region', { name: 'Vista previa de retención' });
    await expect(retention).toContainText('7 PDF de salidas cerradas (2.5 MB), 400 ejecuciones de procesos y 60 avisos leídos.');
    await expect(retention).toContainText('no se elimina nada');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(correo).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('details.outputs-health').analyze();
    expect(axe.violations).toEqual([]);
  });
}

test('salud de las salidas: error al revisar', async ({ page }) => {
  await installErpApiMock(page);
  await page.route('**/api/v1/dashboard**', (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/salidas')) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: endpoint.endsWith('/dashboard') ? { ventasHoy: 0, grafica: [], topProductos: [] } : endpoint.endsWith('/scheduled-jobs') ? [] : endpoint.endsWith('/refresh-status') ? refresh : [{}] });
  });
  await login(page, '/dashboard');
  await page.getByText('Salud de las salidas', { exact: true }).click();
  await expect(page.locator('details.outputs-health')).toContainText('No se pudo revisar la salud de las salidas.');
});
