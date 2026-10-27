import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectResumptionContinuation, prepareResumptionContinuation, continueRecoveryResumption } from "../resumption-continuation.mjs";
import { inspectRecoveryStatus, evidenceNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock, inspectPublicationLock } from "../publication-lock.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { inspectResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { inspectResumptionGuard, prepareResumptionGuardReview, finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { inspectMaintenance, prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { inspectClosureResumption, resumeClosure } from "../closure-resumption.mjs";
import { inspectReconciliationAbort, abortRecoveryReconciliation } from "../reconciliation-abort.mjs";
import { temporary, snapshot, pauseChild, interruptedResumption } from "./support/closure-fixtures.mjs";

const moduleUrl = new URL("../resumption-continuation.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../resumption-continuation.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const stages = ["intent-only", "guard-archived", "guard-removed", "reconciliation-completed"];
const reviewFor = plan => ({ operationId: randomUUID(), decision: "continue-local-resumption", reviewer: "Fixture revisión actual", planSha256: plan.planSha256 });
const closeFor = plan => ({ operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture cierre separado", planSha256: plan.planSha256 });

test("continúa cuatro etapas de reanudación parcial, conserva recibos y deja mantenimiento para cierre separado", async () => {
  for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const { original, resume } = await interruptedResumption(directory, stage), before = await snapshot(directory);
    const proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal);
    assert.equal(proposal.stage, stage); assert.equal((await inspectResumptionContinuation(directory)).eligible, true);
    assert.deepEqual(await snapshot(directory), before); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_PRODUCTS_CONTACTS"));
    const result = await continueRecoveryResumption(directory, review), after = await snapshot(directory);
    assert.equal(result.continued, true); assert.equal(result.replayed, false);
    for (const [name, bytes] of Object.entries(before)) {
      if (name === "publish-resume.lock") assert.equal(after[`publish-continued-resume-${review.operationId}.lock`], bytes);
      else if (name === "publish-recovery.lock") assert.equal(after[`publish-recovery-orphan-${original.operationId}.lock`], bytes);
      else assert.equal(after[name], bytes, name);
    }
    const receipt = JSON.parse(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.json`), "utf8"));
    assert.equal(receipt.schemaVersion, 2); assert.equal(receipt.resumptionContinuationId, review.operationId);
    assert.equal(receipt.resumptionContinuationIntentSha256, hash(await readFile(join(directory, `resumption-continuation-${review.operationId}.intent.json`))));
    await assert.rejects(access(join(directory, "publish-resume.lock"))); await assert.rejects(access(join(directory, "publish-recovery.lock")));
    await assert.rejects(access(join(directory, "publish-finalization.lock")));
    let status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive");
    assert.equal(status.resumptionContinuations.completed.length, 1); assert.equal(status.resumptionContinuations.pending.length, 0);
    assert.equal(status.resumptions.completed.length, 1); assert.equal(status.reconciliations.completed.length, 1);
    assert.equal(status.archives.acknowledged, 1); assert.equal(status.archives.complete, 0);
    const close = await prepareMaintenanceReview(directory); await finalizeMaintenance(directory, closeFor(close));
    assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const historical = await snapshot(directory);
    assert.equal((await continueRecoveryResumption(directory, review)).replayed, true);
    assert.equal((await resumeRecoveryReconciliation(directory, resume)).replayed, true);
    assert.equal((await applyRecoveryReconciliation(directory, original)).replayed, true);
    assert.deepEqual(await snapshot(directory), historical);
  });
});

test("respeta las tres etapas de partida de la reanudación original sin retroceder evidencia", async () => {
  for (const stage of ["intent-only", "guard-archived", "guard-removed"]) await temporary(async directory => {
    await interruptedResumption(directory, "original-intent", stage);
    const proposal = await prepareResumptionContinuation(directory); assert.equal(proposal.stage, stage);
    await continueRecoveryResumption(directory, reviewFor(proposal));
    assert.equal((await inspectRecoveryStatus(directory)).resumptions.pending.length, 0);
  });
});

test("reanudación ya completada se remite al cierre de guarda existente sin crear otra continuación", () => temporary(async directory => {
  await interruptedResumption(directory, "completed-before-release");
  const before = await snapshot(directory), report = await inspectResumptionContinuation(directory);
  assert.equal(report.eligible, false); assert.equal(report.stage, "resumption-completed-use-guard-review");
  await assert.rejects(prepareResumptionContinuation(directory));
  await assert.rejects(continueRecoveryResumption(directory, reviewFor({ planSha256: "a".repeat(64) })));
  assert.deepEqual(await snapshot(directory), before);
  const proposal = await prepareResumptionGuardReview(directory);
  await finalizeResumptionGuard(directory, { ...closeFor(proposal), decision: "archive-completed-resumption" });
  assert.equal((await inspectRecoveryStatus(directory)).resumptionContinuations.completed.length, 0);
}));

test("publicación residual mantiene recuperación ordinaria independiente", () => temporary(async directory => {
  await interruptedResumption(directory, "guard-removed", "intent-only", true);
  const before = await readFile(join(directory, "publish.lock")), plan = await prepareResumptionContinuation(directory), review = reviewFor(plan);
  await continueRecoveryResumption(directory, review);
  assert.deepEqual(await readFile(join(directory, "publish.lock")), before);
  const closure = await prepareMaintenanceReview(directory); await finalizeMaintenance(directory, closeFor(closure));
  const owner = await inspectPublicationLock(directory);
  await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture recuperación separada", sha256: owner.sha256 });
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  assert.equal((await continueRecoveryResumption(directory, review)).replayed, true);
}));

test("rechaza guardas activas, ajenas, corruptas, sin vínculo, v1, intenciones ambiguas y recibos divergentes sin mutar", async () => {
  for (const kind of ["active", "foreign", "invalid", "unlinked", "v1", "original-v1", "ambiguous", "source", "archive", "receipt", "resumed-receipt", "maintenance", "history", "finalization"]) await temporary(async directory => {
    const { original, resume } = await interruptedResumption(directory, "guard-archived");
    if (["active", "foreign", "unlinked"].includes(kind)) {
      const path = join(directory, "publish-resume.lock"), owner = JSON.parse(await readFile(path, "utf8"));
      if (kind === "active") owner.pid = process.pid;
      if (kind === "foreign") owner.host = hostname() + "-foreign";
      if (kind === "unlinked") owner.nonce = randomUUID();
      await writeFile(path, JSON.stringify(owner));
    }
    if (kind === "invalid") await writeFile(join(directory, "publish-resume.lock"), "PRIVATE_INVALID_GUARD");
    if (kind === "v1") { const path = join(directory, `reconciliation-resume-${resume.operationId}.intent.json`), draft = JSON.parse(await readFile(path, "utf8")); draft.schemaVersion = 1; delete draft.resumptionSha256; await writeFile(path, JSON.stringify(draft)); }
    if (kind === "original-v1") { const path = join(directory, `recovery-reconciliation-${original.operationId}.intent.json`), draft = JSON.parse(await readFile(path, "utf8")); draft.schemaVersion = 1; delete draft.maintenanceSha256; await writeFile(path, JSON.stringify(draft)); }
    if (kind === "ambiguous") { const draft = JSON.parse(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.intent.json`), "utf8")); draft.operationId = randomUUID(); await writeFile(join(directory, `reconciliation-resume-${draft.operationId}.intent.json`), JSON.stringify(draft)); }
    if (kind === "source") await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_SOURCE");
    if (kind === "archive") await writeFile(join(directory, `publish-recovery-orphan-${original.operationId}.lock`), "PRIVATE_ARCHIVE");
    if (kind === "receipt") await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.json`), "PRIVATE_RECEIPT");
    if (kind === "resumed-receipt") await writeFile(join(directory, `reconciliation-resume-${resume.operationId}.json`), "{}");
    if (kind === "maintenance") await writeFile(join(directory, "publish-maintenance.lock"), "PRIVATE_MAINTENANCE");
    if (kind === "history") await writeFile(join(directory, `resumption-continuation-${randomUUID()}.intent.json`), "{}");
    if (kind === "finalization") await writeFile(join(directory, "publish-finalization.lock"), "PRIVATE_FINALIZATION");
    const before = await snapshot(directory), report = await inspectResumptionContinuation(directory);
    assert.equal(report.eligible, false, kind); assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    await assert.rejects(prepareResumptionContinuation(directory)); await assert.rejects(continueRecoveryResumption(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("revisión exacta rechaza ID original, campos privados y cambios de etapa, puntero, historial o directorio", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "guard-removed");
  const proposal = await prepareResumptionContinuation(directory), baseline = await snapshot(directory);
  for (const patch of [{ planSha256: "a".repeat(64) }, { operationId: original.operationId }, { operationId: resume.operationId },
    { reviewer: "" }, { reviewer: "a\n" }, { private: "PRIVATE_EXTRA" }, { decision: "resume-local-reconciliation" }]) {
    await assert.rejects(continueRecoveryResumption(directory, { ...reviewFor(proposal), ...patch })); assert.deepEqual(await snapshot(directory), baseline);
  }
  const pointerPath = join(directory, "current-release.json");
  await writeFile(pointerPath, JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
  const changed = await snapshot(directory); await assert.rejects(continueRecoveryResumption(directory, reviewFor(proposal))); assert.deepEqual(await snapshot(directory), changed);
  await unlink(pointerPath);
  const extra = join(directory, `resumption-continuation-${randomUUID()}.json`); await writeFile(extra, "{}");
  await assert.rejects(continueRecoveryResumption(directory, reviewFor(proposal))); await unlink(extra);
  await temporary(async other => { for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
    const before = await snapshot(other); await assert.rejects(continueRecoveryResumption(other, reviewFor(proposal))); assert.deepEqual(await snapshot(other), before); });
  const originalReceipt = join(directory, `recovery-reconciliation-${original.operationId}.json`);
  const originalIntentSha256 = hash(await readFile(join(directory, `recovery-reconciliation-${original.operationId}.intent.json`)));
  await writeFile(originalReceipt, JSON.stringify({ schemaVersion: 2, operationId: original.operationId, decision: "reconcile-local-recovery", intentSha256: originalIntentSha256,
    resumptionId: resume.operationId, resumptionIntentSha256: hash(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.intent.json`))), completedAt: new Date().toISOString() }));
  assert.equal((await inspectResumptionContinuation(directory)).stage, "reconciliation-completed");
  const stageChanged = await snapshot(directory); await assert.rejects(continueRecoveryResumption(directory, reviewFor(proposal))); assert.deepEqual(await snapshot(directory), stageChanged);
}));

