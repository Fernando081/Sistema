const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { databaseConfig } = require('./db-config');

const migrationsDir = path.join(__dirname, 'migrations');
const baselineArg = process.argv.find((arg) => arg.startsWith('--baseline-through='));
const baselineThrough = baselineArg ? Number(baselineArg.split('=')[1]) : null;
const dryRun = process.argv.includes('--check');
const statusOnly = process.argv.includes('--status');

async function run() {
  if (baselineThrough !== null && (!Number.isSafeInteger(baselineThrough) || baselineThrough < 0)) {
    throw new Error('--baseline-through debe ser un entero no negativo');
  }
  if (baselineThrough !== null && (dryRun || statusOnly)) throw new Error('No combines baseline con --check o --status');
  if (!process.env.DATABASE_URL && (!process.env.DB_PASSWORD || !process.env.DB_NAME)) {
    throw new Error('Configura DATABASE_URL o DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.');
  }

  const client = new Client(databaseConfig());
  await client.connect();
  try {
    await client.query("SET lock_timeout = '15s'");
    await client.query("SET statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_lock(hashtext('sistema-schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(migrationsDir)
      .filter((name) => /^\d+_.+\.(sql|js)$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const existing = await client.query('SELECT filename, checksum FROM schema_migration');
    const applied = new Map(existing.rows.map((row) => [row.filename, row.checksum]));
    // Verifica TODO el historial antes de escribir cualquier migración nueva.
    for (const filename of files) {
      const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, filename))).digest('hex');
      if (applied.has(filename) && applied.get(filename) !== checksum) throw new Error(`La migración aplicada cambió: ${filename}`);
    }
    if (statusOnly) {
      for (const filename of files) console.log(`${applied.has(filename) ? 'Aplicada' : 'Pendiente'}: ${filename}`);
      return;
    }

    if (baselineThrough !== null) {
      for (const filename of files) {
        const number = Number(filename.split('_')[0]);
        if (number <= baselineThrough && !applied.has(filename)) {
          const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
          const checksum = crypto.createHash('sha256').update(sql).digest('hex');
          await client.query(
            'INSERT INTO schema_migration(filename, checksum) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [filename, checksum],
          );
          applied.set(filename, checksum);
          console.log(`Baseline: ${filename}`);
        }
      }
    }

    if (dryRun) await client.query('BEGIN');
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(filename)) {
        if (applied.get(filename) !== checksum) {
          throw new Error(`La migración aplicada cambió: ${filename}`);
        }
        continue;
      }

      if (!dryRun) await client.query('BEGIN');
      try {
        if (filename.endsWith('.sql')) await client.query(sql);
        else {
          const migration = require(path.join(migrationsDir, filename));
          if (typeof migration.up !== 'function') throw new Error(`Migración sin función up: ${filename}`);
          await migration.up(client);
        }
        await client.query(
          'INSERT INTO schema_migration(filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
        if (!dryRun) await client.query('COMMIT');
        console.log(`${dryRun ? 'Verificada (se revertirá)' : 'Aplicada'}: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Verificación terminada: cambios de esquema revertidos.');
    }
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
