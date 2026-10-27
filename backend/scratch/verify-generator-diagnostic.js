const assert = require('node:assert/strict');
const http = require('node:http');
const { runGenerator } = require('./full-app-http-generator');
async function main() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Length': '100',
      'Cache-Control': 'no-store',
      'X-Request-Id': 'diagnostic-test',
    });
    res.flushHeaders();
    res.write('{');
    setTimeout(() => res.destroy(), 30);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      runGenerator({
        api: 'http://127.0.0.1:' + server.address().port + '/',
        token: 'synthetic',
        relational: true,
        fixtureCount: 1000,
        readers: 1,
        secondsPerGroup: 40,
        readerPauseMs: 0,
        cases: [
          { domain: 'cliente', route: 'truncated', term: 'private-term' },
        ],
      }),
      (error) => {
        assert.equal(error.diagnostic.stage, 'body-json');
        assert.equal(error.diagnostic.route, '/truncated');
        assert.equal(error.diagnostic.code, 'UND_ERR_SOCKET');
        assert.ok(!error.message.includes('private-term'));
        return true;
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(
    'Generador: diagnostico de cuerpo truncado conservado por IPC; termino de consulta omitido y hijo cerrado.',
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
