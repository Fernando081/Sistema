'use strict';
// O04 · node --test scripts/release.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const lib = require('./release-lib');
const { createReleaseServer } = require('./release-server');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'release-test-'));

test('identificador de versión estable y validado', () => {
  const id = lib.releaseId(new Date(2026, 9, 28, 9, 5, 7), 'abcdef1234567');
  assert.equal(id, '20261028-090507-abcdef1');
  assert.equal(lib.assertReleaseId(id), id);
  assert.throws(() => lib.assertReleaseId('../x'));
  assert.throws(() => lib.releaseId(new Date(), 'zz'));
});

test('el manifiesto detecta archivos alterados, faltantes y agregados', () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'uno.js'), '1');
  fs.writeFileSync(path.join(dir, 'dos.txt'), '2');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
  const files = lib.hashTree(dir, ['node_modules']);
  assert.deepEqual(Object.keys(files), ['a/uno.js', 'dos.txt']);
  assert.deepEqual(lib.compareTree(files, lib.hashTree(dir, ['node_modules'])), []);
  fs.writeFileSync(path.join(dir, 'a', 'uno.js'), 'cambiado');
  fs.rmSync(path.join(dir, 'dos.txt'));
  fs.writeFileSync(path.join(dir, 'tres.txt'), '3');
  assert.deepEqual(lib.compareTree(files, lib.hashTree(dir, ['node_modules'])).sort(), ['Agregado tres.txt', 'Falta dos.txt', 'Modificado a/uno.js']);
  const manifest = { id: 'x', files };
  manifest.digest = lib.manifestDigest(manifest);
  assert.equal(lib.manifestDigest(manifest), manifest.digest);
  assert.notEqual(lib.manifestDigest({ ...manifest, dirty: true }), manifest.digest);
});

test('paquetes requeridos por el código compilado', () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'require("@nestjs/mapped-types");require("node:fs");require("path");require("./b");');
  fs.writeFileSync(path.join(dir, 'sub', 'c.js'), "const x = require('pg/lib/client'); require('@nestjs/core');");
  fs.writeFileSync(path.join(dir, 'd.d.ts'), 'require("ignorado")');
  assert.deepEqual(lib.runtimeRequires(dir), ['@nestjs/core', '@nestjs/mapped-types', 'pg']);
});

test('compatibilidad de esquema: pendientes y desconocidas', () => {
  assert.deepEqual(lib.schemaCompatibility(['1.sql', '2.sql', '3.sql'], ['1.sql', '2.sql']), { pendientes: ['3.sql'], desconocidas: [] });
  assert.deepEqual(lib.schemaCompatibility(['1.sql'], ['1.sql', '2.sql']), { pendientes: [], desconocidas: ['2.sql'] });
});

test('la base de staging nunca es la de trabajo', () => {
  assert.equal(lib.stagingDbName('postgres'), 'postgres_staging');
  assert.equal(lib.stagingDbName('postgres', 'erp_staging'), 'erp_staging');
  assert.throws(() => lib.stagingDbName('postgres', 'postgres'));
  assert.throws(() => lib.stagingDbName('postgres', 'otra'));
  assert.throws(() => lib.stagingDbName('postgres', 'x"; DROP_staging'));
});

test('staging fuerza fiscal mock, correo apagado, base y carpeta propias', () => {
  const base = { DB_NAME: 'postgres', FISCAL_MODE: 'sandbox', PAC_SW_TOKEN: 'secreto', MAIL_MODE: 'smtp', SMTP_PASSWORD: 'x', WEB_LEAD_BRIDGE_ENABLED: 'true', CORS_ORIGINS: 'http://127.0.0.1:4200' };
  const env = lib.processEnv(base, 'staging', { backendPort: 3210, frontendPort: 4310, uploads: 'C:/s/uploads', dbName: 'postgres_staging' });
  assert.equal(env.DB_NAME, 'postgres_staging');
  assert.equal(env.FISCAL_MODE, 'mock');
  assert.equal(env.PAC_SW_TOKEN, '');
  assert.equal(env.MAIL_MODE, 'desactivado');
  assert.equal(env.SMTP_PASSWORD, '');
  assert.equal(env.WEB_LEAD_BRIDGE_ENABLED, 'false');
  assert.equal(env.CORS_ORIGINS, 'http://127.0.0.1:4310,http://localhost:4310');
  assert.equal(env.UPLOAD_DIRECTORY, 'C:/s/uploads');
  assert.equal(base.FISCAL_MODE, 'sandbox', 'no altera el objeto original');
  const url = lib.processEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/erp' }, 'staging', { backendPort: 3210, frontendPort: 4310, uploads: 'u', dbName: 'erp_staging' });
  assert.equal(new URL(url.DATABASE_URL).pathname, '/erp_staging');
});

test('producción conserva la configuración y agrega su origen local', () => {
  const env = lib.processEnv({ DB_NAME: 'postgres', FISCAL_MODE: 'mock', CORS_ORIGINS: 'http://127.0.0.1:4200' }, 'produccion', { backendPort: 3100, frontendPort: 4300, uploads: 'C:/up' });
  assert.equal(env.DB_NAME, 'postgres');
  assert.equal(env.PORT, '3100');
  assert.equal(env.CORS_ORIGINS, 'http://127.0.0.1:4200,http://127.0.0.1:4300,http://localhost:4300');
  assert.throws(() => lib.processEnv({ NODE_ENV: 'production' }, 'produccion', { backendPort: 3100, frontendPort: 4300, uploads: 'u' }), /HTTPS/);
});

