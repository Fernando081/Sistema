import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRedirects } from "../redirects.mjs";
import { build, pagesForCatalog, root } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const entry = { from: "/productos/anterior", to: "/productos/actual" };
test("redirecciones rechazan destinos externos, cadenas, ciclos y fichas retiradas", () => {
  const pages = new Map([[entry.to, true]]);
  assert.equal(
    validateRedirects({ schemaVersion: 1, entries: [entry] }, pages).entries
      .length,
    1,
  );
  for (const entries of [
    [{ ...entry, to: "https://externo.example" }],
    [{ ...entry, to: "/productos/retirado" }],
    [entry, entry],
    [{ ...entry, from: entry.to }],
    [{ ...entry, to: "/contacto" }],
    [entry, { from: "/productos/otro", to: entry.from }],
  ])
    assert.throws(() =>
      validateRedirects({ schemaVersion: 1, entries }, pages),
    );
});
test("HTTP 308 conserva destino vigente sin propagar query ni exponer configuración", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-redirect-"));
  let server;
  try {
    const products = [
      {
        slug: "actual",
        status: "published",
        approved: true,
        code: "PRUEBA",
        brand: "Marca",
        category: "Familia",
        title: "Ficha actual",
        description: "Fixture aislada",
        applications: [],
        references: [],
        specifications: [],
      },
    ];
    await build(
      directory,
      pagesForCatalog(products),
      products,
      join(root, "media-approved"),
      { redirects: { schemaVersion: 1, entries: [entry] } },
    );
    server = await createPreviewServer(directory);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}${entry.from}/?token=prueba`, {
      redirect: "manual",
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), entry.to);
    assert.equal((await fetch(`${base}${entry.to}`)).status, 200);
    assert.equal((await fetch(`${base}/redirect-routes.json`)).status, 404);
    await build(directory, pagesForCatalog([]), []);
    assert.equal(
      (await fetch(`${base}${entry.from}`, { redirect: "manual" })).status,
      404,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
