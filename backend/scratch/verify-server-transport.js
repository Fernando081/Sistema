const assert = require('node:assert/strict');
const http = require('node:http');
const { createTransportRecorder } = require('./load-server-transport');
async function main() {
  const recorder = createTransportRecorder(2);
  const server = http.createServer((req, res) =>
    recorder.middleware(req, res, () => {
      if (req.url.startsWith('/cut')) {
        res.writeHead(200, { 'Content-Length': '100' });
        res.flushHeaders();
        res.write('{');
        setTimeout(() => res.destroy(), 20);
      } else res.end('ok');
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal(await (await fetch(url + '/ok')).text(), 'ok');
    for (let i = 0; i < 3; i++) {
      const response = await fetch(url + '/cut?private=hidden');
      await assert.rejects(response.text());
    }
    await new Promise((resolve) => setImmediate(resolve));
    const result = recorder.result();
    assert.equal(result.counts.requests, 4);
    assert.equal(result.counts.finished, 1);
    assert.equal(result.counts.incomplete, 3);
    assert.equal(result.recentEvents.length, 2);
    assert.ok(
      result.recentEvents.every(
        (e) => e.route === '/cut' && !e.responseFinished && e.headersSent,
      ),
    );
    assert.ok(!JSON.stringify(result).includes('hidden'));
    result.recentEvents[0].route = 'changed';
    assert.equal(recorder.result().recentEvents[0].route, '/cut');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(
    'Servidor: cierre incompleto, respuesta normal, limite y privacidad aprobados.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