test("dos revisores simultáneos completan una sola continuación y revisión diferente impide replay", () => temporary(async directory => {
  await interruptedResumption(directory, "intent-only"); const proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal);
  const results = await Promise.allSettled([continueRecoveryResumption(directory, review), continueRecoveryResumption(directory, reviewFor(proposal))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await inspectRecoveryStatus(directory)).resumptionContinuations.completed.length, 1);
  const before = await snapshot(directory); await assert.rejects(continueRecoveryResumption(directory, { ...review, reviewer: "Otro revisor" }));
  assert.deepEqual(await snapshot(directory), before);
}));

test("nueve cortes de continuación conservan exclusión y evidencia incluso con recibo final completo", async () => {
  for (const stage of ["before-archive", "after-archive", "after-source", "after-original-receipt", "after-resume-receipt", "after-resume-archive", "after-resume-source", "before-final-receipt", "before-release"]) await temporary(async directory => {
    await interruptedResumption(directory, "intent-only"); const proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal);
    await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const stage=process.argv[3],id=JSON.parse(process.argv[2]).operationId;const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...a)=>{if(a[1].includes('publish-recovery-orphan-')&&stage==='before-archive')await pause();await link(...a);
        if((a[1].includes('publish-recovery-orphan-')&&stage==='after-archive')||(a[1].includes('publish-continued-resume-')&&stage==='after-resume-archive'))await pause();};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(a[0].endsWith('publish-finalization.lock')&&stage==='before-release')await pause();await unlink(...a);
        if((a[0].endsWith('publish-recovery.lock')&&stage==='after-source')||(a[0].endsWith('publish-resume.lock')&&stage==='after-resume-source'))await pause();};
      const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].endsWith('resumption-continuation-'+id+'.json')&&stage==='before-final-receipt')await pause();
        const h=await open(...a);if(a[1]==='wx'&&((a[0].includes('recovery-reconciliation-')&&!a[0].endsWith('.intent.json')&&stage==='after-original-receipt')||
          (a[0].includes('reconciliation-resume-')&&!a[0].endsWith('.intent.json')&&stage==='after-resume-receipt'))){const close=h.close.bind(h);h.close=async()=>{await close();await pause();};}return h;};
      syncBuiltinESMExports();const{continueRecoveryResumption}=await import(${JSON.stringify(moduleUrl)});await continueRecoveryResumption(process.argv[1],JSON.parse(process.argv[2]));`,
      [directory, JSON.stringify(review), stage], async (_, stop) => {
        assert.equal((await inspectRecoveryStatus(directory)).status, "finalizing"); const before = await snapshot(directory);
        const dummy = reviewFor({ planSha256: "a".repeat(64) });
        for (const operation of [() => acquirePublicationLock(directory), () => recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }),
          () => applyRecoveryReconciliation(directory, { ...dummy, decision: "reconcile-local-recovery" }), () => resumeRecoveryReconciliation(directory, { ...dummy, decision: "resume-local-reconciliation" }),
          () => finalizeMaintenance(directory, { ...dummy, decision: "archive-completed-maintenance" }), () => finalizeResumptionGuard(directory, { ...dummy, decision: "archive-completed-resumption" }),
          () => resumeClosure(directory, { ...dummy, decision: "resume-local-closure" }), () => abortRecoveryReconciliation(directory, { ...dummy, decision: "abort-local-reconciliation", reason: "Fixture" }),
          () => continueRecoveryResumption(directory, review)]) await assert.rejects(operation());
        assert.deepEqual(await snapshot(directory), before); await stop();
      });
    const status = await inspectRecoveryStatus(directory);
    assert.equal(status.finalization.state, "inactive"); assert.equal(status.coordinationClear, false);
    assert.equal(status.resumptionContinuations.completed.length, Number(stage === "before-release"));
    if (stage !== "before-release") assert.equal(status.resumptions.completed.length, 0);
    const before = await snapshot(directory); await assert.rejects(continueRecoveryResumption(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("sustituciones entre comprobaciones conservan bloqueos y rechazan certificación", async () => {
  for (const kind of ["owner", "resume", "maintenance", "pointer", "original-intent", "resumed-intent", "own-intent", "archive"]) await temporary(async directory => {
    const { original, resume } = await interruptedResumption(directory, "intent-only"), proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal);
    const paths = { owner: "publish-finalization.lock", resume: "publish-resume.lock", maintenance: "publish-maintenance.lock", pointer: "current-release.json",
      "original-intent": `recovery-reconciliation-${original.operationId}.intent.json`, "resumed-intent": `reconciliation-resume-${resume.operationId}.intent.json`, "own-intent": `resumption-continuation-${review.operationId}.intent.json`,
      archive: `publish-recovery-orphan-${original.operationId}.lock` };
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from'node:fs/promises';import{join}from'node:path';import{syncBuiltinESMExports}from'node:module';
      const link=fs.link;let once=true;fs.link=async(...a)=>{await link(...a);if(once){once=false;await fs.writeFile(join(process.argv[1],process.argv[3]),'PRIVATE_REPLACEMENT');}};
      syncBuiltinESMExports();const{continueRecoveryResumption}=await import(${JSON.stringify(moduleUrl)});try{await continueRecoveryResumption(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{process.exitCode=0;}`,
      directory, JSON.stringify(review), paths[kind]], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); await access(join(directory, "publish-finalization.lock"));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.resumptionContinuations.completed.length, 0); assert.equal(status.coordinationClear, false);
  });
});

