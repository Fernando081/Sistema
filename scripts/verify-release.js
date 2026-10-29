'use strict';
// O04 · Aceptación de punta a punta del ciclo versión → staging → despliegue → rollback, sin tocar la operación:
// usa un directorio de versiones temporal, puertos propios y dos copias del último respaldo en bases o04_*.
// El "producción" de la prueba es la copia o04_verificacion_prod; al terminar se eliminan bases, procesos,
// versiones y los respaldos de esa copia. Uso: npm run test:release-deploy [-- --backup=.backups/<fecha>]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, execFileSync } = require('node:child_process');
const { databaseConfig } = require('../backend/db-config');
const { findPgTool, postgresEnvironment } = require('../backend/backup');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const PROD_DB = 'o04_verificacion_prod';
const STAGING_DB = 'o04_verificacion_staging';
const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'o04-releases-'));
const env = {
  ...process.env, RELEASES_DIR: releasesDir, DB_NAME: PROD_DB, STAGING_DB_NAME: STAGING_DB,
  RELEASE_BACKEND_PORT: '3150', RELEASE_FRONTEND_PORT: '4350', STAGING_BACKEND_PORT: '3260', STAGING_FRONTEND_PORT: '4360',
};
delete env.DATABASE_URL;
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'OK ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`); };

function cli(command, ...args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'release.js'), command, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 900000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const get = (port, p) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: p, timeout: 5000, agent: false }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); })
    .on('error', () => resolve({ status: 0, body: '' }));
});
const state = () => JSON.parse(fs.readFileSync(path.join(releasesDir, 'state.json'), 'utf8'));
const releaseIds = () => fs.readdirSync(releasesDir).filter((d) => /^\d{8}-\d{6}-/.test(d)).sort();

async function admin(work) {
  const c = new Client(databaseConfig());
  await c.connect();
  try { return await work(c); } finally { await c.end(); }
}

