import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { checkLocalHttp } from "../check-http.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";

test("comprobación HTTP rechaza destino externo y detecta servidor sin protecciones", async () => {
  await assert.rejects(checkLocalHttp("https://example.com"), /127.0.0.1/);
  await assert.rejects(
    checkLocalHttp("http://127.0.0.1:4500/otra"),
    /127.0.0.1/,
  );
  const server = createServer((req, res) => {
    res.end("Respuesta incorrecta");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const report = await checkLocalHttp(
      `http://127.0.0.1:${server.address().port}`,
    );
    assert.equal(report.status, "failed");
    assert.equal(report.checks.length, 29);
    assert.ok(report.checks.every((check) => !check.passed));
    assert.ok(
      report.checks
        .find((check) => check.path === "/.env")
        .failures.includes("status"),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("aceptación HTTP cubre consulta, logo, rechazo de entradas y redirecciones reales", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-http-acceptance-"));
  let server;
  try {
    await build(directory);
    server = await createPreviewServer(directory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const report = await checkLocalHttp(
      `http://127.0.0.1:${server.address().port}`,
    );
    assert.equal(
      report.status,
      "passed-local",
      JSON.stringify(report.checks.filter((check) => !check.passed)),
    );
    assert.equal(report.checks.length, 29);
    assert.ok(
      report.checks.find((check) => check.path === "/assets/logo-rtt.jpg")
        .bytes > 0,
    );
    assert.equal(
      report.checks.find(
        (check) => check.path === "/consulta" && check.method === "HEAD",
      ).bytes,
      0,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
