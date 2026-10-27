import { test } from "node:test";
import assert from "node:assert/strict";
import { inquiryPieces, inquiryHtml } from "../inquiry.mjs";
import { loadBusiness } from "../business.mjs";
const first = { slug: "uno", code: "OEM-1", brand: "A", title: "Uno" };
const second = { slug: "dos", code: "OEM-2", brand: "B", title: "Dos" };
test("consulta multipieza conserva identificación y acumula duplicados sin adivinar marca", () => {
  const products = [first, second, { ...second, slug: "tres", brand: "C" }];
  const pieces = inquiryPieces(
    products,
    first,
    "2",
    "OEM-1 | 3\nOEM-2 | 4 | B",
  );
  assert.deepEqual(
    pieces.map((item) => [item.product.slug, item.quantity]),
    [
      ["uno", 5],
      ["dos", 4],
    ],
  );
  for (const input of [
    "OEM-2 | 1",
    "PRIVADO | 1",
    "OEM-1 | 0",
    "OEM-1 | 9999",
    "x".repeat(1201),
    Array(10).fill("OEM-1 | 1").join("\n"),
  ])
    assert.throws(() => inquiryPieces(products, first, "2", input));
});
test("lista inválida conserva captura, muestra corrección y no prepara envío", async () => {
  const business = await loadBusiness();
  business.contact.whatsapp = { confirmed: true, value: "+521234567890" };
  const html = inquiryHtml(
    [first, second],
    business,
    new URLSearchParams({ producto: "uno", piezas: "<privado> | 1" }),
    (_url, _title, body) => body,
    () => "",
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;privado&gt; \| 1/);
  assert.doesNotMatch(html, /wa\.me|mailto:|class="inquiry-message"/);
  assert.doesNotMatch(
    html,
    /canales de cotización están pendientes|inquiry-summary/,
  );
  assert.match(html, /Corrige la lista/);
});

test("resumen multipieza refleja cantidades acumuladas y enlaces antes de enviar", async () => {
  const html = inquiryHtml(
    [first, second],
    await loadBusiness(),
    new URLSearchParams({
      producto: "uno",
      cantidad: "2",
      piezas: "OEM-1 | 3\nOEM-2 | 4 | B",
    }),
    (_url, _title, body) => body,
    () => "",
  );
  assert.match(html, /2 referencias en esta consulta/);
  assert.match(html, /href="\/productos\/uno"/);
  assert.match(html, /href="\/productos\/dos"/);
  assert.match(html, /<td>5<\/td>/);
  assert.match(html, /<td>4<\/td>/);
  assert.match(html, /Texto para enviar/);
});
