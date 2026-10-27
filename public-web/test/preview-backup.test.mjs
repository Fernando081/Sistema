import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { build } from "../build.mjs";
import {
  backupPreview,
  restorePreview,
  verifyPreviewRecovery,
} from "../preview-backup.mjs";

test("respaldo restaura bytes y HTTP, rechaza manipulación/traversal y no sobrescribe", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "rtt-backup-test-"));
  try {
    const source = join(temporary, "source");
    await build(source);
    const archive = await backupPreview(source);
    assert.equal(
      (await verifyPreviewRecovery(archive)).status,
      "verified-local",
    );
    const destination = join(temporary, "restored");
    await restorePreview(archive, destination);
    assert.deepEqual(
      await readFile(join(source, "assets/logo-rtt.jpg")),
      await readFile(join(destination, "assets/logo-rtt.jpg")),
    );
    await assert.rejects(restorePreview(archive, destination), {
      code: "EEXIST",
    });
    const altered = structuredClone(archive);
    altered.files[0].data = Buffer.from("alterado").toString("base64");
    await assert.rejects(
      restorePreview(altered, join(temporary, "altered")),
      /Integridad/,
    );
    const traversal = structuredClone(archive);
    traversal.files[0].name = "../escape.html";
    await assert.rejects(
      restorePreview(traversal, join(temporary, "escape")),
      /no permitido/,
    );
    await writeFile(join(source, "current-release.json"), "{}");
    await assert.rejects(backupPreview(source), /publicación activa/);
  } finally {
    if (
      resolve(temporary).startsWith(resolve(tmpdir()) + sep) &&
      basename(temporary).startsWith("rtt-backup-test-")
    )
      await rm(temporary, { recursive: true, force: true });
  }
});
