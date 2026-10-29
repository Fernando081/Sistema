'use strict';
// O04 · Funciones puras de versiones, staging y despliegue local. Las usa scripts/release.js y se prueban
// con node --test (scripts/release.test.js). No leen .env ni tocan procesos ni la base de datos.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RELEASE_ID = /^\d{8}-\d{6}-[0-9a-f]{7,40}$/;
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function releaseId(date, commit) {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error('Commit inválido para la versión');
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${stamp}-${commit.slice(0, 7)}`;
}

function assertReleaseId(id) {
  if (typeof id !== 'string' || !RELEASE_ID.test(id)) throw new Error(`Identificador de versión inválido: ${id}`);
  return id;
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Huella de cada archivo bajo `dir`, en orden estable, omitiendo los directorios de `skip` (relativos). */
function hashTree(dir, skip = []) {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (entry.isSymbolicLink()) throw new Error(`La versión no admite enlaces simbólicos: ${rel}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[rel] = sha256(fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

/** Huella del manifiesto sin el campo calculado, para atar el resultado de staging a una versión exacta. */
function manifestDigest(manifest) {
  const { digest: _omit, ...rest } = manifest;
  return sha256(JSON.stringify(rest));
}

/** Diferencias entre el manifiesto y lo que hay en disco: archivos alterados, faltantes o agregados. */
function compareTree(expected, actual) {
  const problems = [];
  for (const [file, hash] of Object.entries(expected)) {
    if (!(file in actual)) problems.push(`Falta ${file}`);
    else if (actual[file] !== hash) problems.push(`Modificado ${file}`);
  }
  for (const file of Object.keys(actual)) if (!(file in expected)) problems.push(`Agregado ${file}`);
  return problems;
}

/** Paquetes externos que el código compilado requiere (require("x")), sin módulos de Node ni rutas relativas. */
function runtimeRequires(dir) {
  const { builtinModules } = require('node:module');
  const found = new Set();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/require\((["'])([^"'.][^"']*)\1\)/g)) {
          const spec = match[2];
          if (spec.startsWith('node:')) continue;
          const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
          if (!builtinModules.includes(name)) found.add(name);
        }
      }
    }
  };
  walk(dir);
  return [...found].sort();
}

function migrationList(dir) {
  return fs.readdirSync(dir).filter((f) => /^\d+.*\.(sql|js)$/.test(f)).sort();
}

/**
 * Compara las migraciones de una versión con las aplicadas en la base.
 * - pendientes: las que la versión aplicará;
 * - desconocidas: aplicadas en la base pero ausentes en la versión (código más viejo que el esquema).
 */
function schemaCompatibility(releaseMigrations, appliedMigrations) {
  const applied = new Set(appliedMigrations);
  const own = new Set(releaseMigrations);
  return {
    pendientes: releaseMigrations.filter((m) => !applied.has(m)),
    desconocidas: appliedMigrations.filter((m) => !own.has(m)),
  };
}

function stagingDbName(base, override) {
  const name = (override || `${base}_staging`).trim();
  if (!DB_NAME.test(name) || !name.endsWith('_staging')) throw new Error('La base de staging debe terminar en _staging y usar sólo minúsculas, dígitos y guion bajo');
  if (name === base) throw new Error('La base de staging no puede ser la base de trabajo');
  return name;
}

function port(value, fallback, label) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`${label} inválido`);
  return n;
}

/** Puertos de cada ambiente. Producción local usa 3100/4300; staging 3210/4310. */
function environmentPorts(env) {
  const ports = {
    produccion: { backend: port(env.RELEASE_BACKEND_PORT, 3100, 'RELEASE_BACKEND_PORT'), frontend: port(env.RELEASE_FRONTEND_PORT, 4300, 'RELEASE_FRONTEND_PORT') },
    staging: { backend: port(env.STAGING_BACKEND_PORT, 3210, 'STAGING_BACKEND_PORT'), frontend: port(env.STAGING_FRONTEND_PORT, 4310, 'STAGING_FRONTEND_PORT') },
  };
  const all = [ports.produccion.backend, ports.produccion.frontend, ports.staging.backend, ports.staging.frontend];
  if (new Set(all).size !== all.length) throw new Error('Los puertos de producción y staging deben ser distintos');
  return ports;
}

function origins(frontendPort) {
  return [`http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`];
}

