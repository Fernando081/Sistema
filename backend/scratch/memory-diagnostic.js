const assert = require('node:assert/strict');
const metrics = ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'];
class MemoryDiagnostic {
  constructor() {
    this.samples = Object.fromEntries(metrics.map((key) => [key, []]));
    this.windows = new Map();
    this.lastElapsed = 0;
  }
  add(memory, elapsedMs) {
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= this.lastElapsed);
    for (const key of metrics)
      assert.ok(Number.isFinite(memory[key]) && memory[key] >= 0, key);
    this.lastElapsed = elapsedMs;
    const minute = Math.floor(elapsedMs / 60000);
    if (!this.windows.has(minute))
      this.windows.set(minute, { minute, samples: 0, sums: {}, peaks: {} });
    const window = this.windows.get(minute);
    window.samples++;
    for (const key of metrics) {
      this.samples[key].push(memory[key]);
      window.sums[key] = (window.sums[key] ?? 0) + memory[key];
      window.peaks[key] = Math.max(window.peaks[key] ?? 0, memory[key]);
    }
  }
  result() {
    const count = this.samples.rss.length;
    assert.ok(count >= 4, 'Muestras de memoria insuficientes');
    const quarter = Math.max(1, Math.floor(count / 4));
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      scope:
        'Proceso padre: servidor, monitor, escritores y cliente de archivos; no atribuye memoria exclusivamente al servidor ni certifica fuga. ArrayBuffers forma parte de external: no sumar ambas métricas ni restarlas de RSS para inferir memoria nativa.',
      samples: count,
      elapsedMs: this.lastElapsed,
      quarterSamples: quarter,
      comparison: Object.fromEntries(
        metrics.map((key) => {
          const firstMean = mean(this.samples[key].slice(0, quarter));
          const lastMean = mean(this.samples[key].slice(-quarter));
          return [
            key,
            {
              firstMean,
              lastMean,
              deltaBytes: lastMean - firstMean,
              peak: this.samples[key].reduce(
                (peak, value) => Math.max(peak, value),
                0,
              ),
            },
          ];
        }),
      ),
      windows: [...this.windows.values()].map((window) => ({
        minute: window.minute,
        samples: window.samples,
        means: Object.fromEntries(
          metrics.map((key) => [key, window.sums[key] / window.samples]),
        ),
        peaks: window.peaks,
      })),
    };
  }
}
module.exports = { MemoryDiagnostic };
