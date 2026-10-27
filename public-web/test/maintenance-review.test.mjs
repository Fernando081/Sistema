import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { inspectMaintenance, prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { inspectRecoveryStatus } from "../recovery-status.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { acquirePublicationLock, inspectPublicationLock, recoverPublicationLock } from "../publication-lock.mjs";

const lockModule = new URL("../publication-lock.mjs", import.meta.url).href;
const reconciliationModule = new URL("../recovery-reconciliation.mjs", import.meta.url).href;
const maintenanceModule = new URL("../maintenance-review.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../maintenance-review.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const digest = raw => createHash("sha256").update(raw).digest("hex");
const reviewFor = plan => ({ operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Revisión fixture", planSha256: plan.planSha256 });
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-maintenance-test-"));
  try { await work(directory); } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("rtt-maintenance-test-")) throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
}
async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, (await readFile(join(directory, name))).toString("base64")])));
}
async function waitMessage(child) {
  let timer;
  try { return (await Promise.race([once(child, "message"), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Proceso fixture no alcanzó etapa")), 10000);
  })]))[0]; } finally { clearTimeout(timer); }
}
async function pauseChild(code, args, work) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const exit = once(child, "exit");
  try {
    await waitMessage(child);
    await work(child, async () => { child.kill(); await exit; });
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; } }
}
async function interruptedRecovery(directory, beforeArchive = false) {
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `const {acquirePublicationLock}=await import(${JSON.stringify(lockModule)}); await acquirePublicationLock(process.argv[1]);`, directory],
    { stdio: "ignore", windowsHide: true });
  assert.equal((await once(child, "exit"))[0], 0);
  const owner = await inspectPublicationLock(directory);
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename; fs.rename=async(...args)=>{if(process.argv[3]!=='before')await rename(...args);
      process.send('paused'); setInterval(()=>{},1000); await new Promise(()=>{});}; syncBuiltinESMExports();
    const {recoverPublicationLock}=await import(${JSON.stringify(lockModule)});
    await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[2]});`;
  await pauseChild(code, [directory, owner.sha256, beforeArchive ? "before" : "after"], async (_, stop) => stop());
  return owner;
}
async function orphanedMaintenance(directory, stage = "complete", beforeArchive = false) {
  const owner = await interruptedRecovery(directory, beforeArchive);
  const prepared = await prepareRecoveryReconciliation(directory);
  const review = { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture inicial", planSha256: prepared.planSha256 };
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link; fs.link=async(...args)=>{
      if(process.argv[3]==='intent')await pause();
      await link(...args);if(process.argv[3]==='archive')await pause();
    };
    const unlink=fs.unlink; fs.unlink=async(...args)=>{
      if(args[0].endsWith('publish-maintenance.lock'))await pause();
      await unlink(...args);if(process.argv[3]==='removed'&&args[0].endsWith('publish-recovery.lock'))await pause();
    };syncBuiltinESMExports();const {applyRecoveryReconciliation}=await import(${JSON.stringify(reconciliationModule)});
    await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`;
  await pauseChild(code, [directory, JSON.stringify(review), stage], async (_, stop) => stop());
  assert.equal((await inspectRecoveryStatus(directory)).maintenance.state, "inactive");
  return { owner, review };
}

