const assert = require('node:assert/strict');
const { evaluateMemoryCoverage } = require('./separated-soak-coverage');
const values = {
  rss: 10,
  heapUsed: 2,
  heapTotal: 4,
  external: 3,
  arrayBuffers: 1,
};
const diagnostic = {
  elapsedMs: 120000,
  samples: 4,
  windows: [0, 1].map((minute) => ({
    minute,
    samples: 2,
    means: values,
    peaks: values,
  })),
};
assert.equal(evaluateMemoryCoverage(diagnostic, 120).passed, true);
for (const invalid of [
  undefined,
  { ...diagnostic, elapsedMs: 119999 },
  { ...diagnostic, samples: 3 },
  { ...diagnostic, windows: [diagnostic.windows[0]] },
  {
    ...diagnostic,
    windows: diagnostic.windows.map((window) => ({ ...window, samples: 0 })),
  },
  {
    ...diagnostic,
    windows: [
      { ...diagnostic.windows[0], means: { ...values, rss: NaN } },
      diagnostic.windows[1],
    ],
  },
])
  assert.equal(evaluateMemoryCoverage(invalid, 120).passed, false);
assert.throws(() => evaluateMemoryCoverage(diagnostic, 3601));
console.log(
  'Cobertura por proceso: duracion, minutos ausentes, muestras y metricas invalidas verificados.',
);
