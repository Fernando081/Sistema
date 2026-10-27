const assert = require('node:assert/strict');
const {
  selectProfile,
  evaluate,
  evaluateExtended,
} = require('./full-app-load-profiles');
assert.throws(() => selectProfile('__proto__'), /Perfil desconocido/);
assert.throws(() => selectProfile('unknown'), /Perfil desconocido/);
assert.equal(selectProfile('mostrador').readers, 4);
assert.equal(selectProfile('soak').duration, 600);
const group = {
  p95: 50,
  eventLoopP95Ms: 25,
  requests: 100,
  writerCommits: 10,
  financialCycles: 2,
  errors: 0,
  idleTransactions: 0,
  postgres: { countersDelta: { deadlocks: 0 } },
};
assert.equal(evaluate(group, [100, 100, 110, 110]).passed, true);
assert.equal(
  evaluate({ ...group, p95: 501 }, [100, 100, 110, 110]).passed,
  false,
);
assert.equal(
  evaluate({ ...group, eventLoopP95Ms: 101 }, [100, 100, 110, 110]).passed,
  false,
);
assert.equal(
  evaluate(group, [0, 0, 200 * 1024 * 1024, 200 * 1024 * 1024]).passed,
  false,
);
assert.equal(
  evaluate({ ...group, financialCycles: 0 }, [100, 100, 110, 110]).passed,
  false,
);
assert.throws(() => evaluate(group, []), /insuficientes/);
for (const failed of [
  { ...group, errors: 1 },
  { ...group, idleTransactions: 1 },
  { ...group, postgres: { countersDelta: { deadlocks: 1 } } },
  { ...group, p95: NaN },
])
  assert.equal(evaluate(failed, [100, 100, 110, 110]).passed, false);
console.log(
  'Perfiles: selección, objetivos de latencia/memoria y falta de cobertura verificados.',
);

const stable = {
  elapsedMs: 120000,
  readWindows: [
    { minute: 0, requests: 10, p95: 50 },
    { minute: 1, requests: 10, p95: 80 },
  ],
};
assert.equal(evaluateExtended(stable, 120).passed, true);
assert.equal(
  evaluateExtended({ ...stable, elapsedMs: 100000 }, 120).passed,
  false,
);
assert.equal(
  evaluateExtended({ ...stable, readWindows: [stable.readWindows[0]] }, 120)
    .passed,
  false,
);
assert.equal(
  evaluateExtended(
    {
      ...stable,
      readWindows: [
        { minute: 0, requests: 10, p95: 501 },
        stable.readWindows[1],
      ],
    },
    120,
  ).passed,
  false,
);
assert.throws(() => evaluateExtended(stable, 3601));
console.log(
  'Soak ampliado: duración efectiva, cobertura por minuto y p95 local verificados.',
);
