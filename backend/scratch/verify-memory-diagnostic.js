const assert = require('node:assert/strict');
const { MemoryDiagnostic } = require('./memory-diagnostic');
const collector = new MemoryDiagnostic();
assert.throws(() => collector.result(), /insuficientes/);
for (const [time, rss, heap, external, buffers] of [
  [0, 100, 20, 30, 10],
  [1000, 100, 20, 30, 10],
  [60000, 140, 10, 60, 20],
  [61000, 140, 10, 60, 20],
])
  collector.add(
    { rss, heapUsed: heap, heapTotal: 40, external, arrayBuffers: buffers },
    time,
  );
const result = collector.result();
assert.equal(result.elapsedMs, 61000);
assert.equal(result.comparison.rss.deltaBytes, 40);
assert.equal(result.comparison.heapUsed.deltaBytes, -10);
assert.equal(result.comparison.external.deltaBytes, 30);
assert.equal(result.comparison.arrayBuffers.deltaBytes, 10);
assert.equal(result.windows.length, 2);
assert.equal(result.windows[1].samples, 2);
assert.equal(result.windows[1].means.rss, 140);
assert.equal(result.comparison.external.peak, 60);
assert.throws(() => collector.add({ rss: NaN }, 62000));
assert.throws(() => collector.add({}, -1));
assert.equal(collector.result().samples, 4);
assert.equal(collector.result().elapsedMs, 61000);
console.log(
  'Diagnóstico de memoria: ventanas, deltas firmados, picos y muestras inválidas verificados.',
);
