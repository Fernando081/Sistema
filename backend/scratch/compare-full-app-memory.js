const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const files = [
  'q0453c2c3d9-memory-diagnostic.json',
  'q0453c2c3d10-separated.json',
];
const reports = files.map((file) =>
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../docs', file), 'utf8'),
  ),
);
assert.equal(reports[0].phase, 'Q04.5.3c2c3d9');
assert.equal(reports[1].phase, 'Q04.5.3c2c3d10');
for (const key of ['secondsPerGroup', 'fixturesPerDomain']) {
  assert.ok(Number.isInteger(reports[0][key]) && reports[0][key] > 0);
  assert.equal(reports[0][key], reports[1][key]);
}
assert.equal(reports[0].profile.name, reports[1].profile.name);
const groups = reports.map((report) => report.groups[0]);
for (const group of groups) {
  assert.equal(group.objectives.passed, true);
  assert.equal(group.errors, 0);
}
assert.ok(groups[1].financialClientMemory.samples >= 4);
const report = {
  generatedAt: new Date().toISOString(),
  phase: 'Q04.5.3c2c3d10',
  sources: files,
  secondsPerGroup: reports[1].secondsPerGroup,
  fixturesPerDomain: reports[1].fixturesPerDomain,
  mixedParent: groups[0].memoryDiagnostic.comparison,
  separatedParent: groups[1].memoryDiagnostic.comparison,
  financialClient: groups[1].financialClientMemory.comparison,
  scope:
    'Ventanas distintas: comparacion descriptiva, sin prueba causal ni certificacion de fuga. Padre separado aun contiene monitor y cliente de almacen/pagos. Picos independientes no se suman. Muestreo sin GC forzado.',
};
fs.writeFileSync(
  path.resolve(__dirname, '../../docs/q0453c2c3d10-comparison.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  'Comparacion reproducible: fuentes y perfiles comprobados; tres alcances de memoria separados.',
);
