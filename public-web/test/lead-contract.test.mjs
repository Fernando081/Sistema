import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLead, leadFingerprint } from "../lead-contract.mjs";
const product = {
  slug: "pieza-prueba",
  status: "published",
  approved: true,
  code: "OEM-123",
  brand: "Prueba",
  category: "Prueba",
  title: "Pieza",
  description: "Fixture aislada",
  applications: [],
  references: [],
  specifications: [],
};
const catalog = { schemaVersion: 1, products: [product] };
const input = () => ({
  schemaVersion: 1,
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contact: { name: "Prueba", channel: "email", value: "prueba@EXAMPLE.COM" },
  items: [{ kind: "catalog", slug: product.slug, quantity: 2 }],
  privacy: { accepted: true, version: "fixture-v1" },
});
const validate = (data) => validateLead(data, catalog, "fixture-v1");
test("contrato deriva identidad autorizada y mantiene referencia indicada sin equivalencia", () => {
  const data = input();
  data.items.push({
    kind: "reference",
    code: "INDICADO-1",
    brand: "",
    application: "",
    quantity: 1,
  });
  const lead = validate(data);
  assert.equal(lead.origin, "public-web");
  assert.equal(lead.contact.value, "prueba@example.com");
  assert.equal(lead.items[0].code, product.code);
  assert.equal(lead.items[1].kind, "reference");
  assert.equal(data.contact.value, "prueba@EXAMPLE.COM");
});
test("rechaza identidad falsificada, retirados, contactos inválidos y consentimiento ausente", () => {
  for (const mutate of [
    (data) => {
      data.idCliente = 1;
    },
    (data) => {
      data.items[0].code = "FALSO";
    },
    (data) => {
      data.items[0].slug = "inexistente";
    },
    (data) => {
      data.items[0].quantity = "2";
    },
    (data) => {
      data.items.push(data.items[0]);
    },
    (data) => {
      data.items = Array(11).fill(data.items[0]);
    },
    (data) => {
      data.privacy.accepted = false;
    },
    (data) => {
      data.privacy.version = "anterior";
    },
    (data) => {
      data.contact.value = "texto\r\nBcc:otro";
    },
    (data) => {
      data.contact.channel = "whatsapp";
      data.contact.value = "8331234567";
    },
    (data) => {
      data.requestId = "sin-uuid";
    },
    (data) => {
      data.items = [null];
    },
  ]) {
    const data = input();
    mutate(data);
    assert.throws(() => validate(data), /Solicitud web:/);
  }
  assert.throws(
    () =>
      validateLead(
        input(),
        { schemaVersion: 1, products: [{ ...product, status: "retired" }] },
        "fixture-v1",
      ),
    /no publicable/,
  );
});
test("huella privada distingue cambio de contenido y conserva reintentos", () => {
  const key = Buffer.alloc(32, 1);
  const fingerprint = (data) =>
    leadFingerprint(data, catalog, "fixture-v1", key);
  const first = input();
  const retry = input();
  assert.equal(fingerprint(first), fingerprint(retry));
  retry.requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(fingerprint(first), fingerprint(retry));
  retry.items[0].quantity = 3;
  assert.notEqual(fingerprint(first), fingerprint(retry));
  assert.notEqual(
    fingerprint(first),
    leadFingerprint(first, catalog, "fixture-v1", Buffer.alloc(32, 2)),
  );
  assert.throws(
    () => leadFingerprint(first, catalog, "fixture-v1", Buffer.alloc(4)),
    /clave privada/,
  );
});