test("evidencia histórica alterada o vínculo de continuación prestado invalida ambas operaciones sin guardas", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "reconciliation-completed"), proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal);
  await continueRecoveryResumption(directory, review); const closure = await prepareMaintenanceReview(directory); await finalizeMaintenance(directory, closeFor(closure));
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  const paths = [`resumption-continuation-${review.operationId}.intent.json`, `resumption-continuation-${review.operationId}.json`, `publish-continued-resume-${review.operationId}.lock`,
    `reconciliation-resume-${resume.operationId}.intent.json`, `reconciliation-resume-${resume.operationId}.json`, `recovery-reconciliation-${original.operationId}.intent.json`,
    `recovery-reconciliation-${original.operationId}.json`, `publish-recovery-orphan-${original.operationId}.lock`];
  for (const name of paths) {
    const path = join(directory, name), bytes = await readFile(path); await writeFile(path, "{}");
    const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review", name);
    assert.equal(status.resumptionContinuations.pending.length, 1); assert.equal(status.resumptions.completed.length, 0); assert.equal(status.reconciliations.completed.length, 0);
    const before = await snapshot(directory); await assert.rejects(continueRecoveryResumption(directory, review)); assert.deepEqual(await snapshot(directory), before); await writeFile(path, bytes);
  }
  const path = join(directory, `reconciliation-resume-${resume.operationId}.json`), bytes = await readFile(path), value = JSON.parse(bytes);
  value.resumptionContinuationId = randomUUID(); await writeFile(path, JSON.stringify(value));
  assert.equal((await inspectRecoveryStatus(directory)).resumptions.completed.length, 0);
  await writeFile(path, bytes); assert.equal((await continueRecoveryResumption(directory, review)).replayed, true);
}));

