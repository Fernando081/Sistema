const assert = require('node:assert/strict');
const { startFinancialClient } = require('./full-app-financial-client');
async function main() {
  const previous = process.env.TEST_DATABASE_ISOLATED;
  process.env.TEST_DATABASE_ISOLATED = 'true';
  try {
    await assert.rejects(
      startFinancialClient({
        options: { database: 'operacional' },
        api: 'http://127.0.0.1:1/',
      }),
      /regular expression/,
    );
    await assert.rejects(
      startFinancialClient({
        options: { database: 'sistema_http_123_abcdef' },
        api: 'https://127.0.0.1:1/',
      }),
      /http/,
    );
    await assert.rejects(
      startFinancialClient({
        options: { database: 'sistema_http_123_abcdef' },
        api: 'http://example.com/',
      }),
      /127\.0\.0\.1/,
    );
    console.log(
      'Cliente financiero: rechaza base operacional y destinos no locales; hijos cerrados antes de conectar.',
    );
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_ISOLATED;
    else process.env.TEST_DATABASE_ISOLATED = previous;
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
