// O03 · Respaldos protegidos: archivo cifrado (AES-256-GCM), copia verificada a destinos externos,
// retención diaria/semanal/mensual y prueba de restauración en base aislada.
// La clave vive fuera del proyecto (BACKUP_ENCRYPTION_KEY_FILE); nunca se imprime ni se guarda en el archivo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Writable } = require('node:stream');
const { execFileSync } = require('node:child_process');
require('dotenv').config({ path: [path.resolve(__dirname, '..', '.env'), path.join(__dirname, '.env')], quiet: true });

const MAGIC = Buffer.from('SISTEMA-RESPALDO\x01', 'latin1'); // 17 bytes
const KEY_ID_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + KEY_ID_BYTES + IV_BYTES;
const BACKUP_ROOT = path.resolve(__dirname, '..', '.backups');
const ARCHIVE_DIR = path.join(BACKUP_ROOT, 'cifrados');
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

function keyFile() {
  return path.resolve(process.env.BACKUP_ENCRYPTION_KEY_FILE || path.join(os.homedir(), '.sistema-respaldos', 'clave-respaldos.key'));
}

function readKey(file = keyFile()) {
  if (!fs.existsSync(file)) throw new Error('No existe la clave de respaldos. Ejecuta npm run backup:key y guarda una copia fuera del equipo.');
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error('La clave de respaldos no tiene 32 bytes en base64');
  return key;
}

const keyId = (key) => crypto.createHash('sha256').update(key).digest().subarray(0, KEY_ID_BYTES);