test('puertos válidos y distintos', () => {
  assert.deepEqual(lib.environmentPorts({}), { produccion: { backend: 3100, frontend: 4300 }, staging: { backend: 3210, frontend: 4310 } });
  assert.throws(() => lib.environmentPorts({ STAGING_BACKEND_PORT: '3100' }), /distintos/);
  assert.throws(() => lib.environmentPorts({ RELEASE_FRONTEND_PORT: '80' }), /inválido/);
  assert.throws(() => lib.assertLoopback('0.0.0.0'), /loopback/);
});

test('un despliegue exige staging aprobado de la misma versión', () => {
  const manifest = { id: '20261028-090507-abcdef1', digest: 'd1', dirty: false };
  const state = lib.emptyState();
  assert.match(lib.deployBlockers(state, manifest).join(), /no ha pasado staging/);
  state.staging.resultado = { release: manifest.id, digest: 'otro', ok: true };
  assert.match(lib.deployBlockers(state, manifest).join(), /no ha pasado staging/, 'la huella también debe coincidir');
  state.staging.resultado.digest = 'd1';
  assert.deepEqual(lib.deployBlockers(state, manifest), []);
  state.staging.resultado.ok = false;
  assert.match(lib.deployBlockers(state, manifest, { omitirStaging: true }).join(), /--motivo/);
  assert.deepEqual(lib.deployBlockers(state, manifest, { omitirStaging: true, motivo: 'Corrección urgente de caja' }), []);
  assert.match(lib.deployBlockers({ ...state, staging: { resultado: { release: manifest.id, digest: 'd1', ok: true } } }, { ...manifest, dirty: true }).join(), /sin commit/);
  state.staging.resultado.ok = true;
  state.produccion.actual = manifest.id;
  assert.match(lib.deployBlockers(state, manifest).join(), /ya es la actual/);
  assert.deepEqual(lib.deployBlockers(state, manifest, { reinstalar: true }), []);
});

test('rollback a la anterior o a la indicada', () => {
  const state = lib.emptyState();
  assert.throws(() => lib.rollbackTarget(state), /No hay versión anterior/);
  state.produccion = { actual: '20261028-090507-abcdef1', anterior: '20261027-090507-1234567' };
  assert.equal(lib.rollbackTarget(state), '20261027-090507-1234567');
  assert.throws(() => lib.rollbackTarget(state, '20261028-090507-abcdef1'), /ya es la actual/);
});

test('retiro de versiones conserva actual, anterior y staging', () => {
  const ids = ['20261001-000000-aaaaaaa', '20261002-000000-bbbbbbb', '20261003-000000-ccccccc', '20261004-000000-ddddddd', 'state.json', 'run'];
  const state = lib.emptyState();
  state.produccion = { actual: '20261004-000000-ddddddd', anterior: '20261001-000000-aaaaaaa' };
  assert.deepEqual(lib.releasesToPrune(ids, state, 2), ['20261002-000000-bbbbbbb']);
});

test('estado se escribe de forma atómica y valida su formato', () => {
  const file = path.join(temp(), 'state.json');
  assert.deepEqual(lib.readState(file), lib.emptyState());
  const state = lib.emptyState();
  state.produccion.actual = '20261004-000000-ddddddd';
  lib.writeState(file, state);
  assert.equal(lib.readState(file).produccion.actual, '20261004-000000-ddddddd');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
  assert.throws(() => lib.readState(file), /no reconocido/);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function request(port, pathName, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('servidor de la versión: archivos, rutas de la app, proxy y cabeceras', async () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><app-root></app-root></html>');
  fs.writeFileSync(path.join(dir, 'main-ABCDEFGH.js'), 'console.log(1)');
  fs.writeFileSync(path.join(path.dirname(dir), 'secreto.txt'), 'no');
  const seen = [];
  const backend = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, body, xff: req.headers['x-forwarded-for'], proto: req.headers['x-forwarded-proto'], cookie: req.headers.cookie });
      res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'erp_session=1; Path=/api/v1' });
      res.end('{"ok":true}');
    });
  });
  const backendPort = await listen(backend);
  const server = createReleaseServer({ root: dir, backendPort, release: '20261028-090507-abcdef1' });
  const port = await listen(server);
  try {
    const home = await request(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /app-root/);
    assert.equal(home.headers['cache-control'], 'no-cache');
    assert.equal(home.headers['x-frame-options'], 'DENY');
    const asset = await request(port, '/main-ABCDEFGH.js');
    assert.match(asset.headers['cache-control'], /immutable/);
    assert.match(asset.headers['content-type'], /javascript/);
    assert.match((await request(port, '/facturas/12')).body, /app-root/);
    assert.equal((await request(port, '/no-existe.js')).status, 404);
    assert.equal((await request(port, '/..%2fsecreto.txt')).status, 404);
    assert.equal((await request(port, '/%E0%A4%A')).status, 400);
    assert.equal((await request(port, '/', { method: 'POST' })).status, 405);
    assert.deepEqual(JSON.parse((await request(port, '/__version')).body), { release: '20261028-090507-abcdef1' });
    const api = await request(port, '/api/v1/venta?x=1', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json', Cookie: 'erp_session=abc', 'X-Forwarded-For': '10.0.0.9' } });
    assert.equal(api.status, 201);
    assert.equal(api.headers['set-cookie'][0], 'erp_session=1; Path=/api/v1');
    assert.deepEqual(seen[0], { url: '/api/v1/venta?x=1', method: 'POST', body: '{"a":1}', xff: '127.0.0.1', proto: 'http', cookie: 'erp_session=abc' });
    await request(port, '/uploads/a.png');
    assert.equal(seen[1].url, '/uploads/a.png');
    backend.close();
    await new Promise((r) => backend.once('close', r));
    const down = await request(port, '/api/v1/health');
    assert.equal(down.status, 502);
    assert.match(down.body, /no responde/);
  } finally {
    server.close();
    backend.close();
  }
});
