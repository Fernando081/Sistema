import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { inspectRecoveryStatus } from "../recovery-status.mjs";
import { acquirePublicationLock, inspectPublicationLock, recoverPublicationLock } from "../publication-lock.mjs";

const lockModule = new URL("../publication-lock.mjs", import.meta.url).href;
const reconcileModule = new URL("../recovery-reconciliation.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../recovery-reconciliation.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const reviewFor = proposal => ({ operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture de revisión",
  planSha256: proposal.planSha256 });
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-reconcile-test-"));
  try { await work(directory); } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("rtt-reconcile-test-")) throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
}
async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, (await readFile(join(directory, name))).toString("base64")])));
}
async function waitMessage(child) {
  let timer;
  try { return (await Promise.race([once(child, "message"), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Fixture no alcanzó etapa")), 10000);
  })]))[0]; } finally { clearTimeout(timer); }
}
async function stoppedRecovery(directory, stage = "after") {
  const first = spawn(process.execPath, ["--input-type=module", "-e",
    `const {acquirePublicationLock}=await import(${JSON.stringify(lockModule)}); await acquirePublicationLock(process.argv[1]);`, directory],
    { stdio: "ignore", windowsHide: true });
  assert.equal((await once(first, "exit"))[0], 0);
  const owner = await inspectPublicationLock(directory);
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename; fs.rename=async (...args)=>{
      if(process.argv[2]==='after') await rename(...args);
      process.send({stage:process.argv[2]}); setInterval(()=>{},1000); await new Promise(()=>{});
    }; syncBuiltinESMExports(); const {recoverPublicationLock}=await import(${JSON.stringify(lockModule)});
    await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[3]});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, directory, stage, owner.sha256],
    { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const exit = once(child, "exit");
  try { assert.equal((await waitMessage(child)).stage, stage); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exit; }
  assert.equal((await inspectRecoveryStatus(directory)).recovery.state, "inactive");
  return owner;
}

test("plan de reconciliación es de solo lectura y aplicación conserva evidencia sin inventar recuperación anterior", () => temporary(async directory => {
  await stoppedRecovery(directory);
  const pointer = JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) });
  await writeFile(join(directory, "current-release.json"), pointer);
  await writeFile(join(directory, "catalog-private.txt"), "DO_NOT_CHANGE_OR_REPORT");
  const before = await snapshot(directory), proposal = await prepareRecoveryReconciliation(directory);
  assert.equal(proposal.status, "prepared-local");
  assert.deepEqual(await snapshot(directory), before);
  assert.ok(!JSON.stringify(proposal).includes("DO_NOT_CHANGE_OR_REPORT"));
  const review = reviewFor(proposal), result = await applyRecoveryReconciliation(directory, review);
  assert.equal(result.replayed, false);
  const report = await inspectRecoveryStatus(directory);
  assert.equal(report.status, "ready");
  assert.equal(report.archives.complete, 0);
  assert.equal(report.archives.acknowledged, 1);
  assert.equal(report.reconciliations.completed[0].operationId, review.operationId);
  const after = await snapshot(directory);
  for (const [name, value] of Object.entries(before)) if (name !== "publish-recovery.lock") assert.equal(after[name], value);
  assert.equal(after[`publish-recovery-orphan-${review.operationId}.lock`], before["publish-recovery.lock"]);
  assert.ok(!(await readdir(directory)).some(name => name.startsWith("lock-recovery-")));
  await assert.rejects(access(join(directory, "publish-maintenance.lock")));
  const replay = await applyRecoveryReconciliation(directory, review);
  assert.equal(replay.replayed, true);
  assert.deepEqual(await snapshot(directory), after);
  await assert.rejects(applyRecoveryReconciliation(directory, { ...review, reviewer: "Otra revisión" }));
  assert.deepEqual(await snapshot(directory), after);
  const release = await acquirePublicationLock(directory); await release();
}));

