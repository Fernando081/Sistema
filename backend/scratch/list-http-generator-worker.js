const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createRequest } = require('./list-http-contract');
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
              const c = config.cases[i++ % config.cases.length];
              latencies.push(await request(c));
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
        resources: {
          rssPeak,
          heapPeak,
          cpuMicroseconds: process.cpuUsage(cpu),
          eventLoopP95Ms: delay.percentile(95) / 1e6,
        },
      },
      () => process.exit(0),
    );
  } catch {
    process.send({ ok: false }, () => process.exit(1));
  }
});
