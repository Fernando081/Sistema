import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { inspectRecoveryStatus } from "../recovery-status.mjs";
import { acquirePublicationLock, inspectPublicationLock, recoverPublicationLock } from "../publication-lock.mjs";

const moduleUrl = new URL("../publication-lock.mjs", import.meta.url).href;
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-recovery-test-"));
  try { await work(directory); }
  finally {
    const path = resolve(directory);
    if (!path.startsWith(resolve(tmpdir()) + sep) || !basename(path).startsWith("rtt-recovery-test-")) throw new Error("Temporal fuera de alcance");
    await rm(path, { recursive: true, force: true });
  }
}
async function orphan(directory) {
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `const {acquirePublicationLock}=await import(${JSON.stringify(moduleUrl)}); await acquirePublicationLock(process.argv[1]);`, directory],
    { stdio: "ignore", windowsHide: true });
  assert.equal((await once(child, "exit"))[0], 0);
  return inspectPublicationLock(directory);
}
async function snapshot(directory) {
  const result = {};
  for (const name of (await readdir(directory)).sort()) result[name] = (await readFile(join(directory, name))).toString("base64");
  return result;
}
async function waitMessage(child) {
  let timer;
  try { return await Promise.race([once(child, "message"), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Proceso de prueba no alcanzó la etapa")), 10000);
  })]); } finally { clearTimeout(timer); }
}

test("inspección no altera archivos, distingue publicación activa y no la recupera", () => temporary(async directory => {
  await writeFile(join(directory, "contact-private.txt"), "PRIVATE_MARKER_NOT_FOR_REPORT");
  const before = await snapshot(directory);
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  assert.deepEqual(await snapshot(directory), before);
  const release = await acquirePublicationLock(directory);
  try {
    const activeBefore = await snapshot(directory);
    const report = await inspectRecoveryStatus(directory);
    assert.equal(report.status, "publishing");
    assert.equal(report.coordinationClear, false);
    assert.equal(report.publication.state, "active");
    assert.equal(report.publication.pid, process.pid);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_MARKER_NOT_FOR_REPORT"));
    assert.deepEqual(await snapshot(directory), activeBefore);
  } finally { await release(); }
}));

test("guarda antigua, archivo excesivo, equipo ajeno y metadata inválida requieren revisión", () => temporary(async directory => {
  const guard = join(directory, "publish-recovery.lock");
  await writeFile(guard, "");
  assert.equal((await inspectRecoveryStatus(directory)).recovery.state, "invalid");
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  await writeFile(guard, "x".repeat(16385));
  assert.equal((await inspectRecoveryStatus(directory)).recovery.state, "invalid");
  await writeFile(guard, JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname() + "-foreign",
    nonce: randomUUID(), createdAt: new Date().toISOString() }));
  assert.equal((await inspectRecoveryStatus(directory)).recovery.state, "foreign");
  await writeFile(guard, JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(),
    nonce: "-".repeat(36), createdAt: new Date().toISOString(), secret: "DO_NOT_ECHO" }));
  const report = await inspectRecoveryStatus(directory);
  assert.equal(report.status, "needs-review");
  assert.equal(report.recovery.sha256, undefined);
  assert.ok(!JSON.stringify(report).includes("DO_NOT_ECHO"));
}));

