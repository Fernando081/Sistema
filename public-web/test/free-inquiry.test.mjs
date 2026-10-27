import { test } from "node:test";
import assert from "node:assert/strict";
import { freeInquiryHtml } from "../free-inquiry.mjs";
import { loadBusiness } from "../business.mjs";
test("consulta libre conserva referencia indicada sin aprobar producto ni enviar", async () => {
  const business = await loadBusiness();
  const render = (values) =>
    freeInquiryHtml(
      business,
      new URLSearchParams(values),
      (_route, _title, body) => body,
      () => "",
    );
  assert.doesNotMatch(render({}), /inquiry-message|wa.me|mailto:/);
  const html = render({
    parte: "OEM <original>",
    marca: "A & B",
    cantidad: "3",
  });
  assert.match(html, /OEM &lt;original&gt;/);
  assert.match(html, /Cantidad: 3/);
  assert.match(html, /Aplicación indicada: Por confirmar/);
  assert.match(html, /No se guarda una solicitud/);
  const link = html.match(/href="(https:\/\/wa.me\/[^\"]+)"/)[1];
  assert.match(new URL(link).searchParams.get("text"), /OEM <original>/);
  for (const values of [
    { parte: "OEM", cantidad: "0" },
    { parte: "x".repeat(101) },
    { parte: "OEM", aplicacion: "x\ny" },
  ]) {
    const invalid = render(values);
    assert.match(invalid, /role="alert"/);
    assert.doesNotMatch(invalid, /wa.me|mailto:|inquiry-message/);
  }
  assert.throws(() => render({ token: "privado" }), /Parámetros/);
});
