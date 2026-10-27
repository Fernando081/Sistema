const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createRequest } = require('./full-app-http-contract');
process.once('message', async (config) => {
  try {
    if (config.fail) process.exit(23);
    const request = createRequest(
        config.api,
        { Authorization: 'Bearer ' + config.token },
        config.relational,
        config.fixtureCount,
      ),
      latencies = [],
      counts = {},
      windows = new Map(),
      started = performance.now(),
      cpu = process.cpuUsage(),
      delay = monitorEventLoopDelay({ resolution: 20 });
    delay.enable();
    let rssPeak = 0,
      heapPeak = 0;
    const sample = () => {
      const m = process.memoryUsage();
      rssPeak = Math.max(rssPeak, m.rss);
      heapPeak = Math.max(heapPeak, m.heapUsed);
    };
    sample();
    const timer = setInterval(sample, 100);
    let results;
    try {
      results = await Promise.allSettled(
        Array.from({ length: config.readers }, (_, reader) =>
          (async () => {
            let i = reader;
            while (
              performance.now() - started <
              config.secondsPerGroup * 1000
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, config.readerPauseMs ?? 1500),
              );
              const c = config.cases[i++ % config.cases.length];
              try {
                const latency = await request(c);
                latencies.push(latency);
                const minute = Math.floor(
                  (performance.now() - started) / 60000,
                );
                if (!windows.has(minute)) windows.set(minute, []);
                windows.get(minute).push(latency);
              } catch (e) {
                throw Object.assign(new Error(c.domain + ':' + e.message), {
                  diagnostic: e.diagnostic,
                });
              }
              const key = c.domain + ':' + c.term;
              counts[key] = (counts[key] || 0) + 1;
            }
          })(),
        ),
      );
    } finally {
      clearInterval(timer);
      sample();
      delay.disable();
    }
    for (const r of results) if (r.status === 'rejected') throw r.reason;
    process.send(
      {
        ok: true,
        latencies,
        counts,
        windows: [...windows].map(([minute, values]) => ({
          minute,
          requests: values.length,
          p95: values.sort((a, b) => a - b)[
            Math.ceil(values.length * 0.95) - 1
          ],
        })),
        resources: {
          rssPeak,
          heapPeak,
          cpuMicroseconds: process.cpuUsage(cpu),
          eventLoopP95Ms: delay.percentile(95) / 1e6,
        },
      },
      () => process.exit(0),
    );
  } catch (e) {
    process.send(
      {
        ok: false,
        error: String(e.message).slice(0, 500),
        diagnostic: e.diagnostic,
      },
      () => process.exit(1),
    );
  }
});
