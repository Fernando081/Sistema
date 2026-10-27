import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHmac, randomBytes } from "node:crypto";
import { createLeadBridge } from "../lead-bridge.mjs";
test("cliente puente restringe destino y no acepta confirmación de otra solicitud", async () => {
  assert.throws(
    () => createLeadBridge("https://example.com", Buffer.alloc(32)),
    /configuración/,
  );
  assert.throws(
    () => createLeadBridge("http://127.0.0.1:3100", Buffer.alloc(4)),
    /configuración/,
  );
  let redirect = false;
  const server = createServer((_req, res) => {
    if (redirect) {
      res.writeHead(302, { Location: "https://example.com" });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true, requestId: "otro" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const receive = createLeadBridge(
      `http://127.0.0.1:${server.address().port}`,
      Buffer.alloc(32),
    );
    await assert.rejects(
      receive({ requestId: "original" }, "a".repeat(64)),
      /no confirmada/,
    );
    redirect = true;
    await assert.rejects(receive({ requestId: "original" }, "a".repeat(64)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("firma v2 vincula ID/fecha/cuerpo y captura clave/configuración al crear emisor", async () => {
  const key = randomBytes(32), original = Buffer.from(key), options = { keyId: "fixture-2" };
  for (const config of [{ keyId: "" }, { keyId: "legacy" }, { keyId: "a\nb" }, { keyId: undefined }, { keyId: "a", extra: true }, null, []])
    assert.throws(() => createLeadBridge("http://127.0.0.1:3100", key, config), /configuración/);
  let checked = false;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    assert.equal(req.headers["x-web-key-id"], "fixture-2");
    assert.equal(req.headers["x-web-signature"], createHmac("sha256", original)
      .update(`web-lead-v2\nfixture-2\n${req.headers["x-web-timestamp"]}\n${body}`).digest("hex"));
    checked = true;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true, requestId: "fixture" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const bridge = createLeadBridge(`http://127.0.0.1:${server.address().port}`, key, options);
    key.fill(0); options.keyId = "modified";
    assert.deepEqual(await bridge({ requestId: "fixture" }, "a".repeat(64)), { received: true });
    assert.ok(checked);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