test("interrupción previa al archivo conserva publicación huérfana para recuperación ordinaria separada", () => temporary(async directory => {
  const owner = await stoppedRecovery(directory, "before");
  const original = await readFile(join(directory, "publish.lock"), "utf8");
  const proposal = await prepareRecoveryReconciliation(directory);
  assert.equal(proposal.plan.acknowledgedArchives.length, 0);
  await applyRecoveryReconciliation(directory, reviewFor(proposal));
  assert.equal(await readFile(join(directory, "publish.lock"), "utf8"), original);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture separada", sha256: owner.sha256 });
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.status, "ready"); assert.equal(status.archives.complete, 1);
}));

test("rechaza hash equivocado y evidencia cambiada desde el plan sin crear intención ni conservar mantenimiento", async () => {
  for (const field of ["review", "guard", "archive", "pointer", "new-archive"]) await temporary(async directory => {
    await stoppedRecovery(directory);
    const pointer = { release: randomUUID(), integrity: "a".repeat(64) };
    await writeFile(join(directory, "current-release.json"), JSON.stringify(pointer));
    const proposal = await prepareRecoveryReconciliation(directory), review = reviewFor(proposal);
    if (field === "review") review.planSha256 = "0".repeat(64);
    if (field === "pointer") await writeFile(join(directory, "current-release.json"), JSON.stringify({ ...pointer, integrity: "b".repeat(64) }));
    if (["guard", "archive"].includes(field)) {
      const path = join(directory, field === "guard" ? "publish-recovery.lock" : `publish-orphan-${proposal.plan.acknowledgedArchives[0].id}.lock`);
      const owner = JSON.parse(await readFile(path, "utf8"));
      await writeFile(path, JSON.stringify({ ...owner, nonce: randomUUID() }));
    }
    if (field === "new-archive") await writeFile(join(directory, `publish-orphan-${randomUUID()}.lock`), await readFile(join(directory, "publish-recovery.lock")));
    const before = await snapshot(directory);
    await assert.rejects(applyRecoveryReconciliation(directory, review));
    assert.deepEqual(await snapshot(directory), before, field);
  });
});

test("revisión ligada al directorio físico no se trasplanta a una copia", () => temporary(async original => {
  await stoppedRecovery(original);
  const proposal = await prepareRecoveryReconciliation(original);
  await temporary(async copy => {
    for (const name of await readdir(original)) await writeFile(join(copy, name), await readFile(join(original, name)));
    const before = await snapshot(copy);
    await assert.rejects(applyRecoveryReconciliation(copy, reviewFor(proposal)));
    assert.deepEqual(await snapshot(copy), before);
  });
}));

