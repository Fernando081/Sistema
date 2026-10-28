// Checksum de migraciones independiente del fin de línea (H02-e).
// Git guarda LF y cada copia de trabajo puede tener CRLF (core.autocrlf) o LF;
// con el hash de bytes crudos, un clon nuevo rechazaba migraciones ya aplicadas.
const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const toLf = (text) => text.replace(/\r\n/g, '\n');

/** Checksum que se guarda para migraciones nuevas: contenido con LF. */
function canonicalChecksum(content) {
  return sha256(toLf(Buffer.isBuffer(content) ? content.toString('utf8') : content));
}

/**
 * Acepta el checksum canónico y los históricos (bytes crudos con CRLF o LF),
 * de modo que las migraciones ya registradas siguen validando tras cambiar
 * los finales de línea de la copia de trabajo, pero un cambio de contenido no.
 */
function matchesChecksum(stored, content) {
  const text = toLf(Buffer.isBuffer(content) ? content.toString('utf8') : content);
  return stored === sha256(text) || stored === sha256(text.replace(/\n/g, '\r\n'))
    || (Buffer.isBuffer(content) && stored === sha256(content));
}

module.exports = { canonicalChecksum, matchesChecksum };
