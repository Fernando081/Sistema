const { fork } = require('node:child_process');
const path = require('node:path');
function runGenerator(config) {
  return new Promise((resolve, reject) => {
    const child = fork(
      path.join(__dirname, 'list-http-generator-worker.js'),
      [],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
    );
    let result;
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
      clearTimeout(timeout);
      if (code === 0 && result?.ok) resolve(result);
      else reject(new Error('Generador falló; limpieza requerida'));
    });
    child.send(config);
  });
}
module.exports = { runGenerator };
