import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCatalog, catalogPages } from "../catalog.mjs";
const fixture = () => ({
  slug: "prueba-interna",
  status: "published",
  approved: true,
  code: "PRUEBA",
  brand: "Marca de prueba",
  category: "Categoría de prueba",
  title: "Ficha <script> prueba",
  description: "Solo fixture en memoria",
  applications: ["Restricción <b>"],
  references: ["Referencia & revisión"],
  specifications: [{ name: "Medida", value: "1", unit: "mm" }],
});
test("excluye borradores, retirados y productos sin aprobación explícita", () => {
  for (const status of ["draft", "retired"])
    assert.deepEqual(
      validateCatalog({
        schemaVersion: 1,
        products: [{ ...fixture(), status }],
      }),
      [],
    );
  assert.deepEqual(
    validateCatalog({
      schemaVersion: 1,
      products: [{ ...fixture(), approved: false }],
    }),
    [],
  );
});
test("rechaza campos privados y direcciones ambiguas", () => {
  for (const field of ["cost", "price", "VIN", "ESN", "customers", "token"])
    assert.throws(
      () =>
        validateCatalog({
          schemaVersion: 1,
          products: [{ ...fixture(), [field]: "privado" }],
        }),
      /campos/,
    );
  for (const slug of ["../admin", "x?query", "UPPER", "x/y"])
    assert.throws(
      () =>
        validateCatalog({
          schemaVersion: 1,
          products: [{ ...fixture(), slug }],
        }),
      /slug/,
    );
  assert.throws(
    () =>
      validateCatalog({ schemaVersion: 1, products: [fixture(), fixture()] }),
    /duplicado/,
  );
});
test("ficha tiene contenido HTML inicial escapado y enlace desde catálogo", () => {
  const products = validateCatalog({ schemaVersion: 1, products: [fixture()] });
  const pages = catalogPages(
    products,
    (_url, title, body) => `<title>${title}</title>${body}`,
    (_label, title, description) => `<h1>${title}</h1><p>${description}</p>`,
  );
  const html = pages.get("/productos/prueba-interna");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script(?! src="\/assets\/site\.js" defer><\/script>)|\/uploads\/|PrecioUnitario/);
  assert.match(html, /PRUEBA/);
  assert.match(html, /Restricción &lt;b&gt;/);
  assert.match(html, /Referencia &amp; revisión/);
  assert.match(pages.get("/catalogo"), /href="\/productos\/prueba-interna"/);
});

test("alternativas solo hacia fichas aprobadas: bloquea retirada, borrador y ciclos propios", () => {
  const source = { ...fixture(), alternatives: ["alternativa-revisada"] };
  const alternative = {
    ...fixture(),
    slug: "alternativa-revisada",
    title: "Alternativa revisada",
  };
  const input = { schemaVersion: 1, products: [source, alternative] };
  const products = validateCatalog(input);
  const html = catalogPages(
    products,
    (_path, _title, body) => body,
    () => "<h1>Fixture</h1>",
  ).get("/productos/prueba-interna");
  assert.match(html, /aria-label="Alternativas revisadas"/);
  assert.match(html, /href="\/productos\/alternativa-revisada"/);
  for (const state of ["draft", "retired"])
    assert.throws(
      () =>
        validateCatalog({
          ...input,
          products: [source, { ...alternative, status: state }],
        }),
      /publicada y aprobada/,
    );
  assert.throws(
    () =>
      validateCatalog({
        ...input,
        products: [source, { ...alternative, approved: false }],
      }),
    /publicada y aprobada/,
  );
  for (const alternatives of [
    ["prueba-interna"],
    ["alternativa-revisada", "alternativa-revisada"],
    ["../secret"],
  ])
    assert.throws(
      () =>
        validateCatalog({
          ...input,
          products: [{ ...source, alternatives }, alternative],
        }),
      /Alternativas/,
    );
});
