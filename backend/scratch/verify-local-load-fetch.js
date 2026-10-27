const assert = require('node:assert/strict');
const { localLoadFetch } = require('./local-load-fetch');
async function main() {
  const original = global.fetch;
  try {
    global.fetch = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    };
    await assert.rejects(
      localLoadFetch('http://127.0.0.1/api/v1/pago?private=value', {
        method: 'POST',
        body: 'private-payload',
      }),
      (error) => {
        assert.equal(
          error.message,
          'HTTP POST /api/v1/pago: headers; TypeError; ECONNRESET',
        );
        assert.ok(!error.message.includes('private'));
        return true;
      },
    );
  } finally {
    global.fetch = original;
  }
  console.log(
    'Diagnostico HTTP: conserva ruta/codigo sin publicar query, cuerpo ni autorizacion; sin reintentos.',
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
