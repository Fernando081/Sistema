import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectResumptionAbort, prepareResumptionAbort, abortRecoveryResumption } from "../resumption-abort.mjs";
import { inspectRecoveryStatus, evidenceNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock, inspectPublicationLock } from "../publication-lock.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { inspectResumption, prepareRecoveryResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { inspectResumptionGuard, finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { inspectMaintenance, prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { inspectClosureResumption, resumeClosure } from "../closure-resumption.mjs";
import { inspectReconciliationAbort, prepareReconciliationAbort, abortRecoveryReconciliation } from "../reconciliation-abort.mjs";
import { inspectResumptionContinuation, prepareResumptionContinuation, continueRecoveryResumption } from "../resumption-continuation.mjs";
import { temporary, snapshot, pauseChild, interruptedResumption } from "./support/closure-fixtures.mjs";

const moduleUrl = new URL("../resumption-abort.mjs", import.meta.url).href;
const resumeUrl = new URL("../recovery-resumption.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../resumption-abort.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const stages = ["intent-only", "guard-archived", "guard-removed", "reconciliation-completed"];
const reviewFor = plan => ({ operationId: randomUUID(), decision: "abort-local-resumption", reviewer: "Fixture revisión actual", reason: "PRIVATE_REASON cancelación separada", planSha256: plan.planSha256 });
const resumeFor = plan => ({ operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture siguiente operación", planSha256: plan.planSha256 });
const closeFor = plan => ({ operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture cierre separado", planSha256: plan.planSha256 });
const continuingFor = plan => ({ operationId: randomUUID(), decision: "continue-local-resumption", reviewer: "Fixture continuación separada", planSha256: plan.planSha256 });

test("cancela cuatro etapas sin fabricar recibos ni modificar reconciliación y mantenimiento originales", async () => {
  for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const { original, resume } = await interruptedResumption(directory, stage), before = await snapshot(directory);
    const proposal = await prepareResumptionAbort(directory), review = reviewFor(proposal);
    assert.equal(proposal.stage, stage); assert.equal((await inspectResumptionAbort(directory)).eligible, true);
    assert.deepEqual(await snapshot(directory), before); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_"));
    const result = await abortRecoveryResumption(directory, review), after = await snapshot(directory);
    assert.equal(result.aborted, true); assert.equal(result.replayed, false); assert.equal(result.resumptionId, resume.operationId);
    for (const [name, bytes] of Object.entries(before)) {
      if (name === "publish-resume.lock") assert.equal(after[`publish-aborted-resume-${review.operationId}.lock`], bytes);
      else assert.equal(after[name], bytes, name);
    }
    await assert.rejects(access(join(directory, "publish-resume.lock"))); await assert.rejects(access(join(directory, "publish-finalization.lock")));
    await assert.rejects(access(join(directory, `reconciliation-resume-${resume.operationId}.json`)));
    if (stage !== "reconciliation-completed") await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`)));
    const status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive");
    assert.equal(status.resumptionAborts.completed.length, 1); assert.equal(status.resumptionAborts.pending.length, 0);
    assert.equal(status.resumptions.aborted[0].operationId, resume.operationId); assert.equal(status.resumptions.aborted[0].abortId, review.operationId);
    assert.equal(status.resumptions.completed.length, 0); assert.equal(status.resumptions.pending.length, 0);
    assert.equal(status.reconciliations.completed.length, Number(stage === "reconciliation-completed"));
    assert.equal(status.reconciliations.pending.length, Number(stage !== "reconciliation-completed"));
    assert.ok(!JSON.stringify(status).includes("PRIVATE_REASON"));
    const receipt = JSON.parse(await readFile(join(directory, `resumption-abort-${review.operationId}.json`), "utf8"));
    assert.equal(receipt.outcome, "aborted"); assert.equal(receipt.reconciliationReceiptSha256, proposal.plan.reconciliationReceiptSha256);
    await assert.rejects(resumeRecoveryReconciliation(directory, resume));
    assert.deepEqual(await snapshot(directory), after);
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const historical = await snapshot(directory); assert.equal((await abortRecoveryResumption(directory, review)).replayed, true);
    assert.deepEqual(await snapshot(directory), historical);
  });
});

test("tres partidas originales quedan pendientes y se resuelven con cancelación o nueva reanudación independientes", async () => {
  for (const stage of stages.slice(0, 3)) for (const resolution of ["cancel", "resume"]) await temporary(async directory => {
    const { original, resume } = await interruptedResumption(directory, "original-intent", stage);
    const proposal = await prepareResumptionAbort(directory), review = reviewFor(proposal); assert.equal(proposal.stage, stage);
    await abortRecoveryResumption(directory, review);
    if (resolution === "cancel") {
      const plan = await prepareReconciliationAbort(directory);
      await abortRecoveryReconciliation(directory, { ...reviewFor(plan), decision: "abort-local-reconciliation" });
      const status = await inspectRecoveryStatus(directory); assert.equal(status.reconciliations.aborted[0].operationId, original.operationId);
      assert.equal(status.reconciliations.completed.length, 0); assert.equal(status.resumptions.completed.length, 0);
    } else {
      const next = resumeFor(await prepareRecoveryResumption(directory)); assert.notEqual(next.operationId, resume.operationId);
      await resumeRecoveryReconciliation(directory, next);
      await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
      const status = await inspectRecoveryStatus(directory); assert.equal(status.reconciliations.completed[0].operationId, original.operationId);
      assert.equal(status.resumptions.completed[0].operationId, next.operationId);
    }
    const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "ready");
    assert.equal(status.resumptionAborts.completed.length, 1); assert.equal(status.resumptionAborts.pending.length, 0);
    assert.equal(status.resumptions.aborted[0].operationId, resume.operationId);
    const before = await snapshot(directory); assert.equal((await abortRecoveryResumption(directory, review)).replayed, true);
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("recibo original previo se conserva y habilita cierre de mantenimiento sin simular éxito de reanudación", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "reconciliation-completed");
  const receiptPath = join(directory, `recovery-reconciliation-${original.operationId}.json`), bytes = await readFile(receiptPath);
  const review = reviewFor(await prepareResumptionAbort(directory)); await abortRecoveryResumption(directory, review);
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.reconciliations.completed[0].completionEvidence, "preserved-reconciliation-receipt");
  assert.equal(status.reconciliations.completed[0].resumptionAbortId, review.operationId);
  assert.deepEqual(await readFile(receiptPath), bytes);
  await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  assert.equal((await applyRecoveryReconciliation(directory, original)).replayed, true);
  await assert.rejects(resumeRecoveryReconciliation(directory, resume));
  await assert.rejects(prepareResumptionContinuation(directory));
  await assert.rejects(access(join(directory, `reconciliation-resume-${resume.operationId}.json`)));
}));

test("reanudación sucesora interrumpida no invalida cancelación histórica ni completa prematuramente reconciliación", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "guard-removed");
  const review = reviewFor(await prepareResumptionAbort(directory)); await abortRecoveryResumption(directory, review);
  const next = resumeFor(await prepareRecoveryResumption(directory));
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].includes('reconciliation-resume-')&&!a[0].endsWith('.intent.json')){
      process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});}return open(...a);};syncBuiltinESMExports();
    const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumeUrl)});await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`,
    [directory, JSON.stringify(next)], async (_, stop) => stop());
  let status = await inspectRecoveryStatus(directory);
  assert.equal(status.resumptionAborts.completed.length, 1); assert.equal(status.resumptionAborts.pending.length, 0);
  assert.equal(status.resumptions.aborted[0].operationId, resume.operationId); assert.equal(status.resumptions.pending[0].operationId, next.operationId);
  assert.equal(status.reconciliations.pending[0].operationId, original.operationId); assert.equal(status.reconciliations.completed.length, 0);
  const before = await snapshot(directory); assert.equal((await abortRecoveryResumption(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), before);
  const plan = await prepareResumptionContinuation(directory); assert.equal(plan.stage, "reconciliation-completed");
  await continueRecoveryResumption(directory, continuingFor(plan));
  await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
  status = await inspectRecoveryStatus(directory); assert.equal(status.status, "ready"); assert.equal(status.resumptionAborts.completed.length, 1);
  assert.equal(status.resumptions.completed[0].operationId, next.operationId); assert.equal(status.resumptions.aborted[0].operationId, resume.operationId);
  const nextIntentPath = join(directory, `reconciliation-resume-${next.operationId}.intent.json`), nextBytes = await readFile(nextIntentPath);
  const changed = JSON.parse(nextBytes); changed.plan.reconciliationId = randomUUID(); changed.planSha256 = hash(JSON.stringify(changed.plan));
  await writeFile(nextIntentPath, JSON.stringify(changed));
  assert.equal((await inspectRecoveryStatus(directory)).resumptionAborts.completed.length, 0);
  await writeFile(nextIntentPath, nextBytes); assert.equal((await abortRecoveryResumption(directory, review)).replayed, true);
}));

test("publicación residual conserva recuperación ordinaria y cancelaciones independientes", () => temporary(async directory => {
  await interruptedResumption(directory, "guard-removed", "intent-only", true);
  const bytes = await readFile(join(directory, "publish.lock")), review = reviewFor(await prepareResumptionAbort(directory));
  await abortRecoveryResumption(directory, review); assert.deepEqual(await readFile(join(directory, "publish.lock")), bytes);
  await abortRecoveryReconciliation(directory, { ...reviewFor(await prepareReconciliationAbort(directory)), decision: "abort-local-reconciliation" });
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  const owner = await inspectPublicationLock(directory);
  await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture separado", sha256: owner.sha256 });
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready"); assert.equal((await abortRecoveryResumption(directory, review)).replayed, true);
}));

test("rechaza guardas activas ajenas sin vínculo, v1, etapas corruptas y reanudación completada sin mutar", async () => {
  for (const kind of ["active", "foreign", "invalid", "unlinked", "v1", "original-v1", "ambiguous", "source", "archive", "receipt", "resumed-receipt", "maintenance", "history", "finalization", "completed"]) await temporary(async directory => {
    const { original, resume } = await interruptedResumption(directory, kind === "completed" ? "completed-before-release" : "guard-archived");
    if (["active", "foreign", "unlinked"].includes(kind)) {
      const path = join(directory, "publish-resume.lock"), owner = JSON.parse(await readFile(path, "utf8"));
      if (kind === "active") owner.pid = process.pid;
      if (kind === "foreign") owner.host = hostname() + "-foreign";
      if (kind === "unlinked") owner.nonce = randomUUID();
      await writeFile(path, JSON.stringify(owner));
    }
    if (kind === "v1") { const path = join(directory, `reconciliation-resume-${resume.operationId}.intent.json`), value = JSON.parse(await readFile(path, "utf8")); value.schemaVersion = 1; delete value.resumptionSha256; await writeFile(path, JSON.stringify(value)); }
    if (kind === "original-v1") { const path = join(directory, `recovery-reconciliation-${original.operationId}.intent.json`), value = JSON.parse(await readFile(path, "utf8")); value.schemaVersion = 1; delete value.maintenanceSha256; await writeFile(path, JSON.stringify(value)); }
    if (kind === "ambiguous") { const value = JSON.parse(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.intent.json`), "utf8")); value.operationId = randomUUID(); await writeFile(join(directory, `reconciliation-resume-${value.operationId}.intent.json`), JSON.stringify(value)); }
    const corrupt = { invalid: "publish-resume.lock", source: "publish-recovery.lock", archive: `publish-recovery-orphan-${original.operationId}.lock`, receipt: `recovery-reconciliation-${original.operationId}.json`, "resumed-receipt": `reconciliation-resume-${resume.operationId}.json`, maintenance: "publish-maintenance.lock", history: `resumption-abort-${randomUUID()}.intent.json`, finalization: "publish-finalization.lock" };
    if (corrupt[kind]) await writeFile(join(directory, corrupt[kind]), "PRIVATE_CORRUPT");
    const before = await snapshot(directory), report = await inspectResumptionAbort(directory);
    assert.equal(report.eligible, false, kind); assert.ok(!JSON.stringify(report).includes("PRIVATE_CORRUPT"));
    await assert.rejects(prepareResumptionAbort(directory)); await assert.rejects(abortRecoveryResumption(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before, kind);
    if (kind === "completed") assert.equal(report.stage, "resumption-completed-use-guard-review");
  });
});

test("revisión exacta exige motivo acotado e IDs nuevos y rechaza plan desactualizado o trasplantado", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "guard-removed");
  const proposal = await prepareResumptionAbort(directory), baseline = await snapshot(directory);
  for (const patch of [{ operationId: original.operationId }, { operationId: resume.operationId }, { reason: "" }, { reason: "a\n" }, { reason: "a".repeat(501) },
    { reviewer: "" }, { reviewer: "a\n" }, { reviewer: "a".repeat(101) }, { private: "PRIVATE_EXTRA" }, { decision: "continue-local-resumption" }, { planSha256: "a".repeat(64) }]) {
    await assert.rejects(abortRecoveryResumption(directory, { ...reviewFor(proposal), ...patch })); assert.deepEqual(await snapshot(directory), baseline);
  }
  const path = join(directory, "current-release.json"); await writeFile(path, JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
  const changed = await snapshot(directory); await assert.rejects(abortRecoveryResumption(directory, reviewFor(proposal))); assert.deepEqual(await snapshot(directory), changed); await unlink(path);
  const extra = join(directory, `resumption-abort-${randomUUID()}.json`); await writeFile(extra, "{}");
  await assert.rejects(abortRecoveryResumption(directory, reviewFor(proposal))); await unlink(extra);
  await temporary(async other => { for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
    const before = await snapshot(other); await assert.rejects(abortRecoveryResumption(other, reviewFor(proposal))); assert.deepEqual(await snapshot(other), before); });
  const receipt = { schemaVersion: 2, operationId: original.operationId, decision: "reconcile-local-recovery", intentSha256: hash(await readFile(join(directory, `recovery-reconciliation-${original.operationId}.intent.json`))),
    resumptionId: resume.operationId, resumptionIntentSha256: hash(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.intent.json`))), completedAt: new Date().toISOString() };
  await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.json`), JSON.stringify(receipt));
  assert.equal((await inspectResumptionAbort(directory)).stage, "reconciliation-completed");
  const stageChanged = await snapshot(directory); await assert.rejects(abortRecoveryResumption(directory, reviewFor(proposal))); assert.deepEqual(await snapshot(directory), stageChanged);
}));

test("dos revisores concurrentes cancelan una vez y motivo o responsable distinto impide replay", () => temporary(async directory => {
  await interruptedResumption(directory, "intent-only"); const plan = await prepareResumptionAbort(directory), reviews = [reviewFor(plan), reviewFor(plan)];
  const results = await Promise.allSettled(reviews.map(review => abortRecoveryResumption(directory, review)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const review = reviews[results.findIndex(result => result.status === "fulfilled")];
  assert.equal((await inspectRecoveryStatus(directory)).resumptionAborts.completed.length, 1);
  const before = await snapshot(directory);
  for (const patch of [{ reviewer: "Otro revisor" }, { reason: "Otro motivo" }]) await assert.rejects(abortRecoveryResumption(directory, { ...review, ...patch }));
  assert.deepEqual(await snapshot(directory), before);
}));

test("cinco cortes conservan exclusión de diez herramientas y dejan la propia cancelación para revisión", async () => {
  for (const stage of ["before-archive", "after-archive", "after-source", "before-receipt", "before-release"]) await temporary(async directory => {
    await interruptedResumption(directory, "intent-only"); const review = reviewFor(await prepareResumptionAbort(directory));
    await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const stage=process.argv[3],id=JSON.parse(process.argv[2]).operationId,pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...a)=>{if(stage==='before-archive')await pause();await link(...a);if(stage==='after-archive')await pause();};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(a[0].endsWith('publish-finalization.lock')&&stage==='before-release')await pause();await unlink(...a);if(a[0].endsWith('publish-resume.lock')&&stage==='after-source')await pause();};
      const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].endsWith('resumption-abort-'+id+'.json')&&stage==='before-receipt')await pause();return open(...a);};
      syncBuiltinESMExports();const{abortRecoveryResumption}=await import(${JSON.stringify(moduleUrl)});await abortRecoveryResumption(process.argv[1],JSON.parse(process.argv[2]));`,
      [directory, JSON.stringify(review), stage], async (_, stop) => {
        assert.equal((await inspectRecoveryStatus(directory)).status, "finalizing"); const before = await snapshot(directory), dummy = reviewFor({ planSha256: "a".repeat(64) });
        for (const operation of [() => acquirePublicationLock(directory), () => recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }),
          () => applyRecoveryReconciliation(directory, { operationId: dummy.operationId, decision: "reconcile-local-recovery", reviewer: dummy.reviewer, planSha256: dummy.planSha256 }),
          () => resumeRecoveryReconciliation(directory, resumeFor({ planSha256: dummy.planSha256 })), () => finalizeMaintenance(directory, closeFor({ planSha256: dummy.planSha256 })),
          () => finalizeResumptionGuard(directory, { ...closeFor({ planSha256: dummy.planSha256 }), decision: "archive-completed-resumption" }),
          () => resumeClosure(directory, { ...closeFor({ planSha256: dummy.planSha256 }), decision: "resume-local-closure" }),
          () => abortRecoveryReconciliation(directory, { ...dummy, decision: "abort-local-reconciliation" }),
          () => continueRecoveryResumption(directory, continuingFor({ planSha256: dummy.planSha256 })), () => abortRecoveryResumption(directory, review)]) await assert.rejects(operation());
        assert.deepEqual(await snapshot(directory), before); await stop();
      });
    const status = await inspectRecoveryStatus(directory); assert.equal(status.finalization.state, "inactive"); assert.equal(status.coordinationClear, false);
    assert.equal(status.resumptionAborts.completed.length, Number(stage === "before-release"));
    assert.equal(status.resumptionAborts.pending.length, Number(stage !== "before-release"));
    assert.equal(status.resumptions.completed.length, 0); assert.equal(status.reconciliations.completed.length, 0);
    const before = await snapshot(directory); await assert.rejects(abortRecoveryResumption(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("sustituciones entre pasos no certifican cancelación y conservan guarda y evidencia", async () => {
  for (const kind of ["owner", "resume", "maintenance", "pointer", "original-intent", "resumed-intent", "own-intent", "archive", "original-receipt", "history"]) await temporary(async directory => {
    const { original, resume } = await interruptedResumption(directory, kind === "original-receipt" ? "reconciliation-completed" : "guard-archived");
    const review = reviewFor(await prepareResumptionAbort(directory));
    const paths = { owner: "publish-finalization.lock", resume: "publish-resume.lock", maintenance: "publish-maintenance.lock", pointer: "current-release.json",
      "original-intent": `recovery-reconciliation-${original.operationId}.intent.json`, "resumed-intent": `reconciliation-resume-${resume.operationId}.intent.json`,
      "own-intent": `resumption-abort-${review.operationId}.intent.json`, archive: `publish-recovery-orphan-${original.operationId}.lock`,
      "original-receipt": `recovery-reconciliation-${original.operationId}.json`, history: `lock-recovery-${randomUUID()}.json` };
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from'node:fs/promises';import{join}from'node:path';import{syncBuiltinESMExports}from'node:module';
      const link=fs.link;fs.link=async(...a)=>{await link(...a);await fs.writeFile(join(process.argv[1],process.argv[3]),'PRIVATE_REPLACEMENT');};
      syncBuiltinESMExports();const{abortRecoveryResumption}=await import(${JSON.stringify(moduleUrl)});try{await abortRecoveryResumption(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{process.exitCode=0;}`,
      directory, JSON.stringify(review), paths[kind]], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); await access(join(directory, "publish-finalization.lock"));
    assert.equal((await inspectRecoveryStatus(directory)).resumptionAborts.completed.length, 0); assert.equal((await inspectRecoveryStatus(directory)).coordinationClear, false);
  });
});

test("alteraciones históricas y recibo de reanudación insertado invalidan cancelación y éxito sin guardas", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "reconciliation-completed"), review = reviewFor(await prepareResumptionAbort(directory));
  await abortRecoveryResumption(directory, review); await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  const paths = [`resumption-abort-${review.operationId}.intent.json`, `resumption-abort-${review.operationId}.json`, `publish-aborted-resume-${review.operationId}.lock`,
    `reconciliation-resume-${resume.operationId}.intent.json`, `recovery-reconciliation-${original.operationId}.intent.json`, `recovery-reconciliation-${original.operationId}.json`, `publish-recovery-orphan-${original.operationId}.lock`];
  for (const name of paths) {
    const path = join(directory, name), bytes = await readFile(path); await writeFile(path, "{}"); const status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review", name); assert.equal(status.resumptionAborts.pending.length, 1); assert.equal(status.resumptions.aborted.length, 0);
    assert.equal(status.reconciliations.completed.length, 0); const before = await snapshot(directory);
    await assert.rejects(abortRecoveryResumption(directory, review)); assert.deepEqual(await snapshot(directory), before); await writeFile(path, bytes);
  }
  const resumeReceipt = join(directory, `reconciliation-resume-${resume.operationId}.json`); await writeFile(resumeReceipt, "{}");
  assert.equal((await inspectRecoveryStatus(directory)).resumptionAborts.completed.length, 0); await unlink(resumeReceipt);
  assert.equal((await abortRecoveryResumption(directory, review)).replayed, true);
  await temporary(async other => {
    const initial = await interruptedResumption(other, "guard-removed"), cancellation = reviewFor(await prepareResumptionAbort(other));
    await abortRecoveryResumption(other, cancellation);
    await writeFile(join(other, `recovery-reconciliation-${initial.original.operationId}.json`), JSON.stringify({ schemaVersion: 2,
      operationId: initial.original.operationId, decision: "reconcile-local-recovery", intentSha256: hash(await readFile(join(other, `recovery-reconciliation-${initial.original.operationId}.intent.json`))),
      resumptionId: initial.resume.operationId, resumptionIntentSha256: hash(await readFile(join(other, `reconciliation-resume-${initial.resume.operationId}.intent.json`))), completedAt: new Date().toISOString() }));
    const invalid = await inspectRecoveryStatus(other); assert.equal(invalid.resumptionAborts.completed.length, 0);
    assert.equal(invalid.resumptionAborts.pending.length, 1); assert.equal(invalid.reconciliations.completed.length, 0);
    await assert.rejects(abortRecoveryResumption(other, cancellation));
  });
}));

test("dos cancelaciones válidas del mismo origen se diagnostican ambiguas y nunca se elige una", () => temporary(async directory => {
  const { resume } = await interruptedResumption(directory, "guard-removed"), review = reviewFor(await prepareResumptionAbort(directory));
  await abortRecoveryResumption(directory, review); const id = randomUUID();
  const intent = JSON.parse(await readFile(join(directory, `resumption-abort-${review.operationId}.intent.json`), "utf8")); intent.operationId = id;
  const raw = JSON.stringify(intent), receipt = JSON.parse(await readFile(join(directory, `resumption-abort-${review.operationId}.json`), "utf8")); receipt.operationId = id; receipt.intentSha256 = hash(raw);
  await writeFile(join(directory, `resumption-abort-${id}.intent.json`), raw); await writeFile(join(directory, `resumption-abort-${id}.json`), JSON.stringify(receipt));
  await writeFile(join(directory, `publish-aborted-resume-${id}.lock`), await readFile(join(directory, `publish-aborted-resume-${review.operationId}.lock`)));
  const status = await inspectRecoveryStatus(directory); assert.equal(status.resumptionAborts.completed.length, 0); assert.equal(status.resumptionAborts.pending.length, 2);
  assert.ok(status.resumptionAborts.pending.every(item => item.issue === "ambiguous-resumption-abort"));
  assert.equal(status.resumptions.aborted.length, 0); assert.equal(status.resumptions.pending[0].operationId, resume.operationId); assert.notEqual(status.status, "ready");
}));

test("reserva tres destinos sin truncar y permite cancelar cuando no caben los seis de una continuación", () => temporary(async directory => {
  await interruptedResumption(directory, "intent-only");
  const orphan = (await readdir(directory)).find(name => /^publish-orphan-/.test(name)), bytes = await readFile(join(directory, orphan)), owner = JSON.parse(bytes), pairs = [];
  for (let i = 0; i < 298; i++) { const id = randomUUID(); pairs.push(id);
    await writeFile(join(directory, `publish-orphan-${id}.lock`), bytes);
    await writeFile(join(directory, `lock-recovery-${id}.json`), JSON.stringify({ owner: { ...owner, sha256: hash(bytes), active: false }, reviewer: "Fixture", decision: "recover-local-lock", createdAt: new Date().toISOString() })); }
  assert.equal((await inspectResumptionAbort(directory)).stage, "history-limit"); const before = await snapshot(directory);
  await assert.rejects(abortRecoveryResumption(directory, reviewFor({ planSha256: "a".repeat(64) }))); assert.deepEqual(await snapshot(directory), before);
  await unlink(join(directory, `publish-orphan-${pairs[0]}.lock`)); await unlink(join(directory, `lock-recovery-${pairs[0]}.json`));
  assert.equal((await inspectResumptionContinuation(directory)).stage, "history-limit");
  await abortRecoveryResumption(directory, reviewFor(await prepareResumptionAbort(directory)));
  assert.equal((await evidenceNames(directory)).length, 605); assert.equal((await inspectRecoveryStatus(directory)).resumptionAborts.completed.length, 1);
}));

test("CLI de lectura no muta y un fallo sustituye reporte previo sin exponer responsable o motivo", () => temporary(async directory => {
  await interruptedResumption(directory, "guard-removed"); const baseline = await snapshot(directory);
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), baseline);
  const review = reviewFor(await prepareResumptionAbort(directory)), reviewPath = join(directory, "review-private.json"); await writeFile(reviewPath, JSON.stringify(review));
  const success = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]); assert.equal(success.status, 0, success.stderr); assert.ok(!success.stdout.includes("PRIVATE_REASON"));
  await writeFile(reviewPath, JSON.stringify({ ...review, reviewer: "PRIVATE_CHANGED_REVIEWER", reason: "PRIVATE_CHANGED_REASON" }));
  const failed = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]); assert.equal(failed.status, 1); assert.ok(!failed.stderr.includes("PRIVATE_"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resumption-abort-result.json"), "utf8")).resultConfirmed, false);
  for (const args of [["--plan", "--inspect"], ["--inspect", "--unknown"], ["--inspect", "--directory="], ["--inspect", `--directory=${directory}`, `--directory=${directory}`], ["--apply"], ["--plan", `--review=${reviewPath}`]]) assert.equal(run(args).status, 1);
}));

test("fallo del recibo después de retirar guarda conserva cancelación pendiente y bloquea preparaciones aun sin guarda", () => temporary(async directory => {
  const { original, resume } = await interruptedResumption(directory, "guard-removed"), before = await snapshot(directory), review = reviewFor(await prepareResumptionAbort(directory));
  const reviewPath = join(directory, "review.json"); await writeFile(reviewPath, JSON.stringify(review));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const id=process.argv[4],open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].endsWith('resumption-abort-'+id+'.json'))throw new Error('PRIVATE_IO_FAILURE');return open(...a);};
    syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];await import(${JSON.stringify(moduleUrl)});`,
    cli, directory, reviewPath, review.operationId], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 1, result.stderr); assert.ok(!result.stderr.includes("PRIVATE_IO_FAILURE"));
  await assert.rejects(access(join(directory, "publish-resume.lock"))); await access(join(directory, "publish-finalization.lock"));
  const after = await snapshot(directory);
  for (const [name, bytes] of Object.entries(before)) if (name !== "publish-resume.lock") assert.equal(after[name], bytes);
  await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`))); await assert.rejects(access(join(directory, `reconciliation-resume-${resume.operationId}.json`)));
  await unlink(join(directory, "publish-finalization.lock")); await unlink(join(directory, "publish-maintenance.lock"));
  const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.resumptionAborts.pending.length, 1);
  assert.equal(status.resumptions.aborted.length, 0); assert.equal(status.reconciliations.completed.length, 0);
  for (const inspect of [inspectResumption, inspectResumptionGuard, inspectMaintenance, inspectClosureResumption, inspectReconciliationAbort, inspectResumptionContinuation, inspectResumptionAbort]) {
    const report = await inspect(directory); assert.equal(report.eligible, false); assert.equal(report.stage, "resumption-abort-needs-review");
  }
  const preserved = await snapshot(directory); await assert.rejects(prepareRecoveryReconciliation(directory)); await assert.rejects(abortRecoveryResumption(directory, review)); assert.deepEqual(await snapshot(directory), preserved);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resumption-abort-result.json"), "utf8")).resultConfirmed, false);
}));
