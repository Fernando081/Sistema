import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { join, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { testPilotProduct } from "../test-pilot-model.mjs";
import { previewContextHtml, TEST_PILOT_MODE } from "../preview-context.mjs";
import { shell, build } from "../build.mjs";
import { publishCatalog } from "../publish.mjs";
import { hash } from "../release.mjs";
import { createPreviewServer } from "../server.mjs";
import { backupTestPilot, restoreTestPilot, rehearseTestPilot } from "../test-pilot-backup.mjs";
import { loadSavedBackup } from "../check-saved-backup.mjs";

const product = id => testPilotProduct({ id, codigo: `P-${id}`, nombre: 'Pieza del arnés de pruebas', marca: 'Pruebas', categoria: 'Pruebas', aplicaciones: [], numerosParte: [] });
const approve = raw => ({ sha256: hash(raw), reviewer: 'Arnés de prueba', decision: 'approve-local-preview' });
async function fixture(work, mode = TEST_PILOT_MODE) {
  const temporary = await mkdtemp(join(tmpdir(), 'rtt-db-pilot-test-'));
  try {
    const site = join(temporary, 'site');
    const raw = JSON.stringify({ schemaVersion: 1, products: [product(1), product(2)] });
    const first = await publishCatalog(raw, approve(raw), site, { previewMode: mode === 'normal' ? undefined : mode });
    const reduced = JSON.stringify({ schemaVersion: 1, products: [product(1)] });
    const second = await publishCatalog(reduced, approve(reduced), site, { previewMode: mode === 'normal' ? undefined : mode });
    await work({ temporary, site, first, second, raw });
  } finally {
    const physical = await realpath(temporary), base = await realpath(tmpdir());
    if (physical.startsWith(base + sep) && basename(physical).startsWith('rtt-db-pilot-test-')) await rm(physical, { recursive: true, force: true });
  }
}

test('proyección de prueba conserva códigos/aplicaciones y excluye campos privados', () => {
  const row = { id: 17, codigo: 'ABC/123', nombre: 'Pieza <verificar>', marca: 'Marca', categoria: 'Grupo',
    precio: 'PRIVATE-PRICE', costo: 'PRIVATE-COST', clientes: 'PRIVATE-CUSTOMER', vin: 'PRIVATE-VIN',
    aplicaciones: [{ fabricante: 'Equipo', modelo: 'Modelo', desde: 2020, restricciones: 'Confirmar' }], numerosParte: [{ tipo: 'OEM', numero: 'X-90' }] };
  const result = testPilotProduct(row);
  assert.equal(result.code, 'ABC/123'); assert.equal(result.slug, 'marca-abc-123-17');
  assert.deepEqual(result.applications, ['Equipo · Modelo · 2020 · Confirmar']);
  assert.deepEqual(result.references, ['OEM · X-90']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-'));
  assert.throws(() => testPilotProduct({ ...row, marca: null }));
});

test('aviso técnico es explícito y el modo normal conserva sus bytes', async () => {
  const html = shell('/', 'Prueba', '<h1>Prueba</h1>');
  assert.equal(previewContextHtml(html), html);
  assert.ok(previewContextHtml(html, TEST_PILOT_MODE).includes('Datos de prueba · Sin oferta comercial'));
  assert.throws(() => previewContextHtml(html, 'unknown'));
  assert.throws(() => previewContextHtml('<h1>Sin shell</h1>', TEST_PILOT_MODE));
  await assert.rejects(build('unused', undefined, undefined, undefined, { previewMode: TEST_PILOT_MODE, site: { origin: 'https://example.com', confirmed: true } }), /dominio confirmado/);
});

test('HTTP dinámico, estático y errores conservan aviso/noindex sin captación', async () => {
  await fixture(async ({ site }) => {
    await assert.rejects(createPreviewServer(site, { previewMode: TEST_PILOT_MODE, intake: {} }), /captación cerrada/);
    const server = await createPreviewServer(site, { previewMode: TEST_PILOT_MODE });
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}`;
      for (const [path, status] of [['/catalogo', 200], ['/productos/pruebas-p-1-1', 200], ['/buscar?q=P-1', 200], ['/cotizar?producto=pruebas-p-1-1', 200], ['/buscar?pagina=0', 400], ['/solicitar', 503], ['/ruta-no-existente', 404]]) {
        const response = await fetch(origin + path);
        assert.equal(response.status, status, path);
        assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.ok((await response.text()).includes('Datos de prueba · Sin oferta comercial'), path);
      }
    } finally { await new Promise(resolveClose => server.close(resolveClose)); }
  });
});

test('piloto rechaza recibo comercial y modo inválido antes de crear publicación', async () => {
  const raw = JSON.stringify({ schemaVersion: 1, products: [product(1)] });
  await assert.rejects(publishCatalog(raw, { ...approve(raw), erpReceipt: {} }, 'unused', { previewMode: TEST_PILOT_MODE }), /aprobación ERP/);
  await assert.rejects(publishCatalog(raw, approve(raw), 'unused', { previewMode: 'unknown' }), /inválido/);
});

test('respaldo de dos versiones restaura y ensaya daño/rollback desde archivo guardado', async () => {
  await fixture(async ({ temporary, site, first, second }) => {
    const before = await readFile(join(site, 'current-release.json'));
    const archive = await backupTestPilot(site, [first, second]);
    const destination = join(temporary, 'restored');
    await restoreTestPilot(archive, destination);
    const sentinel = join(destination, 'sentinel.txt'); await writeFile(sentinel, 'PRESERVE');
    await assert.rejects(restoreTestPilot(archive, destination), { code: 'EEXIST' });
    assert.equal(await readFile(sentinel, 'utf8'), 'PRESERVE');
    const backupDirectory = join(temporary, 'backups'); await mkdir(backupDirectory);
    const filename = `web-test-pilot-${randomUUID()}.json`, raw = JSON.stringify(archive);
    await writeFile(join(backupDirectory, filename), raw);
    await assert.rejects(loadSavedBackup(backupDirectory, filename, hash(raw)), /Nombre/);
    const report = await rehearseTestPilot(backupDirectory, filename, hash(raw), first);
    assert.equal(report.status, 'verified-test-pilot-recovery'); assert.equal(report.damageDetected, true);
    assert.equal(report.restoredHttp.release, second); assert.equal(report.rolledBackHttp.release, first);
    assert.equal(report.commercialAccepted, false); assert.equal(report.erpReceiptVerified, false);
    assert.deepEqual(await readFile(join(site, 'current-release.json')), before);
    assert.equal(hash(await readFile(join(backupDirectory, filename))), hash(raw));
    await assert.rejects(rehearseTestPilot(backupDirectory, filename, 'a'.repeat(64), first), /Hash/);
  });
});

test('contenido corrupto/traversal/ajeno falla antes de crear destino de restauración', async () => {
  await fixture(async ({ temporary, site, first, second }) => {
    const archive = await backupTestPilot(site, [first, second]);
    for (const kind of ['hash', 'traversal', 'private', 'extra']) {
      const altered = structuredClone(archive);
      if (kind === 'hash') altered.files[0].data = Buffer.from('altered').toString('base64');
      if (kind === 'traversal') altered.files[1].name = '../escape.html';
      if (kind === 'private') altered.files[1].name = `releases/${first}/.env`;
      if (kind === 'extra') altered.files.push({ name: `releases/${first}/unexpected.html`, sha256: hash('extra'), data: Buffer.from('extra').toString('base64') });
      const destination = join(temporary, kind);
      await assert.rejects(restoreTestPilot(altered, destination));
      await assert.rejects(lstat(destination), { code: 'ENOENT' });
    }
  });
});

test('el respaldo de pruebas no admite una publicación normal/comercial', async () => {
  await fixture(async ({ site, first, second }) => {
    await assert.rejects(backupTestPilot(site, [first, second]), /versiones técnicas/);
  }, 'normal');
});
