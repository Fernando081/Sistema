import { test } from "node:test";
import assert from "node:assert/strict";
import { build, pagesForCatalog, root } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("slash final conserva criterios y piezas en Location relativo; cuota sigue compartida", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-dynamic-url-"));
  let server;
  try {
    const products = [
      {
        slug: "fixture",
        status: "published",
        approved: true,
        code: "OEM-1",
        brand: "Marca",
        category: "Familia",
        title: "Fixture",
        description: "Prueba aislada",
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
    );
    server = await createPreviewServer(directory, {
      requestLimits: { requests: 8 },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const search = new URLSearchParams({
      q: "OEM-1",
      marca: "Marca",
      pagina: "1",
    });
    const first = await fetch(`${base}/buscar/?${search}`, {
      redirect: "manual",
    });
    assert.equal(first.status, 308);
    assert.equal(first.headers.get("location"), `/buscar?${search}`);
    const result = await fetch(base + first.headers.get("location"));
    assert.equal(result.status, 200);
    assert.match(await result.text(), /OEM-1/);
    const query = new URLSearchParams({
      producto: "fixture",
      cantidad: "2",
      piezas: "OEM-1 | 3",
    });
    const response = await fetch(`${base}/cotizar/?${query}`, {
      redirect: "manual",
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `/cotizar?${query}`);
    const inquiry = await fetch(base + response.headers.get("location"));
    assert.equal(inquiry.status, 200);
    assert.match(await inquiry.text(), /Cantidad: 5/);
    for (let index = 0; index < 4; index++)
      assert.equal(
        (await fetch(`${base}/buscar/`, { redirect: "manual" })).status,
        308,
      );
    assert.equal(
      (await fetch(`${base}/buscar`, { redirect: "manual" })).status,
      429,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
