import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesForCatalog } from "../build.mjs";
import { productMetadata, breadcrumbHtml } from "../metadata.mjs";
const fixture = (slug, code) => ({
  slug,
  code,
  title: "Filtro revisado",
  brand: 'Marca " & prueba',
  category: "Familia <revisada>",
  description: 'Descripción "revisada" <segura>',
  applications: [],
  references: [],
  specifications: [],
});
test("fichas con título comercial repetido tienen metadatos propios y rutas existentes", () => {
  const first = fixture("primero", "OEM-1");
  const second = fixture("segundo", "OEM-2");
  const pages = pagesForCatalog([first, second]);
  const html = pages.get("/productos/primero");
  assert.match(
    html,
    /<title>Filtro revisado · OEM-1 · Marca &quot; &amp; prueba/,
  );
  assert.match(
    html,
    /name="description" content="OEM-1 · Marca &quot; &amp; prueba\. Descripción &quot;revisada&quot; &lt;segura&gt;"/,
  );
  assert.notEqual(productMetadata(first).title, productMetadata(second).title);
  for (const item of productMetadata(first).breadcrumbs)
    assert.ok(pages.has(item.url));
  assert.match(html, /href="\/catalogo">Catálogo/);
  assert.match(html, /Familia &lt;revisada&gt;/);
  assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json|<script(?! src="\/assets\/site\.js" defer><\/script>)/);
  assert.match(html, /noindex,nofollow/);
  assert.throws(() =>
    breadcrumbHtml("x", [{ url: "javascript:alert(1)", title: "x" }]),
  );
});
test("descripción acotada conserva identificación y normaliza espacios", () => {
  const metadata = productMetadata({
    ...fixture("prueba", "OEM-1"),
    description: "Texto\n   largo " + "x".repeat(1000),
  });
  assert.ok(metadata.description.length <= 320);
  assert.match(metadata.description, /OEM-1/);
  assert.doesNotMatch(metadata.description, /\n| {2}/);
});