test("diagnóstico clasifica intención, archivo y guarda retirada sin intervenir ni permitir cierre parcial", async () => {
  for (const [stage, expected] of [["intent", "intent-only"], ["archive", "guard-archived"], ["removed", "guard-removed"]]) await temporary(async directory => {
    await orphanedMaintenance(directory, stage);
    const before = await snapshot(directory), report = await inspectMaintenance(directory);
    assert.equal(report.stage, expected); assert.equal(report.eligible, false);
    await assert.rejects(prepareMaintenanceReview(directory));
    await assert.rejects(finalizeMaintenance(directory, { operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture", planSha256: "a".repeat(64) }));
    assert.deepEqual(await snapshot(directory), before);
    assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  });
});

test("cierre de operación terminada conserva bytes, separa historial, permite publicar y repite sin duplicar", () => temporary(async directory => {
  const { review: origin } = await orphanedMaintenance(directory);
  await writeFile(join(directory, "private.txt"), "PRIVATE_MARKER_NOT_FOR_OUTPUT");
  const before = await snapshot(directory), plan = await prepareMaintenanceReview(directory);
  assert.equal(plan.stage, "completed-before-release"); assert.equal(plan.plan.reconciliationId, origin.operationId);
  assert.deepEqual(await snapshot(directory), before);
  assert.ok(!JSON.stringify(plan).includes("PRIVATE_MARKER_NOT_FOR_OUTPUT"));
  const review = reviewFor(plan), result = await finalizeMaintenance(directory, review);
  assert.equal(result.replayed, false);
  const after = await snapshot(directory);
  for (const [name, value] of Object.entries(before)) if (name !== "publish-maintenance.lock") assert.equal(after[name], value);
  assert.equal(after[`publish-maintenance-orphan-${review.operationId}.lock`], before["publish-maintenance.lock"]);
  await assert.rejects(access(join(directory, "publish-recovery.lock")));
  const report = await inspectRecoveryStatus(directory);
  assert.equal(report.status, "ready"); assert.equal(report.archives.acknowledged, 1); assert.equal(report.archives.complete, 0);
  assert.equal(report.maintenanceReviews.completed[0].operationId, review.operationId);
  assert.equal((await finalizeMaintenance(directory, review)).replayed, true);
  assert.deepEqual(await snapshot(directory), after);
  await assert.rejects(finalizeMaintenance(directory, { ...review, reviewer: "Otra persona" }));
  assert.deepEqual(await snapshot(directory), after);
  const release = await acquirePublicationLock(directory); await release();
}));

test("bloqueo ordinario inactivo conserva su recuperación y aceptación independientes del cierre", () => temporary(async directory => {
  const { owner } = await orphanedMaintenance(directory, "complete", true);
  const publication = await readFile(join(directory, "publish.lock"), "utf8");
  await finalizeMaintenance(directory, reviewFor(await prepareMaintenanceReview(directory)));
  assert.equal(await readFile(join(directory, "publish.lock"), "utf8"), publication);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture separada", sha256: owner.sha256 });
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
}));

test("guarda activa/ajena/antigua, recibo corrupto e intención v1 sin vínculo rechazan plan y conservan evidencia", async () => {
  for (const kind of ["active", "foreign", "legacy", "receipt", "v1"]) await temporary(async directory => {
    const { review } = await orphanedMaintenance(directory);
    if (["active", "foreign"].includes(kind)) await writeFile(join(directory, "publish-maintenance.lock"), JSON.stringify({ schemaVersion: 1, pid: process.pid,
      host: kind === "foreign" ? hostname() + "-other" : hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() }));
    if (kind === "legacy") await writeFile(join(directory, "publish-maintenance.lock"), "PRIVATE_LEGACY");
    if (kind === "receipt") await writeFile(join(directory, `recovery-reconciliation-${review.operationId}.json`), "PRIVATE_RECEIPT");
    if (kind === "v1") {
      const intentPath = join(directory, `recovery-reconciliation-${review.operationId}.intent.json`);
      const value = JSON.parse(await readFile(intentPath, "utf8")); value.schemaVersion = 1; delete value.maintenanceSha256;
      const raw = JSON.stringify(value); await writeFile(intentPath, raw);
      const receiptPath = join(directory, `recovery-reconciliation-${review.operationId}.json`);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")); receipt.intentSha256 = digest(raw); await writeFile(receiptPath, JSON.stringify(receipt));
      assert.equal((await inspectRecoveryStatus(directory)).reconciliations.completed.length, 1);
    }
    const before = await snapshot(directory), report = await inspectMaintenance(directory);
    assert.equal(report.eligible, false); assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    if (kind === "v1") assert.equal(report.stage, "unlinked-maintenance");
    await assert.rejects(prepareMaintenanceReview(directory));
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("revisión por hash rechaza cambios de mantenimiento, puntero, historia y traslado de directorio", async () => {
  for (const kind of ["review", "maintenance", "pointer", "history", "directory"]) await temporary(async directory => {
    await orphanedMaintenance(directory);
    const plan = await prepareMaintenanceReview(directory), review = reviewFor(plan);
    if (kind === "review") review.planSha256 = "0".repeat(64);
    if (kind === "maintenance") {
      const path = join(directory, "publish-maintenance.lock"), value = JSON.parse(await readFile(path, "utf8"));
      value.nonce = randomUUID(); await writeFile(path, JSON.stringify(value));
    }
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    if (kind === "history") await writeFile(join(directory, `publish-orphan-${randomUUID()}.lock`), await readFile(join(directory, "publish-maintenance.lock")));
    if (kind === "directory") return temporary(async copy => {
      for (const name of await readdir(directory)) await writeFile(join(copy, name), await readFile(join(directory, name)));
      const before = await snapshot(copy); await assert.rejects(finalizeMaintenance(copy, review)); assert.deepEqual(await snapshot(copy), before);
    });
    const before = await snapshot(directory);
    await assert.rejects(finalizeMaintenance(directory, review)); assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("dos revisores concurrentes completan un solo cierre", () => temporary(async directory => {
  await orphanedMaintenance(directory);
  const plan = await prepareMaintenanceReview(directory);
  const results = await Promise.allSettled([finalizeMaintenance(directory, reviewFor(plan)), finalizeMaintenance(directory, reviewFor(plan))]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  assert.equal((await readdir(directory)).filter(name => name.startsWith("publish-maintenance-orphan-")).length, 1);
}));

test("interrupción del cierre conserva exclusión antes/después del archivo y de retirar mantenimiento", async () => {
  for (const stage of ["before", "after", "removed"]) await temporary(async directory => {
    await orphanedMaintenance(directory);
    const before = await snapshot(directory), review = reviewFor(await prepareMaintenanceReview(directory));
    const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...args)=>{if(process.argv[3]==='before')await pause();await link(...args);if(process.argv[3]==='after')await pause();};
      const unlink=fs.unlink;fs.unlink=async(...args)=>{await unlink(...args);if(process.argv[3]==='removed'&&args[0].endsWith('publish-maintenance.lock'))await pause();};
      syncBuiltinESMExports();const {finalizeMaintenance}=await import(${JSON.stringify(maintenanceModule)});
      await finalizeMaintenance(process.argv[1],JSON.parse(process.argv[2]));`;
    await pauseChild(code, [directory, JSON.stringify(review), stage], async (_, stop) => {
      await assert.rejects(acquirePublicationLock(directory));
      await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
      await assert.rejects(finalizeMaintenance(directory, review));
      await stop();
      const report = await inspectRecoveryStatus(directory), interrupted = await snapshot(directory);
      assert.equal(report.status, "needs-review"); assert.equal(report.recovery.state, "inactive"); assert.equal(report.maintenanceReviews.pending.length, 1);
      for (const [name, value] of Object.entries(before)) {
        if (stage === "removed" && name === "publish-maintenance.lock") assert.equal(interrupted[`publish-maintenance-orphan-${review.operationId}.lock`], value);
        else assert.equal(interrupted[name], value);
      }
      await assert.rejects(prepareMaintenanceReview(directory));
      await assert.rejects(finalizeMaintenance(directory, review));
      await assert.rejects(prepareRecoveryReconciliation(directory));
      assert.deepEqual(await snapshot(directory), interrupted);
    });
  });
});

test("cierre registrado antes de liberar guarda se resuelve con reconciliación existente sin fabricar recibos", () => temporary(async directory => {
  await orphanedMaintenance(directory);
  const review = reviewFor(await prepareMaintenanceReview(directory));
  const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports}from'node:module';
    const unlink=fs.unlink;fs.unlink=async(...args)=>{if(args[0].endsWith('publish-recovery.lock')){process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});}return unlink(...args);};
    syncBuiltinESMExports();const{finalizeMaintenance}=await import(${JSON.stringify(maintenanceModule)});await finalizeMaintenance(process.argv[1],JSON.parse(process.argv[2]));`;
  await pauseChild(code, [directory, JSON.stringify(review)], async (_, stop) => stop());
  assert.equal((await inspectRecoveryStatus(directory)).maintenanceReviews.completed.length, 1);
  const plan = await prepareRecoveryReconciliation(directory);
  await applyRecoveryReconciliation(directory, { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture nueva", planSha256: plan.planSha256 });
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
}));

test("propietario reemplazado durante el cierre se conserva y rechaza terminar", () => temporary(async directory => {
  await orphanedMaintenance(directory);
  const review = reviewFor(await prepareMaintenanceReview(directory));
  const maintenance = await readFile(join(directory, "publish-maintenance.lock"), "utf8");
  const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
    const link=fs.link;fs.link=async(...args)=>{await link(...args);await fs.writeFile(join(process.argv[1],'publish-recovery.lock'),'FOREIGN_GUARD');};
    syncBuiltinESMExports();const{finalizeMaintenance}=await import(${JSON.stringify(maintenanceModule)});
    try{await finalizeMaintenance(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{console.log('preserved');}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(join(directory, "publish-recovery.lock"), "utf8"), "FOREIGN_GUARD");
  assert.equal(await readFile(join(directory, "publish-maintenance.lock"), "utf8"), maintenance);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
}));

test("cambio de historial o puntero durante cierre conserva exclusión sin certificar resultado", async () => {
  for (const kind of ["history", "pointer"]) await temporary(async directory => {
    const { review: origin } = await orphanedMaintenance(directory);
    const review = reviewFor(await prepareMaintenanceReview(directory));
    const original = await readFile(join(directory, "publish-maintenance.lock"), "utf8");
    const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;fs.link=async(...args)=>{await link(...args);if(process.argv[3]==='history')await fs.writeFile(join(process.argv[1],'recovery-reconciliation-'+process.argv[4]+'.json'),'ALTERED_HISTORY');};
      const unlink=fs.unlink;fs.unlink=async(...args)=>{await unlink(...args);if(process.argv[3]==='pointer'&&args[0].endsWith('publish-maintenance.lock'))
        await fs.writeFile(join(process.argv[1],'current-release.json'),'ALTERED_POINTER');};
      syncBuiltinESMExports();const{finalizeMaintenance}=await import(${JSON.stringify(maintenanceModule)});
      try{await finalizeMaintenance(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{console.log('closed');}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, origin.operationId], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    await assert.rejects(access(join(directory, `maintenance-review-${review.operationId}.json`)));
    const evidence = kind === "history" ? "publish-maintenance.lock" : `publish-maintenance-orphan-${review.operationId}.lock`;
    assert.equal(await readFile(join(directory, evidence), "utf8"), original);
  });
});

test("intención, archivo o recibo de cierre alterados invalidan historial y repetición", async () => {
  for (const kind of ["intent", "archive", "receipt"]) await temporary(async directory => {
    await orphanedMaintenance(directory);
    const review = reviewFor(await prepareMaintenanceReview(directory)); await finalizeMaintenance(directory, review);
    const name = kind === "archive" ? `publish-maintenance-orphan-${review.operationId}.lock` :
      `maintenance-review-${review.operationId}${kind === "intent" ? ".intent" : ""}.json`;
    await writeFile(join(directory, name), "PRIVATE_TAMPER");
    const before = await snapshot(directory), report = await inspectRecoveryStatus(directory);
    assert.equal(report.status, "needs-review"); assert.equal(report.maintenanceReviews.pending.length, 1);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_TAMPER"));
    await assert.rejects(finalizeMaintenance(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("CLI diagnostica sin mutar, exige plan y revisión explícitos e invalida reporte anterior al fallar", () => temporary(async directory => {
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0);
  await orphanedMaintenance(directory);
  const before = await snapshot(directory);
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0);
  assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), before);
  const plan = JSON.parse(await readFile(join(artifacts, "web-maintenance-plan.json"), "utf8"));
  const path = join(directory, "fixture-review.json"); await writeFile(path, JSON.stringify(reviewFor(plan)));
  const result = run(["--apply", `--directory=${directory}`, `--review=${path}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-maintenance-result.json"), "utf8")).finalized, true);
  const invalid = run(["--apply", "--secret=PRIVATE_MARKER"]);
  assert.equal(invalid.status, 1); assert.ok(!(invalid.stdout + invalid.stderr).includes("PRIVATE_MARKER"));
  const failed = JSON.parse(await readFile(join(artifacts, "web-maintenance-result.json"), "utf8"));
  assert.equal(failed.resultConfirmed, false); assert.equal(failed.finalized, undefined);
  assert.equal(run(["--plan", "--plan", `--directory=${directory}`]).status, 1);
  assert.equal(run(["--inspect", `--directory=${directory}`, `--review=${path}`]).status, 1);
}));

test("CLI con fallo de E/S tras intención deja guarda y reporte incierto, sin imprimir la excepción", () => temporary(async directory => {
  await orphanedMaintenance(directory);
  const reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(reviewFor(await prepareMaintenanceReview(directory))));
  const source = await readFile(join(directory, "publish-maintenance.lock"), "utf8");
  const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    fs.link=async()=>{throw new Error('PRIVATE_IO_ERROR');};syncBuiltinESMExports();
    process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];
    await import(${JSON.stringify(maintenanceModule)});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, cli, directory, reviewPath], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 1); assert.ok(!(child.stdout + child.stderr).includes("PRIVATE_IO_ERROR"));
  const result = JSON.parse(await readFile(join(artifacts, "web-maintenance-result.json"), "utf8"));
  assert.equal(result.resultConfirmed, false); assert.equal(result.finalized, undefined); assert.equal(result.applied, undefined);
  assert.equal(await readFile(join(directory, "publish-maintenance.lock"), "utf8"), source);
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.status, "needs-review"); assert.equal(status.recovery.state, "inactive");
  assert.equal(status.maintenanceReviews.pending.length, 1);
}));
