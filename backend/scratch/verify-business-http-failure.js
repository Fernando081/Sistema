const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFile } = require('node:child_process');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const backup = process.argv.find((x) => x.startsWith('--backup='));
  assert.ok(backup);
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const names = async () =>
      (
        await client.query(
          "SELECT datname FROM pg_database WHERE datname ~ '^sistema_http_[0-9]+_[a-f0-9]{6}$' ORDER BY datname",
        )
      ).rows.map((x) => x.datname);
    const before = await names(),
      report = path.resolve(
        __dirname,
        '../../docs/q0453c2c3b-http-business.json',
      ),
      original = fs.existsSync(report) ? fs.readFileSync(report) : null;
    const result = await new Promise((resolve) =>
      execFile(
        process.execPath,
        [
          path.join(__dirname, 'verify-list-business-http.js'),
          '--duration=5',
          '--fixtures=1000',
          '--generator-failure',
          backup,
        ],
        {
          windowsHide: true,
          timeout: 180000,
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
        },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      ),
    );
    assert.equal(result.error?.code, 1, 'El fallo debe acabar con exit 1');
    assert.ok(
      result.stderr.includes('Generador falló'),
      'No fue el fallo de generador esperado',
    );
    assert.deepEqual(await names(), before, 'Se dejó una base temporal');
    if (original)
      assert.deepEqual(
        fs.readFileSync(report),
        original,
        'Un fallo reemplazó el reporte de éxito',
      );
    else assert.equal(fs.existsSync(report), false);
    console.log(
      'Caída del generador: error esperado, copia eliminada y reporte previo conservado.',
    );
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
