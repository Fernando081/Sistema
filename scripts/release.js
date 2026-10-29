'use strict';
// O04 · Versiones, staging, despliegue y rollback locales. Ver docs/DESPLIEGUE_Y_ROLLBACK.md.
// Comandos: build | list | verify | status | start | stop | deploy | rollback | prune | staging-refresh | staging-deploy | staging-stop
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { databaseConfig } = require('../backend/db-config'); // también carga backend/.env en process.env
const { findPgTool, postgresEnvironment } = require('../backend/backup');
const lib = require('./release-lib');

const root = path.resolve(__dirname, '..');
const RELEASES = process.env.RELEASES_DIR ? path.resolve(process.env.RELEASES_DIR) : path.join(root, 'releases');
const STATE = path.join(RELEASES, 'state.json');
const RUN = path.join(RELEASES, 'run');
const LOGS = path.join(RELEASES, 'logs');
const STAGING_DATA = path.join(RELEASES, 'staging-data');
const SKIP = ['node_modules', 'backend/node_modules', 'frontend/node_modules', 'manifest.json'];

const argv = process.argv.slice(3);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function checkNode() {
  if (process.versions.node.split('.')[0] !== '24') throw new Error(`Se requiere Node 24 (actual ${process.versions.node})`);
}

function npm(args, cwd) {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} terminó con código ${result.status}`);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function now() { return new Date().toISOString(); }

function log(state, entry) {
  state.historial.push({ en: now(), ...entry });
  if (state.historial.length > 200) state.historial = state.historial.slice(-200);
}

function releaseDir(id) { return path.join(RELEASES, lib.assertReleaseId(id)); }

/** Lee el manifiesto y comprueba la huella de cada archivo de la versión. */
function loadRelease(id) {
  const dir = releaseDir(id);
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`No existe la versión ${id}`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.id !== id || manifest.digest !== lib.manifestDigest(manifest)) throw new Error(`El manifiesto de ${id} fue alterado`);
  const problems = lib.compareTree(manifest.files, lib.hashTree(dir, SKIP));
  if (problems.length) throw new Error(`La versión ${id} no coincide con su manifiesto:\n  ${problems.slice(0, 10).join('\n  ')}`);
  if (!fs.existsSync(path.join(dir, 'node_modules'))) throw new Error(`La versión ${id} no tiene dependencias instaladas`);
  return { dir, manifest };
}

// ---------- base de datos ----------

async function withClient(config, work) {
  const { Client } = require('pg');
  const client = new Client(config);
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

function configFor(envVars) {
  const config = databaseConfig();
  if (config.connectionString) return { ...config, connectionString: envVars.DATABASE_URL };
  return { ...config, database: envVars.DB_NAME };
}

async function appliedMigrations(envVars) {
  return withClient(configFor(envVars), async (c) => {
    const exists = await c.query("SELECT to_regclass('public.schema_migration') AS t");
    if (!exists.rows[0].t) return [];
    return (await c.query('SELECT filename FROM schema_migration ORDER BY filename')).rows.map((r) => r.filename);
  });
}

function runMigrations(dir, envVars, check) {
  const args = [path.join(dir, 'backend', 'run-migrations.js'), ...(check ? ['--check'] : [])];
  const result = spawnSync(process.execPath, args, { cwd: path.join(dir, 'backend'), env: envVars, encoding: 'utf8', windowsHide: true, timeout: 600000 });
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) throw new Error(`Migraciones ${check ? '(db:check) ' : ''}fallaron: ${(result.stderr || '').trim().split('\n').slice(-3).join(' ')}`);
  return (result.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith('Aplicada: ')).map((l) => l.slice(10));
}

// ---------- procesos ----------

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function isNode(pid) {
  if (process.platform !== 'win32') return alive(pid);
  const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || '';
  return /^"node\.exe"/i.test(out.trim());
}

const pidFile = (env) => path.join(RUN, `${env}.json`);
function running(env) {
  if (!fs.existsSync(pidFile(env))) return null;
  const info = JSON.parse(fs.readFileSync(pidFile(env), 'utf8'));
  info.vivos = [info.backend.pid, info.frontend.pid].filter((pid) => alive(pid) && isNode(pid));
  return info;
}

async function stopEnv(env) {
  const info = running(env);
  if (!info) return null;
  for (const pid of info.vivos) try { process.kill(pid); } catch { /* ya terminó */ }
  const deadline = Date.now() + 15000;
  while (info.vivos.some(alive) && Date.now() < deadline) await sleep(250);
  if (info.vivos.some(alive)) throw new Error(`No se pudo detener ${env} (pid ${info.vivos.join(', ')})`);
  fs.rmSync(pidFile(env), { force: true });
  console.log(`${env}: detenida la versión ${info.release}.`);
  return info.release;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function assertPortsUsable(env, ports) {
  const own = running(env);
  if (own?.vivos.length) return;
  for (const port of [ports.backend, ports.frontend]) {
    if (!(await portFree(port))) throw new Error(`El puerto ${port} está ocupado por otro proceso (¿el backend o frontend de desarrollo?). Deténlo o cambia los puertos de ${env}.`);
  }
}

function startEnv(env, release, envVars, ports) {
  const dir = releaseDir(release);
  fs.mkdirSync(RUN, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  const open = (name) => fs.openSync(path.join(LOGS, `${env}-${name}.log`), 'a');
  const banner = (fd) => fs.writeSync(fd, `\n--- ${now()} inicia ${release} ---\n`);
  const backendLog = open('backend'); banner(backendLog);
  const frontendLog = open('frontend'); banner(frontendLog);
  const backend = spawn(process.execPath, ['dist/main.js'], { cwd: path.join(dir, 'backend'), env: envVars, detached: true, stdio: ['ignore', backendLog, backendLog], windowsHide: true });
  const frontend = spawn(process.execPath, [path.join(dir, 'release-server.js'), `--root=${path.join(dir, 'frontend', 'browser')}`, `--port=${ports.frontend}`, `--backend=${ports.backend}`, `--release=${release}`],
    { cwd: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, detached: true, stdio: ['ignore', frontendLog, frontendLog], windowsHide: true });
  backend.unref(); frontend.unref();
  fs.closeSync(backendLog); fs.closeSync(frontendLog);
  const info = { release, iniciadaEn: now(), backend: { pid: backend.pid, port: ports.backend }, frontend: { pid: frontend.pid, port: ports.frontend } };
  fs.writeFileSync(pidFile(env), JSON.stringify(info, null, 2));
  return info;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve) => {
    // Sin keep-alive: entre pruebas se detienen y arrancan servidores, y una conexión reutilizada daría un falso fallo.
    const req = http.get(url, { timeout: 5000, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 200000) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

/** Pruebas de humo: salud, versión servida, interfaz, proxy, autenticación exigida y migraciones al día. */
async function smoke(release, ports, envVars, manifest) {
  const back = `http://127.0.0.1:${ports.backend}`;
  const front = `http://127.0.0.1:${ports.frontend}`;
  const deadline = Date.now() + 120000;
  let health = { status: 0 };
  while (Date.now() < deadline) {
    health = await get(`${back}/api/v1/health`);
    if (health.status === 200) break;
    await sleep(1000);
  }
  const checks = [];
  const check = (nombre, ok, detalle = '') => checks.push({ nombre, ok: Boolean(ok), detalle });
  check('Backend responde /health', health.status === 200, `HTTP ${health.status}`);
  const version = await get(`${front}/__version`);
  let served = null;
  try { served = JSON.parse(version.body).release; } catch { /* sin JSON */ }
  check('La interfaz sirve la versión esperada', served === release, String(served));
  const home = await get(`${front}/`);
  check('Página inicial', home.status === 200 && home.body.includes('<app-root'), `HTTP ${home.status}`);
  const deep = await get(`${front}/facturas`);
  check('Rutas de la aplicación regresan la interfaz', deep.status === 200 && deep.body.includes('<app-root'), `HTTP ${deep.status}`);
  const missing = await get(`${front}/no-existe-${Date.now()}.js`);
  check('Archivo inexistente es 404', missing.status === 404, `HTTP ${missing.status}`);
  const proxied = await get(`${front}/api/v1/health`);
  check('Proxy /api hacia el backend', proxied.status === 200, `HTTP ${proxied.status}`);
  const me = await get(`${front}/api/v1/auth/me`);
  check('Rutas privadas exigen sesión', me.status === 401, `HTTP ${me.status}`);
  try {
    const { pendientes } = lib.schemaCompatibility(manifest.migraciones, await appliedMigrations(envVars));
    check('Sin migraciones pendientes', pendientes.length === 0, pendientes.join(', ') || 'al día');
  } catch (error) {
    check('Sin migraciones pendientes', false, error.message);
  }
  for (const c of checks) console.log(`  ${c.ok ? 'OK ' : 'FALLA'} ${c.nombre}${c.detalle ? ` (${c.detalle})` : ''}`);
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------- ambientes ----------

