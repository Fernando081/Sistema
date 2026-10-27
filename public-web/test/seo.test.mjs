import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSite, applySeo } from "../seo.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build, pages, root } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
import { sealRelease, verifyRelease } from "../release.mjs";
test("sitemap HTTP queda sellado y desactivar dominio lo retira del manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-seo-"));
  let server;
  try {
    await build(directory, pages, [], join(root, "media-approved"), {
      site: { origin: "https://empresa.example", confirmed: true },
    });
    await writeFile(join(directory, "approval.json"), "{}");
    const digest = await sealRelease(directory);
    await verifyRelease(directory, digest);
    server = await createPreviewServer(directory);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/sitemap.xml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/xml/);
    assert.match(await response.text(), /https:\/\/empresa.example\/catalogo/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    await writeFile(join(directory, "sitemap.xml"), "alterado");
    await assert.rejects(verifyRelease(directory, digest), /alterado/);
    await build(directory, pages, [], join(root, "media-approved"), {
      site: { origin: "", confirmed: false },
    });
    assert.equal((await fetch(`${base}/sitemap.xml`)).status, 404);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
test("dominio requiere confirmación y origen HTTPS público sin rutas o credenciales", () => {
  for (const origin of [
    "http://empresa.example",
    "https://usuario:clave@empresa.example",
    "https://empresa.example/ruta",
    "https://empresa.example?q=1",
    "https://empresa.example#x",
    "https://127.0.0.1",
    "https://localhost",
    "https://empresa.local",
    "https://empresa.example:4500",
  ])
    assert.throws(() => validateSite({ origin, confirmed: true }));
  assert.throws(() => validateSite({ origin: "", confirmed: true }));
  assert.throws(() =>
    validateSite({ origin: "", confirmed: false, extra: true }),
  );
  assert.equal(
    validateSite({ origin: "https://EMPRESA.example/", confirmed: true })
      .origin,
    "https://empresa.example",
  );
});
test("canonical y sitemap solo incluyen rutas publicables; preview conserva noindex", () => {
  const html =
    '<html><head><meta name="robots" content="noindex,nofollow"></head></html>';
  const pages = new Map(
    [
      "/",
      "/productos/fixture",
      "/catalogo/pagina/2",
      "/buscar",
      "/cotizar",
      "/diseno/ficha",
      "/404",
      "/admin",
      "/productos/retirado?x=1",
    ].map((route) => [route, html]),
  );
  for (const config of [
    { origin: "", confirmed: false },
    { origin: "https://empresa.example", confirmed: false },
  ]) {
    const result = applySeo(pages, config);
    assert.equal(result.sitemap, null);
    assert.equal(result.pages.get("/"), html);
  }
  const result = applySeo(pages, {
    origin: "https://empresa.example",
    confirmed: true,
  });
  assert.match(
    result.pages.get("/productos/fixture"),
    /rel="canonical" href="https:\/\/empresa.example\/productos\/fixture"/,
  );
  assert.match(result.pages.get("/productos/fixture"), /noindex,nofollow/);
  assert.equal((result.sitemap.match(/<loc>/g) ?? []).length, 3);
  assert.doesNotMatch(
    result.sitemap,
    /buscar|cotizar|diseno|404|admin|retirado/,
  );
  assert.doesNotMatch(result.pages.get("/buscar"), /canonical/);
});
