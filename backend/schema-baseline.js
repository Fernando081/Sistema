// O05 · Esquema base versionado y preparación reproducible de una base desde cero.
//   export  (mantenimiento) congela backend/schema/ desde la base configurada, ya migrada por completo.
//   init    crea una base NUEVA con el esquema base + catálogos de sistema y aplica migraciones posteriores.
//   verify  crea una base temporal con init, compara su esquema con la base configurada y la elimina.
// Los catálogos no incluyen datos de negocio, usuarios ni secretos; saldos inicia en cero.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { databaseConfig } = require('./db-config');
const { findPgTool, postgresEnvironment } = require('./backup');
const { canonicalChecksum } = require('./migration-checksum');

const SCHEMA_DIR = path.join(__dirname, 'schema');
const SCHEMA_FILE = path.join(SCHEMA_DIR, 'esquema-base.sql');
const DATA_FILE = path.join(SCHEMA_DIR, 'datos-base.sql');
const MANIFEST_FILE = path.join(SCHEMA_DIR, 'esquema-base.json');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** Tablas de sistema/catálogo (SAT, geografía, configuración sembrada por migraciones). Nada de negocio. */
const SEED_TABLES = [
  'claveproductooservicio', 'claveunidad', 'colonia', 'estado', 'municipio', 'localidad',
  'formadepago', 'metododepago', 'moneda', 'objetoimpuesto', 'regimenfiscal', 'tasaocuota',
  'tipocomprobante', 'tipofactor', 'tiporelacion', 'usocfdi', 'impuesto', 'meses', 'periodicidad', 'unidad',
  'cuenta_contable', 'app_permission', 'app_role_permission', 'comercial_regla_aprobacion', 'operational_job',
  'almacen', 'almacen_ubicacion', 'centro_costo', 'lista_precio',
];

const DB_NAME = /^[a-z][a-z0-9_]{2,62}$/;

function databaseEnvironment(name) {
  const env = { ...postgresEnvironment(), PGDATABASE: name, DB_NAME: name };
  const base = databaseConfig();
  if (base.connectionString) {
    const url = new URL(base.connectionString);
    url.pathname = '/' + name;
    env.DATABASE_URL = url.toString();
  } else delete env.DATABASE_URL;
  return env;
}

function clientFor(name) {
  const base = databaseConfig();
  if (base.connectionString) {
    const url = new URL(base.connectionString);
    url.pathname = '/' + name;
    return new Client({ connectionString: url.toString(), ...(base.ssl ? { ssl: base.ssl } : {}) });
  }
  return new Client({ ...base, database: name });
}

const currentDatabase = () => {
  const base = databaseConfig();
  return base.connectionString ? decodeURIComponent(new URL(base.connectionString).pathname.slice(1)) : base.database;
};

/**
 * pg_dump en Windows escribe en modo texto (cada \n sale como \r\n): se deshace una sola vez, lo que
 * conserva los \r propios de funciones creadas con CRLF. También quita la llave aleatoria de \restrict.
 */
function normalizeDump(text) {
  return text.replace(/\r\n/g, '\n').split('\n')
    .filter((line) => !/^\\(un)?restrict /.test(line))
    .join('\n');
}

function dumpSchema(name) {
  return normalizeDump(execFileSync(findPgTool('pg_dump'), ['--schema-only', '--no-owner', '--no-acl', '--schema=public'], {
    env: databaseEnvironment(name), windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 300000,
  }).toString('utf8'));
}

// Al restaurar, PostgreSQL vuelve a analizar expresiones y las imprime de otra forma equivalente:
// (ARRAY['a'::varchar])::text[] pasa a ARRAY[('a'::varchar)::text] (CHECK, índices parciales, vistas)
// y en los CHECK además cambia la agrupación de AND con paréntesis.
const ARRAY_CAST = /\(ARRAY\[((?:'(?:[^']|'')*'::[a-z ]+(?:\(\d+\))?(?:, )?)+)\]\)::text\[\]/g;
const ARRAY_ITEM = /'(?:[^']|'')*'::[a-z ]+(?:\(\d+\))?/g;
const canonicalArrays = (line) => line
  .replace(ARRAY_CAST, (_m, inner) => 'ARRAY[' + inner.match(ARRAY_ITEM).map((x) => `(${x})::text`).join(', ') + ']');