function ports() { return lib.environmentPorts(process.env); }

function productionEnv() {
  const p = ports().produccion;
  return lib.processEnv(process.env, 'produccion', { backendPort: p.backend, frontendPort: p.frontend, uploads: path.join(root, 'backend', 'uploads') });
}

function stagingName() {
  const config = databaseConfig();
  const base = config.connectionString ? decodeURIComponent(new URL(config.connectionString).pathname.slice(1)) : config.database;
  return lib.stagingDbName(base, process.env.STAGING_DB_NAME);
}

function stagingEnv() {
  const p = ports().staging;
  return lib.processEnv(process.env, 'staging', { backendPort: p.backend, frontendPort: p.frontend, uploads: path.join(STAGING_DATA, 'uploads'), dbName: stagingName() });
}

// ---------- comandos ----------

async function build() {
  checkNode();
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']).length > 0;
  if (dirty && !flag('permitir-sucio')) throw new Error('Hay cambios sin commit. Haz commit primero o usa --permitir-sucio (la versión quedará marcada y no se desplegará sin el mismo permiso).');
  npm(['--workspace', 'backend', 'run', 'build'], root);
  npm(['--workspace', 'frontend', 'run', 'build'], root);
  const id = lib.releaseId(new Date(), commit);
  const dir = path.join(RELEASES, id);
  const tmp = path.join(RELEASES, `.tmp-${id}`);
  if (fs.existsSync(dir)) throw new Error(`Ya existe ${dir}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(tmp, to ?? from), { recursive: true });
  copy('backend/dist');
  copy('backend/migrations');
  for (const f of ['package.json', 'run-migrations.js', 'migration-checksum.js', 'db-config.js']) copy(`backend/${f}`);
  copy('frontend/dist/frontend/browser', 'frontend/browser');
  copy('frontend/package.json');
  copy('package.json');
  copy('package-lock.json');
  copy('scripts/release-server.js', 'release-server.js');
  console.log('Instalando dependencias de producción del backend en la versión…');
  npm(['ci', '--omit=dev', '--workspace', 'backend', '--prefer-offline', '--no-audit', '--no-fund'], tmp);
  // Un paquete que sólo existe por ser dependencia de desarrollo no se instala aquí: la versión no arrancaría.
  const missing = lib.runtimeRequires(path.join(tmp, 'backend', 'dist')).filter((name) => {
    try { require.resolve(name, { paths: [path.join(tmp, 'backend')] }); return false; } catch { return true; }
  });
  if (missing.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`El backend compilado requiere paquetes que no son dependencias de producción: ${missing.join(', ')}. Muévelos a "dependencies" de backend/package.json.`);
  }
  const migraciones = lib.migrationList(path.join(tmp, 'backend', 'migrations'));
  const manifest = {
    schemaVersion: 1, id, creadaEn: now(), commit, dirty, node: process.versions.node,
    migraciones, ultimaMigracion: migraciones.at(-1) ?? null,
    lockSha256: lib.sha256(fs.readFileSync(path.join(tmp, 'package-lock.json'))),
    files: lib.hashTree(tmp, SKIP),
  };
  manifest.digest = lib.manifestDigest(manifest);
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, dir);
  const state = lib.readState(STATE);
  log(state, { accion: 'build', release: id, commit, dirty });
  lib.writeState(STATE, state);
  console.log(`Versión ${id} creada (${Object.keys(manifest.files).length} archivos, última migración ${manifest.ultimaMigracion}${dirty ? ', CON CAMBIOS SIN COMMIT' : ''}).`);
  console.log(`Siguiente paso: npm run staging:deploy -- --release=${id}`);
}

function list() {
  const state = lib.readState(STATE);
  const ids = fs.existsSync(RELEASES) ? fs.readdirSync(RELEASES).filter((d) => lib.RELEASE_ID.test(d)).sort().reverse() : [];
  if (!ids.length) return console.log('No hay versiones. Crea una con npm run release:build.');
  for (const id of ids) {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(RELEASES, id, 'manifest.json'), 'utf8')); } catch { /* incompleta */ }
    const marks = [state.produccion.actual === id && 'ACTUAL', state.produccion.anterior === id && 'anterior',
      state.staging.resultado?.release === id && (state.staging.resultado.ok ? 'staging OK' : 'staging FALLÓ'), m.dirty && 'sin commit'].filter(Boolean);
    console.log(`${id}  ${m.ultimaMigracion ?? '?'}${marks.length ? `  [${marks.join(', ')}]` : ''}`);
  }
}

function verify() {
  const id = option('release') ?? lib.readState(STATE).produccion.actual;
  if (!id) throw new Error('Indica --release=<id>');
  const { manifest } = loadRelease(id);
  console.log(`Versión ${id} íntegra: ${Object.keys(manifest.files).length} archivos coinciden con el manifiesto.`);
}

async function status() {
  const state = lib.readState(STATE);
  const p = ports();
  for (const env of ['produccion', 'staging']) {
    const info = running(env);
    const health = await get(`http://127.0.0.1:${p[env].backend}/api/v1/health`);
    const front = await get(`http://127.0.0.1:${p[env].frontend}/__version`);
    console.log(`${env}: ${info?.vivos.length ? `en marcha ${info.release} desde ${info.iniciadaEn}` : 'detenida'} · backend ${p[env].backend} HTTP ${health.status} · interfaz http://127.0.0.1:${p[env].frontend} HTTP ${front.status}`);
  }
  console.log(`Versión actual: ${state.produccion.actual ?? 'ninguna'} · anterior: ${state.produccion.anterior ?? 'ninguna'}`);
  const r = state.staging.resultado;
  console.log(`Staging: base ${state.staging.base ?? 'sin crear'}${state.staging.refrescadaEn ? `, copia del ${state.staging.respaldo} (${state.staging.refrescadaEn})` : ''}${r ? `; última prueba ${r.release} ${r.ok ? 'OK' : 'FALLÓ'} ${r.en}` : ''}`);
  const last = state.historial.at(-1);
  if (last) console.log(`Último movimiento: ${last.en} ${last.accion} ${last.release ?? ''} ${last.resultado ?? ''}`);
}

