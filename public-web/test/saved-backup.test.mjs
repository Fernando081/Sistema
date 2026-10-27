import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { checkSavedBackup } from "../check-saved-backup.mjs";
import { hash } from "../release.mjs";
test("respaldo guardado rechaza traversal, hash distinto y formato inválido", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-saved-backup-"));
  try {
    const filename = "web-preview-11111111-1111-1111-1111-111111111111.json";
    await writeFile(join(directory, filename), "{}");
    await assert.rejects(
      checkSavedBackup(directory, filename, hash("{}")),
      /Respaldo inválido/,
    );
    await assert.rejects(
      checkSavedBackup(directory, "../" + filename, "a".repeat(64)),
      /inválido/,
    );
    await assert.rejects(
      checkSavedBackup(directory, filename, "a".repeat(64)),
      /no coincide/,
    );
    await assert.rejects(
      checkSavedBackup(directory, filename, "invalid"),
      /inválido/,
    );
  } finally {
    if (
      resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
      basename(directory).startsWith("rtt-saved-backup-")
    )
      await rm(directory, { recursive: true, force: true });
  }
});
