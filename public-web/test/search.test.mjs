import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCatalog, searchHtml } from "../search.mjs";
import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, pagesForCatalog } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
test("búsqueda HTTP sirve HTML público y mantiene índice privado y límites", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-search-"));
  let server;
  try {
    const products = [
      {
        ...fixture("OEM-123"),
        status: "published",
        approved: true,
        specifications: [],
      },
    ];
    await build(directory, pagesForCatalog(products), products);
    server = await createPreviewServer(directory);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/buscar?q=OEM123`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Número de parte sin guiones/);
    assert.equal((await fetch(`${base}/search-catalog.json`)).status, 404);
    assert.equal((await fetch(`${base}/buscar?pagina=0`)).status, 400);
    assert.equal(
      (await fetch(`${base}/buscar?q=OEM123`, { method: "HEAD" })).status,
      200,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
const fixture = (code, references = []) => ({
  slug: code.toLowerCase().replace(/[^a-z0-9]/g, "-"),
  code,
  references,
  title: "Filtro diésel",
  description: "Servicio pesado",
  brand: "Marca",
  category: "Filtros",
  applications: [],
});
test("prioriza código original, normalizado y referencia; filtros y límites", () => {
  const products = [
    fixture("AB12"),
    fixture("OTRO", ["AB-12"]),
    fixture("AB-12"),
  ];
  const result = searchCatalog(products, new URLSearchParams({ q: "AB-12" }));
  assert.deepEqual(
    result.results.map((row) => row.rank),
    [4, 3, 2],
  );
  assert.equal(
    searchCatalog(products, new URLSearchParams({ q: "diesel pesado" })).total,
    3,
  );
  assert.equal(
    searchCatalog(products, new URLSearchParams({ marca: "Otra" })).total,
    0,
  );
  for (const query of [
    "q=x&q=y",
    "pagina=0",
    "pagina=9999",
    "otro=x",
    `q=${"a".repeat(101)}`,
  ])
    assert.throws(() => searchCatalog(products, new URLSearchParams(query)));
  const html = searchHtml(
    products,
    new URLSearchParams({ q: "<script>" }),
    (_url, _title, body) => body,
    () => "",
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test("búsquedas representativas sobre mil fichas y paginación acotada", () => {
  const products = Array.from({ length: 1000 }, (_, index) =>
    fixture(`OEM-${index}`),
  );
  const start = performance.now();
  for (let index = 0; index < 100; index++)
    assert.equal(
      searchCatalog(products, new URLSearchParams({ q: `OEM-${index}` }))
        .results[0].item.code,
      `OEM-${index}`,
    );
  const elapsed = performance.now() - start;
  console.log(
    `100 consultas / 1000 fichas: ${elapsed.toFixed(1)} ms (motor en memoria)`,
  );
  assert.ok(elapsed < 10000);
  assert.equal(
    searchCatalog(products, new URLSearchParams({ q: "filtro", pagina: "2" }))
      .results.length,
    12,
  );
});
