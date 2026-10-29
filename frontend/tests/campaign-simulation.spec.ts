import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// O01.2c · Simulación de campañas: iniciar desde la preparación vigente, ver omisiones por baja y cancelar.
const preview = (actual: boolean) => ({
  campana: { id: 5, nombre: 'Promoción filtros', estado: 'Borrador', canal: 'Correo', segmento: 'Talleres', plantilla: 'Filtros', fechaInicio: null, fechaFin: null, asunto: 'Hola {{nombre}}', contenido: 'Promoción para {{cliente}}' },
  bloqueos: [], metricas: { clientesSegmento: 2, clientesSinContacto: 0, contactosEvaluados: 3, elegibles: 3, excluidos: 0, motivos: { Elegible: 3 } },
  evaluacionSha256: 'c'.repeat(64), evaluadaEn: '2026-10-28T18:00:00Z',
  ultima: { id: 12, creadaEn: '2026-10-28T17:55:00Z', motivo: 'Revisión', autor: 'admin-e2e', sha256: 'd'.repeat(64), evaluacionSha256: 'c'.repeat(64), actual },
  data: [], total: 0, page: 1, limit: 20,
});
const sim = (extra = {}) => ({ id: 3, idPreparacion: 12, modo: 'Simulacion', canal: 'Correo', estado: 'Terminada', motivo: 'Prueba', creadaEn: '2026-10-28T18:01:00Z', terminadaEn: '2026-10-28T18:02:00Z',
  motivoCierre: null, autor: 'admin-e2e', total: 3, pendientes: 0, simulados: 2, omitidos: 1, cancelados: 0, motivos: { Baja: 1 }, ...extra });

test('campañas: simular el envío revalida bajas y permite cancelar sin enviar nada', async ({ page }) => {
  await installErpApiMock(page);
  let simulaciones = [sim()];
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/v1/crm/campanas-locales/5/destinatarios?*', (route) => route.fulfill({ json: preview(true) }));
  await page.route('**/api/v1/crm/campanas-locales/5/ejecuciones', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: simulaciones });
    posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    simulaciones = [sim({ id: 4, estado: 'En curso', terminadaEn: null, pendientes: 3, simulados: 0, omitidos: 0, motivos: {} }), ...simulaciones];
    return route.fulfill({ status: 201, json: { id: 4, repetida: false, destinatarios: 3 } });
  });
  await page.route('**/api/v1/crm/campanas-locales/5/ejecuciones/4/cancelar', (route) => {
    posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    simulaciones = simulaciones.map((s) => s.id === 4 ? { ...s, estado: 'Cancelada', pendientes: 0, cancelados: 3, motivoCierre: 'Ya no aplica' } : s);
    return route.fulfill({ status: 201, json: { id: 4, cancelados: 3 } });
  });
  await login(page, '/crm/campanas?campana=5');
  const panel = page.getByRole('region', { name: 'Simulación de envío' });
  await expect(panel.getByText('No envía ningún mensaje')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Simulación 3 · Terminada' })).toBeVisible();
  await expect(panel.getByText('Omitidos por Baja: 1')).toBeVisible();

  const iniciar = panel.getByRole('button', { name: 'Iniciar simulación' });
  await expect(iniciar).toBeDisabled();
  await panel.getByLabel('Motivo de la simulación').fill('Validar bajas antes de C01.2');
  await panel.getByLabel('Entiendo que es una simulación local y que no se enviará nada.').check();
  await iniciar.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Iniciar simulación' }).click();
  await expect(page.getByText('Simulación 4 iniciada', { exact: false })).toBeVisible();
  expect(posts[0].body).toMatchObject({ idPreparacion: 12, motivo: 'Validar bajas antes de C01.2', confirmacion: true });
  expect(posts[0].body['requestId']).toMatch(/^[0-9a-f-]{36}$/);
  await expect(panel.getByRole('heading', { name: 'Simulación 4 · En curso' })).toBeVisible();
  await expect(iniciar).toBeDisabled();

  await panel.getByLabel('Motivo para cancelar').fill('Ya no aplica');
  await panel.getByRole('button', { name: 'Cancelar simulación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar simulación' }).click();
  await expect(panel.getByRole('heading', { name: 'Simulación 4 · Cancelada' })).toBeVisible();
  expect(posts[1]).toMatchObject({ body: { motivo: 'Ya no aplica', confirmacion: true } });
  const axe = await new AxeBuilder({ page }).include('[aria-label="Simulación de envío"]').analyze();
  expect(axe.violations).toEqual([]);
});

test('campañas: sin preparación vigente no se puede simular', async ({ page }) => {
  await installErpApiMock(page);
  await page.route('**/api/v1/crm/campanas-locales/5/destinatarios?*', (route) => route.fulfill({ json: preview(false) }));
  await page.route('**/api/v1/crm/campanas-locales/5/ejecuciones', (route) => route.fulfill({ json: [] }));
  await login(page, '/crm/campanas?campana=5');
  const panel = page.getByRole('region', { name: 'Simulación de envío' });
  await expect(panel.getByText('Conserva una preparación que coincida')).toBeVisible();
  await panel.getByLabel('Motivo de la simulación').fill('x');
  await panel.getByLabel('Entiendo que es una simulación local y que no se enviará nada.').check();
  await expect(panel.getByRole('button', { name: 'Iniciar simulación' })).toBeDisabled();
  await expect(panel.getByText('Esta campaña no tiene simulaciones.')).toBeVisible();
});