const canonicalCheck = (line) => canonicalArrays(line).replace(/[()]/g, '');

/** Compara línea por línea; tolera sólo la reescritura de ARRAY (cualquier línea) y la agrupación en líneas CHECK del mismo nombre. */
function compareSchemas(current, fresh) {
  const clean = (t) => t.split('\n').filter((l) => !/^-- Dumped (from|by)/.test(l));
  const a = clean(current);
  const b = clean(fresh);
  const differences = [];
  let reparsed = 0;
  if (a.length !== b.length) differences.push(`líneas ${a.length} vs ${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const isCheck = /^\s+CONSTRAINT \S+ CHECK /.test(a[i]) && a[i].split(' CHECK ')[0] === b[i].split(' CHECK ')[0];
    if (canonicalArrays(a[i]) === canonicalArrays(b[i]) || (isCheck && canonicalCheck(a[i]) === canonicalCheck(b[i]))) reparsed++;
    else differences.push(`línea ${i + 1}: actual="${a[i].trim()}" nueva="${b[i].trim()}"`);
  }
  return { differences, reparsed };
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((n) => /^\d+_.+\.(sql|js)$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function exportBaseline() {
  const name = currentDatabase();
  const client = clientFor(name);
  await client.connect();
  let applied;
  let counts = {};
  let version;
  try {
    applied = new Map((await client.query('SELECT filename, checksum FROM schema_migration')).rows.map((r) => [r.filename, r.checksum]));
    for (const table of SEED_TABLES) counts[table] = (await client.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n;
    version = (await client.query('SHOW server_version')).rows[0].server_version;
  } finally { await client.end(); }
  const files = migrationFiles();
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length) throw new Error(`La base tiene migraciones pendientes (${pending.join(', ')}); ejecuta db:migrate antes de exportar.`);
  const migraciones = files.map((archivo) => ({ archivo, checksum: canonicalChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, archivo))) }));

  let schema = dumpSchema(name);
  if (!schema.includes('\nCREATE SCHEMA public;\n')) throw new Error('Volcado inesperado: falta CREATE SCHEMA public');
  // pg_dump por esquema no incluye extensiones; pg_trgm (índices de búsqueda) debe existir antes de los índices.
  schema = schema.replace('\nCREATE SCHEMA public;\n', '\nCREATE SCHEMA public;\n\nCREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\n');
  const header = `-- O05 · Esquema base generado por "node backend/schema-baseline.js export" (${new Date().toISOString().slice(0, 10)}).\n-- Incluye migraciones hasta ${files[files.length - 1]}. No editar a mano; las nuevas estructuras van en migraciones.\n`;

  const data = normalizeDump(execFileSync(findPgTool('pg_dump'), ['--data-only', '--no-owner', '--no-acl', '--disable-triggers', ...SEED_TABLES.map((t) => `--table=public.${t}`)], {
    env: databaseEnvironment(name), windowsHide: true, maxBuffer: 512 * 1024 * 1024, timeout: 300000,
  }).toString('utf8'));
  const saldos = '\n-- Caja y banco inician en cero (la tabla saldos exige una sola fila).\nINSERT INTO public.saldos(id_saldo, caja_chica, cuenta_banco) VALUES (1, 0, 0);\nSELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence(\'public.saldos\', \'id_saldo\'), 1, true);\n';

  fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  fs.writeFileSync(SCHEMA_FILE, header + schema);
  fs.writeFileSync(DATA_FILE, `-- O05 · Catálogos de sistema para una base nueva (sin datos de negocio, usuarios ni secretos).\n` + data + saldos);
  const manifest = {
    generado: new Date().toISOString(), postgres: version,
    esquema_sha256: crypto.createHash('sha256').update(fs.readFileSync(SCHEMA_FILE)).digest('hex'),
    datos_sha256: crypto.createHash('sha256').update(fs.readFileSync(DATA_FILE)).digest('hex'),
    tablas_semilla: counts, migraciones,
  };
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Esquema base exportado: ${migraciones.length} migraciones, ${SEED_TABLES.length} tablas de catálogo.`);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) throw new Error('No existe backend/schema/esquema-base.json');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  for (const [file, key] of [[SCHEMA_FILE, 'esquema_sha256'], [DATA_FILE, 'datos_sha256']]) {
    // Los .sql se versionan sin conversión de fin de línea (.gitattributes -text): se comparan bytes exactos.
    if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== manifest[key]) throw new Error(`${path.basename(file)} no coincide con su huella del manifiesto`);
  }
  for (const m of manifest.migraciones) {
    const file = path.join(MIGRATIONS_DIR, m.archivo);
    if (!fs.existsSync(file) || canonicalChecksum(fs.readFileSync(file)) !== m.checksum) throw new Error(`La migración ${m.archivo} cambió o falta desde que se generó el esquema base`);
  }
  return manifest;
}

