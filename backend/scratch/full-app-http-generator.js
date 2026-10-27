const { fork } = require('node:child_process');
const path = require('node:path');
function runGenerator(config, signal) {
  return new Promise((resolve, reject) => {
    const child = fork(
      path.join(__dirname, 'full-app-http-generator-worker.js'),
      [],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
    );
    let result;
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(
      () => child.kill(),
      (config.secondsPerGroup + 15) * 1000,
    );
    child.on('message', (message) => {
      result = message;
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('No se pudo iniciar generador'));
    });
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
      if (code === 0 && result?.ok) resolve(result);
      else
        reject(
          Object.assign(
            new Error(
              'Generador falló: ' +
                (result?.error || 'sin detalle') +
                '; copia requiere limpieza',
            ),
            { diagnostic: result?.diagnostic },
          ),
        );
    });
    child.send(config);
  });
}
module.exports = { runGenerator };