async function start() {
  const state = lib.readState(STATE);
  const id = state.produccion.actual;
  if (!id) throw new Error('No hay versión desplegada. Usa npm run release:deploy -- --release=<id>');
  const info = running('produccion');
  if (info?.vivos.length) return console.log(`produccion ya está en marcha con ${info.release}.`);
  const { manifest } = loadRelease(id);
  const envVars = productionEnv();
  await assertPortsUsable('produccion', ports().produccion);
  startEnv('produccion', id, envVars, ports().produccion);
  const result = await smoke(id, ports().produccion, envVars, manifest);
  if (!result.ok) throw new Error('La versión arrancó pero no pasó las pruebas de humo; revisa releases/logs.');
  console.log(`Sistema en http://127.0.0.1:${ports().produccion.frontend}`);
}

async function deploy() {
  checkNode();
  const id = option('release');
  if (!id) throw new Error('Indica --release=<id> (npm run release:list)');
  const { manifest } = loadRelease(id);
  const state = lib.readState(STATE);
  const blockers = lib.deployBlockers(state, manifest, { permitirSucio: flag('permitir-sucio'), omitirStaging: flag('omitir-staging'), motivo: option('motivo'), reinstalar: flag('reinstalar') });
  if (blockers.length) throw new Error(`No se puede desplegar:\n  ${blockers.join('\n  ')}`);
  const envVars = productionEnv();
  const p = ports().produccion;
  const compat = lib.schemaCompatibility(manifest.migraciones, await appliedMigrations(envVars));
  if (compat.desconocidas.length) throw new Error(`La base tiene migraciones que esta versión no conoce (${compat.desconocidas.join(', ')}); es más antigua que el esquema. Usa release:rollback.`);
  await assertPortsUsable('produccion', p);

  console.log('1/5 Respaldo previo (db:backup)…');
  const before = new Set(fs.existsSync(path.join(root, '.backups')) ? fs.readdirSync(path.join(root, '.backups')) : []);
  const backup = spawnSync(process.execPath, [path.join(root, 'backend', 'backup.js')], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (backup.status !== 0) throw new Error('El respaldo previo falló; no se cambió nada.');
  const respaldo = fs.readdirSync(path.join(root, '.backups')).filter((d) => !before.has(d) && fs.existsSync(path.join(root, '.backups', d, 'database.dump'))).sort().at(-1);
  if (!respaldo) throw new Error('No se encontró el respaldo recién creado; no se cambió nada.');

  console.log(`2/5 db:check de ${compat.pendientes.length} migraciones pendientes…`);
  let aplicadas = [];
  if (compat.pendientes.length) {
    runMigrations(releaseDir(id), envVars, true);
    console.log('3/5 db:migrate…');
    aplicadas = runMigrations(releaseDir(id), envVars, false);
  } else console.log('3/5 Sin migraciones que aplicar.');

  console.log('4/5 Cambio de versión…');
  const anterior = state.produccion.actual;
  await stopEnv('produccion');
  startEnv('produccion', id, envVars, p);
  console.log('5/5 Pruebas de humo…');
  const result = await smoke(id, p, envVars, manifest);
  const entry = { accion: 'deploy', release: id, desde: anterior, respaldo: `.backups/${respaldo}`, migracionesAplicadas: aplicadas, motivo: option('motivo') ?? null, omitioStaging: flag('omitir-staging') };
  if (result.ok) {
    state.produccion = { actual: id, anterior: anterior && anterior !== id ? anterior : state.produccion.anterior };
    log(state, { ...entry, resultado: 'ok' });
    lib.writeState(STATE, state);
    console.log(`Desplegada ${id}. Sistema en http://127.0.0.1:${p.frontend}. Respaldo previo: .backups/${respaldo}`);
    return;
  }
  await stopEnv('produccion');
  let restored = false;
  if (anterior) {
    console.log(`Las pruebas fallaron; se regresa a ${anterior}…`);
    try {
      const prev = loadRelease(anterior);
      startEnv('produccion', anterior, envVars, p);
      restored = (await smoke(anterior, p, envVars, prev.manifest)).ok;
    } catch (error) { console.error(error.message); }
  }
  log(state, { ...entry, resultado: restored ? 'fallo-revertido' : 'fallo', pruebas: result.checks.filter((c) => !c.ok) });
  lib.writeState(STATE, state);
  throw new Error(`El despliegue de ${id} no pasó las pruebas de humo. ${restored ? `Quedó en marcha ${anterior}.` : 'No quedó ninguna versión en marcha.'}${aplicadas.length ? ` La base conserva ${aplicadas.length} migraciones nuevas; para volver al esquema anterior restaura .backups/${respaldo} (docs/DESPLIEGUE_Y_ROLLBACK.md).` : ''}`);
}

async function rollback() {
  checkNode();
  const state = lib.readState(STATE);
  const target = lib.rollbackTarget(state, option('release'));
  const { manifest } = loadRelease(target);
  const envVars = productionEnv();
  const p = ports().produccion;
  const compat = lib.schemaCompatibility(manifest.migraciones, await appliedMigrations(envVars));
  if (compat.pendientes.length) throw new Error(`${target} tiene migraciones sin aplicar (${compat.pendientes.join(', ')}); es más nueva que la base. Usa release:deploy.`);
  if (compat.desconocidas.length && !flag('aceptar-esquema-nuevo')) {
    const deployWithMigrations = [...state.historial].reverse().find((h) => h.accion === 'deploy' && h.migracionesAplicadas?.length);
    throw new Error(`La base tiene ${compat.desconocidas.length} migraciones posteriores a ${target}: ${compat.desconocidas.join(', ')}.\n` +
      '  Las migraciones sólo agregan, así que el código anterior suele funcionar; confírmalo con --aceptar-esquema-nuevo.\n' +
      `  Para volver también el esquema, restaura el respaldo previo${deployWithMigrations ? ` (${deployWithMigrations.respaldo})` : ''} según docs/DESPLIEGUE_Y_ROLLBACK.md.`);
  }
  await assertPortsUsable('produccion', p);
  const actual = state.produccion.actual;
  await stopEnv('produccion');
  startEnv('produccion', target, envVars, p);
  const result = await smoke(target, p, envVars, manifest);
  if (result.ok) {
    state.produccion = { actual: target, anterior: actual };
    log(state, { accion: 'rollback', release: target, desde: actual, esquemaNuevoAceptado: compat.desconocidas, resultado: 'ok' });
    lib.writeState(STATE, state);
    console.log(`Rollback terminado: en marcha ${target} (antes ${actual ?? 'ninguna'}).`);
    return;
  }
  await stopEnv('produccion');
  log(state, { accion: 'rollback', release: target, desde: actual, resultado: 'fallo', pruebas: result.checks.filter((c) => !c.ok) });
  lib.writeState(STATE, state);
  throw new Error(`${target} no pasó las pruebas de humo. Ninguna versión quedó en marcha; inicia la actual con npm run release:start.`);
}

function prune() {
  const state = lib.readState(STATE);
  const keep = Number(option('conservar') ?? 5);
  if (!Number.isInteger(keep) || keep < 2) throw new Error('--conservar debe ser 2 o más');
  const ids = fs.existsSync(RELEASES) ? fs.readdirSync(RELEASES) : [];
  const victims = lib.releasesToPrune(ids, state, keep);
  if (!victims.length) return console.log('No hay versiones que retirar.');
  for (const id of victims) {
    console.log(`${flag('apply') ? 'Eliminada' : 'Se eliminaría'}: ${id}`);
    if (flag('apply')) fs.rmSync(releaseDir(id), { recursive: true, force: true });
  }
  if (!flag('apply')) console.log('Vista previa. Agrega --apply para eliminar.');
}

async function stagingRefresh() {
  checkNode();
  const name = stagingName();
  await stopEnv('staging');
  const backups = path.join(root, '.backups');
  const chosen = option('backup')
    ? path.resolve(option('backup'))
    : path.join(backups, fs.readdirSync(backups).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d) && fs.existsSync(path.join(backups, d, 'database.dump'))).sort().at(-1) ?? '');
  const dump = chosen.endsWith('.dump') ? chosen : path.join(chosen, 'database.dump');
  if (!dump.startsWith(backups + path.sep) || !fs.existsSync(dump)) throw new Error('No hay respaldo en .backups; ejecuta npm run db:backup');
  console.log(`Restaurando ${path.relative(root, dump)} en ${name}…`);
  await withClient(databaseConfig(), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  });
  const env = { ...postgresEnvironment(), PGDATABASE: name };
  execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, dump], { env, windowsHide: true, stdio: 'pipe', timeout: 600000 });
  const uploads = path.join(STAGING_DATA, 'uploads');
  fs.rmSync(uploads, { recursive: true, force: true });
  const source = path.join(path.dirname(dump), 'uploads');
  if (fs.existsSync(source)) fs.cpSync(source, uploads, { recursive: true });
  else fs.mkdirSync(uploads, { recursive: true });
  const state = lib.readState(STATE);
  state.staging = { base: name, refrescadaEn: now(), respaldo: path.relative(root, path.dirname(dump)).split(path.sep).join('/'), resultado: null };
  log(state, { accion: 'staging-refresh', base: name, respaldo: state.staging.respaldo });
  lib.writeState(STATE, state);
  console.log(`Staging listo: ${name} con datos de ${state.staging.respaldo}. Siguiente: npm run staging:deploy -- --release=<id>`);
}

