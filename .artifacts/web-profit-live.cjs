const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { chromium } = require('@playwright/test');
const { databaseConfig } = require('../backend/db-config');
const { CrmWebMetricsService } = require('../backend/dist/crm/crm-web-metrics.service');

(async () => {
  const probes = [];
  const probe = async (url, expected, options = {}) => {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    assert.equal(res.status, expected, url); probes.push({ method: options.method || 'GET', url, expected, status: res.status });
    return res;
  };
  await probe('http://127.0.0.1:3100/api/v1/health', 200);
  const route = 'http://127.0.0.1:3100/api/v1/crm/solicitudes-web/metricas?desde=2026-10-01&hasta=2026-10-11';
  await probe(route, 401);
  await probe('http://127.0.0.1:3100/api/v1/crm/oportunidades/1/documentos-comerciales', 401);
  await probe('http://127.0.0.1:4300/login', 200);
  await probe('http://127.0.0.1:4500/', 200);
  await probe('http://127.0.0.1:4600/catalogo', 200);
  await probe('http://127.0.0.1:4500/solicitar', 503);
  await probe('http://127.0.0.1:4600/solicitar', 503);
  await probe('http://127.0.0.1:3100/api/v1/web-lead-bridge', 503, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const config = databaseConfig();
  const host = config.connectionString ? new URL(config.connectionString).hostname : config.host;
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host));
  const db = new DataSource({ type: 'postgres', ...(config.connectionString ? { url: config.connectionString } :
    { host: config.host, port: config.port, username: config.user, password: config.password, database: config.database }),
    ssl: config.ssl, synchronize: false, entities: [], extra: { connectionTimeoutMillis: 5000 } });
  let metrics;
  await db.initialize();
  try { metrics = await new CrmWebMetricsService(db).report('2026-10-01', '2026-10-11'); }
  finally { await db.destroy(); }
  let authenticated = false, ui = null;
  // Existing private configuration is read in memory only; no credentials or JWT
  // are copied to this source, console, screenshots or report.
  const password = process.env.METRICS_TEST_PASSWORD || process.env.AUTH_PASSWORD;
  const username = process.env.AUTH_USERNAME || 'admin';
  if (password) {
    const result = await fetch('http://127.0.0.1:3100/api/v1/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(10000) });
    if (result.status === 201) {
      const token = (await result.json()).access_token;
      const res = await probe(route, 200, { headers: { Authorization: 'Bearer ' + token } });
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      const httpMetrics = await res.json();
      assert.deepEqual(httpMetrics.totals, metrics.totals); assert.deepEqual(httpMetrics.commercial, metrics.commercial);
      assert.deepEqual(httpMetrics.finance, metrics.finance); authenticated = true;
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
        await context.addInitScript(() => localStorage.setItem('theme', 'dark'));
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          return url.protocol === 'http:' && url.hostname === '127.0.0.1' && ['4300', '3100'].includes(url.port)
            ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        await page.goto('http://127.0.0.1:4300/login');
        await page.getByLabel(/Usuario/).fill(username); await page.getByLabel(/Contraseña/).fill(password);
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        await page.waitForURL('**/dashboard', { timeout: 20000 });
        await page.goto('http://127.0.0.1:4300/crm');
        await page.getByRole('tab', { name: 'Solicitudes web' }).click();
        const panel = page.locator('app-crm-web-metrics');
        await panel.getByText('Medición de solicitudes', { exact: true }).click();
        await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByLabel('Recibidas hasta').fill('2026-10-11');
        const incoming = page.waitForResponse(res => res.url().includes('/solicitudes-web/metricas?') && res.status() === 200);
        await panel.getByRole('button', { name: 'Consultar medición' }).click();
        assert.deepEqual((await (await incoming).json()).finance, metrics.finance);
        await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
        await panel.locator('.finance').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const financialPanel = panel.locator('.finance');
        await financialPanel.scrollIntoViewIfNeeded();
        await financialPanel.screenshot({ path: path.join(__dirname, 'web-profit-live-panel.png') });
        ui = { actualLogin: true, apiMocked: false, injectedJwt: false, width: 390, theme: 'dark', reflow: true };
        await context.close();
      } finally { await browser.close(); }
    }
  }
  fs.writeFileSync(path.join(__dirname, 'web-profit-live.json'), JSON.stringify({ phase: 'WEB05.2d',
    source: 'current-development-database', generatedAt: new Date().toISOString(), node: process.versions.node,
    probes, authenticated, ui, metrics, captureEnabled: false,
    limits: ['La base de desarrollo conserva datos de prueba; no aceptación o conversiones comerciales reales.'] }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: probes.length, total: probes.length, authenticated, ui,
    received: metrics.totals.recibidas, opportunities: metrics.totals.oportunidades, evidence: '.artifacts/web-profit-live.json' }));
})().catch(error => { console.error('Verificación local de medición no completada:', error.name,
  error instanceof assert.AssertionError ? error.message : 'Error de comprobación; datos privados omitidos'); process.exitCode = 1; });
