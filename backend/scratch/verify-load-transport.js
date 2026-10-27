const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { localLoadFetch, readLoadBody } = require('./local-load-fetch');
const { createRequest } = require('./full-app-http-contract');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const counts = {};
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    counts[route] = (counts[route] ?? 0) + 1;
    if (route === '/reset') return req.socket.destroy();
    if (route.startsWith('/truncated')) {
      res.writeHead(200, {
        'Content-Length': '100',
        'Cache-Control': 'no-store',
        'X-Request-Id': 'transport-test',
      });
      res.flushHeaders();
      res.write('{');
      return setTimeout(() => res.destroy(), 30);
    }
    if (route === '/timeout') return;
    res.end(route === '/invalid' ? 'private-payload' : '{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const diagnostics = [];
  const check = (route, stage) => (error) => {
    assert.equal(error.diagnostic.route, route);
    assert.equal(error.diagnostic.stage, stage);
    assert.ok(!error.message.includes('private'));
    diagnostics.push(error.diagnostic);
    return true;
  };
  try {
    await assert.rejects(
      localLoadFetch(url + '/reset?private=value', {
        signal: AbortSignal.timeout(5000),
      }),
      check('/reset', 'headers'),
    );
    await assert.rejects(
      readLoadBody(
        await localLoadFetch(url + '/truncated', {
          signal: AbortSignal.timeout(5000),
        }),
      ),
      check('/truncated', 'body-json'),
    );
    for (const kind of ['text', 'arrayBuffer']) {
      const route = '/truncated-' + kind;
      await assert.rejects(
        readLoadBody(
          await localLoadFetch(url + route, {
            signal: AbortSignal.timeout(5000),
          }),
          kind,
        ),
        check(route, 'body-' + kind),
      );
    }
    await assert.rejects(
      createRequest(
        url + '/',
        {},
        true,
        1000,
      )({ route: 'truncated-reader', term: 'private', domain: 'cliente' }),
      check('/truncated-reader', 'body-json'),
    );
    await assert.rejects(
      readLoadBody(await localLoadFetch(url + '/invalid')),
      check('/invalid', 'body-json'),
    );
    await assert.rejects(
      localLoadFetch(url + '/timeout', { signal: AbortSignal.timeout(100) }),
      check('/timeout', 'headers'),
    );
    assert.deepEqual(
      await readLoadBody(await localLoadFetch(url + '/healthy')),
      { ok: true },
    );
    assert.deepEqual(counts, {
      '/reset': 1,
      '/truncated': 1,
      '/truncated-text': 1,
      '/truncated-arrayBuffer': 1,
      '/truncated-reader': 1,
      '/invalid': 1,
      '/timeout': 1,
      '/healthy': 1,
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  fs.writeFileSync(
    path.resolve(
      __dirname,
      '../../docs/q0453c2c3d12-controlled-transport.json',
    ),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        phase: 'Q04.5.3c2c3d12',
        node: process.versions.node,
        status: 'passed',
        diagnostics,
        requests: counts,
        scope:
          'Servidor HTTP local con fallos deliberados: valida diagnostico, lectura de cuerpo, timeout, ausencia de reintentos y recuperacion; no identifica la causa del incidente historico del ERP.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Transporte real local: reset, cuerpo truncado, JSON invalido, timeout y recuperacion verificados sin reintentos.',
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