test("historial acotado reserva todos los destinos antes de iniciar sin truncar evidencia", () => temporary(async directory => {
  await interruptedResumption(directory, "guard-removed");
  const orphan = (await readdir(directory)).find(name => /^publish-orphan-/.test(name)), bytes = await readFile(join(directory, orphan)), owner = JSON.parse(bytes), pairs = [];
  for (let i = 0; i < 296; i++) { const id = randomUUID(); pairs.push(id);
    await writeFile(join(directory, `publish-orphan-${id}.lock`), bytes);
    await writeFile(join(directory, `lock-recovery-${id}.json`), JSON.stringify({ owner: { ...owner, sha256: hash(bytes), active: false }, reviewer: "Fixture", decision: "recover-local-lock", createdAt: new Date().toISOString() })); }
  assert.equal((await inspectResumptionContinuation(directory)).stage, "history-limit");
  const before = await snapshot(directory); await assert.rejects(continueRecoveryResumption(directory, reviewFor({ planSha256: "a".repeat(64) }))); assert.deepEqual(await snapshot(directory), before);
  await unlink(join(directory, `publish-orphan-${pairs[0]}.lock`)); await unlink(join(directory, `lock-recovery-${pairs[0]}.json`));
  const plan = await prepareResumptionContinuation(directory); await continueRecoveryResumption(directory, reviewFor(plan));
  assert.equal((await evidenceNames(directory)).length, 604); assert.equal((await inspectRecoveryStatus(directory)).resumptionContinuations.pending.length, 0);
}));