async function main() {
  const backups = path.join(root, '.backups');
  const arg = process.argv.find((a) => a.startsWith('--backup='))?.slice(9);
  const backup = arg ? path.resolve(arg) : path.join(backups, fs.readdirSync(backups).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d) && fs.existsSync(path.join(backups, d, 'database.dump'))).sort().at(-1));
  const before = new Set(fs.readdirSync(backups));
  console.log(`Respaldo base: ${path.relative(root, backup)} · versiones en ${releasesDir}`);
  try {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${PROD_DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${PROD_DB}" TEMPLATE template0`);
    });
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', PROD_DB, path.join(backup, 'database.dump')], { env: { ...postgresEnvironment(), PGDATABASE: PROD_DB }, windowsHide: true, stdio: 'pipe', timeout: 600000 });
    const files = fs.readdirSync(path.join(root, 'backend', 'migrations')).filter((f) => /^\d+.*\.(sql|js)$/.test(f)).sort();
    const appliedProd = async () => {
      const c = new Client({ ...databaseConfig(), database: PROD_DB });
      await c.connect();
      try { return (await c.query('SELECT filename FROM schema_migration')).rows.map((r) => r.filename); } finally { await c.end(); }
    };
    const appliedAtStart = new Set(await appliedProd());
    const pendingAtStart = files.filter((f) => !appliedAtStart.has(f));
    step('Copia "producción" restaurada', true, `${pendingAtStart.length} migraciones pendientes (${pendingAtStart.join(', ') || 'ninguna'})`);

    let r = cli('build');
    step('build rechaza el árbol con cambios sin commit', r.code !== 0 && /sin commit/.test(r.out));
    r = cli('build', '--permitir-sucio');
    const [a] = releaseIds();
    step('build crea la versión A con manifiesto', r.code === 0 && a, a);
    const manifestA = JSON.parse(fs.readFileSync(path.join(releasesDir, a, 'manifest.json'), 'utf8'));
    step('El manifiesto registra commit, sucio y migraciones', manifestA.dirty === true && manifestA.ultimaMigracion === files.at(-1) && manifestA.migraciones.length === files.length, manifestA.ultimaMigracion);

    r = cli('verify', `--release=${a}`);
    step('verify confirma la integridad', r.code === 0 && /íntegra/.test(r.out));
    const tampered = path.join(releasesDir, a, 'backend', 'dist', 'main.js');
    const original = fs.readFileSync(tampered);
    fs.appendFileSync(tampered, '\n// alterado');
    r = cli('verify', `--release=${a}`);
    step('verify detecta un archivo alterado', r.code !== 0 && /Modificado backend\/dist\/main\.js/.test(r.out));
    fs.writeFileSync(tampered, original);

    r = cli('deploy', `--release=${a}`, '--permitir-sucio');
    step('deploy exige staging aprobado', r.code !== 0 && /no ha pasado staging/.test(r.out));
    r = cli('staging-deploy', `--release=${a}`);
    step('staging-deploy exige refrescar staging', r.code !== 0 && /staging:refresh/.test(r.out));

    r = cli('staging-refresh', `--backup=${backup}`);
    step('staging-refresh restaura la copia en la base _staging', r.code === 0 && state().staging.base === STAGING_DB, r.code ? r.out.slice(-300) : '');
    r = cli('staging-deploy', `--release=${a}`);
    const stagingA = state().staging.resultado;
    step('staging-deploy aplica migraciones y pasa las pruebas de humo', r.code === 0 && stagingA.ok && stagingA.release === a && stagingA.migracionesAplicadas.length === pendingAtStart.length,
      r.code ? r.out.slice(-600) : `${stagingA.pruebas.length} pruebas, ${stagingA.migracionesAplicadas.length} migraciones`);
    step('Staging sirve la versión A en su puerto', JSON.parse((await get(4360, '/__version')).body || '{}').release === a);
    const login = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: 4360, path: '/api/v1/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4360' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', () => resolve(0));
      req.end(JSON.stringify({ username: 'o04-no-existe', password: 'incorrecta-123' }));
    });
    step('Login por el proxy de staging llega al backend (rechazo 401)', login === 401, `HTTP ${login}`);
    r = cli('staging-stop');
    step('staging-stop detiene staging', r.code === 0 && (await get(3260, '/api/v1/health')).status === 0);

    r = cli('deploy', `--release=${a}`);
    step('deploy rechaza una versión sin commit sin permiso explícito', r.code !== 0 && /sin commit/.test(r.out));
    r = cli('deploy', `--release=${a}`, '--permitir-sucio');
    const afterA = state();
    const deployA = afterA.historial.filter((h) => h.accion === 'deploy').at(-1);
    step('deploy A: respaldo previo, migraciones, cambio y pruebas de humo', r.code === 0 && afterA.produccion.actual === a && deployA.respaldo && deployA.migracionesAplicadas.length === pendingAtStart.length,
      r.code ? r.out.slice(-600) : `${deployA.respaldo}, ${deployA.migracionesAplicadas.length} migraciones`);
    const appliedAfter = new Set(await appliedProd());
    step('La copia "producción" quedó sin migraciones pendientes', files.every((f) => appliedAfter.has(f)));
    step('El respaldo previo existe y es legible', fs.existsSync(path.join(root, deployA.respaldo, 'database.dump')) && fs.existsSync(path.join(root, deployA.respaldo, 'database-index.txt')));

    r = cli('build', '--permitir-sucio');
    const b = releaseIds().at(-1);
    step('build crea la versión B', r.code === 0 && b !== a, b);
    r = cli('deploy', `--release=${b}`, '--permitir-sucio');
    step('deploy B sin staging se rechaza aunque A pasó', r.code !== 0 && /no ha pasado staging/.test(r.out));
    r = cli('deploy', `--release=${b}`, '--permitir-sucio', '--omitir-staging', '--motivo=corto');
    step('Omitir staging exige un motivo suficiente', r.code !== 0 && /--motivo/.test(r.out));
    r = cli('staging-deploy', `--release=${b}`);
    step('staging-deploy B sin migraciones nuevas', r.code === 0 && state().staging.resultado.migracionesAplicadas.length === 0);
    cli('staging-stop');
    r = cli('deploy', `--release=${b}`, '--permitir-sucio');
    const afterB = state();
    step('deploy B reemplaza a A y la conserva como anterior', r.code === 0 && afterB.produccion.actual === b && afterB.produccion.anterior === a && JSON.parse((await get(4350, '/__version')).body || '{}').release === b);

    r = cli('rollback');
    const afterRollback = state();
    const servedAfterRollback = JSON.parse((await get(4350, '/__version')).body || '{}').release;
    step('rollback regresa a A sin tocar la base', r.code === 0 && afterRollback.produccion.actual === a && afterRollback.produccion.anterior === b && servedAfterRollback === a,
      r.code ? r.out.slice(-800) : `${JSON.stringify(afterRollback.produccion)} sirve ${servedAfterRollback}`);

    // Fallo simulado: B sin un módulo de producción no arranca; el despliegue debe volver solo a A.
    const broken = path.join(releasesDir, b, 'node_modules', '@nestjs', 'core');
    fs.renameSync(broken, `${broken}.oculto`);
    r = cli('deploy', `--release=${b}`, '--permitir-sucio', '--omitir-staging', '--motivo=Prueba de fallo controlado O04');
    const afterFail = state();
    step('Un despliegue que falla las pruebas de humo vuelve solo a la versión anterior', r.code !== 0 && /Quedó en marcha/.test(r.out) && afterFail.produccion.actual === a &&
      afterFail.historial.at(-1).resultado === 'fallo-revertido' && JSON.parse((await get(4350, '/__version')).body || '{}').release === a, afterFail.historial.at(-1).resultado);
    fs.renameSync(`${broken}.oculto`, broken);

    r = cli('status');
    step('status informa la versión en marcha', r.code === 0 && r.out.includes(`en marcha ${a}`));
    r = cli('stop');
    step('stop detiene producción', r.code === 0 && (await get(3150, '/api/v1/health')).status === 0);
    r = cli('start');
    step('start vuelve a iniciar la versión actual', r.code === 0 && JSON.parse((await get(4350, '/__version')).body || '{}').release === a);
    r = cli('prune', '--conservar=2');
    step('prune no propone retirar versiones protegidas', r.code === 0 && /No hay versiones que retirar/.test(r.out));
  } finally {
    cli('stop');
    cli('staging-stop');
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${PROD_DB}" WITH (FORCE)`);
      await c.query(`DROP DATABASE IF EXISTS "${STAGING_DB}" WITH (FORCE)`);
    });
    for (const d of fs.readdirSync(backups)) if (!before.has(d) && /^\d{4}-\d{2}-\d{2}T/.test(d)) fs.rmSync(path.join(backups, d), { recursive: true, force: true });
    // Bitácoras de la prueba para diagnóstico (carpeta ignorada por git).
    if (fs.existsSync(path.join(releasesDir, 'logs'))) fs.cpSync(path.join(releasesDir, 'logs'), path.join(root, '.artifacts', 'local', 'o04-logs'), { recursive: true });
    fs.rmSync(releasesDir, { recursive: true, force: true });
  }
  const report = { id: 'O04.1', fecha: new Date().toISOString(), respaldoBase: path.relative(root, backup).split(path.sep).join('/'), total: results.length, aprobadas: results.filter((x) => x.ok).length, resultados: results };
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.artifacts', 'o04-despliegue.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.aprobadas}/${report.total} comprobaciones. Reporte: .artifacts/o04-despliegue.json`);
  if (report.aprobadas !== report.total) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
