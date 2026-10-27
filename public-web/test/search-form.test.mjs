import { test } from "node:test";
import assert from "node:assert/strict";
import { searchForm } from "../search.mjs";
test("sugerencias limitadas a 40, únicas, escapadas y sin reemplazar filtro escrito", () => {
  const products = Array.from({ length: 1000 }, (_, index) => ({
    brand: `Marca ${index}`,
    category: "Familia & <revisada>",
  }));
  const html = searchForm('OEM "original"', "", "", products);
  assert.equal((html.match(/<option /g) ?? []).length, 41);
  assert.match(html, /Familia &amp; &lt;revisada&gt;/);
  assert.match(html, /OEM &quot;original&quot;/);
  assert.match(html, /href="\/buscar">Limpiar/);
  const filtered = searchForm("", "Marca 999", "", products);
  assert.match(filtered, /value="Marca 999"/);
  assert.equal((filtered.match(/<option /g) ?? []).length, 2);
});
