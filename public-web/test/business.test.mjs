import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBusiness, validateBusiness, businessPages } from "../business.mjs";
const shell = (path, title, body) => body;
const heading = () => "";
test("Google Maps solo admite enlace corto HTTPS confirmado y conserva configuración anterior", async () => {
  const input = await loadBusiness();
  input.contact.maps = {
    confirmed: false,
    value: "https://maps.app.goo.gl/Prueba123",
  };
  assert.doesNotMatch(
    businessPages(input, shell, heading).get("/contacto"),
    /Prueba123/,
  );
  input.contact.maps.confirmed = true;
  assert.match(
    businessPages(input, shell, heading).get("/contacto"),
    /href="https:\/\/maps.app.goo.gl\/Prueba123"/,
  );
  for (const value of [
    "javascript:alert(1)",
    "https://maps.app.goo.gl.evil.example/Prueba",
    "https://maps.app.goo.gl/Prueba?next=evil",
    "http://maps.app.goo.gl/Prueba",
  ])
    assert.throws(
      () =>
        validateBusiness({
          ...input,
          contact: { ...input.contact, maps: { confirmed: true, value } },
        }),
      /Google Maps/,
    );
  delete input.contact.maps;
  assert.doesNotThrow(() => validateBusiness(input));
});
test("solo incluye información pública confirmada y escapa texto", async () => {
  const draft = await loadBusiness();
  for (const record of Object.values(draft.contact)) record.confirmed = false;
  draft.contact.address = { confirmed: false, value: "DIRECCION-NO-APROBADA" };
  draft.story = { confirmed: false, paragraphs: ["HISTORIA-NO-APROBADA"] };
  draft.brands = [{ confirmed: false, name: "MARCA-NO-APROBADA" }];
  const hidden = [...businessPages(draft, shell, heading).values()].join("");
  assert.doesNotMatch(hidden, /NO-APROBADA/);
  assert.doesNotMatch(hidden, /href="tel:|wa.me/);
  draft.contact.address.confirmed = true;
  draft.story = { confirmed: true, paragraphs: ["<script>alert(1)</script>"] };
  draft.brands = [{ confirmed: true, name: "Marca & refacciones" }];
  const visible = [...businessPages(draft, shell, heading).values()].join("");
  assert.match(visible, /DIRECCION-NO-APROBADA/);
  assert.match(visible, /&lt;script&gt;/);
  assert.match(visible, /Marca &amp; refacciones/);
  assert.doesNotMatch(visible, /<script>/);
});
test("rechaza datos desconocidos, confirmaciones inválidas, URL en teléfono y marcas duplicadas", async () => {
  const empty = await loadBusiness();
  assert.throws(
    () => validateBusiness({ ...empty, token: "no-permitido" }),
    /Configuración/,
  );
  for (const record of [
    { confirmed: "true", value: "" },
    { confirmed: true, value: "" },
    { confirmed: true, value: "javascript:alert(1)" },
  ]) {
    const input = structuredClone(empty);
    input.contact.phone = record;
    assert.throws(() => validateBusiness(input));
  }
  const duplicate = structuredClone(empty);
  duplicate.brands = [
    { confirmed: true, name: "Marca" },
    { confirmed: false, name: " marca " },
  ];
  assert.throws(() => validateBusiness(duplicate), /duplicadas/);
});
