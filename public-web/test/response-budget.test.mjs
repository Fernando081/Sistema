import { test } from "node:test";
import assert from "node:assert/strict";
import { dynamicResponse } from "../response-budget.mjs";
import { inquiryHtml } from "../inquiry.mjs";
import { loadBusiness } from "../business.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
test("HTTP responde 503 sin cuerpo HEAD cuando CSS supera presupuesto", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-response-budget-"));
  let server;
  try {
    await build(directory);
    await writeFile(join(directory, "assets/site.css"), Buffer.alloc(20001));
    server = await createPreviewServer(directory);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const head = await fetch(`${base}/buscar`, { method: "HEAD" });
    assert.equal(head.status, 503);
    assert.equal(await head.text(), "");
    const response = await fetch(`${base}/buscar`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /Reduce las piezas/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
test("presupuesto dinámico incluye CSS y cuenta bytes UTF-8", () => {
  assert.equal(
    dynamicResponse("x".repeat(40000), Buffer.alloc(10000)).length,
    40000,
  );
  assert.throws(
    () => dynamicResponse("x".repeat(40001), Buffer.alloc(10000)),
    (error) => error.code === "PUBLIC_RESPONSE_BUDGET",
  );
  assert.throws(
    () => dynamicResponse("é".repeat(20001), Buffer.alloc(10000)),
    /presupuesto/,
  );
  assert.throws(() => dynamicResponse("x", Buffer.alloc(20001)), /presupuesto/);
});
test("mensaje largo no crea enlaces enormes y conserva texto para copiar", async () => {
  const business = await loadBusiness();
  business.contact.whatsapp = { confirmed: true, value: "+521234567890" };
  business.contact.email = {
    confirmed: true,
    value: "fixture@empresa.example",
  };
  const product = {
    slug: "fixture",
    code: "PRUEBA",
    title: "é".repeat(1100),
    brand: "Marca",
  };
  const html = inquiryHtml(
    [product],
    business,
    new URLSearchParams({ producto: "fixture" }),
    (_url, _title, body) => body,
    () => "",
  );
  assert.match(html, /demasiado largo/);
  assert.match(html, /class="inquiry-message"/);
  assert.doesNotMatch(
    html,
    /href="https:\/\/wa\.me|href="mailto:|canales de cotización están pendientes/,
  );
});
