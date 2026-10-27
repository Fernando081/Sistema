import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  acquirePublicationLock,
  inspectPublicationLock,
  recoverPublicationLock,
} from "../publication-lock.mjs";
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-lock-test-"));
  try {
    await work(directory);
  } finally {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith("rtt-lock-test-")
    )
      throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
}
test("bloqueo identifica propietario, impide otro publicador y no recupera proceso activo", () =>
  temporary(async (directory) => {
    const release = await acquirePublicationLock(directory);
    const owner = await inspectPublicationLock(directory);
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.active, true);
    await assert.rejects(
      acquirePublicationLock(directory),
      (error) => error.code === "EEXIST",
    );
    await assert.rejects(
      recoverPublicationLock(directory, {
        decision: "recover-local-lock",
        reviewer: "Fixture",
        sha256: owner.sha256,
      }),
      /activo/,
    );
    await release();
    await assert.rejects(access(join(directory, "publish.lock")));
  }));
test("proceso terminado deja bloqueo recuperable por hash; archiva y permite publicar de nuevo", () =>
  temporary(async (directory) => {
    const moduleUrl = new URL("../publication-lock.mjs", import.meta.url).href;
    const code = `const {acquirePublicationLock}=await import(${JSON.stringify(moduleUrl)}); await acquirePublicationLock(process.argv[1]);`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", code, directory],
      { stdio: "ignore", windowsHide: true },
    );
    const [exit] = await once(child, "exit");
    assert.equal(exit, 0);
    const raw = await readFile(join(directory, "publish.lock"), "utf8");
    const owner = await inspectPublicationLock(directory);
    assert.equal(owner.active, false);
    await assert.rejects(
      recoverPublicationLock(directory, {
        decision: "recover-local-lock",
        reviewer: "Fixture",
        sha256: "0".repeat(64),
      }),
      /cambió/,
    );
    const result = await recoverPublicationLock(directory, {
      decision: "recover-local-lock",
      reviewer: "Fixture",
      sha256: owner.sha256,
    });
    assert.equal(
      await readFile(
        join(directory, `publish-orphan-${result.id}.lock`),
        "utf8",
      ),
      raw,
    );
    assert.equal(
      JSON.parse(
        await readFile(
          join(directory, `lock-recovery-${result.id}.json`),
          "utf8",
        ),
      ).owner.nonce,
      owner.nonce,
    );
    const release = await acquirePublicationLock(directory);
    await release();
  }));
test("bloqueo incompleto y recuperación en curso requieren revisión", () =>
  temporary(async (directory) => {
    await writeFile(join(directory, "publish.lock"), "");
    await assert.rejects(inspectPublicationLock(directory), /revisión manual/);
    await writeFile(join(directory, "publish-recovery.lock"), "");
    await assert.rejects(acquirePublicationLock(directory), /Recuperación/);
  }));
