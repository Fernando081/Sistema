const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const backup = process.argv.find((x) => x.startsWith('--backup='));
  assert.ok(backup);
  const serverTransport = process.argv.includes('--server-transport');
  const transportSearch =
    serverTransport || process.argv.includes('--transport-search');
  const transportProbe =
    transportSearch || process.argv.includes('--transport-probe');
  const transportFailure = process.argv.includes('--transport-failure');
  assert.ok(!transportFailure || transportProbe);
  const financialHttp = process.argv.includes('--financial-http');
  const separateFinancialClient = process.argv.includes(
    '--separate-financial-client',
  );
  const memoryDiagnostic =
    separateFinancialClient || process.argv.includes('--memory-diagnostic');
  const extendedSoak = process.argv.includes('--extended-soak');
  const separatedExtended = separateFinancialClient && extendedSoak;
  const separatedPhase = transportProbe
    ? transportSearch
      ? serverTransport
        ? 'Q04.5.3c2c3d12c'
        : 'Q04.5.3c2c3d12b'
      : 'Q04.5.3c2c3d12'
    : separatedExtended
      ? 'Q04.5.3c2c3d11'
      : 'Q04.5.3c2c3d10';
  const separatedStem = transportProbe
    ? transportSearch
      ? serverTransport
        ? 'q0453c2c3d12c-server'
        : 'q0453c2c3d12b-search'
      : 'q0453c2c3d12-transport'
    : separatedExtended
      ? 'q0453c2c3d11-separated-soak'
      : 'q0453c2c3d10-separated';
  const commercialDocumentsHttp =
    memoryDiagnostic ||
    extendedSoak ||
    process.argv.includes('--commercial-documents-http');
  const documentsHttp =
    commercialDocumentsHttp || process.argv.includes('--documents-http');
  const supplierRetries =
    documentsHttp || process.argv.includes('--supplier-retry-http');
  const reversalsHttp =
    supplierRetries || process.argv.includes('--reversals-http');
  const profileArg = process.argv.find((x) => x.startsWith('--profile='));
  const profile = profileArg
    ? require('./full-app-load-profiles').selectProfile(profileArg.slice(10))
    : null;
  assert.ok(
    !extendedSoak || profile?.name === 'soak',
    '--extended-soak requiere --profile=soak',
  );
  assert.ok(
    !memoryDiagnostic || profile?.name === 'soak',
    '--memory-diagnostic requiere --profile=soak',
  );
  const financialClientFailure = process.argv.includes(
    '--financial-client-failure',
  );
  assert.ok(!financialClientFailure || separateFinancialClient);
  const coverageFailure = process.argv.includes('--coverage-failure');
  assert.ok(!coverageFailure || separatedExtended);
  const objectiveFailure = process.argv.includes('--objective-failure');
  assert.ok(
    !process.argv.includes('--require-profile') || profile,
    'Selecciona --profile=mostrador|operaciones|soak',
  );
  assert.ok(!objectiveFailure || profile, 'Fallo de objetivo requiere perfil');
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const names = async () =>
      (
        await client.query(
          "SELECT datname FROM pg_database WHERE datname ~ '^sistema_http_[0-9]+_[a-f0-9]{6}$' ORDER BY datname",
        )
      ).rows.map((x) => x.datname);
    const childPids = () =>
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*full-app-financial-client.js*' } | Sort-Object ProcessId | ForEach-Object { $_.ProcessId }",
        ],
        { encoding: 'utf8', windowsHide: true },
      ).trim();
    const beforeChildren = separateFinancialClient ? childPids() : null;
    const before = await names(),
      report = path.resolve(
        __dirname,
        separateFinancialClient
          ? `../../docs/${separatedStem}.json`
          : memoryDiagnostic
            ? '../../docs/q0453c2c3d9-memory-diagnostic.json'
            : extendedSoak
              ? '../../docs/q0453c2c3d8-extended-soak.json'
              : commercialDocumentsHttp
                ? '../../docs/q0453c2c3d7-commercial-documents.json'
                : documentsHttp
                  ? '../../docs/q0453c2c3d6-documents-http.json'
                  : supplierRetries
                    ? '../../docs/q0453c2c3d5-supplier-retry.json'
                    : reversalsHttp
                      ? '../../docs/q0453c2c3d4-reversals-http.json'
                      : profile
                        ? `../../docs/q0453c2c3d3-${profile.name}.json`
                        : financialHttp
                          ? '../../docs/q0453c2c3d2-financial-http.json'
                          : '../../docs/q0453c2c3c-full-app.json',
      ),
      original = fs.existsSync(report) ? fs.readFileSync(report) : null;
    const result = await new Promise((resolve) =>
      execFile(
        process.execPath,
        [
          path.join(__dirname, 'verify-full-app-load.js'),
          '--duration=40',
          '--fixtures=1000',
          ...(transportSearch ? ['--transport-search'] : []),
          ...(serverTransport ? ['--server-transport'] : []),
          ...(transportProbe ? ['--transport-probe'] : []),
          ...(transportFailure ? ['--transport-failure'] : []),
          ...(financialClientFailure ? ['--financial-client-failure'] : []),
          ...(coverageFailure ? ['--coverage-failure'] : []),
          ...(transportFailure || financialClientFailure || coverageFailure
            ? []
            : objectiveFailure
              ? ['--objective-failure']
              : ['--generator-failure']),
          ...(profileArg ? [profileArg] : []),
          ...(financialHttp ? ['--financial-http'] : []),
          ...(reversalsHttp ? ['--reversals-http'] : []),
          ...(supplierRetries ? ['--supplier-retry-http'] : []),
          ...(documentsHttp ? ['--documents-http'] : []),
          ...(commercialDocumentsHttp ? ['--commercial-documents-http'] : []),
          ...(extendedSoak ? ['--extended-soak'] : []),
          ...(separateFinancialClient ? ['--separate-financial-client'] : []),
          ...(memoryDiagnostic ? ['--memory-diagnostic'] : []),
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
      transportFailure
        ? result.stderr.includes('body-json') &&
            result.stderr.includes('UND_ERR_SOCKET')
        : coverageFailure
          ? result.stderr.includes(
              'Cobertura de memoria por proceso incompleta',
            )
          : financialClientFailure
            ? /Cliente financiero.*17/.test(result.stderr)
            : result.stderr.includes(
                objectiveFailure
                  ? 'Objetivos locales incumplidos'
                  : 'Generador fall\u00f3',
              ),
      'Fallo inesperado: ' + result.stderr,
    );
    if (separateFinancialClient)
      assert.equal(
        childPids(),
        beforeChildren,
        'Se dejo un cliente financiero huerfano',
      );
    assert.deepEqual(await names(), before, 'Se dejó una base temporal');
    if (original)
      assert.deepEqual(
        fs.readFileSync(report),
        original,
        'Un fallo reemplazó el reporte de éxito',
      );
    else assert.equal(fs.existsSync(report), false);
    if (memoryDiagnostic) {
      const diagnosticStem = separateFinancialClient
        ? separatedStem
        : 'q0453c2c3d9-memory-diagnostic';
      const failureKind = transportFailure
        ? 'transport'
        : coverageFailure
          ? 'coverage'
          : objectiveFailure
            ? 'objective'
            : financialClientFailure
              ? 'client'
              : 'generator';
      const failed = JSON.parse(
        fs.readFileSync(
          path.resolve(
            __dirname,
            `../../docs/${diagnosticStem}-${failureKind}-failed.json`,
          ),
          'utf8',
        ),
      );
      if (transportFailure) {
        assert.equal(failed.injectedTransportFailure, true);
        if (serverTransport) {
          const server = failed.groups[0].serverTransport;
          assert.ok(server.counts.incomplete >= 1);
          assert.ok(
            server.recentEvents.some(
              (event) =>
                event.route === '/api/v1/__q04_transport_failure' &&
                event.kind === 'incomplete' &&
                event.headersSent &&
                !event.responseFinished,
            ),
          );
        }
        assert.equal(failed.groups[0].incomplete, true);
        assert.equal(
          failed.groups[0].failureContext.source,
          'financial-document-client',
        );
        assert.equal(
          failed.groups[0].failureContext.diagnostic.stage,
          'body-json',
        );
        assert.equal(
          failed.groups[0].failureContext.diagnostic.code,
          'UND_ERR_SOCKET',
        );
      }
      assert.equal(failed.status, 'failed');
      assert.equal(failed.injectedObjectiveFailure, objectiveFailure);
      assert.equal(
        failed.injectedGeneratorFailure,
        failureKind === 'generator',
      );
      assert.equal(
        failed.injectedFinancialClientFailure,
        financialClientFailure,
      );
      if (financialClientFailure || failureKind === 'generator')
        assert.equal(failed.groups[0].incomplete, true);
      if (coverageFailure) {
        assert.equal(failed.injectedCoverageFailure, true);
        assert.equal(
          failed.groups[0].processMemoryCoverage.parent.passed,
          true,
        );
        assert.equal(
          failed.groups[0].processMemoryCoverage.financialClient.checks
            .everyMinuteCovered,
          false,
        );
      }
      assert.ok(failed.groups[0].memoryDiagnostic.samples >= 4);
      if (objectiveFailure)
        assert.equal(failed.groups[0].objectives.passed, false);
    }
    console.log('Fallo esperado: copia eliminada y reporte previo conservado.');
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
