const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { MemoryDiagnostic } = require('./memory-diagnostic');
async function startFinancialClient(config) {
  const child = fork(__filename, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  let serial = 0,
    exited = false;
  const pending = new Map();
  const exit = new Promise((resolve) =>
    child.once('exit', (code) => {
      exited = true;
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error('Cliente financiero terminó: ' + code));
      }
      pending.clear();
      resolve();
    }),
  );
  child.on('error', () => child.kill());
  child.on('message', (message) => {
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error)
      entry.reject(
        Object.assign(new Error(message.error), {
          diagnostic: message.diagnostic,
        }),
      );
    else entry.resolve(message.result);
  });
  const request = (kind, data) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(new Error('Cliente financiero cerrado'));
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Tiempo agotado del cliente financiero'));
        child.kill();
      }, 120000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, kind, data }, (error) => {
        if (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    });
  const close = async () => {
    try {
      if (!exited) return await request('close');
    } finally {
      const termination = setTimeout(() => {
        if (!exited) child.kill();
      }, 5000);
      await exit;
      clearTimeout(termination);
    }
  };
  try {
    await request('init', config);
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  return { run: () => request('run'), close };
}
async function worker() {
  assert.equal(process.versions.node.split('.')[0], '24');
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true');
  let client,
    config,
    collector,
    timer,
    sample,
    busy = false,
    closing = false;
  process.on('disconnect', () => process.exit(closing ? 0 : 1));
  process.on('message', async ({ id, kind, data }) => {
    try {
      assert.ok(!busy, 'Cliente financiero ocupado');
      busy = true;
      let result;
      if (kind === 'init') {
        assert.ok(!client);
        assert.match(data.options.database, /^sistema_http_\d+_[a-f0-9]{6}$/);
        const url = new URL(data.api);
        assert.equal(url.protocol, 'http:');
        assert.equal(url.hostname, '127.0.0.1');
        client = new (require('pg').Client)(data.options);
        await client.connect();
        assert.equal(
          (await client.query('SELECT current_database() name')).rows[0].name,
          data.options.database,
        );
        config = data;
        collector = new MemoryDiagnostic();
        const started = performance.now();
        sample = () =>
          collector.add(process.memoryUsage(), performance.now() - started);
        sample();
        timer = setInterval(sample, 100);
        result = { ready: true };
      } else if (kind === 'run') {
        assert.ok(config);
        if (config.injectTransportFailure) {
          const {
            localLoadFetch,
            readLoadBody,
          } = require('./local-load-fetch');
          await readLoadBody(
            await localLoadFetch(config.api + '__q04_transport_failure', {
              signal: AbortSignal.timeout(5000),
            }),
          );
        }
        if (config.injectFailure) process.exit(17);
        result = await require('./full-app-financial-http').verifyFinancialHttp(
          {
            query: async (sql, params) =>
              (await client.query(sql, params)).rows,
          },
          config.api,
          config.headers,
          config.flags,
        );
      } else if (kind === 'close') {
        clearInterval(timer);
        if (sample) sample();
        result = collector?.result();
        if (result)
          result.scope =
            'Cliente financiero/documental persistente separado; incluye fetch, Blob y una conexión PostgreSQL de verificación. No sumar picos independientes.';
        if (client) await client.end();
      } else throw new Error('Mensaje desconocido');
      busy = false;
      process.send({ id, result }, () => {
        if (kind === 'close') {
          closing = true;
          process.disconnect();
        }
      });
    } catch (error) {
      busy = false;
      process.send({ id, error: error.message, diagnostic: error.diagnostic });
    }
  });
}
if (require.main === module) worker().catch(() => process.exit(1));
module.exports = { startFinancialClient };
