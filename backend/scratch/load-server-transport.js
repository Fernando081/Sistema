const { performance } = require('node:perf_hooks');
function createTransportRecorder(limit = 100) {
  const started = performance.now();
  const events = [];
  const counts = { requests: 0, finished: 0, incomplete: 0, aborted: 0 };
  function middleware(req, res, next) {
    counts.requests++;
    let finished = false;
    const context = {
      method: req.method,
      route: new URL(req.originalUrl || req.url, 'http://127.0.0.1').pathname,
    };
    function record(kind) {
      counts[kind]++;
      if (events.length === limit) events.shift();
      events.push({
        ...context,
        kind,
        elapsedMs: performance.now() - started,
        status: res.statusCode,
        headersSent: res.headersSent,
        requestComplete: req.complete,
        responseFinished: res.writableFinished,
      });
    }
    req.once('aborted', () => record('aborted'));
    res.once('finish', () => {
      finished = true;
      counts.finished++;
    });
    res.once('close', () => {
      if (!finished) record('incomplete');
    });
    next();
  }
  return {
    middleware,
    result: () => ({
      scope:
        'Servidor de prueba: cierre incompleto no identifica por si solo la causa ni quien cerro la conexion',
      counts: { ...counts },
      recentEvents: events.map((event) => ({ ...event })),
      eventLimit: limit,
    }),
  };
}
module.exports = { createTransportRecorder };