async function initDatabase(name, { log = console.log } = {}) {
  if (!DB_NAME.test(name)) throw new Error('Nombre de base inválido (minúsculas, números y _; 3 a 63 caracteres)');
  const manifest = readManifest();
  const admin = clientFor(currentDatabase());
  await admin.connect();
  try {
    if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rows.length) throw new Error(`La base ${name} ya existe; init sólo crea bases nuevas.`);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
  } finally { await admin.end(); }
  const client = clientFor(name);
  await client.connect();
  try {
    await client.query('DROP SCHEMA public'); // base recién creada y vacía; el esquema base crea public
  } finally { await client.end(); }
  const psql = (file) => execFileSync(findPgTool('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file], {
    env: databaseEnvironment(name), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 64 * 1024 * 1024,
  });
  psql(SCHEMA_FILE);
  log('Esquema base cargado.');
  psql(DATA_FILE);
  log('Catálogos de sistema cargados.');
  const seeded = clientFor(name);
  await seeded.connect();
  try {
    for (const m of manifest.migraciones) await seeded.query('INSERT INTO schema_migration(filename, checksum) VALUES ($1, $2)', [m.archivo, m.checksum]);
  } finally { await seeded.end(); }
  const options = { env: databaseEnvironment(name), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 };
  execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js'), '--check'], options);
  const out = execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], options).toString();
  const applied = out.split('\n').filter((l) => l.startsWith('Aplicada')).length;
  log(`Migraciones registradas del esquema base: ${manifest.migraciones.length}; aplicadas después: ${applied}.`);
}

async function dropDatabase(name) {
  const admin = clientFor(currentDatabase());
  await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await admin.end(); }
}