test("proceso interrumpido antes y después de archivar deja guarda identificable y diagnóstico sin mutar", async () => {
  for (const stage of ["before", "after"]) await temporary(async directory => {
    const owner = await orphan(directory);
    const original = await readFile(join(directory, "publish.lock"), "utf8");
    const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const rename=fs.rename; fs.rename=async (...args)=>{
        if(process.argv[2]==='after') await rename(...args);
        process.send({stage:process.argv[2]}); setInterval(()=>{},1000); await new Promise(()=>{});
      }; syncBuiltinESMExports();
      const {recoverPublicationLock}=await import(${JSON.stringify(moduleUrl)});
      await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[3]});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, directory, stage, owner.sha256],
      { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
    const stopped = once(child, "exit");
    try {
      assert.equal((await waitMessage(child))[0].stage, stage);
      const live = await inspectRecoveryStatus(directory);
      assert.equal(live.status, "recovering");
      assert.equal(live.recovery.pid, child.pid);
      child.kill(); await stopped;
      const before = await snapshot(directory);
      const report = await inspectRecoveryStatus(directory);
      assert.equal(report.status, "needs-review");
      assert.equal(report.coordinationClear, false);
      assert.equal(report.recovery.state, "inactive");
      if (stage === "after") {
        assert.equal(report.publication.state, "absent");
        assert.equal(report.archives.pending[0].issue, "missing-record");
        const archive = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
        assert.equal(await readFile(join(directory, archive), "utf8"), original);
      } else assert.equal(report.publication.state, "inactive");
      assert.deepEqual(await snapshot(directory), before);
      await assert.rejects(acquirePublicationLock(directory), /Recuperación/);
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await stopped; } }
  });
});

test("recuperación terminada verifica archivo/registro y detecta alteración sin borrar evidencia", () => temporary(async directory => {
  const owner = await orphan(directory);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  const result = await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: owner.sha256 });
  const report = await inspectRecoveryStatus(directory);
  assert.equal(report.status, "ready");
  assert.equal(report.archives.complete, 1);
  const file = join(directory, `publish-orphan-${result.id}.lock`);
  const changed = JSON.parse(await readFile(file, "utf8")); changed.nonce = randomUUID();
  await writeFile(file, JSON.stringify(changed));
  const before = await snapshot(directory);
  const bad = await inspectRecoveryStatus(directory);
  assert.equal(bad.status, "needs-review");
  assert.equal(bad.archives.pending[0].issue, "archive-mismatch");
  assert.deepEqual(await snapshot(directory), before);
}));

test("liberación conserva una guarda reemplazada y no retira el nuevo propietario", () => temporary(async directory => {
  const owner = await orphan(directory);
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
    const rename=fs.rename; fs.rename=async (...args)=>{await rename(...args); await fs.writeFile(join(process.argv[1],'publish-recovery.lock'),'FOREIGN_GUARD');};
    syncBuiltinESMExports(); const {recoverPublicationLock}=await import(${JSON.stringify(moduleUrl)});
    try {await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[2]}); process.exitCode=2;}
    catch(error){if(error.message!=='Cambió el propietario del bloqueo de recuperación') throw error; console.log('guard-preserved');}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, owner.sha256], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(child.stdout.includes("guard-preserved"));
  assert.equal(await readFile(join(directory, "publish-recovery.lock"), "utf8"), "FOREIGN_GUARD");
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
}));

test("CLI estricto rechaza coordinación incierta y no imprime contenido privado", () => temporary(async directory => {
  const cli = new URL("../recovery-status.mjs", import.meta.url);
  const { fileURLToPath } = await import("node:url");
  const first = spawnSync(process.execPath, [fileURLToPath(cli), `--directory=${directory}`, "--strict"], { encoding: "utf8", windowsHide: true });
  assert.equal(first.status, 0);
  await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_MARKER");
  const next = spawnSync(process.execPath, [fileURLToPath(cli), `--directory=${directory}`, "--strict"], { encoding: "utf8", windowsHide: true });
  assert.equal(next.status, 1);
  assert.ok(next.stdout.includes("needs-review"));
  assert.ok(!(next.stdout + next.stderr).includes("PRIVATE_MARKER"));
  const invalid = spawnSync(process.execPath, [fileURLToPath(cli), "--secret=PRIVATE_MARKER"], { encoding: "utf8", windowsHide: true });
  assert.equal(invalid.status, 1);
  assert.ok(!(invalid.stdout + invalid.stderr).includes("PRIVATE_MARKER"));
}));