/**
 * Variables del proceso del backend para un ambiente. `base` viene de backend/.env.
 * Staging fuerza modo fiscal mock, correo desactivado y puente web cerrado, y usa su propia base y carpeta.
 */
function processEnv(base, environment, options) {
  if ((base.NODE_ENV || '').trim() === 'production') throw new Error('NODE_ENV=production exige HTTPS y origen público (O04.2); el despliegue local corre en loopback');
  const env = { ...base, PORT: String(options.backendPort), UPLOAD_DIRECTORY: options.uploads };
  const front = origins(options.frontendPort);
  if (environment === 'staging') {
    if (!options.dbName) throw new Error('Falta la base de staging');
    if (env.DATABASE_URL) {
      const url = new URL(env.DATABASE_URL);
      url.pathname = `/${options.dbName}`;
      env.DATABASE_URL = url.toString();
    }
    env.DB_NAME = options.dbName;
    Object.assign(env, {
      FISCAL_MODE: 'mock', FISCAL_PRODUCTION_ENABLED: 'false', PAC_SW_USER: '', PAC_SW_PASSWORD: '', PAC_SW_TOKEN: '',
      MAIL_MODE: 'desactivado', SMTP_PASSWORD: '', EMAIL_PASS: '',
      WEB_LEAD_BRIDGE_ENABLED: 'false', WEB_INBOX_PURGE_ENABLED: 'false',
      CORS_ORIGINS: front.join(','),
    });
  } else {
    const configured = (env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (configured.length) env.CORS_ORIGINS = [...new Set([...configured, ...front])].join(',');
  }
  return env;
}

function assertLoopback(host) {
  if (!LOOPBACK.has(host)) throw new Error('El servidor de la versión sólo escucha en loopback; el acceso por red requiere HTTPS (O04.2)');
  return host;
}

/** Revisiones previas a un despliegue. Devuelve la lista de impedimentos (vacía si se puede desplegar). */
function deployBlockers(state, manifest, options = {}) {
  const blockers = [];
  if (manifest.dirty && !options.permitirSucio) blockers.push('La versión se generó con cambios sin commit; genera una versión desde un commit o usa --permitir-sucio');
  const staging = state.staging?.resultado;
  const stagedOk = staging && staging.ok && staging.release === manifest.id && staging.digest === manifest.digest;
  if (!stagedOk) {
    if (!options.omitirStaging) blockers.push('La versión no ha pasado staging (npm run staging:deploy -- --release=' + manifest.id + ')');
    else if (!options.motivo || options.motivo.trim().length < 10) blockers.push('Omitir staging requiere --motivo con al menos 10 caracteres');
  }
  if (state.produccion?.actual === manifest.id && !options.reinstalar) blockers.push('Esa versión ya es la actual; usa --reinstalar para volver a iniciarla');
  return blockers;
}

/** Destino de un rollback: la indicada o la anterior registrada. */
function rollbackTarget(state, requested) {
  const target = requested || state.produccion?.anterior;
  if (!target) throw new Error('No hay versión anterior registrada; indica --release=<id>');
  assertReleaseId(target);
  if (target === state.produccion?.actual) throw new Error('Esa versión ya es la actual');
  return target;
}

function emptyState() {
  return { schemaVersion: 1, produccion: { actual: null, anterior: null }, staging: { base: null, refrescadaEn: null, respaldo: null, resultado: null }, historial: [] };
}

function readState(file) {
  if (!fs.existsSync(file)) return emptyState();
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.schemaVersion !== 1) throw new Error('Formato de releases/state.json no reconocido');
  return { ...emptyState(), ...state };
}

function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Conserva las versiones referenciadas (actual, anterior, staging) y las `keep` más recientes. */
function releasesToPrune(ids, state, keep = 5) {
  const protectedIds = new Set([state.produccion?.actual, state.produccion?.anterior, state.staging?.resultado?.release].filter(Boolean));
  const sorted = [...ids].filter((id) => RELEASE_ID.test(id)).sort().reverse();
  return sorted.slice(keep).filter((id) => !protectedIds.has(id));
}

module.exports = {
  RELEASE_ID, releaseId, assertReleaseId, sha256, hashTree, manifestDigest, compareTree, runtimeRequires, migrationList,
  schemaCompatibility, stagingDbName, environmentPorts, origins, processEnv, assertLoopback,
  deployBlockers, rollbackTarget, emptyState, readState, writeState, releasesToPrune,
};
