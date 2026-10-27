import { test } from "node:test";
import assert from "node:assert/strict";
import { leadFromForm, leadFormHtml } from "../lead-form.mjs";
import { validateLead } from "../lead-contract.mjs";

const config = { privacyVersion: "fixture-v1", privacyText: "Aviso fixture" };
const values = () =>
  new URLSearchParams({
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    privacyVersion: config.privacyVersion,
    privacyAccepted: "yes",
    name: "Fixture",
    channel: "email",
    value: "fixture@example.com",
    code: "PIEZA-1",
    brand: "",
    application: "",
    quantity: "2",
  });
const validate = (params) =>
  validateLead(
    leadFromForm(params.toString()),
    { schemaVersion: 1, products: [] },
    config.privacyVersion,
  );

test("formulario nativo admite diez referencias, huecos vacíos y cantidad opcional 1", () => {
  const params = values();
  // Native closed details still submit their controls: fully blank rows must not
  // become extra pieces. A reference in row 10 must survive the blank rows.
  for (let n = 2; n <= 10; n++)
    for (const field of ["code", "brand", "application", "quantity"])
      params.set(field + n, "");
  params.set("code10", "PIEZA-10");
  assert.deepEqual(
    validate(params).items.map((item) => [item.code, item.quantity]),
    [
      ["PIEZA-1", 2],
      ["PIEZA-10", 1],
    ],
  );
  for (let n = 2; n <= 10; n++) {
    params.set("code" + n, "PIEZA-" + n);
    params.set("quantity" + n, String(n));
  }
  assert.equal(validate(params).items.length, 10);
});

test("referencias parciales, repetidas, cantidades inválidas y campos ambiguos impiden confirmar", () => {
  for (const changes of [
    { brand2: "Marca sin código" },
    { quantity2: "2" },
    { code2: "PIEZA-2", quantity2: "0" },
    { code2: "PIEZA-2", quantity2: "1.5" },
    { code2: "PIEZA-2", quantity2: "10000" },
    { code2: "PIEZA-1" },
    { code11: "PIEZA-11" },
    { code02: "PIEZA-2" },
  ]) {
    const params = values();
    for (const [field, value] of Object.entries(changes))
      params.set(field, value);
    assert.throws(() => validate(params));
  }
  const repeated = values();
  repeated.append("code2", "A");
  repeated.append("code2", "B");
  assert.throws(() => validate(repeated));
});

test("error conserva todas las referencias, cero inválido y UUID; campos escapados", () => {
  const params = values();
  params.set("code2", '<script>alert("x")</script>');
  params.set("quantity2", "0");
  params.set("application10", 'Motor "fixture"');
  params.set("code10", "PIEZA-10");
  params.set("quantity10", "10000");
  const html = leadFormHtml(
    config,
    leadFromForm(params.toString()),
    400,
    (_url, _title, body) => body,
    () => "",
  );
  assert.ok(html.includes(params.get("requestId")));
  assert.ok(html.includes('name="quantity2"'));
  assert.ok(html.includes('value="0"'));
  assert.ok(html.includes('value="10000"'));
  assert.ok(html.includes('value="PIEZA-10"'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.equal((html.match(/class="lead-piece" open/g) || []).length, 2);
});
