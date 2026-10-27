import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";

test("recepción HTTP cerrada por defecto; origen, tamaño y validación antes de persistencia", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-intake-"));
  let server;
  const intake = {
    privacyText:
      "Aviso fixture para pruebas aisladas. No es el aviso operativo.",
    privacyApproved: false,
    privacyVersion: "fixture-v1",
    origin: "http://127.0.0.1",
    key: Buffer.alloc(32, 1),
  };
  const received = [];
  intake.receive = async (lead, fingerprint) => {
    received.push({ lead, fingerprint });
  };
  try {
    await build(directory);
    server = await createPreviewServer(directory, { intake });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    intake.origin = base;
    const input = {
      schemaVersion: 1,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      contact: {
        name: "Fixture",
        channel: "email",
        value: "fixture@example.com",
      },
      items: [
        {
          kind: "reference",
          code: "INDICADO-1",
          brand: "",
          application: "",
          quantity: 2,
        },
      ],
      privacy: { accepted: true, version: "fixture-v1" },
    };
    const post = (body, origin = base, type = "application/json") =>
      fetch(base + "/solicitudes", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": type },
        body,
      });
    assert.equal((await post(JSON.stringify(input))).status, 503);
    assert.equal((await fetch(base + "/solicitar")).status, 503);
    intake.privacyApproved = true;
    assert.equal(
      (await post(JSON.stringify(input), "https://externo.example")).status,
      403,
    );
    assert.equal(
      (await post(JSON.stringify(input), base, "text/plain")).status,
      415,
    );
    assert.equal((await post("a".repeat(16385))).status, 413);
    assert.equal((await post("{")).status, 400);
    assert.equal(
      (
        await post(
          JSON.stringify({
            ...input,
            privacy: { accepted: false, version: "fixture-v1" },
          }),
        )
      ).status,
      400,
    );
    assert.equal(received.length, 0);
    const response = await post(JSON.stringify(input));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { received: true });
    assert.equal(received.length, 1);
    assert.match(received[0].fingerprint, /^[a-f0-9]{64}$/);
    const form = await fetch(base + "/solicitar");
    assert.equal(form.status, 200);
    assert.match(await form.text(), /method="post"/);
    const values = new URLSearchParams({
      requestId: input.requestId,
      privacyVersion: "fixture-v1",
      name: "Fixture",
      channel: "email",
      value: "fixture@example.com",
      code: "INDICADO-1",
      brand: "",
      application: "",
      quantity: "2",
      privacyAccepted: "yes",
    });
    const submitted = await post(
      values.toString(),
      base,
      "application/x-www-form-urlencoded",
    );
    assert.equal(submitted.status, 202);
    assert.match(await submitted.text(), /Solicitud recibida/);
    assert.equal(received.length, 2);
    values.set("quantity", "0");
    const invalidForm = await post(
      values.toString(),
      base,
      "application/x-www-form-urlencoded",
    );
    assert.equal(invalidForm.status, 400);
    assert.ok((await invalidForm.text()).includes("fixture@example.com"));
    assert.equal(received.length, 2);
    values.set("quantity", "2");
    intake.receive = async () => {
      throw new Error("información privada");
    };
    const failed = await post(JSON.stringify(input));
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { received: false });
    const retry = await post(
      values.toString(),
      base,
      "application/x-www-form-urlencoded",
    );
    assert.equal(retry.status, 503);
    const retryHtml = await retry.text();
    assert.match(retryHtml, /No pudimos confirmar/);
    assert.ok(retryHtml.includes(input.requestId));
    assert.ok(retryHtml.includes("fixture@example.com"));
    // Full ten-piece native POST uses the same validated contract. Unknown or
    // incomplete rows must fail before the receiver, never silently disappear.
    intake.receive = async (lead, fingerprint) =>
      received.push({ lead, fingerprint });
    for (let n = 2; n <= 10; n++) {
      values.set("code" + n, "INDICADO-" + n);
      values.set("brand" + n, "Marca fixture");
      values.set("application" + n, "Aplicación fixture");
      values.set("quantity" + n, String(n));
    }
    const nativePost = () =>
      post(values.toString(), base, "application/x-www-form-urlencoded");
    assert.equal((await nativePost()).status, 202);
    assert.equal(received.length, 3);
    assert.equal(received[2].lead.items.length, 10);
    assert.equal(received[2].lead.items[9].quantity, 10);
    values.set("quantity10", "0");
    const invalidTen = await nativePost();
    assert.equal(invalidTen.status, 400);
    const invalidTenHtml = await invalidTen.text();
    assert.ok(invalidTenHtml.includes('value="INDICADO-10"'));
    assert.ok(invalidTenHtml.includes('value="0"'));
    assert.ok(invalidTenHtml.includes(input.requestId));
    assert.equal(received.length, 3);
    values.set("quantity10", "10");
    values.set("code10", "");
    assert.equal((await nativePost()).status, 400);
    values.set("code10", "INDICADO-10");
    values.append("code10", "AMBIGUO");
    assert.equal((await nativePost()).status, 400);
    assert.equal(received.length, 3);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
