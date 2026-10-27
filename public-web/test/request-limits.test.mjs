import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestLimits } from "../request-limits.mjs";
import { build } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("límite por conexión acota memoria y recupera ventanas sin dormir", () => {
  let time = 0;
  const check = createRequestLimits({
    requests: 2,
    windowMs: 1000,
    clients: 1,
    now: () => time,
  });
  assert.equal(check("a").status, 200);
  assert.equal(check("a").status, 200);
  assert.deepEqual(check("a"), { status: 429, retryAfter: 1 });
  assert.equal(check("b").status, 503);
  time = 1000;
  assert.equal(check("b").status, 200);
  assert.throws(() => createRequestLimits({ requests: 0 }));
});
test("HTTP limita antes de procesar y no confía en cabeceras de proxy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-limits-"));
  let server;
  try {
    await build(directory);
    server = await createPreviewServer(directory, {
      requestLimits: { requests: 2 },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/buscar?q=primera`)).status, 200);
    assert.equal(
      (
        await fetch(`${base}/buscar?q=segunda`, {
          headers: { "X-Forwarded-For": "192.0.2.1" },
        })
      ).status,
      200,
    );
    const blocked = await fetch(`${base}/cotizar?producto=ausente`, {
      headers: { "X-Forwarded-For": "192.0.2.2" },
      method: "HEAD",
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(await blocked.text(), "");
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal(
      (await fetch(`${base}/buscar?q=${"x".repeat(8200)}`)).status,
      414,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