async function verify() {
  const name = `sistema_fresh_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const report = { base: name, comprobaciones: [] };
  const check = (nombre, ok, detalle = '') => { report.comprobaciones.push({ nombre, ok: Boolean(ok), detalle }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${nombre}${ok ? '' : ' :: ' + detalle}`); };
  try {
    const manifest = readManifest();
    check('manifiesto, huellas y migraciones congeladas coinciden', true);
    await initDatabase(name, { log: () => {} });
    check('init crea la base desde cero sin errores', true);
    const fresh = dumpSchema(name);
    const current = dumpSchema(currentDatabase());
    const { differences, reparsed } = compareSchemas(current, fresh);
    check(`esquema de la base nueva equivalente al de la base configurada (${reparsed} expresiones reescritas por PostgreSQL al restaurar)`, !differences.length, differences.slice(0, 3).join(' | '));
    const client = clientFor(name);
    await client.connect();
    try {
      // Se compara con la base configurada: las migraciones posteriores al esquema base también siembran catálogos.
      const mismatched = [];
      const actual = clientFor(currentDatabase());
      await actual.connect();
      try {
        for (const table of Object.keys(manifest.tablas_semilla)) {
          const got = (await client.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n;
          const expected = (await actual.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n;
          if (got !== expected) mismatched.push(`${table} ${got}/${expected}`);
        }
      } finally { await actual.end(); }
      check('catálogos con el mismo número de filas que la base configurada', !mismatched.length, mismatched.join(', '));
      const business = [];
      for (const table of ['auth_user', 'cliente', 'proveedor', 'producto', 'factura', 'compra', 'kardex', 'poliza_contable', 'auditoria_jsonb']) {
        if ((await client.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n) business.push(table);
      }
      check('sin datos de negocio, usuarios ni auditoría', !business.length, business.join(', '));
      const saldo = (await client.query('SELECT caja_chica, cuenta_banco FROM saldos')).rows;
      check('una fila de saldos en cero', saldo.length === 1 && Number(saldo[0].caja_chica) === 0 && Number(saldo[0].cuenta_banco) === 0, JSON.stringify(saldo));
      const pending = execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js'), '--status'], { env: databaseEnvironment(name), windowsHide: true }).toString();
      check('sin migraciones pendientes', !/^Pendiente/m.test(pending));
      // El primer administrador se crea con la misma herramienta que usará el propietario.
      const password = crypto.randomBytes(18).toString('base64url');
      execFileSync(process.execPath, [path.join(__dirname, 'create-admin.js'), `--database=${name}`, '--username=admin_verificacion'], { env: { ...process.env, CREATE_ADMIN_PASSWORD: password }, windowsHide: true, stdio: 'pipe' });
      const [user] = (await client.query("SELECT role, is_active, password_hash FROM auth_user WHERE username='admin_verificacion'")).rows;
      const bcrypt = require('bcrypt');
      check('create-admin crea un administrador activo con contraseña bcrypt', user && user.role === 'admin' && user.is_active && await bcrypt.compare(password, user.password_hash));
      let refused = false;
      try { execFileSync(process.execPath, [path.join(__dirname, 'create-admin.js'), `--database=${name}`, '--username=otro_admin'], { env: { ...process.env, CREATE_ADMIN_PASSWORD: password }, windowsHide: true, stdio: 'pipe' }); } catch { refused = true; }
      check('create-admin se niega si ya hay un administrador activo', refused);
      const perms = (await client.query("SELECT count(*)::int n FROM app_role_permission WHERE role='admin'")).rows[0].n;
      check('permisos de rol admin presentes', perms > 0, String(perms));
      // Funcionamiento real: cliente y proveedor de prueba sólo en esta base temporal y el mismo arnés de operaciones de verify:release.
      const [r616] = (await client.query(`SELECT "IdRegimenFiscal" AS id FROM regimenfiscal WHERE "Clave"='616'`)).rows;
      await client.query(`INSERT INTO cliente("RFC","RazonSocial","CodigoPostal","IdRegimenFiscal") VALUES ('XAXX010101000','PUBLICO EN GENERAL','89000',$1)`, [r616.id]);
      await client.query(`INSERT INTO proveedor("RFC","RazonSocial","CodigoPostal","IdRegimenFiscal") VALUES ('XAXX010101000','PROVEEDOR VERIFICACION','89000',$1)`, [r616.id]);
      const operations = path.join(__dirname, 'scratch', 'verify-operaciones-2026-09-16.js');
      const out = execFileSync(process.execPath, [operations], { env: { ...databaseEnvironment(name), TEST_DATABASE_ISOLATED: 'true' }, windowsHide: true, stdio: 'pipe', timeout: 600000, cwd: path.resolve(__dirname, '..') }).toString();
      check('operaciones aisladas aprobadas en la base nueva (ventas, compras, caja, NC/REP, fiscal mock, pedidos, abastecimiento, cuentas por pagar, tesorería)', /Operaciones aisladas aprobadas/.test(out), out.slice(-500));
    } finally { await client.end(); }
  } catch (error) {
    check('ejecución sin errores', false, (error.stderr ? error.stderr.toString() : '') || error.message);
  } finally {
    await dropDatabase(name).catch(() => {});
    const admin = clientFor(currentDatabase());
    await admin.connect();
    const left = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rows.length;
    await admin.end();
    check('base temporal eliminada', !left);
  }
  const failed = report.comprobaciones.filter((c) => !c.ok).length;
  console.log(`\n${report.comprobaciones.length - failed}/${report.comprobaciones.length} comprobaciones aprobadas`);
  process.exitCode = failed ? 1 : 0;
}

async function main() {
  const command = process.argv[2];
  const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  if (command === 'export') await exportBaseline();
  else if (command === 'init') {
    const name = arg('database');
    if (!name) throw new Error('Indica --database=NOMBRE (base nueva)');
    await initDatabase(name);
    console.log(`Base ${name} lista. Siguiente: node backend/create-admin.js --database=${name} --username=TU_USUARIO, y luego DB_NAME=${name} en backend/.env.`);
  } else if (command === 'verify') await verify();
  else { console.log('Uso: node backend/schema-baseline.js export|init --database=NOMBRE|verify'); process.exitCode = 1; }
}

if (require.main === module) main().catch((error) => { console.error(`Esquema base: ${error.stderr ? error.stderr.toString().trim() : error.message}`); process.exitCode = 1; });

module.exports = { initDatabase, normalizeDump, compareSchemas, SEED_TABLES };
