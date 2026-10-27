import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyErpReceipt } from "../erp-receipt.mjs";
test("recibo de lote verifica ruta, hash, vigencia y alcance", async () => {
  const raw = '{"schemaVersion":1,"products":[{}]}';
  const receipt = { scope: "batch", receiptId: 9 };
  const status = {
    ...receipt,
    active: true,
    revoked: false,
    productCount: 1,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
  const options = {
    token: "fixture-solo-memoria",
    fetchImpl: async (url) => {
      assert.equal(
        url.pathname,
        "/api/v1/web-catalog/admin/products/batch/approvals/9",
      );
      return { ok: true, json: async () => status };
    },
  };
  assert.equal((await verifyErpReceipt(raw, receipt, options)).scope, "batch");
  for (const patch of [
    { active: false },
    { revoked: true },
    { sha256: "otro" },
    { scope: "product" },
    { productCount: 0 },
    { receiptId: 10 },
  ])
    await assert.rejects(
      verifyErpReceipt(raw, receipt, {
        ...options,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ ...status, ...patch }),
        }),
      }),
      /no vigente/,
    );
});
test("recibo ERP exige sesión, origen local y vigencia/hash exactos", async () => {
  const raw = '{"schemaVersion":1,"products":[]}';
  const receipt = { productId: 1, receiptId: 9 };
  const status = {
    ...receipt,
    version: 2,
    active: true,
    revoked: false,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
  let calls = 0;
  const options = {
    token: "fixture-solo-memoria",
    fetchImpl: async (url, request) => {
      calls++;
      assert.equal(url.hostname, "127.0.0.1");
      assert.equal(request.redirect, "error");
      return { ok: true, json: async () => status };
    },
  };
  assert.equal((await verifyErpReceipt(raw, receipt, options)).version, 2);
  assert.equal(calls, 1);
  for (const patch of [
    { active: false },
    { revoked: true },
    { sha256: "distinto" },
    { productId: 2 },
    { receiptId: 10 },
  ])
    await assert.rejects(
      verifyErpReceipt(raw, receipt, {
        ...options,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ ...status, ...patch }),
        }),
      }),
      /no vigente/,
    );
  await assert.rejects(
    verifyErpReceipt(raw, receipt, {
      ...options,
      baseUrl: "http://example.com/api/v1/",
    }),
    /Solo/,
  );
  await assert.rejects(
    verifyErpReceipt(raw, receipt, { ...options, token: "" }),
    /sesión/,
  );
  await assert.rejects(
    verifyErpReceipt(raw, receipt, {
      ...options,
      fetchImpl: async () => ({ ok: false }),
    }),
    /no confirmó/,
  );
});
