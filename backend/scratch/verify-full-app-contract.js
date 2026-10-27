const assert = require('node:assert/strict');
const { createRequest } = require('./full-app-http-contract');
(async () => {
  const original = global.fetch;
  try {
    let data = {
      page: 1,
      total: 2,
      totalPages: 1,
      data: [{ id_cotizacion: 1 }, { id_cotizacion: 2 }],
    };
    global.fetch = async () => ({
      status: 200,
      headers: new Headers({
        'cache-control': 'no-store',
        'x-request-id': 'fixture-test',
      }),
      json: async () => data,
    });
    const request = createRequest('http://127.0.0.1/', {}, true, 1000);
    await request({
      domain: 'cotizacion',
      route: 'cotizacion',
      term: 'Q04HTTPONLY',
    });
    data = { ...data, data: [{ id_cotizacion: 1 }] };
    await assert.rejects(() =>
      request({
        domain: 'cotizacion',
        route: 'cotizacion',
        term: 'Q04HTTPONLY',
      }),
    );
    console.log(
      'Contrato dinámico: admite crecimiento y rechaza total/página discordantes.',
    );
  } finally {
    global.fetch = original;
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