test("CLI prepara sin mutar y reporta fallos sin valores privados ni reutilizar éxito previo", () => temporary(async directory => {
  await interruptedResumption(directory, "guard-removed"); const baseline = await snapshot(directory);
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), baseline);
  const proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal), reviewPath = join(directory, "review-private.json");
  await writeFile(reviewPath, JSON.stringify(review)); const success = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]); assert.equal(success.status, 0, success.stderr);
  await writeFile(reviewPath, JSON.stringify({ ...review, reviewer: "PRIVATE_CHANGED_REVIEWER" }));
  const failed = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]); assert.equal(failed.status, 1); assert.ok(!failed.stderr.includes("PRIVATE_CHANGED_REVIEWER"));
  assert.deepEqual(JSON.parse(await readFile(join(artifacts, "web-resumption-continuation-result.json"), "utf8")).resultConfirmed, false);
  for (const args of [["--plan", "--inspect"], ["--inspect", "--unknown"], ["--inspect", "--directory="], ["--inspect", `--directory=${directory}`, `--directory=${directory}`], ["--apply"], ["--plan", `--review=${reviewPath}`]]) assert.equal(run(args).status, 1);
}));

test("fallo al registrar resultado tras retirar reanudación mantiene ambos recibos pendientes sin guarda temporal", () => temporary(async directory => {
  await interruptedResumption(directory, "guard-removed"); const proposal = await prepareResumptionContinuation(directory), review = reviewFor(proposal), reviewPath = join(directory, "review.json");
  await writeFile(reviewPath, JSON.stringify(review));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const id=process.argv[4],open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].endsWith('resumption-continuation-'+id+'.json'))throw new Error('PRIVATE_IO_FAILURE');return open(...a);};
    syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];await import(${JSON.stringify(moduleUrl)});`,
    cli, directory, reviewPath, review.operationId], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 1, result.stderr); assert.ok(!result.stderr.includes("PRIVATE_IO_FAILURE"));
  await assert.rejects(access(join(directory, "publish-resume.lock"))); await access(join(directory, "publish-finalization.lock"));
  let status = await inspectRecoveryStatus(directory); assert.equal(status.resumptionContinuations.pending.length, 1); assert.equal(status.resumptions.completed.length, 0);
  await unlink(join(directory, "publish-finalization.lock")); await unlink(join(directory, "publish-maintenance.lock"));
  status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.resumptions.completed.length, 0); assert.equal(status.reconciliations.completed.length, 0);
  for (const inspect of [inspectResumption, inspectResumptionGuard, inspectMaintenance, inspectClosureResumption, inspectReconciliationAbort]) {
    const report = await inspect(directory); assert.equal(report.eligible, false); assert.equal(report.stage, "continuation-needs-review");
  }
  const before = await snapshot(directory); await assert.rejects(prepareRecoveryReconciliation(directory)); await assert.rejects(continueRecoveryResumption(directory, review)); assert.deepEqual(await snapshot(directory), before);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resumption-continuation-result.json"), "utf8")).resultConfirmed, false);
}));
