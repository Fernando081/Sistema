const { Client } = require('pg');
const { canonicalChecksum, matchesChecksum } = require('./migration-checksum');
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
      const content = fs.readFileSync(path.join(migrationsDir, filename));
      if (applied.has(filename) && !matchesChecksum(applied.get(filename), content)) throw new Error(`La migración aplicada cambió: ${filename}`);
    }
    if (!statusOnly && !dryRun) {
      // Re-sella checksums históricos de bytes crudos sólo cuando el archivo actual
      // coincide exactamente con lo registrado; así un clon con otro fin de línea valida.
      for (const filename of files) {
        if (!applied.has(filename)) continue;
        const content = fs.readFileSync(path.join(migrationsDir, filename));
        const canonical = canonicalChecksum(content);
        if (applied.get(filename) === canonical) continue;
        await client.query(
          'UPDATE schema_migration SET checksum = $2 WHERE filename = $1 AND checksum = $3',
          [filename, canonical, applied.get(filename)],
        );
        applied.set(filename, canonical);
        console.log(`Checksum normalizado: ${filename}`);
      }
    }
    if (statusOnly) {
      for (const filename of files) console.log(`${applied.has(filename) ? 'Aplicada' : 'Pendiente'}: ${filename}`);
      return;
    }

    if (baselineThrough !== null) {
      for (const filename of files) {
        const number = Number(filename.split('_')[0]);
        if (number <= baselineThrough && !applied.has(filename)) {
          const checksum = canonicalChecksum(fs.readFileSync(path.join(migrationsDir, filename)));
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
      const content = fs.readFileSync(path.join(migrationsDir, filename));
      const sql = content.toString('utf8');
      const checksum = canonicalChecksum(content);
      if (applied.has(filename)) {
        if (!matchesChecksum(applied.get(filename), content)) {
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
