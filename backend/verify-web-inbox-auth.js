/* WEB05.1b/c: production Angular + complete AppModule + real login in an owned database copy. */
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const express = require('express');
const { Client } = require('pg');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { SchedulerRegistry } = require('@nestjs/schedule');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { databaseConfig } = require('./db-config');
const { findPgTool, postgresEnvironment } = require('./backup');
const { bridgeEnvironmentKeys } = require('./dist/crm/web-lead-bridge.config');
const { verifyBridgeRotation } = require('./verify-web-bridge-rotation');
const { verifyIntakeProfile } = require('./verify-web-intake-profile');

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
}

// This proxy belongs only to the test: no API mocks, injected JWTs or operational uploads.
function erpPreview(api, directory) {
  const site = express();
  site.use('/api', (req, res) => {
    const upstream = http.request(new URL(req.originalUrl, api), {
      method: req.method, headers: { ...req.headers, host: new URL(api).host }, timeout: 10000,
    }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  site.use('/uploads', (_req, res) => res.sendStatus(404));
  site.use(express.static(directory));
  site.get(/.*/, (_req, res) => res.sendFile(path.join(directory, 'index.html')));
  return http.createServer(site);
}

async function main() {
  assert.equal(process.versions.node.split('.')[0], '24', 'Requiere Node24');
  const root = path.resolve(__dirname, '..');
  const backupArg = process.argv.find(value => value.startsWith('--backup='));
  assert.ok(backupArg, 'Falta --backup=RUTA bajo .backups');
  const backupRoot = fs.realpathSync(path.join(root, '.backups'));
  const dump = fs.realpathSync(path.resolve(backupArg.slice(9)));
  assert.ok(dump.startsWith(backupRoot + path.sep) && fs.statSync(dump).isFile(), 'Respaldo fuera de .backups');
  const angular = path.join(root, 'frontend/dist/frontend/browser');
  assert.ok(fs.existsSync(path.join(angular, 'index.html')), 'Compila frontend producción antes de verificar');
  const config = databaseConfig();
  const admin = new Client(config);
  const database = 'verify_web_auth_' + randomBytes(8).toString('hex');
  const isolated = { ...config, database };
  const isolatedUrl = config.connectionString ? new URL(config.connectionString) : new URL('postgresql://127.0.0.1');
  if (!config.connectionString) {
    isolatedUrl.hostname = config.host;
    isolatedUrl.port = String(config.port);
    isolatedUrl.username = config.user;
    isolatedUrl.password = config.password;
  }
  isolatedUrl.pathname = '/' + database;
  isolated.connectionString = isolatedUrl.toString();
  const envKeys = ['DATABASE_URL', 'DB_NAME', 'NODE_ENV', 'JWT_SECRET', 'ALLOW_ENV_AUTH', 'FISCAL_MODE', 'CORS_ORIGINS',
    ...bridgeEnvironmentKeys, 'WEB_INBOX_PURGE_ENABLED'];
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let created = false, writer, app, publicServer, erpServer, browser, directory, releaseReceipt;
  let stage = 'Restauración';
  const report = { phase: 'WEB05.1-acceptance-local', startedAt: new Date().toISOString(),
    checks: [], browser: [], isolatedDatabase: true, apiMocked: false, operationalCaptureEnabled: false };
  const checked = label => { report.checks.push(label); console.log('OK: ' + label); };
  const requestId = randomUUID();
  const contactName = 'Aceptación fixture ' + requestId.slice(0, 8);
  await admin.connect();
  try {
    assert.notEqual((await admin.query('SELECT current_database() name')).rows[0].name, database);
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const child = { env: { ...postgresEnvironment(), DATABASE_URL: isolatedUrl.toString(), DB_NAME: database,
      PGDATABASE: database }, windowsHide: true, stdio: 'pipe', timeout: 180000, cwd: __dirname };
    execFileSync(findPgTool('pg_restore'), ['--list', dump], child);
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', database, dump], child);
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js'), '--check'], child);
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], child);
    checked('Respaldo restaurado; db:check antes de db:migrate solo en copia');
    writer = new Client(isolated);
    await writer.connect();
    assert.equal((await writer.query('SELECT current_database() name')).rows[0].name, database);
    // Disable copied accounts and clear copied inbox contents only in the owned database.
    await writer.query('UPDATE auth_user SET is_active=false');
    await writer.query('TRUNCATE crm_solicitud_web_resolucion,crm_oportunidad_consulta_web,crm_solicitud_web');
    const password = randomBytes(24).toString('hex');
    const hash = await require('bcrypt').hash(password, 10);
    const users = {};
    for (const [label, role] of [['admin', 'admin'], ['owner', 'user'], ['other', 'user']]) {
      const username = 'webverify_' + label + '_' + randomBytes(4).toString('hex');
      const row = (await writer.query(`INSERT INTO auth_user(username,password_hash,role,is_active,token_version)
        VALUES($1,$2,$3,true,0) RETURNING id_user`, [username, hash, role])).rows[0];
      users[label] = { username, id: row.id_user };
    }
    const key = randomBytes(32);
    for (const field of bridgeEnvironmentKeys) delete process.env[field];
    Object.assign(process.env, { DATABASE_URL: isolatedUrl.toString(), DB_NAME: database, NODE_ENV: 'test',
      JWT_SECRET: randomBytes(32).toString('hex'), ALLOW_ENV_AUTH: 'false', FISCAL_MODE: 'mock',
      WEB_LEAD_BRIDGE_ENABLED: 'true', WEB_LEAD_BRIDGE_KEY: key.toString('base64'),
      WEB_LEAD_PRIVACY_VERSION: 'fixture-auth-v1', WEB_INBOX_PURGE_ENABLED: 'false' });
    stage = 'AppModule';
    const module = await Test.createTestingModule({ imports: [require('./dist/app.module').AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    require('./dist/configure-app').configureApp(app);
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name, database);
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl();
    checked('AppModule completo, guards globales, fiscal mock y cron detenido en copia');
    const apiCall = async (route, token, status, method = 'GET', body) => {
      const response = await fetch(api + '/api/v1/' + route, { method,
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, status, method + ' ' + route);
      return response;
    };
    stage = 'Autenticación';
    for (const user of Object.values(users)) {
      const result = await apiCall('auth/login', null, 201, 'POST', { username: user.username, password });
      user.token = (await result.json()).access_token;
      assert.equal((await (await apiCall('auth/me', user.token, 200)).json()).idUser, user.id);
    }
    const inbox = 'crm/solicitudes-web';
    for (const [route, method, body] of [[inbox, 'GET'], [inbox + '/' + requestId + '/estado', 'GET'],
      [inbox + '/' + requestId, 'PATCH', { estado: 'Revisada', expectedVersion: 1 }],
      [inbox + '/' + requestId + '/convertir', 'POST', { expectedVersion: 1 }],
      [inbox + '/purgar-vencidas', 'POST'], [inbox + '/mantenimiento', 'GET'], [inbox + '/puente', 'GET'],
      [inbox + '/' + requestId + '/resoluciones', 'GET'], [inbox + '/' + requestId + '/resolver', 'POST',
        { operationId: randomUUID(), motivo: 'Clave', expectedVersion: 1, originalVerificado: true }]]) {
      await apiCall(route, null, 401, method, body);
      await apiCall(route, users.other.token, 403, method, body);
    }
    const forged = users.admin.token.slice(0, -5) + 'AAAAA';
    await apiCall(inbox, forged, 401);
    await apiCall(inbox + '/invalid/estado', users.admin.token, 400);
    await apiCall(inbox + '/' + requestId + '/estado', users.admin.token, 404);
    checked('Login PostgreSQL real; anónimo401, operador403, JWT alterado401 y UUID inválido400');

    stage = 'Formulario público';
    const { createLeadBridge } = await import('../public-web/lead-bridge.mjs');
    const bridge = createLeadBridge(api, key);
    await apiCall('web-lead-bridge', null, 401, 'POST', {});
    const { build, pagesForCatalog } = await import('../public-web/build.mjs');
    const { createPreviewServer } = await import('../public-web/server.mjs');
    const products = ['a', 'b'].map(letter => ({ slug: 'fixture-' + letter, code: 'OEM-' + letter.toUpperCase(),
      status: 'published', approved: true, brand: 'Marca fixture', category: 'Familia fixture',
      title: 'Pieza fixture ' + letter, description: 'Prueba aislada, sin publicación comercial',
      applications: [], references: [], specifications: [] }));
    directory = await fsp.mkdtemp(path.join(tmpdir(), 'rtt-web-auth-'));
    await build(directory, pagesForCatalog(products), products);
    const receipt = new Promise(resolve => { releaseReceipt = resolve; });
    let committed = false;
    const intake = { privacyApproved: true, privacyVersion: 'fixture-auth-v1',
      privacyText: 'Aviso fixture aislado, sin validez como política comercial.', key, origin: 'http://127.0.0.1',
      storageTimeoutMs: 1000, receive: async (lead, fingerprint) => {
        await bridge(lead, fingerprint); committed = true; await receipt;
      } };
    publicServer = await createPreviewServer(directory, { intake });
    publicServer.listen(0, '127.0.0.1'); await once(publicServer, 'listening');
    intake.origin = 'http://127.0.0.1:' + publicServer.address().port;
    erpServer = erpPreview(api, angular);
    erpServer.listen(0, '127.0.0.1'); await once(erpServer, 'listening');
    const erp = 'http://127.0.0.1:' + erpServer.address().port;
    process.env.CORS_ORIGINS=erp;
    browser = await chromium.launch();
    const allowed = new Set([erp, intake.origin]);
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(intake.origin + '/solicitar?producto=fixture-a&cantidad=2&piezas=OEM-B%20%7C%204');
    await page.locator('[name=requestId]').evaluate((element, id) => { element.value = id; }, requestId);
    await page.getByLabel('Nombre de contacto').fill(contactName);
    await page.getByLabel('Correo o teléfono internacional').fill('acceptance@example.com');
    await page.getByText('Pieza 3 (opcional)', { exact: true }).click();
    await page.locator('[name=code3]').fill('LIBRE-FIXTURE');
    await page.locator('[name=quantity3]').fill('3');
    await page.locator('[name=privacyAccepted]').check();
    const nativeBody = await page.locator('form').evaluate(element => new URLSearchParams(new FormData(element)).toString());
    const submission = page.waitForResponse(response => response.url().endsWith('/solicitudes'));
    await page.getByRole('button', { name: 'Enviar solicitud' }).click();
    assert.equal((await submission).status(), 503);
    assert.ok(committed);
    await expect(page.getByRole('alert')).toContainText('pudo haber quedado registrado');
    await expect(page.locator('[name=requestId]')).toHaveValue(requestId);
    await expect(page.locator('[name=value]')).toHaveValue('acceptance@example.com');
    await expect(page.locator('[name=quantity2]')).toHaveValue('4');
    const metadata = await apiCall(inbox + '/' + requestId + '/estado', users.admin.token, 200);
    assert.equal(metadata.headers.get('cache-control'), 'no-store');
    const status = await metadata.json();
    assert.deepEqual(Object.keys(status).sort(), ['requestId', 'estado', 'version', 'createdAt', 'expiresAt', 'contenido', 'idOportunidad'].sort());
    assert.equal(status.contenido, 'Vigente');
    releaseReceipt();
    const { leadFromForm } = await import('../public-web/lead-form.mjs');
    const { validateLead } = await import('../public-web/lead-contract.mjs');
    const storedLead = validateLead(leadFromForm(nativeBody), { schemaVersion: 1, products }, intake.privacyVersion);
    await verifyBridgeRotation(api, key, storedLead,
      async () => (await writer.query('SELECT payload,fingerprint,expires_at,estado,id_oportunidad FROM crm_solicitud_web WHERE request_id=$1', [requestId])).rows[0]);
    Object.assign(intake, await verifyIntakeProfile(api, intake.origin, async () => (await writer.query(`SELECT
      (SELECT count(*) FROM crm_solicitud_web) leads, (SELECT count(*) FROM crm_oportunidad) opportunities,
      (SELECT count(*) FROM crm_oportunidad_consulta_web) snapshots, (SELECT count(*) FROM crm_solicitud_web_resolucion) decisions`)).rows[0]));
    checked('Perfil explícito local y preflight firmado sin escrituras; formulario reintenta con adaptador preparado');
    const bridgeState = await apiCall(inbox + '/puente', users.admin.token, 200);
    assert.equal(bridgeState.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await bridgeState.json(), { enabled: true, configured: true, mode: 'v2', activeKeyId: 'fixture-3', previous: null });
    checked('Rotación legacy/v2 y segunda rotación v2; reintentos históricos estables y diagnóstico privado sin secretos');
    const postNative = body => fetch(intake.origin + '/solicitudes', { method: 'POST',
      headers: { Origin: intake.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body, signal: AbortSignal.timeout(15000) });
    const replies = await Promise.all([postNative(nativeBody), postNative(nativeBody)]);
    for (const response of replies) { assert.equal(response.status, 202); await response.text(); }
    const changed = new URLSearchParams(nativeBody); changed.set('quantity2', '5');
    const conflict = await postNative(changed.toString());
    assert.equal(conflict.status, 503); await conflict.text();
    const stored = (await writer.query('SELECT payload FROM crm_solicitud_web WHERE request_id=$1', [requestId])).rows;
    assert.equal(stored.length, 1); assert.equal(stored[0].payload.items[1].quantity, 4);
    checked('Formulario nativo sin JS → puente firmado → commit sin recibo → diagnóstico ADMIN → reintentos y conflicto');
    await context.close();

    stage = 'UI autenticada';
    let opportunity;
    const authenticatedScreens = new Map();
    for (const theme of ['light', 'dark']) {
      const width = theme === 'dark' ? 390 : 1280;
      const ui = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await ui.route('**/*', route => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
      await ui.addInitScript(value => localStorage.setItem('theme', value), theme);
      const screen = await ui.newPage();
      await screen.goto(erp + '/login');
      await screen.getByLabel('Usuario', { exact: true }).fill(users.admin.username);
      await screen.getByLabel('Contraseña', { exact: true }).fill(password);
      await screen.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(screen).toHaveURL(/dashboard/, { timeout: 20000 });
      await screen.goto(erp + '/crm');
      await screen.getByRole('tab', { name: 'Solicitudes web' }).click();
      const panel = screen.locator('app-crm-solicitudes-web');
      await panel.getByText('Estado del puente de recepción', { exact: true }).click();
      await panel.getByRole('button', { name: 'Consultar configuración del puente' }).click();
      await expect(panel.locator('.bridge-check')).toContainText('ID de firma activa: fixture-3');
      await expect(panel.getByRole('heading', { name: contactName, exact: true })).toBeVisible();
      await panel.getByLabel('Identificador de solicitud', { exact: true }).fill(requestId);
      await panel.getByRole('button', { name: 'Consultar estado' }).click();
      await expect(panel.locator('.receipt-check')).toContainText('Registro encontrado');
      if (!opportunity) {
        await panel.getByLabel('Responsable de las nuevas oportunidades').selectOption({ label: users.owner.username });
        const conversion = screen.waitForResponse(response => response.url().endsWith('/convertir') && response.request().method() === 'POST');
        await panel.getByRole('button', { name: 'Crear oportunidad: ' + contactName, exact: true }).click();
        const response = await conversion; assert.equal(response.status(), 201);
        opportunity = (await response.json()).idOportunidad;
      }
      await expect(panel.getByText('Oportunidad CRM #' + opportunity, { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Crear oportunidad: ' + contactName })).toHaveCount(0);
      await panel.getByRole('button', { name: 'Consultar estado' }).click();
      await expect(panel.locator('.receipt-check')).toContainText('Oportunidad vinculada en CRM: #' + opportunity);
      await panel.getByLabel('Motivo de la revisión').selectOption('Clave');
      await panel.getByRole('checkbox', { name: /Comprobé el estado/ }).check();
      const decisionResponse = screen.waitForResponse(response => response.url().endsWith('/resolver') && response.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Guardar decisión: conservar original' }).click();
      assert.equal((await decisionResponse).status(), 201);
      await expect(panel.locator('.resolution-panel')).toContainText('Decisión registrada');
      await expect(panel.locator('.resolution-panel li').first()).toContainText('Conservar original · Clave');
      const a11y = await new AxeBuilder({ page: screen }).include('app-crm-solicitudes-web').analyze();
      assert.deepEqual(a11y.violations.map(item => item.id), [], 'Accesibilidad bandeja ' + theme);
      assert.ok(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Reflujo ' + theme);
      await panel.getByRole('link', { name: 'Buscar oportunidad en CRM' }).click();
      await screen.getByRole('button', { name: contactName, exact: true }).click();
      await expect(screen.getByRole('heading', { name: 'Consulta web original' })).toBeVisible();
      await expect(screen.getByText('LIBRE-FIXTURE', { exact: true })).toBeVisible();
      report.browser.push({ theme, width, login: 'real', bridgeStatus: 'passed', receipt: 'passed', resolution: 'passed', conversionLink: 'passed', snapshot: 'passed', axeViolations: 0 });
      authenticatedScreens.set(theme, { ui, screen });
    }
    checked('Angular producción claro1280/oscuro390: login, bandeja, diagnóstico, conversión, ficha, Axe y reflujo');

    stage = 'Integridad y revocación';
    const repeat = await Promise.all([apiCall(inbox + '/' + requestId + '/convertir', users.admin.token, 201, 'POST', { expectedVersion: 1 }),
      apiCall(inbox + '/' + requestId + '/convertir', users.admin.token, 201, 'POST', { expectedVersion: 1, idResponsable: users.other.id })]);
    for (const response of repeat) assert.equal((await response.json()).idOportunidad, opportunity);
    const snapshotRoute = 'crm/oportunidades/' + opportunity + '/consulta-web';
    const snapshot = await (await apiCall(snapshotRoute, users.owner.token, 200)).json();
    assert.deepEqual(snapshot.piezas, stored[0].payload.items);
    await apiCall(snapshotRoute, users.other.token, 404);
    await apiCall(snapshotRoute, null, 401);
    const counts = (await writer.query(`SELECT
      (SELECT count(*)::int FROM crm_oportunidad_consulta_web WHERE request_id=$1) snapshots,
      (SELECT count(*)::int FROM crm_seguimiento WHERE id_oportunidad=$2) seguimientos,
      (SELECT id_responsable FROM crm_oportunidad WHERE id_oportunidad=$2) owner,
      (SELECT id_autor FROM crm_oportunidad_consulta_web WHERE request_id=$1) author`, [requestId, opportunity])).rows[0];
    assert.deepEqual(counts, { snapshots: 1, seguimientos: 1, owner: users.owner.id, author: users.admin.id });
    const historyResponse = await apiCall(inbox + '/' + requestId + '/resoluciones', users.admin.token, 200);
    assert.equal(historyResponse.headers.get('cache-control'), 'no-store');
    const decisions = await historyResponse.json(); assert.equal(decisions.length, 2);
    const decision = decisions[0];
    const decisionBody = { operationId: decision.operationId, motivo: decision.motivo,
      expectedVersion: decision.expectedVersion, originalVerificado: true };
    const repeatedDecisions = await Promise.all([apiCall(inbox + '/' + requestId + '/resolver', users.admin.token, 201, 'POST', decisionBody),
      apiCall(inbox + '/' + requestId + '/resolver', users.admin.token, 201, 'POST', decisionBody)]);
    for (const response of repeatedDecisions) assert.deepEqual(await response.json(), decision);
    await apiCall(inbox + '/' + requestId + '/resolver', users.admin.token, 409, 'POST', { ...decisionBody, motivo: 'Contenido' });
    await apiCall(inbox + '/' + requestId + '/resolver', users.admin.token, 400, 'POST', { ...decisionBody, originalVerificado: false });
    const stillConflict = await postNative(changed.toString()); assert.equal(stillConflict.status, 503); await stillConflict.text();
    await writer.query("UPDATE crm_solicitud_web SET expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1", [requestId]);
    assert.equal((await (await apiCall(inbox + '/' + requestId + '/estado', users.admin.token, 200)).json()).contenido, 'Vencido');
    assert.deepEqual(await (await apiCall(inbox, users.admin.token, 200)).json(), []);
    assert.equal((await (await apiCall(inbox + '/purgar-vencidas', users.admin.token, 201, 'POST')).json()).purged, 1);
    const purged = await (await apiCall(inbox + '/' + requestId + '/estado', users.admin.token, 200)).json();
    assert.equal(purged.contenido, 'Purgado'); assert.equal(purged.idOportunidad, opportunity);
    assert.ok(!JSON.stringify(purged).includes('acceptance@example.com'));
    const afterPurge = await (await apiCall(inbox + '/' + requestId + '/resolver', users.admin.token, 201, 'POST', {
      operationId: randomUUID(), motivo: 'Catalogo', expectedVersion: purged.version, originalVerificado: true,
    })).json();
    assert.equal(afterPurge.contenido, 'Purgado'); assert.equal(afterPurge.idOportunidad, opportunity);
    const purgedRetries = await Promise.all([postNative(nativeBody), postNative(nativeBody)]);
    for (const response of purgedRetries) { assert.equal(response.status, 202); await response.text(); }
    assert.equal((await writer.query('SELECT payload FROM crm_solicitud_web WHERE request_id=$1', [requestId])).rows[0].payload, null);
    assert.deepEqual((await (await apiCall(snapshotRoute, users.owner.token, 200)).json()).piezas, snapshot.piezas);
    stage = 'Trazabilidad comercial WEB05.2b';
    const quote = (await writer.query(`SELECT q.id_cotizacion,q.id_cliente FROM cotizacion q WHERE q.id_cliente IS NOT NULL
      ORDER BY EXISTS(SELECT 1 FROM factura f WHERE f.id_cotizacion=q.id_cotizacion AND f.id_cliente=q.id_cliente
        AND f.tipo_comprobante='I' AND f.estatus::text NOT IN ('Cancelada','Cancelado') AND f.serie<>'G') DESC,q.id_cotizacion LIMIT 1`)).rows[0];
    assert.ok(quote, 'El respaldo de prueba requiere al menos una cotización asociada a un cliente ERP');
    const commercialRoute = 'crm/oportunidades/' + opportunity + '/documentos-comerciales';
    await apiCall(commercialRoute, null, 401); await apiCall(commercialRoute, users.other.token, 404);
    const beforeLink = (await writer.query('SELECT * FROM cotizacion WHERE id_cotizacion=$1', [quote.id_cotizacion])).rows[0];
    const state = await (await apiCall(commercialRoute, users.owner.token, 200)).json();
    const clientLink = await (await apiCall(commercialRoute + '/cliente', users.owner.token, 200, 'PUT', {
      idCliente: quote.id_cliente, expectedVersion: state.opportunity.version, confirmado: true,
    })).json();
    const linkBody = { expectedVersion: clientLink.version, confirmado: true };
    const linkRoute = commercialRoute + '/cotizaciones/' + quote.id_cotizacion;
    const commercialLink = await (await apiCall(linkRoute, users.owner.token, 200, 'PUT', linkBody)).json();
    assert.deepEqual(await (await apiCall(linkRoute, users.owner.token, 200, 'PUT', linkBody)).json(), commercialLink);
    const list = await (await apiCall(commercialRoute, users.owner.token, 200)).json();
    assert.equal(list.quotes.length, 1); assert.equal(list.quotes[0].idCotizacion, quote.id_cotizacion);
    stage = 'Devoluciones y cobros netos WEB05.2e';
    report.webCashBusiness = await require('./test-support/web-refund-acceptance').verifyRefundAcceptance({
      writer,apiCall,admin:users.admin,other:users.other,
      inboxService:app.get(require('./dist/crm/crm-solicitudes-web.service').CrmSolicitudesWebService),checked,
    });
    const measurement = await (await apiCall(inbox + '/metricas?desde=2026-10-01&hasta=2026-10-31', users.admin.token, 200)).json();
    assert.equal(measurement.commercial.cotizacionesVinculadas, 1);
    stage = 'Medición financiera WEB05.2c';
    assert.ok(measurement.finance && Array.isArray(measurement.finance.currencies));
    assert.equal(measurement.finance.coverage.documentosVinculados, measurement.commercial.documentosVentaVigentes);
    const expectedAmounts = (await writer.query(`SELECT f.moneda,count(*)::int AS documents,sum(f.total)::numeric(30,2)::text AS total
      FROM factura f LEFT JOIN pedido_venta p ON p.id_pedido=f.id_pedido
      WHERE f.tipo_comprobante='I' AND (f.id_cotizacion=$1 OR p.id_cotizacion=$1) AND f.id_cliente=$2
        AND f.estatus::text NOT IN ('Cancelada','Cancelado')
        AND (p.id_pedido IS NULL OR(p.id_cliente=$2 AND p.estado<>'Cancelado'))
        AND (f.id_cotizacion IS NULL OR p.id_cotizacion IS NULL OR f.id_cotizacion=p.id_cotizacion)
        AND NOT EXISTS(SELECT 1 FROM fiscal_documento fd WHERE fd.id_factura=f.id_factura AND fd.estado='Cancelado')
        AND f.serie<>'G' AND NOT EXISTS(SELECT 1 FROM factura t WHERE t.id_factura_global=f.id_factura)
        AND f.moneda ~ '^[A-Z]{3}$' AND f.moneda<>'XXX'
      GROUP BY f.moneda ORDER BY f.moneda`, [quote.id_cotizacion,quote.id_cliente])).rows;
    assert.ok(expectedAmounts.length, 'La aceptación financiera requiere una cotización con venta en el respaldo de prueba');
    for (const row of expectedAmounts) {
      const money = measurement.finance.currencies.find(item => item.moneda===row.moneda);
      assert.ok(money); assert.equal(money.documentos,row.documents);
      if (money.importeDocumentado!==null) assert.equal(money.importeDocumentado,row.total);
      for (const key of ['importeDocumentado','ventasNetasSinImpuestos','notasCredito','devoluciones','cobrosRegistrados','saldoRegistrado'])
        assert.ok(money[key]===null || /^\d+\.\d{2}$/.test(money[key]));
      assert.ok(money.profit); assert.equal(money.profit.baseCosto,'snapshot-local-MXN');
      assert.equal(money.profit.documentosConRentabilidad+money.profit.documentosRentabilidadDesconocida,money.documentos);
      for (const key of ['costoVentaNeto','utilidadBruta','margenBrutoPct'])
        assert.ok(money.profit[key]===null || /^-?\d+\.\d{2}$/.test(money.profit[key]));
      assert.equal(money.cash.baseMonetaria,'registros-locales-MXN');
      assert.equal(money.cash.documentosConCobroNeto+money.cash.documentosCobroNetoDesconocido,money.documentos);
      for (const key of ['reembolsosEfectivo','saldoAFavorGenerado','cobrosNetosRegistrados'])
        assert.ok(money.cash[key]===null || /^-?\d+\.\d{2}$/.test(money.cash[key]));
    }
    for (const theme of ['light','dark']) {
      // Reuse the two real sessions established above. Extra logins would hit
      // the application's intended 5/minute auth limit; never weaken that guard.
      const { ui, screen } = authenticatedScreens.get(theme);
      await screen.goto(erp+'/crm'); await screen.getByRole('tab',{name:'Solicitudes web'}).click();
      const panel = screen.locator('app-crm-web-metrics'); await panel.getByText('Medición de solicitudes',{exact:true}).click();
      await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByLabel('Recibidas hasta').fill('2026-10-31');
      const response = screen.waitForResponse(reply=>new URL(reply.url()).pathname.endsWith('/solicitudes-web/metricas'));
      await panel.getByRole('button',{name:'Consultar medición'}).click(); assert.deepEqual((await (await response).json()).finance,measurement.finance);
      await panel.getByText('Importes y cobros por moneda',{exact:true}).click();
      await expect(panel.locator('.currency')).toHaveCount(measurement.finance.currencies.length);
      for (const money of measurement.finance.currencies) {
        const currency = panel.getByRole('region',{name:'Importes en '+money.moneda});
        await expect(currency).toContainText(money.moneda);
        if (money.ventasNetasSinImpuestos===null) await expect(currency).toContainText('Por conciliar');
        await currency.getByText('Cobros netos y reembolsos en '+money.moneda,{exact:true}).click();
        const cashPanel=panel.getByRole('region',{name:'Cobros netos en '+money.moneda});
        await expect(cashPanel).toContainText('Saldo a favor generado, sin salida de efectivo');
        if (money.cash.cobrosNetosRegistrados===null) await expect(cashPanel).toContainText('Por conciliar');
        await cashPanel.screenshot({path:path.join(root,'.artifacts','web-cash-auth-'+theme+'.png')});
        await currency.getByText('Rentabilidad de las ventas en '+money.moneda,{exact:true}).click();
        const profitPanel = panel.getByRole('region',{name:'Rentabilidad en '+money.moneda});
        await expect(profitPanel).toContainText('Costo histórico neto');
        if (money.profit.utilidadBruta===null) await expect(profitPanel).toContainText('Por conciliar');
        await profitPanel.screenshot({path:path.join(root,'.artifacts','web-profit-auth-'+theme+'.png')});
      }
      expect((await new AxeBuilder({page:screen}).include('app-crm-web-metrics').analyze()).violations).toEqual([]);
      assert.ok(await screen.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await panel.locator('.finance').evaluate(element=>element.scrollIntoView({block:'start'}));
      await screen.screenshot({path:path.join(root,'.artifacts','web-financial-auth-'+theme+'.png'),fullPage:true}); await ui.close();
    }
    report.webFinancial = { passed:true,app:'complete-AppModule',source:'restored-test-database',
      privateHttp:true,productionAngular:true,realLogin:true,apiMocks:false,uiThemes:['light','dark'],finance:measurement.finance };
    checked('WEB05.2c con tablas completas/venta del respaldo: HTTP privado, importes/monedas y Angular producción claro/oscuro con login real');
    report.webProfit = {passed:true,source:'restored-test-database',realLogin:true,apiMocks:false,
      currencies:measurement.finance.currencies.map(row=>({moneda:row.moneda,documents:row.documentos,profit:row.profit}))};
    checked('WEB05.2d en AppModule/copia: snapshots reales, cobertura de rentabilidad y panel Angular con desconocidos explícitos');
    report.webCashUI={passed:true,realLogin:true,apiMocks:false,productionAngular:true,uiThemes:['light','dark'],
      currencies:measurement.finance.currencies.map(row=>({moneda:row.moneda,cash:row.cash}))};
    checked('WEB05.2e con venta histórica del respaldo y Angular producción claro/oscuro: cobertura de cobro neto y desconocidos sin asumir cero');
    await apiCall(linkRoute + '/retirar', users.owner.token, 200, 'PUT', { expectedVersion: commercialLink.version, confirmado: true });
    assert.deepEqual((await writer.query('SELECT * FROM cotizacion WHERE id_cotizacion=$1', [quote.id_cotizacion])).rows[0], beforeLink);
    report.webCommercial = { passed: true, schema: 'restored-with-092', app: 'complete-AppModule', ownerAccess: true,
      userIsolation: true, clientMatch: true, idempotency: true, metrics: true, withdrawalPreservesQuote: true };
    checked('WEB05.2b en AppModule/copia restaurada: cliente, cotización, dueño/tercero, reintento, métricas y retiro sin alterar el documento');
    await apiCall('auth/logout', users.admin.token, 201, 'POST');
    await apiCall(inbox, users.admin.token, 401);
    await writer.query('UPDATE auth_user SET is_active=false WHERE id_user=$1', [users.owner.id]);
    await apiCall(snapshotRoute, users.owner.token, 401);
    checked('Conversión única, autor/responsable, snapshot privado, vencimiento/purga y revocación/logout reales');
    checked('Decisiones ADMIN idempotentes y sin sobrescribir huella/payload; historial sin contactos y resolución de purgado sin restaurar');
    report.completedAt = new Date().toISOString(); report.passed = true;
  } finally {
    releaseReceipt?.();
    const cleanup = await Promise.allSettled([browser?.close(), closeServer(publicServer), closeServer(erpServer), app?.close()]);
    if (writer) await writer.end();
    if (created && /^verify_web_auth_[a-f0-9]{16}$/.test(database)) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
      await admin.query(`DROP DATABASE "${database}"`);
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
      report.copyRemoved = true;
    }
    await admin.end();
    if (directory) {
      const target = path.resolve(directory);
      assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep + 'rtt-web-auth-'));
      await fsp.rm(target, { recursive: true, force: true });
    }
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    report.lastStage = stage;
    report.cleanupPassed = cleanup.every(result => result.status === 'fulfilled');
    const artifacts = path.join(root, '.artifacts'); await fsp.mkdir(artifacts, { recursive: true });
    await fsp.writeFile(path.join(artifacts, 'web-inbox-auth-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
    assert.ok(report.cleanupPassed, 'Falló cierre de recursos propios');
  }
  console.log('Aceptación autenticada local aprobada; copia eliminada. Reporte sanitizado: .artifacts/web-inbox-auth-acceptance.json');
}
main().catch(error => {
  const code=error.code ?? error.driverError?.code;
  console.error('Falló aceptación web/CRM:', error instanceof assert.AssertionError ? error.message : error.name,
    typeof code==='string' && /^[A-Z0-9]{5}$/.test(code) ? 'SQLSTATE '+code : '',
    'Consulta la etapa del reporte; no se imprimen credenciales, tokens o respuestas privadas.');
  process.exitCode = 1;
});