test("directorio listo, guarda activa, ajena, antigua e historial inválido no generan plan", async () => {
  for (const kind of ["ready", "active", "foreign", "legacy", "history", "maintenance"]) await temporary(async directory => {
    if (kind !== "ready") await stoppedRecovery(directory);
    if (["active", "foreign"].includes(kind)) await writeFile(join(directory, "publish-recovery.lock"), JSON.stringify({ schemaVersion: 1, pid: process.pid,
      host: kind === "foreign" ? hostname() + "-other" : hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() }));
    if (kind === "legacy") await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_MARKER");
    if (kind === "history") await writeFile(join(directory, `lock-recovery-${randomUUID()}.json`), "{}");
    if (kind === "maintenance") await writeFile(join(directory, "publish-maintenance.lock"), await readFile(join(directory, "publish-recovery.lock")));
    const before = await snapshot(directory);
    await assert.rejects(prepareRecoveryReconciliation(directory));
    assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("dos reconciliadores concurrentes dejan una sola operación completada", () => temporary(async directory => {
  await stoppedRecovery(directory);
  const proposal = await prepareRecoveryReconciliation(directory);
  const results = await Promise.allSettled([applyRecoveryReconciliation(directory, reviewFor(proposal)), applyRecoveryReconciliation(directory, reviewFor(proposal))]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal((await readdir(directory)).filter(name => name.startsWith("publish-recovery-orphan-")).length, 1);
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
}));

test("interrupción antes/después del enlace o después de retirar la guarda conserva exclusión y exige revisión", async () => {
  for (const stage of ["before", "after", "after-unlink"]) await temporary(async directory => {
    await stoppedRecovery(directory);
    const proposal = await prepareRecoveryReconciliation(directory), review = reviewFor(proposal);
    const before = await snapshot(directory);
    const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const pause=async()=>{process.send({stage:process.argv[2]}); setInterval(()=>{},1000); await new Promise(()=>{});};
      const link=fs.link; fs.link=async (...args)=>{
        if(process.argv[2]==='after-unlink') return link(...args);
        if(process.argv[2]==='after') await link(...args);
        await pause();
      };
      const unlink=fs.unlink; fs.unlink=async (...args)=>{await unlink(...args);
        if(process.argv[2]==='after-unlink' && args[0].endsWith('publish-recovery.lock')) await pause();
      }; syncBuiltinESMExports(); const {applyRecoveryReconciliation}=await import(${JSON.stringify(reconcileModule)});
      await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[3]));`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, directory, stage, JSON.stringify(review)],
      { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
    const exit = once(child, "exit");
    try {
      assert.equal((await waitMessage(child)).stage, stage);
      assert.equal((await inspectRecoveryStatus(directory)).status, "reconciling");
      await assert.rejects(acquirePublicationLock(directory), /Reconciliación/);
      await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }), /Reconciliación/);
      await assert.rejects(applyRecoveryReconciliation(directory, review));
      child.kill(); await exit;
      const interrupted = await snapshot(directory), status = await inspectRecoveryStatus(directory);
      assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive");
      assert.equal(status.reconciliations.pending.length, 1);
      for (const [name, value] of Object.entries(before)) {
        if (stage === "after-unlink" && name === "publish-recovery.lock") {
          assert.equal(interrupted[name], undefined);
          assert.equal(interrupted[`publish-recovery-orphan-${review.operationId}.lock`], value);
        } else assert.equal(interrupted[name], value);
      }
      await assert.rejects(applyRecoveryReconciliation(directory, review));
      await assert.rejects(prepareRecoveryReconciliation(directory));
      assert.deepEqual(await snapshot(directory), interrupted);
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; } }
  });
});

test("mantenimiento reemplazado se conserva y no se retira la guarda original", () => temporary(async directory => {
  await stoppedRecovery(directory);
  const proposal = await prepareRecoveryReconciliation(directory), review = reviewFor(proposal);
  const original = await readFile(join(directory, "publish-recovery.lock"), "utf8");
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
    const link=fs.link; fs.link=async (...args)=>{await link(...args); await fs.writeFile(join(process.argv[1],'publish-maintenance.lock'),'FOREIGN_MAINTENANCE');};
    syncBuiltinESMExports(); const {applyRecoveryReconciliation}=await import(${JSON.stringify(reconcileModule)});
    try {await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2])); process.exitCode=2;}
    catch {console.log('preserved');}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(join(directory, "publish-maintenance.lock"), "utf8"), "FOREIGN_MAINTENANCE");
  assert.equal(await readFile(join(directory, "publish-recovery.lock"), "utf8"), original);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
}));

test("cambio externo de publicación o puntero tras retirar guarda conserva mantenimiento sin recibo de terminación", async () => {
  for (const kind of ["publication", "pointer"]) await temporary(async directory => {
    await stoppedRecovery(directory);
    const review = reviewFor(await prepareRecoveryReconciliation(directory));
    const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
      const unlink=fs.unlink; fs.unlink=async (...args)=>{await unlink(...args);
        if(args[0].endsWith('publish-recovery.lock')) await fs.writeFile(join(process.argv[1],process.argv[3]==='publication'?'publish.lock':'current-release.json'),'EXTERNAL_CHANGE');
      }; syncBuiltinESMExports(); const {applyRecoveryReconciliation}=await import(${JSON.stringify(reconcileModule)});
      try {await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2])); process.exitCode=2;} catch {console.log('closed');}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    await assert.rejects(access(join(directory, `recovery-reconciliation-${review.operationId}.json`)));
    assert.equal((await inspectRecoveryStatus(directory)).maintenance.state, "inactive");
    assert.equal(await readFile(join(directory, kind === "publication" ? "publish.lock" : "current-release.json"), "utf8"), "EXTERNAL_CHANGE");
  });
});

test("intención, recibo o guarda archivada alterados invalidan reconocimiento y repetición", async () => {
  for (const kind of ["intent", "receipt", "guard"]) await temporary(async directory => {
    await stoppedRecovery(directory);
    const review = reviewFor(await prepareRecoveryReconciliation(directory));
    await applyRecoveryReconciliation(directory, review);
    const name = kind === "guard" ? `publish-recovery-orphan-${review.operationId}.lock` :
      `recovery-reconciliation-${review.operationId}${kind === "intent" ? ".intent" : ""}.json`;
    await writeFile(join(directory, name), "PRIVATE_TAMPERED");
    const before = await snapshot(directory), report = await inspectRecoveryStatus(directory);
    assert.equal(report.status, "needs-review"); assert.equal(report.archives.acknowledged, 0);
    assert.equal(report.reconciliations.pending.length, 1);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_TAMPERED"));
    await assert.rejects(applyRecoveryReconciliation(directory, review));
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("CLI prepara y aplica revisión explícita, invalida reporte anterior al fallar sin afirmar que no hubo mutaciones", () => temporary(async directory => {
  await stoppedRecovery(directory);
  const before = await snapshot(directory);
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
  const planResult = run(["--plan", `--directory=${directory}`]);
  assert.equal(planResult.status, 0, planResult.stderr);
  assert.deepEqual(await snapshot(directory), before);
  const proposal = JSON.parse(await readFile(join(artifacts, "web-reconciliation-plan.json"), "utf8"));
  const reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(reviewFor(proposal)));
  const applied = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-reconciliation-result.json"), "utf8")).reconciled, true);
  const invalid = run(["--apply", "--secret=PRIVATE_MARKER"]);
  assert.equal(invalid.status, 1);
  assert.ok(!(invalid.stdout + invalid.stderr).includes("PRIVATE_MARKER"));
  const failed = JSON.parse(await readFile(join(artifacts, "web-reconciliation-result.json"), "utf8"));
  assert.equal(failed.resultConfirmed, false); assert.equal(failed.applied, undefined); assert.equal(failed.reconciled, undefined);
  assert.equal(run(["--plan", "--plan", `--directory=${directory}`]).status, 1);
}));

test("más de veinte archivos sin registro bloquean preparación sin truncar evidencia", () => temporary(async directory => {
  await stoppedRecovery(directory);
  const raw = await readFile(join(directory, "publish-recovery.lock"));
  for (let i = 0; i < 20; i++) await writeFile(join(directory, `publish-orphan-${randomUUID()}.lock`), raw);
  const before = await snapshot(directory);
  await assert.rejects(prepareRecoveryReconciliation(directory));
  assert.deepEqual(await snapshot(directory), before);
  assert.equal((await inspectRecoveryStatus(directory)).archives.pending.length, 21);
}));

test("CLI con fallo de E/S tras intención conserva bloqueo y reporta resultado incierto", () => temporary(async directory => {
  await stoppedRecovery(directory);
  const review = reviewFor(await prepareRecoveryReconciliation(directory));
  const reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(review));
  const guard = await readFile(join(directory, "publish-recovery.lock"), "utf8");
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    fs.link=async()=>{throw new Error('PRIVATE_IO_FAILURE');}; syncBuiltinESMExports();
    process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];
    await import(${JSON.stringify(reconcileModule)});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, cli, directory, reviewPath], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 1); assert.ok(!(child.stdout + child.stderr).includes("PRIVATE_IO_FAILURE"));
  const failed = JSON.parse(await readFile(join(artifacts, "web-reconciliation-result.json"), "utf8"));
  assert.equal(failed.resultConfirmed, false); assert.equal(failed.applied, undefined);
  assert.equal(await readFile(join(directory, "publish-recovery.lock"), "utf8"), guard);
  const report = await inspectRecoveryStatus(directory);
  assert.equal(report.status, "needs-review"); assert.equal(report.maintenance.state, "inactive");
  assert.equal(report.reconciliations.pending.length, 1);
}));
