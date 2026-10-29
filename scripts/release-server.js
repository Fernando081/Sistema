'use strict';
// O04 · Servidor de la interfaz de una versión desplegada: sirve el build de Angular y reenvía /api y /uploads
// al backend de la misma versión. Escucha sólo en loopback (el backend confía en que el HTTP sin TLS es local).
// Uso: node release-server.js --root=<browser> --port=4300 --backend=3100 --release=<id>
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};

function createReleaseServer({ root, backendPort, release }) {
  const base = path.resolve(root);
  const index = path.join(base, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`No existe ${index}`);

  function proxy(req, res) {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) if (!HOP.has(key) && !key.startsWith('x-forwarded-')) headers[key] = value;
    // Se reemplazan (no se encadenan) para que un cliente no pueda suplantar su dirección.
    headers['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1';
    headers['x-forwarded-proto'] = 'http';
    headers['x-forwarded-host'] = req.headers.host ?? '';
    const upstream = http.request({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers }, (answer) => {
      const out = {};
      for (const [key, value] of Object.entries(answer.headers)) if (!HOP.has(key)) out[key] = value;
      res.writeHead(answer.statusCode ?? 502, out);
      answer.pipe(res);
    });
    upstream.setTimeout(300000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ statusCode: 502, message: 'El servidor del sistema no responde. Intenta de nuevo en unos segundos.' }));
    });
    req.pipe(upstream);
  }

  function send(res, file, method) {
    const name = path.basename(file);
    const hashed = /[.-][A-Z0-9]{8,}\.(js|css|woff2?|ttf|svg|png|jpg|webp)$/i.test(name);
    const cache = name === 'index.html' || name === 'ngsw.json' || name === 'ngsw-worker.js' ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'no-cache';
    const stat = fs.statSync(file);
    res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return proxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...SECURITY, Allow: 'GET, HEAD' });
      return res.end();
    }
    if (url.pathname === '/__version') {
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ release }));
    }
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { res.writeHead(400, SECURITY); return res.end(); }
    const file = path.resolve(base, '.' + decoded);
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(404, SECURITY); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file, req.method);
    // Rutas de la aplicación (sin extensión) regresan index.html; un archivo inexistente es 404.
    if (path.extname(decoded)) { res.writeHead(404, { ...SECURITY, 'Cache-Control': 'no-store' }); return res.end(); }
    return send(res, index, req.method);
  });
}

if (require.main === module) {
  const host = arg('host', '127.0.0.1');
  if (!LOOPBACK.has(host)) throw new Error('El servidor de la versión sólo escucha en loopback; el acceso por red requiere HTTPS (O04.2)');
  const port = Number(arg('port', '4300'));
  const backendPort = Number(arg('backend', '3100'));
  const server = createReleaseServer({ root: arg('root', path.join(__dirname, '..', 'frontend', 'browser')), backendPort, release: arg('release', 'local') });
  server.listen(port, host, () => console.log(JSON.stringify({ type: 'release_server', host, port, backendPort, release: arg('release', 'local') })));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createReleaseServer };
