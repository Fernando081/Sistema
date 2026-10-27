import { test } from "node:test";
import assert from "node:assert/strict";
import { navigationPages, groupRoute, pageSize } from "../navigation.mjs";
import { measureBudget } from "../budget.mjs";
import { readFile } from "node:fs/promises";
import { pagesForCatalog } from "../build.mjs";
const product = (index) => ({
  slug: `fixture-${index}`,
  code: `OEM-${index}`,
  brand: "Marca & revisada",
  category: "Familia <revisada>",
  title: "Fixture de navegación",
  description: "Solo pruebas",
  applications: [],
  references: [],
  specifications: [],
});
test("paginación enlaza cada ficha una vez por listado y conserva números originales", () => {
  const items = Array.from({ length: 31 }, (_, i) => product(i));
  const pages = navigationPages(
    items,
    (_route, _title, body) => body,
    (_label, title) => `<h1>${title}</h1>`,
  );
  for (const route of [
    "/catalogo",
    groupRoute("marcas", items[0].brand),
    groupRoute("categorias", items[0].category),
  ]) {
    const all = [...pages].filter(
      ([path]) => path === route || path.startsWith(`${route}/pagina/`),
    );
    assert.equal(all.length, 3);
    for (const [, html] of all)
      assert.ok((html.match(/href="\/productos\//g) ?? []).length <= pageSize);
    for (const item of items)
      assert.equal(
        all
          .map(([, html]) => html)
          .join("")
          .split(`href="/productos/${item.slug}"`).length - 1,
        1,
      );
    assert.match(pages.get(route), /OEM-/);
    assert.match(pages.get(`${route}/pagina/2`), new RegExp(`href="${route}"`));
  }
  assert.match(pages.get("/categorias"), /Familia &lt;revisada&gt;/);
  assert.equal(pages.has("/catalogo/pagina/4"), false);
  assert.equal(
    navigationPages(
      [],
      () => "",
      () => "",
    ).size,
    0,
  );
});
test("mil fichas conservan el presupuesto y grupos con nombres similares no colisionan", async () => {
  const items = Array.from({ length: 1000 }, (_, i) => product(i));
  const report = measureBudget(
    pagesForCatalog(items),
    await readFile(new URL("../assets/site.css", import.meta.url)),
  );
  assert.ok(report.routes.every((row) => row.initialBytes <= 50000));
  assert.notEqual(groupRoute("marcas", "A-B"), groupRoute("marcas", "A B"));
});