function createKey(file = keyFile()) {
  if (fs.existsSync(file)) throw new Error(`Ya existe una clave en ${file}; no se reemplaza para no perder el acceso a respaldos anteriores.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crypto.randomBytes(32).toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
  return file;
}

function externalDirs() {
  return (process.env.BACKUP_EXTERNAL_DIRS || '').split(';').map((d) => d.trim()).filter(Boolean).map((d) => path.resolve(d));
}

function stampDate(name) {
  const m = STAMP.exec(name);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])) : null;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function latestLocalBackup() {
  const dirs = fs.existsSync(BACKUP_ROOT) ? fs.readdirSync(BACKUP_ROOT).filter((n) => STAMP.test(n) && fs.existsSync(path.join(BACKUP_ROOT, n, 'database.dump'))).sort() : [];
  if (!dirs.length) throw new Error('No hay respaldos en .backups. Ejecuta npm run db:backup.');
  return path.join(BACKUP_ROOT, dirs[dirs.length - 1]);
}

/** Cifra una carpeta de respaldo en un solo archivo: encabezado | AES-256-GCM(largo, manifiesto, archivos) | etiqueta. */
async function encryptDirectory(sourceDir, archivePath, key) {
  const files = listFiles(sourceDir);
  if (!files.includes('database.dump')) throw new Error('La carpeta no contiene database.dump');
  const manifest = { version: 1, origen: path.basename(sourceDir), creado: new Date().toISOString(), archivos: [] };
  for (const rel of files) {
    const full = path.join(sourceDir, ...rel.split('/'));
    manifest.archivos.push({ ruta: rel, bytes: fs.statSync(full).size, sha256: await sha256File(full) });
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(manifestBuf.length);
  const iv = crypto.randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, keyId(key), iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const tmp = archivePath + '.tmp';
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(tmp, header);
  async function* plain() {
    yield length;
    yield manifestBuf;
    for (const entry of manifest.archivos) yield* fs.createReadStream(path.join(sourceDir, ...entry.ruta.split('/')));
  }
  await pipeline(Readable.from(plain()), cipher, fs.createWriteStream(tmp, { flags: 'a' }));
  fs.appendFileSync(tmp, cipher.getAuthTag());
  fs.renameSync(tmp, archivePath);
  return manifest;
}

/**
 * Descifra y comprueba un archivo. Sin destino sólo verifica (no escribe nada); con destino extrae.
 * Lo extraído sólo es válido si la etiqueta GCM y los sha256 del manifiesto coinciden; si no, se borra.
 */
async function decryptArchive(archivePath, key, destination = null) {
  const size = fs.statSync(archivePath).size;
  if (size < HEADER_BYTES + TAG_BYTES + 4) throw new Error('El archivo es demasiado pequeño para ser un respaldo');
  const fd = fs.openSync(archivePath, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  fs.readSync(fd, header, 0, HEADER_BYTES, 0);
  fs.readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);
  fs.closeSync(fd);
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('No es un respaldo cifrado del sistema');
  if (!header.subarray(MAGIC.length, MAGIC.length + KEY_ID_BYTES).equals(keyId(key))) throw new Error('El respaldo fue cifrado con otra clave');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length + KEY_ID_BYTES));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  let pending = Buffer.alloc(0);
  let manifest = null;
  let index = 0;
  let current = null; // { entry, remaining, hash, out }
  const openNext = () => {
    while (manifest && index < manifest.archivos.length && !current) {
      const entry = manifest.archivos[index++];
      if (!entry.ruta || entry.ruta.split('/').some((p) => p === '..' || p === '') || path.isAbsolute(entry.ruta)) throw new Error('Ruta inválida en el manifiesto');
      let out = null;
      if (destination) {
        const target = path.join(destination, ...entry.ruta.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        out = fs.openSync(target, 'wx');
      }
      current = { entry, remaining: entry.bytes, hash: crypto.createHash('sha256'), out };
      if (entry.bytes === 0) finishCurrent();
    }
  };
  const finishCurrent = () => {
    if (current.out !== null) fs.closeSync(current.out);
    if (current.hash.digest('hex') !== current.entry.sha256) throw new Error(`El contenido de ${current.entry.ruta} no coincide con su huella`);
    current = null;
  };
  const consume = (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    if (!manifest) {
      if (pending.length < 4) return;
      const len = pending.readUInt32BE(0);
      if (len > 64 * 1024 * 1024) throw new Error('Manifiesto inválido');
      if (pending.length < 4 + len) return;
      manifest = JSON.parse(pending.subarray(4, 4 + len).toString('utf8'));
      if (manifest.version !== 1 || !Array.isArray(manifest.archivos)) throw new Error('Versión de respaldo no soportada');
      pending = pending.subarray(4 + len);
      openNext();
    }
    while (pending.length && current) {
      const take = Math.min(current.remaining, pending.length);
      const part = pending.subarray(0, take);
      current.hash.update(part);
      if (current.out !== null) fs.writeSync(current.out, part);
      current.remaining -= take;
      pending = pending.subarray(take);
      if (current.remaining === 0) { finishCurrent(); openNext(); }
    }
    if (pending.length && !current) throw new Error('El respaldo contiene datos de más');
  };
  try {
    await pipeline(
      fs.createReadStream(archivePath, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      new Writable({ write(chunk, _enc, done) { try { consume(chunk); done(); } catch (error) { done(error); } } }),
    );
    if (!manifest || current || index < manifest.archivos.length) throw new Error('El respaldo está incompleto');
    return manifest;
  } catch (error) {
    if (current && current.out !== null) try { fs.closeSync(current.out); } catch { /* ya cerrado */ }
    if (destination) fs.rmSync(destination, { recursive: true, force: true });
    if (/unable to authenticate|Unsupported state/i.test(String(error.message))) throw new Error('El respaldo fue alterado o la clave no corresponde');
    throw error;
  }
}

/** Copia a cada destino externo por archivo temporal, compara sha256 y renombra. */
async function copyToExternal(archivePath, dirs = externalDirs()) {
  const expected = await sha256File(archivePath);
  const results = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) throw new Error('el destino no está conectado o no existe');
      const target = path.join(dir, path.basename(archivePath));
      const tmp = target + '.tmp';
      fs.copyFileSync(archivePath, tmp);
      if (await sha256File(tmp) !== expected) { fs.rmSync(tmp, { force: true }); throw new Error('la copia no coincide con el original'); }
      fs.renameSync(tmp, target);
      results.push({ destino: dir, ok: true });
    } catch (error) {
      results.push({ destino: dir, ok: false, motivo: error.message });
    }
  }
  return results;
}

const retentionPolicy = () => ({
  dias: Number(process.env.BACKUP_KEEP_DAYS || 14),
  semanas: Number(process.env.BACKUP_KEEP_WEEKS || 8),
  meses: Number(process.env.BACKUP_KEEP_MONTHS || 12),
});

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  return `${year}-W${Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)}`;
}

/** Conserva todo lo reciente, el más nuevo de cada semana y de cada mes en sus ventanas, y siempre el último. */
function selectRetention(items, now = new Date(), policy = retentionPolicy()) {
  const sorted = [...items].sort((a, b) => b.fecha - a.fecha);
  const keep = new Set();
  if (sorted[0]) keep.add(sorted[0].nombre);
  const weeks = new Set();
  const months = new Set();
  const age = (item) => (now - item.fecha) / 86400000;
  for (const item of sorted) {
    if (age(item) <= policy.dias) keep.add(item.nombre);
    const week = isoWeek(item.fecha);
    if (age(item) <= policy.semanas * 7 && !weeks.has(week)) { weeks.add(week); keep.add(item.nombre); }
    const month = item.fecha.toISOString().slice(0, 7);
    if (age(item) <= policy.meses * 31 && !months.has(month)) { months.add(month); keep.add(item.nombre); }
  }
  return { conservar: sorted.filter((i) => keep.has(i.nombre)), eliminar: sorted.filter((i) => !keep.has(i.nombre)) };
}

function retentionTargets() {
  const targets = [];
  if (fs.existsSync(BACKUP_ROOT)) {
    targets.push({ lugar: '.backups (sin cifrar)', items: fs.readdirSync(BACKUP_ROOT).filter((n) => STAMP.test(n)).map((n) => ({ nombre: n, fecha: stampDate(n), ruta: path.join(BACKUP_ROOT, n) })) });
  }
  for (const dir of [ARCHIVE_DIR, ...externalDirs()]) {
    if (!fs.existsSync(dir)) continue;
    targets.push({ lugar: dir === ARCHIVE_DIR ? '.backups/cifrados' : dir, items: fs.readdirSync(dir).filter((n) => n.endsWith('.sbk') && STAMP.test(n.slice(0, -4))).map((n) => ({ nombre: n, fecha: stampDate(n.slice(0, -4)), ruta: path.join(dir, n) })) });
  }
  return targets;
}

function prune(apply) {
  for (const target of retentionTargets()) {
    const { conservar, eliminar } = selectRetention(target.items);
    console.log(`${target.lugar}: conservar ${conservar.length}, ${apply ? 'eliminados' : 'se eliminarían'} ${eliminar.length}`);
    for (const item of eliminar) {
      if (apply) fs.rmSync(item.ruta, { recursive: true, force: true });
      else console.log(`  - ${item.nombre}`);
    }
  }
  if (!apply) console.log('Vista previa: no se eliminó nada. Usa --apply (o BACKUP_RETENTION_APPLY=true en backup:daily) para aplicar.');
}

function status() {
  const now = Date.now();
  let warnings = 0;
  console.log(`Clave: ${fs.existsSync(keyFile()) ? 'configurada' : 'FALTA (npm run backup:key)'}`);
  if (!fs.existsSync(keyFile())) warnings++;
  const dirs = externalDirs();
  if (!dirs.length) { console.log('Destinos externos: NINGUNO (configura BACKUP_EXTERNAL_DIRS)'); warnings++; }
  for (const target of retentionTargets()) {
    const newest = target.items.sort((a, b) => b.fecha - a.fecha)[0];
    const hours = newest ? (now - newest.fecha) / 3600000 : Infinity;
    console.log(`${target.lugar}: ${target.items.length} respaldos; último ${newest ? newest.nombre + ` (hace ${hours.toFixed(1)} h)` : 'ninguno'}`);
    if (hours > 48) warnings++;
  }
  for (const dir of dirs) if (!fs.existsSync(dir)) { console.log(`Destino externo no conectado: ${dir}`); warnings++; }
  console.log(warnings ? `Avisos: ${warnings}` : 'Sin avisos.');
  return warnings;
}

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function main() {
  const command = process.argv[2];
  if (command === 'key') {
    const file = createKey();
    console.log(`Clave creada en ${file}. Guarda una copia fuera de este equipo (gestor de contraseñas o memoria aparte de los respaldos); sin ella los respaldos cifrados no se pueden abrir.`);
  } else if (command === 'protect') {
    const key = readKey();
    const source = argValue('backup') ? path.resolve(argValue('backup')) : latestLocalBackup();
    if (!source.startsWith(BACKUP_ROOT + path.sep) || !STAMP.test(path.basename(source))) throw new Error('El respaldo debe ser una carpeta con fecha dentro de .backups');
    const archive = path.join(ARCHIVE_DIR, `${path.basename(source)}.sbk`);
    if (fs.existsSync(archive)) throw new Error(`Ya existe ${archive}`);
    const manifest = await encryptDirectory(source, archive, key);
    await decryptArchive(archive, key);
    console.log(`Cifrado y verificado: ${path.relative(path.resolve(__dirname, '..'), archive)} (${manifest.archivos.length} archivos)`);
    const copies = await copyToExternal(archive);
    for (const copy of copies) console.log(copy.ok ? `Copia externa verificada: ${copy.destino}` : `Copia externa FALLÓ en ${copy.destino}: ${copy.motivo}`);
    if (!copies.length) console.log('Aviso: sin destinos externos (BACKUP_EXTERNAL_DIRS); la copia cifrada sigue en este equipo.');
    if (copies.some((c) => !c.ok)) process.exitCode = 2;
  } else if (command === 'verify') {
    const archive = argValue('archive');
    if (!archive) throw new Error('Indica --archive=RUTA.sbk');
    const manifest = await decryptArchive(path.resolve(archive), readKey());
    console.log(`Respaldo íntegro: ${manifest.origen}, ${manifest.archivos.length} archivos, huellas y etiqueta correctas.`);
  } else if (command === 'restore-test') {
    const archive = argValue('archive') || (() => {
      const files = fs.existsSync(ARCHIVE_DIR) ? fs.readdirSync(ARCHIVE_DIR).filter((n) => n.endsWith('.sbk')).sort() : [];
      if (!files.length) throw new Error('No hay respaldos cifrados en .backups/cifrados');
      return path.join(ARCHIVE_DIR, files[files.length - 1]);
    })();
    const work = path.join(BACKUP_ROOT, `restauracion-${Date.now()}`);
    try {
      const manifest = await decryptArchive(path.resolve(archive), readKey(), work);
      console.log(`Descifrado y verificado ${manifest.origen}; restaurando en base aislada…`);
      execFileSync(process.execPath, [path.join(__dirname, 'verify-isolated-database.js'), `--backup=${path.join(work, 'database.dump')}`], { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      console.log('Prueba de restauración aprobada; la base aislada se eliminó.');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  } else if (command === 'prune') {
    prune(process.argv.includes('--apply'));
  } else if (command === 'retention-daily') {
    prune(process.env.BACKUP_RETENTION_APPLY === 'true');
  } else if (command === 'status') {
    if (status()) process.exitCode = 3;
  } else {
    console.log('Uso: node backend/backup-protect.js key|protect|verify|restore-test|prune|status');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(`Respaldo protegido: ${error.message}`); process.exitCode = 1; });
}

module.exports = { encryptDirectory, decryptArchive, copyToExternal, selectRetention, createKey, readKey, stampDate };
