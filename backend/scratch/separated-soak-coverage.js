const assert = require('node:assert/strict');
const metrics = ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'];
function evaluateMemoryCoverage(diagnostic, seconds) {
  assert.ok(Number.isInteger(seconds) && seconds >= 40 && seconds <= 3600);
  const expectedMinutes = Math.ceil(seconds / 60);
  const windows = diagnostic?.windows ?? [];
  const checks = {
    duration:
      Number.isFinite(diagnostic?.elapsedMs) &&
      diagnostic.elapsedMs >= seconds * 1000,
    samples: Number.isInteger(diagnostic?.samples) && diagnostic.samples >= 4,
    everyMinuteCovered: Array.from({ length: expectedMinutes }, (_, minute) =>
      windows.some(
        (window) =>
          window.minute === minute &&
          Number.isInteger(window.samples) &&
          window.samples > 0,
      ),
    ).every(Boolean),
    finiteMetrics:
      windows.length > 0 &&
      windows.every((window) =>
        metrics.every(
          (key) =>
            Number.isFinite(window.means?.[key]) &&
            window.means[key] >= 0 &&
            Number.isFinite(window.peaks?.[key]) &&
            window.peaks[key] >= window.means[key],
        ),
      ),
  };
  return {
    expectedMinutes,
    checks,
    passed: Object.values(checks).every(Boolean),
    scope:
      'Cobertura temporal de memoria por proceso; sin nuevo umbral de memoria del cliente ni prueba de fuga.',
  };
}
module.exports = { evaluateMemoryCoverage };
