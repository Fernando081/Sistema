import { test } from "node:test";
import assert from "node:assert/strict";
import { auditPages } from "../audit.mjs";
import { pagesForCatalog } from "../build.mjs";
test("auditoría bloquea enlace roto, ancla, metadatos y pérdida de noindex", () => {
  const pages = pagesForCatalog([]);
  assert.equal(auditPages(pages).errors.length, 0);
  for (const edit of [
    (html) => html.replace("</main>", '<a href="/privado">Enlace</a></main>'),
    (html) =>
      html.replace("</main>", '<a href="#inexistente">Enlace</a></main>'),
    (html) => html.replace(/<title>[^]*?<\/title>/, ""),
    (html) => html.replace('name="description"', 'name="otro"'),
    (html) => html.replace("noindex,nofollow", "index,follow"),
  ]) {
    const invalid = new Map(pages);
    invalid.set("/", edit(invalid.get("/")));
    assert.throws(() => auditPages(invalid), /Auditoría pública/);
  }
});
test("título comercial duplicado es advertencia editorial y consulta conserva producto publicado", () => {
  const product = {
    title: "Fixture",
    code: "PRUEBA",
    brand: "Marca",
    category: "Familia",
    description: "Prueba aislada",
    applications: [],
    references: [],
    specifications: [],
  };
  const pages = pagesForCatalog([
    { ...product, slug: "uno" },
    { ...product, slug: "dos" },
  ]);
  const report = auditPages(pages);
  assert.equal(report.errors.length, 0);
  assert.equal(report.warnings.length, 1);
  const invalid = new Map(pages);
  invalid.set(
    "/productos/uno",
    invalid
      .get("/productos/uno")
      .replace("/cotizar?producto=uno", "/cotizar?producto=privado"),
  );
  assert.throws(() => auditPages(invalid), /enlace roto/);
});
