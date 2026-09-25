// Respaldo local reproducible. Nunca pasa contraseñas como argumentos del proceso.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { databaseConfig } = require('./db-config');

function findPgTool(name) {
  const binary = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, binary);
  if (process.platform === 'win32') {
    const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    const versions = fs.existsSync(root) ? fs.readdirSync(root).filter((entry) => /^\d+$/.test(entry)).sort((a, b) => Number(b) - Number(a)) : [];
    for (const version of versions) {
      const candidate = path.join(root, version, 'bin', binary);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return binary;
}

function postgresEnvironment() {
  const config = databaseConfig();
  const env = { ...process.env };
  if (config.connectionString) {
    const url = new URL(config.connectionString);
    env.PGHOST = url.hostname;
    env.PGPORT = url.port || '5432';
    env.PGUSER = decodeURIComponent(url.username);
    env.PGPASSWORD = decodeURIComponent(url.password);
    env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
    if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  } else {
    Object.assign(env, { PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user, PGPASSWORD: config.password, PGDATABASE: config.database });
  }
  if (config.ssl) env.PGSSLMODE = config.ssl.rejectUnauthorized ? 'verify-full' : 'require';
  return env;
}

function backup() {
  const backupRoot = path.resolve(__dirname, '..', '.backups');
  const destination = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(destination, { recursive: true });
  const dumpFile = path.join(destination, 'database.dump');
  const options = { env: postgresEnvironment(), windowsHide: true, stdio: 'pipe', timeout: 120000 };
  execFileSync(findPgTool('pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '--file', dumpFile], options);
  const index = execFileSync(findPgTool('pg_restore'), ['--list', dumpFile], options);
  fs.writeFileSync(path.join(destination, 'database-index.txt'), index);
  const uploads = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(destination, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'README.txt'), 'Respaldo PostgreSQL custom y uploads. El índice fue leído con pg_restore --list. Esto verifica legibilidad, no sustituye un ensayo de restauración en base aislada.\n');
  console.log(`Respaldo creado y legible: ${destination}`);
}

if (require.main === module) {
  try { backup(); } catch (error) {
    console.error(`No se completó el respaldo (${error.code || error.status || error.name}). Revisa acceso a PostgreSQL y PG_BIN.`);
    process.exitCode = 1;
  }
}
module.exports = { findPgTool, postgresEnvironment };
