import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectActiveRelease } from "../active-release.mjs";
import { sealRelease, hash } from "../release.mjs";

test("inspección distingue preview, versión sellada, alteración y ruta sin sello", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-active-test-"));
  const release = "11111111-1111-1111-1111-111111111111";
  const selected = join(directory, "releases", release);
  const pointer = join(directory, "current-release.json");
  try {
    assert.equal((await inspectActiveRelease(directory)).status, "pending");
    await mkdir(selected, { recursive: true });
    for (const [name, content] of Object.entries({
      "index.html": "Fixture aislada",
      "routes.json": '{"/":"index.html"}',
      "approval.json": "{}",
      "budget-report.json": "{}",
    }))
      await writeFile(join(selected, name), content);
    const integrity = await sealRelease(selected);
    await writeFile(pointer, JSON.stringify({ release, integrity }));
    const report = await inspectActiveRelease(directory);
    assert.equal(report.status, "verified-local");
    assert.equal(report.erpReceiptFreshnessVerified, false);
    await writeFile(join(selected, "index.html"), "Alterado");
    await assert.rejects(inspectActiveRelease(directory), /alterado/);
    await writeFile(join(selected, "index.html"), "Fixture aislada");
    await writeFile(join(selected, "routes.json"), '{"/":"missing.html"}');
    const manifest = JSON.parse(
      await readFile(join(selected, "integrity.json"), "utf8"),
    );
    manifest.files["routes.json"] = hash('{"/":"missing.html"}');
    const raw = JSON.stringify(manifest);
    await writeFile(join(selected, "integrity.json"), raw);
    await writeFile(pointer, JSON.stringify({ release, integrity: hash(raw) }));
    await assert.rejects(inspectActiveRelease(directory), /sin sello/);
    await writeFile(
      pointer,
      JSON.stringify({ release: "../escape", integrity }),
    );
    await assert.rejects(inspectActiveRelease(directory), /Identificador/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
