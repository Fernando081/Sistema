import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { once } from "node:events";
import { publishCatalog, digest, rollbackRelease } from "../publish.mjs";
import { createPreviewServer } from "../server.mjs";
test("aprobación exacta, activación completa y retiro HTTP sin reinicio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-release-test-"));
  let server;
  const product = {
    slug: "fixture-interna",
    status: "published",
    approved: true,
    code: "TEST",
    brand: "Fixture",
    category: "Fixture",
    title: "Fixture interna",
    description: "Solo prueba temporal",
    applications: [],
    references: [],
    specifications: [],
  };
  const raw = JSON.stringify({ schemaVersion: 1, products: [product] });
  const approve = (value) => ({
    sha256: digest(value),
    reviewer: "Prueba automatizada",
    decision: "approve-local-preview",
  });
  try {
    await assert.rejects(
      publishCatalog(raw, { ...approve(raw), sha256: "incorrecto" }, directory),
      /Aprobación/,
    );
    const first = await publishCatalog(raw, approve(raw), directory);
    const integrity = digest(
      await readFile(
        join(directory, "releases", first, "integrity.json"),
        "utf8",
      ),
    );
    server = await createPreviewServer(directory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal(
      (await fetch(base + "/productos/fixture-interna")).status,
      200,
    );
    for (const route of [
      "/current-release.json",
      "/approval.json",
      "/catalog.json",
      "/releases/test",
    ])
      assert.equal((await fetch(base + route)).status, 404);
    const retired = JSON.stringify({
      schemaVersion: 1,
      products: [{ ...product, status: "retired" }],
    });
    await publishCatalog(retired, approve(retired), directory);
    assert.equal(
      (await fetch(base + "/productos/fixture-interna")).status,
      404,
    );
    const invalid = JSON.stringify({
      schemaVersion: 1,
      products: [{ ...product, cost: 99 }],
    });
    await assert.rejects(
      publishCatalog(invalid, approve(invalid), directory),
      /campos/,
    );
    assert.equal((await fetch(base + "/")).status, 200);
    const rollbackApproval = {
      integrity,
      reviewer: "Prueba automatizada",
      decision: "approve-local-rollback",
    };
    await assert.rejects(
      rollbackRelease("../escape", rollbackApproval, directory),
      /Identificador/,
    );
    await rollbackRelease(first, rollbackApproval, directory);
    const previousPolicy = process.env.PUBLIC_WEB_REQUIRE_ERP;
    try {
      process.env.PUBLIC_WEB_REQUIRE_ERP = "1";
      await assert.rejects(
        rollbackRelease(first, rollbackApproval, directory),
        /exige recibo/,
      );
    } finally {
      if (previousPolicy === undefined)
        delete process.env.PUBLIC_WEB_REQUIRE_ERP;
      else process.env.PUBLIC_WEB_REQUIRE_ERP = previousPolicy;
    }
    assert.equal(
      (await fetch(base + "/productos/fixture-interna")).status,
      200,
    );
    await writeFile(
      join(
        directory,
        "releases",
        first,
        "productos/fixture-interna/index.html",
      ),
      "alterado",
    );
    await assert.rejects(
      rollbackRelease(first, rollbackApproval, directory),
      /alterado/,
    );
  } finally {
    if (server) await new Promise((done) => server.close(done));
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + "\\") ||
      !basename(target).startsWith("rtt-release-test-")
    )
      throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
});

test("rollback con recibo exige vigencia también en la segunda comprobación", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-release-test-"));
  try {
    const raw = JSON.stringify({
      schemaVersion: 1,
      products: [
        {
          slug: "fixture",
          status: "published",
          approved: true,
          code: "TEST",
          brand: "Fixture",
          category: "Fixture",
          title: "Fixture",
          description: "Solo prueba",
          applications: [],
          references: [],
          specifications: [],
        },
      ],
    });
    const receipt = { scope: "batch", receiptId: 9 };
    let checks = 0,
      failSecond = false;
    const options = {
      erp: {
        token: "fixture-solo-memoria",
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            scope: "batch",
            receiptId: 9,
            productCount: 1,
            sha256: digest(raw),
            active: !(failSecond && ++checks === 2),
            revoked: false,
          }),
        }),
      },
    };
    const local = {
      sha256: digest(raw),
      reviewer: "Prueba",
      decision: "approve-local-preview",
      erpReceipt: receipt,
    };
    const first = await publishCatalog(raw, local, directory, options);
    const integrity = digest(
      await readFile(
        join(directory, "releases", first, "integrity.json"),
        "utf8",
      ),
    );
    await publishCatalog(raw, local, directory, options);
    const pointer = await readFile(
      join(directory, "current-release.json"),
      "utf8",
    );
    failSecond = true;
    checks = 0;
    await assert.rejects(
      rollbackRelease(
        first,
        { integrity, reviewer: "Prueba", decision: "approve-local-rollback" },
        directory,
        options,
      ),
      /no vigente/,
    );
    assert.equal(checks, 2);
    assert.equal(
      await readFile(join(directory, "current-release.json"), "utf8"),
      pointer,
    );
  } finally {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + "\\") ||
      !basename(target).startsWith("rtt-release-test-")
    )
      throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
});
