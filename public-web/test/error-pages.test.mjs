import { test } from "node:test";
import assert from "node:assert/strict";
import { errorHtml } from "../error-pages.mjs";
test("errores mantienen identidad, noindex y rutas de recuperación sin reintentos", () => {
  for (const status of [400, 405, 414, 429, 500, 503]) {
    const html = errorHtml(status, { retryAfter: 12 });
    assert.match(html, /<html lang="es-MX">/);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.match(html, /noindex,nofollow/);
    assert.match(html, /href="\/catalogo">Volver al catálogo/);
    assert.match(html, /href="\/buscar">Nueva búsqueda/);
    assert.match(html, /12 segundos/);
    assert.doesNotMatch(html, /<script(?! src="\/assets\/site\.js" defer><\/script>)|http-equiv="refresh"/);
  }
  assert.doesNotMatch(errorHtml(429, { retryAfter: "<script>" }), /<script>/);
  assert.match(errorHtml(503, { budget: true }), /Reduce las piezas/);
});
