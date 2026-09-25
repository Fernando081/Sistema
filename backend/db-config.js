const path = require('node:path');
require('dotenv').config({ path: [path.resolve(__dirname, '..', '.env'), path.join(__dirname, '.env')], quiet: true });

function sslConfig() {
  const truthy = new Set(['true', '1', 'yes', 'y', 'on']);
  if (!truthy.has((process.env.DB_SSL || '').trim().toLowerCase())) return undefined;
  const raw = (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase();
  const rejectUnauthorized = raw === '' || truthy.has(raw);
  if (!rejectUnauthorized && process.env.NODE_ENV === 'production') throw new Error('Producción requiere verificar el certificado TLS de PostgreSQL');
  return { rejectUnauthorized };
}

function databaseConfig() {
  const ssl = sslConfig();
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ...(ssl ? { ssl } : {}) };
  if (!process.env.DB_PASSWORD || !process.env.DB_NAME) {
    throw new Error('Configura DATABASE_URL o DB_PASSWORD y DB_NAME antes de ejecutar este script.');
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ...(ssl ? { ssl } : {}),
  };
}

module.exports = { databaseConfig };
