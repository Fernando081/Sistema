import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, basename } from "node:path";
import { once } from "node:events";
import { build, pages } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
test("HTML inicial y navegación sin ejecutar JavaScript", () => {
  for (const [route, html] of pages) {
    assert.match(html, /<html lang="es-MX">/);
    assert.match(html, /<h1>/);
    assert.match(html, /noindex,nofollow/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /api\/v1|access_token|VIN|ESN|PrecioUnitario/);
    for (const [, target] of html.matchAll(/href="([^"]+)"/g))
      if (
        target !== "#contenido" &&
        !target.startsWith("/assets/") &&
        !/^(?:tel:\+[1-9][0-9]{7,14}|mailto:[a-zA-Z0-9._%+@-]+|https:\/\/wa\.me\/[0-9]+|https:\/\/maps\.app\.goo\.gl\/[a-zA-Z0-9]+)$/.test(
          target,
        )
      )
        assert.ok(pages.has(target), `${route}: ${target}`);
  }
});
test("servidor local: métodos, encabezados, 404 real y aislamiento de archivos", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-public-web-test-"));
  let server;
  try {
    await build(directory);
    server = await createPreviewServer(directory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(base);
    const logo = await fetch(base + "/assets/logo-rtt.jpg");
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(
      Buffer.from(await logo.arrayBuffer()),
      await readFile(new URL("../assets/logo-rtt.jpg", import.meta.url)),
    );
    assert.equal(home.status, 200);
    assert.match(await home.text(), /La pieza correcta/);
    assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(home.headers.get("cache-control"), "no-store");
    assert.match(
      home.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    for (const path of [
      "/api/v1/web-catalog/admin/products",
      "/.env",
      "/business.json",
      "/business.mjs",
      "/routes.json",
      "/uploads/a.png",
      "/backend/db-config.js",
      "/productos/inexistente",
    ])
      assert.equal((await fetch(base + path)).status, 404);
    assert.equal(
      (await fetch(base + "/catalogo/", { redirect: "manual" })).status,
      308,
    );
    const missing = await fetch(base + "/no-existe");
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Página no encontrada/);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    const head = await fetch(base, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.match(
      await (await fetch(base + "/robots.txt")).text(),
      /Disallow: \//,
    );
    assert.equal(
      (await fetch(base + "/assets/site.css")).headers.get("content-type"),
      "text/css; charset=utf-8",
    );
    const files = JSON.parse(
      await readFile(join(directory, "routes.json"), "utf8"),
    );
    assert.equal(files["/catalogo"], "catalogo/index.html");
  } finally {
    if (server)
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    const target = resolve(directory);
    const allowed = resolve(tmpdir());
    if (!target.startsWith(allowed + "\\") && !target.startsWith(allowed + "/"))
      throw new Error("Directorio de prueba fuera del temporal");
    if (!basename(target).startsWith("rtt-public-web-test-"))
      throw new Error("Directorio de prueba inesperado");
    await rm(target, { recursive: true, force: true });
  }
});