async function stagingDeploy() {
  checkNode();
  const id = option('release');
  if (!id) throw new Error('Indica --release=<id> (npm run release:list)');
  const { manifest } = loadRelease(id);
  const state = lib.readState(STATE);
  if (!state.staging.refrescadaEn) throw new Error('Primero crea la base de staging: npm run staging:refresh');
  const envVars = stagingEnv();
  const p = ports().staging;
  await stopEnv('staging');
  await assertPortsUsable('staging', p);
  const compat = lib.schemaCompatibility(manifest.migraciones, await appliedMigrations(envVars));
  if (compat.desconocidas.length) throw new Error(`La base de staging tiene migraciones que la versión no conoce (${compat.desconocidas.join(', ')}). Refresca staging.`);
  let aplicadas = [];
  if (compat.pendientes.length) {
    runMigrations(releaseDir(id), envVars, true);
    aplicadas = runMigrations(releaseDir(id), envVars, false);
  }
  startEnv('staging', id, envVars, p);
  console.log('Pruebas de humo en staging…');
  const result = await smoke(id, p, envVars, manifest);
  state.staging.resultado = { release: id, digest: manifest.digest, ok: result.ok, en: now(), migracionesAplicadas: aplicadas, pruebas: result.checks };
  log(state, { accion: 'staging-deploy', release: id, migracionesAplicadas: aplicadas, resultado: result.ok ? 'ok' : 'fallo' });
  lib.writeState(STATE, state);
  if (!result.ok) {
    await stopEnv('staging');
    throw new Error(`${id} no pasó staging; revisa releases/logs/staging-backend.log.`);
  }
  console.log(`Staging OK. Pruébalo en http://127.0.0.1:${p.frontend} (copia de datos, fiscal mock, sin correo). Al terminar: npm run staging:stop`);
  console.log(`Para desplegar: npm run release:deploy -- --release=${id}`);
}

const commands = {
  build, list, verify, status, start, stop: () => stopEnv('produccion').then((r) => r || console.log('produccion no estaba en marcha.')),
  deploy, rollback, prune, 'staging-refresh': stagingRefresh, 'staging-deploy': stagingDeploy,
  'staging-stop': () => stopEnv('staging').then((r) => r || console.log('staging no estaba en marcha.')),
};

const command = commands[process.argv[2]];
if (!command) {
  console.error(`Comando desconocido. Usa: ${Object.keys(commands).join(' | ')}`);
  process.exitCode = 1;
} else {
  fs.mkdirSync(RELEASES, { recursive: true });
  Promise.resolve().then(command).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
