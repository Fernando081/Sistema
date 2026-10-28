// O03 · Pruebas del respaldo protegido (node --test). Trabajan sólo en una carpeta temporal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptDirectory, decryptArchive, copyToExternal, selectRetention, createKey, readKey, stampDate } = require('./backup-protect');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-protegido-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function sampleBackup() {
  const dir = fs.mkdtempSync(path.join(tmp, 'origen-'));
  fs.writeFileSync(path.join(dir, 'database.dump'), crypto.randomBytes(300_000));
  fs.writeFileSync(path.join(dir, 'README.txt'), 'respaldo de prueba\n');
  fs.mkdirSync(path.join(dir, 'uploads', 'fotos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'uploads', 'fotos', 'a.png'), crypto.randomBytes(5000));
  fs.writeFileSync(path.join(dir, 'uploads', 'vacio.txt'), '');
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')));

test('cifra y restaura byte por byte, sin texto claro en el archivo', async () => {
  const key = crypto.randomBytes(32);
  const source = sampleBackup();
  const archive = path.join(tmp, 'ok.sbk');
  const manifest = await encryptDirectory(source, archive, key);
  assert.deepEqual(manifest.archivos.map((f) => f.ruta).sort(), ['README.txt', 'database.dump', 'uploads/fotos/a.png', 'uploads/vacio.txt']);
  assert.equal(fs.readFileSync(archive).includes(Buffer.from('respaldo de prueba')), false);
  const out = path.join(tmp, 'restaurado');
  await decryptArchive(archive, key, out);
  for (const rel of ['README.txt', 'database.dump', 'uploads/fotos/a.png', 'uploads/vacio.txt']) assert.ok(read(out, rel).equals(read(source, rel)), rel);
  assert.equal((await decryptArchive(archive, key)).archivos.length, 4);
});

test('rechaza archivo alterado, clave distinta y archivo truncado sin dejar extracción', async () => {
  const key = crypto.randomBytes(32);
  const archive = path.join(tmp, 'alterado.sbk');
  await encryptDirectory(sampleBackup(), archive, key);
  const bytes = fs.readFileSync(archive);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  const tampered = path.join(tmp, 'alterado2.sbk');
  fs.writeFileSync(tampered, bytes);
  const out = path.join(tmp, 'no-debe-quedar');
  await assert.rejects(decryptArchive(tampered, key, out), /alterado|huella/);
  assert.equal(fs.existsSync(out), false);
  await assert.rejects(decryptArchive(archive, crypto.randomBytes(32)), /otra clave/);
  const truncated = path.join(tmp, 'truncado.sbk');
  fs.writeFileSync(truncated, fs.readFileSync(archive).subarray(0, 2000));
  await assert.rejects(decryptArchive(truncated, key), /alterado|incompleto/);
});

test('la clave no se reemplaza y debe tener 32 bytes', () => {
  const file = path.join(tmp, 'clave', 'k.key');
  createKey(file);
  assert.equal(readKey(file).length, 32);
  assert.throws(() => createKey(file), /no se reemplaza/);
  fs.writeFileSync(path.join(tmp, 'corta.key'), Buffer.alloc(8).toString('base64'));
  assert.throws(() => readKey(path.join(tmp, 'corta.key')), /32 bytes/);
});

test('copia externa verificada y destino ausente informado', async () => {
  const archive = path.join(tmp, 'copia.sbk');
  await encryptDirectory(sampleBackup(), archive, crypto.randomBytes(32));
  const usb = fs.mkdtempSync(path.join(tmp, 'usb-'));
  const results = await copyToExternal(archive, [usb, path.join(tmp, 'no-conectado')]);
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
  assert.ok(fs.readFileSync(path.join(usb, 'copia.sbk')).equals(fs.readFileSync(archive)));
  assert.equal(fs.existsSync(path.join(usb, 'copia.sbk.tmp')), false);
});

test('retención: todo lo reciente, uno por semana y por mes, y siempre el último', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const items = [];
  for (let d = 0; d < 400; d++) {
    const fecha = new Date(now.getTime() - d * 86400000);
    items.push({ nombre: fecha.toISOString().replace(/[:.]/g, '-'), fecha });
  }
  const { conservar, eliminar } = selectRetention(items, now, { dias: 14, semanas: 8, meses: 12 });
  assert.equal(conservar.length + eliminar.length, 400);
  assert.ok(conservar.filter((i) => now - i.fecha <= 14 * 86400000).length >= 14);
  assert.ok(conservar.length < 40, `conserva ${conservar.length}`);
  assert.ok(eliminar.every((i) => now - i.fecha > 14 * 86400000));
  const old = [{ nombre: 'viejo', fecha: new Date('2020-01-01T00:00:00Z') }];
  assert.deepEqual(selectRetention(old, now).conservar.map((i) => i.nombre), ['viejo']);
  assert.equal(stampDate('2026-10-28T16-29-08-319Z').toISOString(), '2026-10-28T16:29:08.319Z');
  assert.equal(stampDate('web-preview.json'), null);
});
