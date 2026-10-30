import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesForCatalog } from "../build.mjs";
import { validateCatalog } from "../catalog.mjs";
const product = {
  slug: "schema-fixture",
  status: "published",
  approved: true,
  code: "OEM-PRUEBA",
  title: 'Pieza "revisada"',
  brand: "Marca & prueba",
  category: "Filtros",
  description: "Solo fixture <aislada>",
  applications: [],
  references: [],
  specifications: [],
};
test("microdatos Product/Brand usan datos publicados y no afirman precios, GTIN o fabricante", () => {
  const html = pagesForCatalog(
    validateCatalog({ schemaVersion: 1, products: [product] }),
  ).get("/productos/schema-fixture");
  assert.match(html, /itemscope itemtype="https:\/\/schema.org\/Product"/);
  assert.match(html, /itemprop="name" content="Pieza &quot;revisada&quot;"/);
  assert.match(
    html,
    /itemprop="description" content="Solo fixture &lt;aislada&gt;"/,
  );
  assert.match(html, /itemprop="productID">OEM-PRUEBA/);
  assert.match(
    html,
    /itemprop="brand" itemscope itemtype="https:\/\/schema.org\/Brand"/,
  );
  assert.match(html, /itemprop="name">Marca &amp; prueba/);
  assert.doesNotMatch(
    html,
    /itemprop="(?:offers|aggregateRating|review|gtin|mpn|manufacturer|price|availability)"|<script(?! src="\/assets\/site\.js" defer><\/script>)/,
  );
  assert.doesNotMatch(html, /itemprop="image"/);
  for (const status of ["draft", "retired"])
    assert.equal(
      pagesForCatalog(
        validateCatalog({
          schemaVersion: 1,
          products: [{ ...product, status }],
        }),
      ).has("/productos/schema-fixture"),
      false,
    );
});
