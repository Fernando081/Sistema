import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { receiveLeadHttp } from "../lead-intake.mjs";

const input = {
  schemaVersion: 1,
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contact: { name: "Fixture", channel: "email", value: "fixture@example.com" },
  items: [
    {
      kind: "reference",
      code: "FIXTURE",
      brand: "",
      application: "",
      quantity: 2,
    },
  ],
  privacy: { accepted: true, version: "fixture-v1" },
};

async function withReceiver(run) {
  const config = {
    privacyApproved: true,
    privacyVersion: "fixture-v1",
    key: Buffer.alloc(32, 1),
    catalog: { schemaVersion: 1, products: [] },
    storageTimeoutMs: 50,
    receive: async () => {},
  };
  const server = createServer((req, res) => receiveLeadHttp(req, res, config));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  config.origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body = input) =>
    fetch(config.origin, {
      method: "POST",
      headers: { Origin: config.origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  try {
    await run(config, post);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("receptor pendiente vence sin confirmar y su rechazo tardío queda manejado", async () => {
  await withReceiver(async (config, post) => {
    let rejectReceipt;
    config.receive = () =>
      new Promise((_, reject) => {
        rejectReceipt = reject;
      });
    const response = await post();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { received: false });
    assert.equal(typeof rejectReceipt, "function");
    // Node's test runner fails on an unhandled rejection. The late callback
    // cannot rewrite a completed response or crash a subsequent request.
    rejectReceipt(new Error("Detalle privado fixture"));
    await new Promise((resolve) => setImmediate(resolve));
    config.receive = async function (lead) {
      assert.equal(this, config);
      assert.equal(lead.requestId, input.requestId);
    };
    const retry = await post();
    assert.equal(retry.status, 202);
    assert.deepEqual(await retry.json(), { received: true });
  });
});

test("deadline solo configurable por servidor, intervalo inválido bloquea antes del receptor", async () => {
  await withReceiver(async (config, post) => {
    let calls = 0;
    config.receive = async () => {
      calls++;
    };
    for (const timeout of [0, -1, 5001, 1.5, "50", null, NaN, Infinity]) {
      config.storageTimeoutMs = timeout;
      assert.equal((await post()).status, 503);
    }
    assert.equal(calls, 0);
    delete config.storageTimeoutMs;
    assert.equal((await post()).status, 202, "Cinco segundos por defecto");
    config.storageTimeoutMs = 5000;
    assert.equal((await post()).status, 202);
    assert.equal((await post({ ...input, storageTimeoutMs: 1 })).status, 400);
    assert.equal(calls, 2);
  });
});
