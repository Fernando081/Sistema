const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) =>
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../docs', file), 'utf8'),
  );
const baseline = read('q0453c2c3d10-separated.json');
const extended = read('q0453c2c3d11-separated-soak.json');
assert.equal(baseline.phase, 'Q04.5.3c2c3d10');
assert.equal(extended.phase, 'Q04.5.3c2c3d11');
assert.equal(extended.secondsPerGroup, 3600);
assert.equal(baseline.fixturesPerDomain, extended.fixturesPerDomain);
assert.deepEqual(baseline.profile, extended.profile);
const summarize = (report) => {
  const group = report.groups[0];
  assert.equal(group.objectives.passed, true);
  assert.equal(group.errors, 0);
  return {
    seconds: report.secondsPerGroup,
    reads: group.requests,
    commits: group.writerCommits,
    financialCycles: group.financialCycles,
    p95: group.p95,
    parent: group.memoryDiagnostic.comparison,
    financialClient: group.financialClientMemory.comparison,
  };
};
const group = extended.groups[0];
assert.equal(group.stability.passed, true);
for (const process of ['parent', 'financialClient'])
  assert.equal(group.processMemoryCoverage[process].passed, true);
const result = {
  generatedAt: new Date().toISOString(),
  phase: extended.phase,
  sources: ['q0453c2c3d10-separated.json', 'q0453c2c3d11-separated-soak.json'],
  baseline: summarize(baseline),
  extended: summarize(extended),
  scope:
    'Ventanas de diez y sesenta minutos con cuartos de distinta duracion: comparacion descriptiva, sin inferir causalidad, tasas lineales ni fuga. Padre conserva monitor/escritores. Picos independientes no se suman. Umbrales del perfil se aplican al padre; cliente tiene diagnostico y cobertura.',
};
fs.writeFileSync(
  path.resolve(__dirname, '../../docs/q0453c2c3d11-comparison.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  'Una hora separada: objetivos, cobertura por minuto y comparacion de ambos procesos comprobados.',
);
