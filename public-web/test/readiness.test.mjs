import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readinessReport } from "../readiness.mjs";
const business = JSON.parse(
  await readFile(new URL("../business.json", import.meta.url), "utf8"),
);
test("catálogo vacío no se considera preparado aunque el HTML sea válido", () => {
  const report = readinessReport({
    catalog: { schemaVersion: 1, products: [] },
    business,
    site: { origin: "", confirmed: false },
  });
  assert.equal(report.status, "pending");
  assert.equal(report.publicProducts, 0);
  assert.equal(report.pending.length, 6);
});
test("borrador no cuenta y configuración técnica no sustituye aceptación del propietario", () => {
  const product = {
    slug: "fixture",
    status: "published",
    approved: true,
    code: "PRUEBA",
    title: "Fixture",
    brand: "Marca",
    category: "Familia",
    description: "Solo pruebas",
    applications: [],
    references: [],
    specifications: [],
  };
  const config = structuredClone(business);
  config.contact.email = { confirmed: true, value: "fixture@empresa.example" };
  const report = readinessReport({
    catalog: {
      schemaVersion: 1,
      products: [product, { ...product, slug: "borrador", status: "draft" }],
    },
    business: config,
    site: { origin: "https://empresa.example", confirmed: true },
  });
  assert.equal(report.publicProducts, 1);
  assert.ok(report.pending.includes("WEB03.1-fotos"));
  assert.ok(report.pending.includes("WEB04.2-aceptacion"));
  assert.ok(report.pending.includes("WEB04.1-operacion"));
  assert.ok(report.pending.includes("WEB04.3-validacion"));
  assert.equal(report.status, "pending");
});
