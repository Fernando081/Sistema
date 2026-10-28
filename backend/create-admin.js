// O05 · Crea el primer administrador de una base (nueva o sin administradores activos).
// La contraseña se pide sin mostrarla en pantalla (o CREATE_ADMIN_PASSWORD para automatización); nunca se imprime ni se guarda en claro.
// Uso: node backend/create-admin.js --username=USUARIO [--database=NOMBRE]
const path = require('node:path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { databaseConfig } = require('./db-config');

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('Sin terminal interactiva: define CREATE_ADMIN_PASSWORD sólo para esta ejecución.'));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = (buffer) => {
      for (const ch of buffer.toString('utf8')) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); return resolve(value); }
        if (ch === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); return reject(new Error('Cancelado')); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const username = (arg('username') || '').trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) throw new Error('Indica --username= (3 a 64 letras, números, punto, guion o guion bajo)');
  let password = process.env.CREATE_ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('Contraseña (mínimo 10 caracteres): ');
    if (password !== await askHidden('Repite la contraseña: ')) throw new Error('Las contraseñas no coinciden');
  }
  // Misma regla que el ERP (backend/src/auth/password-policy.ts): 10 caracteres a 72 bytes.
  if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('La contraseña debe tener al menos 10 caracteres y no más de 72 bytes');
  const base = databaseConfig();
  const database = arg('database');
  let config = base;
  if (database) {
    if (!/^[a-z][a-z0-9_]{2,62}$/.test(database)) throw new Error('Nombre de base inválido');
    if (base.connectionString) { const url = new URL(base.connectionString); url.pathname = '/' + database; config = { connectionString: url.toString(), ...(base.ssl ? { ssl: base.ssl } : {}) }; }
    else config = { ...base, database };
  }
  const client = new Client(config);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('auth-user-administration'))");
    const admins = (await client.query("SELECT count(*)::int AS n FROM auth_user WHERE role='admin' AND is_active")).rows[0].n;
    if (admins) throw new Error('Ya existe un administrador activo; crea más usuarios desde el ERP.');
    if ((await client.query('SELECT 1 FROM auth_user WHERE username=$1', [username])).rows.length) throw new Error('Ese usuario ya existe');
    await client.query("INSERT INTO auth_user(username, password_hash, role, is_active) VALUES ($1, $2, 'admin', true)", [username, await bcrypt.hash(password, 10)]);
    await client.query('COMMIT');
    console.log(`Administrador ${username} creado en ${database || path.basename(String(base.database || 'la base configurada'))}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(`No se creó el administrador: ${error.message}`); process.exitCode = 1; });
