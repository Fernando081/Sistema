import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectClosureAbortContinuation, prepareClosureAbortContinuation, continueClosureAbort } from "../closure-abort-continuation.mjs";
import { inspectRecoveryStatus, evidenceNames, closureNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock, inspectPublicationLock } from "../publication-lock.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { prepareRecoveryResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { prepareResumptionGuardReview, finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { prepareClosureResumption, resumeClosure } from "../closure-resumption.mjs";
import { prepareClosureAbort, abortInterruptedClosure } from "../closure-abort.mjs";
import { prepareResumptionContinuation, continueRecoveryResumption } from "../resumption-continuation.mjs";
import { prepareResumptionAbort, abortRecoveryResumption } from "../resumption-abort.mjs";
import { prepareReconciliationAbort, abortRecoveryReconciliation } from "../reconciliation-abort.mjs";
import { prepareReconciliationAbortContinuation, continueReconciliationAbort } from "../reconciliation-abort-continuation.mjs";
import { prepareResumptionAbortContinuation, continueResumptionAbort } from "../resumption-abort-continuation.mjs";
import { temporary, snapshot, pauseChild, interruptedClosureAbort } from "./support/closure-fixtures.mjs";

const module = new URL("../closure-abort-continuation.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../closure-abort-continuation.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const stages = ["intent-only", "source-archived", "source-removed", "completed-before-release"];
const closureStages = ["intent-only", "source-archived", "source-removed"];
const kinds = ["maintenance", "resumption"];
const reviewFor = proposal => ({ operationId: randomUUID(), decision: "continue-local-closure-abort", reviewer: "Fixture continuación PRIVATE_REVIEWER", planSha256: proposal.planSha256 });
const closureFor = (proposal, kind) => ({ operationId: randomUUID(), decision: kind === "maintenance" ? "archive-completed-maintenance" : "archive-completed-resumption",
  reviewer: "Fixture cierre independiente", planSha256: proposal.planSha256 });
const prepares = [prepareRecoveryReconciliation, prepareRecoveryResumption, prepareMaintenanceReview, prepareResumptionGuardReview,
  prepareClosureResumption, prepareClosureAbort, prepareResumptionContinuation, prepareResumptionAbort, prepareReconciliationAbort,
  prepareReconciliationAbortContinuation, prepareResumptionAbortContinuation];
async function closeResidual(directory, kind) {
  if (kind === "resumption" && (await readdir(directory)).includes("publish-resume.lock"))
    await finalizeResumptionGuard(directory, closureFor(await prepareResumptionGuardReview(directory), "resumption"));
  if ((await readdir(directory)).includes("publish-maintenance.lock"))
    await finalizeMaintenance(directory, closureFor(await prepareMaintenanceReview(directory), "maintenance"));
}

test("veinticuatro combinaciones conservan recibos, fuentes residuales y cierre cancelado sin fabricar éxito", async () => {
  for (const kind of kinds) for (const closureStage of closureStages) for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const { original, resume, close, abort } = await interruptedClosureAbort(directory, kind, stage, closureStage);
    const before = await snapshot(directory), proposal = await prepareClosureAbortContinuation(directory), names = closureNames(kind, close.operationId);
    assert.equal(proposal.stage, stage); assert.equal(proposal.closureKind, kind); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_"));
    assert.deepEqual(await snapshot(directory), before);
    const review = reviewFor(proposal), result = await continueClosureAbort(directory, review), after = await snapshot(directory);
    assert.equal(result.continued, true); assert.equal(result.replayed, false); assert.equal(result.abortId, abort.operationId); assert.equal(result.closureId, close.operationId);
    for (const [name, raw] of Object.entries(before)) {
      if (name === "publish-finalization.lock") assert.equal(after["publish-continued-closure-abort-finalization-" + abort.operationId + ".lock"], raw);
      else if (name === "publish-recovery.lock") assert.equal(after["publish-aborted-closure-recovery-" + abort.operationId + ".lock"], raw);
      else assert.equal(after[name], raw, name);
    }
    for (const name of ["publish-recovery.lock", "publish-finalization.lock", names.receipt]) await assert.rejects(access(join(directory, name)));
    const receipt = JSON.parse(await readFile(join(directory, "closure-abort-" + abort.operationId + ".json"), "utf8"));
    assert.equal(receipt.schemaVersion, stage === "completed-before-release" ? 1 : 2); assert.equal(receipt.outcome, "aborted");
    if (receipt.schemaVersion === 2) assert.equal(receipt.abortContinuationId, review.operationId);
    const status = await inspectRecoveryStatus(directory), summary = kind === "maintenance" ? status.maintenanceReviews : status.resumptionReviews;
    assert.equal(status.status, kind === "maintenance" && closureStage === "source-removed" ? "ready" : "needs-review");
    assert.equal(status.closureAbortContinuations.completed[0].operationId, review.operationId); assert.equal(status.closureAborts.completed[0].operationId, abort.operationId);
    assert.equal(summary.aborted[0].operationId, close.operationId); assert.equal(summary.completed.length, 0); assert.equal(summary.pending.length, 0);
    assert.equal(status.reconciliations.completed[0].operationId, original.operationId);
    if (resume) assert.equal(status.resumptions.completed[0].operationId, resume.operationId);
    assert.equal((await continueClosureAbort(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), after);
    assert.equal((await abortInterruptedClosure(directory, abort)).replayed, true); assert.deepEqual(await snapshot(directory), after);
    await assert.rejects((kind === "maintenance" ? finalizeMaintenance : finalizeResumptionGuard)(directory, close));
  });
});

test("fuentes presentes se cierran por revisión nueva independiente y replay conserva puntero posterior", async () => {
  for (const kind of kinds) for (const closureStage of closureStages) await temporary(async directory => {
    const { close, abort } = await interruptedClosureAbort(directory, kind, "source-removed", closureStage);
    const review = reviewFor(await prepareClosureAbortContinuation(directory)); await continueClosureAbort(directory, review);
    await closeResidual(directory, kind); assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    await assert.rejects(access(join(directory, closureNames(kind, close.operationId).receipt)));
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const before = await snapshot(directory); assert.equal((await continueClosureAbort(directory, review)).replayed, true);
    assert.equal((await abortInterruptedClosure(directory, abort)).replayed, true); assert.deepEqual(await snapshot(directory), before);
  });
});

test("publicación residual mantiene recuperación ordinaria independiente en ambos tipos", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosureAbort(directory, kind, "source-removed", "source-archived", true); const raw = await readFile(join(directory, "publish.lock"));
    const review = reviewFor(await prepareClosureAbortContinuation(directory)); await continueClosureAbort(directory, review);
    assert.deepEqual(await readFile(join(directory, "publish.lock")), raw); await closeResidual(directory, kind);
    assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    const owner = await inspectPublicationLock(directory); await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture recuperación independiente", sha256: owner.sha256 });
    assert.equal((await inspectRecoveryStatus(directory)).status, "ready"); assert.equal((await continueClosureAbort(directory, review)).replayed, true);
  });
});

test("IDs nuevos distintos compiten por un único destino exclusivo por cancelación original", () => temporary(async directory => {
  await interruptedClosureAbort(directory, "resumption", "source-archived"); const proposal = await prepareClosureAbortContinuation(directory);
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => continueClosureAbort(directory, reviewFor(proposal))));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const status = await inspectRecoveryStatus(directory); assert.equal(status.closureAbortContinuations.completed.length, 1); assert.equal(status.closureAbortContinuations.pending.length, 0);
  const winner = results.find(result => result.status === "fulfilled").value, intent = JSON.parse(await readFile(join(directory, "closure-abort-continuation-" + winner.operationId + ".intent.json"), "utf8"));
  const review = { operationId: winner.operationId, decision: intent.decision, reviewer: intent.reviewer, planSha256: intent.planSha256 };
  assert.equal((await continueClosureAbort(directory, review)).replayed, true); await assert.rejects(continueClosureAbort(directory, { ...review, reviewer: "Revisor distinto" }));
}));

test("revisión exige campos exactos, responsable acotado e IDs distintos de todos los originales", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { original, resume, close, abort } = await interruptedClosureAbort(directory, kind, "intent-only"), proposal = await prepareClosureAbortContinuation(directory);
    const before = await snapshot(directory), patches = [{ operationId: original.operationId }, { operationId: close.operationId }, { operationId: abort.operationId },
      { operationId: randomUUID().toUpperCase() }, { reviewer: "" }, { reviewer: "a\n" }, { reviewer: "a".repeat(101) }, { decision: "resume-local-closure" },
      { planSha256: "a".repeat(64) }, { private: "PRIVATE_EXTRA" }];
    if (resume) patches.push({ operationId: resume.operationId });
    for (const patch of patches) { await assert.rejects(continueClosureAbort(directory, { ...reviewFor(proposal), ...patch })); assert.deepEqual(await snapshot(directory), before); }
  });
});

test("puntero, historia, fuentes, archivos, recibos y trasplante invalidan revisión sin mutar", async () => {
  const faults = ["pointer", "old-intent", "closure-intent", "source", "archive", "original-receipt", "history", "lost-source", "receipt", "directory"];
  for (let index = 0; index < faults.length; index++) await temporary(async directory => {
    const kind = kinds[index % 2], fault = faults[index], { original, close, abort } = await interruptedClosureAbort(directory, kind, "source-archived", "source-archived");
    const review = reviewFor(await prepareClosureAbortContinuation(directory)), names = closureNames(kind, close.operationId);
    const targets = { pointer: "current-release.json", "old-intent": "closure-abort-" + abort.operationId + ".intent.json", "closure-intent": names.intent,
      source: names.source, archive: names.archive, "original-receipt": "recovery-reconciliation-" + original.operationId + ".json",
      history: "closure-abort-continuation-" + randomUUID() + ".intent.json", receipt: "closure-abort-" + abort.operationId + ".json" };
    if (targets[fault]) await writeFile(join(directory, targets[fault]), "PRIVATE_CHANGED");
    if (fault === "lost-source") await unlink(join(directory, "publish-recovery.lock"));
    if (fault === "directory") await temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(continueClosureAbort(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    else { const before = await snapshot(directory); await assert.rejects(continueClosureAbort(directory, review)); assert.deepEqual(await snapshot(directory), before, fault); }
  });
});

test("finalización activa ajena inválida ausente sin vínculo y cancelaciones ambiguas requieren revisión", async () => {
  for (const fault of ["active", "foreign", "invalid", "absent", "unlinked", "ambiguous", "maintenance", "recovery", "legacy"]) await temporary(async directory => {
    const { close, abort } = await interruptedClosureAbort(directory, "resumption", "source-archived"), path = join(directory, "publish-finalization.lock");
    const owner = JSON.parse(await readFile(path, "utf8"));
    if (fault === "active") owner.pid = process.pid;
    if (fault === "foreign") owner.host = hostname() + "-OTHER";
    if (fault === "unlinked") owner.nonce = randomUUID();
    if (["active", "foreign", "unlinked"].includes(fault)) await writeFile(path, JSON.stringify(owner));
    if (fault === "invalid") await writeFile(path, "PRIVATE_OWNER");
    if (fault === "absent") await unlink(path);
    if (fault === "ambiguous") { const intent = JSON.parse(await readFile(join(directory, "closure-abort-" + abort.operationId + ".intent.json"), "utf8"));
      intent.operationId = randomUUID(); await writeFile(join(directory, "closure-abort-" + intent.operationId + ".intent.json"), JSON.stringify(intent)); }
    if (fault === "maintenance") await writeFile(join(directory, "publish-maintenance.lock"), "{}");
    if (fault === "recovery") await writeFile(join(directory, "publish-recovery.lock"), "{}");
    if (fault === "legacy") { const intentPath = join(directory, closureNames("resumption", close.operationId).intent), value = JSON.parse(await readFile(intentPath, "utf8"));
      value.schemaVersion = 1; delete value.recoverySha256; await writeFile(intentPath, JSON.stringify(value)); }
    const before = await snapshot(directory); assert.equal((await inspectClosureAbortContinuation(directory)).eligible, false);
    await assert.rejects(prepareClosureAbortContinuation(directory)); assert.deepEqual(await snapshot(directory), before);
  });
});

const cuts = ["claimed", "own-intent", "source-archived", "source-removed", "abort-receipt", "before-release"];
const cutCode = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';" +
  "const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};" +
  "const link=fs.link;fs.link=async(...a)=>{await link(...a);if(process.argv[3]==='claimed'&&a[0].endsWith('publish-finalization.lock')||" +
    "process.argv[3]==='source-archived'&&a[0].endsWith('publish-recovery.lock'))await pause();};" +
  "const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();await unlink(...a);" +
    "if(process.argv[3]==='source-removed'&&a[0].endsWith('publish-recovery.lock'))await pause();};" +
  "const open=fs.open;fs.open=async(...a)=>{const h=await open(...a);if(a[1]==='wx'&&(process.argv[3]==='own-intent'&&a[0].includes('closure-abort-continuation-')&&a[0].endsWith('.intent.json')||" +
    "process.argv[3]==='abort-receipt'&&a[0].includes('closure-abort-')&&!a[0].includes('continuation-')&&a[0].endsWith('.json')&&!a[0].endsWith('.intent.json')))" +
    "{const close=h.close.bind(h);h.close=async()=>{await close();await pause();};}return h;};" +
  "syncBuiltinESMExports();const{continueClosureAbort}=await import(" + JSON.stringify(module) + ");await continueClosureAbort(process.argv[1],JSON.parse(process.argv[2]));";
async function othersBlocked(directory, original, abort, proposal) {
  await assert.rejects(acquirePublicationLock(directory));
  await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
  await assert.rejects(applyRecoveryReconciliation(directory, original));
  for (const [apply, decision] of [[resumeRecoveryReconciliation, "resume-local-reconciliation"], [finalizeMaintenance, "archive-completed-maintenance"],
    [finalizeResumptionGuard, "archive-completed-resumption"], [resumeClosure, "resume-local-closure"], [continueRecoveryResumption, "continue-local-resumption"],
    [continueReconciliationAbort, "continue-local-reconciliation-abort"], [continueResumptionAbort, "continue-local-resumption-abort"]])
    await assert.rejects(apply(directory, { ...original, operationId: randomUUID(), decision }));
  await assert.rejects(abortInterruptedClosure(directory, abort));
  await assert.rejects(abortRecoveryResumption(directory, { ...original, operationId: randomUUID(), decision: "abort-local-resumption", reason: "Fixture" }));
  await assert.rejects(abortRecoveryReconciliation(directory, { ...original, operationId: randomUUID(), decision: "abort-local-reconciliation", reason: "Fixture" }));
  await assert.rejects(continueClosureAbort(directory, reviewFor(proposal)));
}

test("seis cortes por tipo mantienen finalización y excluyen trece herramientas incluso con cinco controles ocupados", async () => {
  for (const kind of kinds) for (const cut of cuts) await temporary(async directory => {
    const { original, close, abort } = await interruptedClosureAbort(directory, kind, "intent-only", "intent-only", true);
    const proposal = await prepareClosureAbortContinuation(directory), review = reviewFor(proposal), names = closureNames(kind, close.operationId);
    if (kind === "resumption") for (const name of ["publish.lock", "publish-maintenance.lock", "publish-recovery.lock", "publish-resume.lock", "publish-finalization.lock"]) await access(join(directory, name));
    await pauseChild(cutCode, [directory, JSON.stringify(review), cut], async (_, stop) => {
      const status = await inspectRecoveryStatus(directory); assert.equal(status.finalization.state, "inactive"); assert.equal(status.coordinationClear, false);
      assert.equal(status.closureAborts.completed.length, Number(cut === "before-release")); await othersBlocked(directory, original, abort, proposal);
      await stop(); const before = await snapshot(directory); await assert.rejects(prepareClosureAbortContinuation(directory));
      if (cut === "before-release") assert.equal((await continueClosureAbort(directory, review)).replayed, true);
      else await assert.rejects(continueClosureAbort(directory, review));
      assert.deepEqual(await snapshot(directory), before); await assert.rejects(access(join(directory, names.receipt)));
      if (cut !== "before-release") {
        for (const name of ["publish.lock", "publish-maintenance.lock", "publish-recovery.lock", "publish-resume.lock", "publish-finalization.lock"])
          if ((await readdir(directory)).includes(name)) await unlink(join(directory, name));
        const lost = await inspectRecoveryStatus(directory); assert.equal(lost.status, "needs-review"); assert.ok(lost.closureAbortContinuations.pending.length);
        for (const prepare of prepares) await assert.rejects(prepare(directory));
      }
    });
  });
});

test("recibo de cancelación v1 previo sigue reconocido si la nueva auditoría parcial pierde controles", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { abort } = await interruptedClosureAbort(directory, kind, "completed-before-release", "source-removed");
    const path = join(directory, "closure-abort-" + abort.operationId + ".json"), raw = await readFile(path, "utf8"), review = reviewFor(await prepareClosureAbortContinuation(directory));
    await pauseChild(cutCode, [directory, JSON.stringify(review), "own-intent"], async (_, stop) => stop());
    for (const name of ["publish-finalization.lock", "publish-maintenance.lock"]) if ((await readdir(directory)).includes(name)) await unlink(join(directory, name));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.closureAborts.completed.length, 1);
    assert.equal(status.closureAbortContinuations.pending.length, 1); assert.equal(await readFile(path, "utf8"), raw);
    for (const prepare of prepares) await assert.rejects(prepare(directory));
  });
});

test("sustituciones durante archivo conservan controles y rechazan resultado", async () => {
  const faults = ["gate", "claim", "source", "archive", "own-intent", "old-intent", "closure-source", "closure-archive", "original-receipt", "maintenance", "pointer", "record"];
  for (let index = 0; index < faults.length; index++) await temporary(async directory => {
    const kind = kinds[index % 2], fault = faults[index], { original, close, abort } = await interruptedClosureAbort(directory, kind, "intent-only", "source-archived");
    const review = reviewFor(await prepareClosureAbortContinuation(directory)), names = closureNames(kind, close.operationId);
    const record = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")).replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json");
    const targets = { gate: "publish-finalization.lock", claim: "publish-continued-closure-abort-finalization-" + abort.operationId + ".lock",
      source: "publish-recovery.lock", archive: "publish-aborted-closure-recovery-" + abort.operationId + ".lock",
      "own-intent": "closure-abort-continuation-" + review.operationId + ".intent.json", "old-intent": "closure-abort-" + abort.operationId + ".intent.json",
      "closure-source": names.source, "closure-archive": names.archive, "original-receipt": "recovery-reconciliation-" + original.operationId + ".json",
      maintenance: "publish-maintenance.lock", pointer: "current-release.json", record };
    const code = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';" +
      "const link=fs.link;fs.link=async(...a)=>{await link(...a);if(a[0].endsWith('publish-recovery.lock'))await fs.writeFile(join(process.argv[1],process.argv[3]),'PRIVATE_REPLACEMENT');};" +
      "syncBuiltinESMExports();const{continueClosureAbort}=await import(" + JSON.stringify(module) + ");try{await continueClosureAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), targets[fault]], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr); await access(join(directory, "publish-finalization.lock"));
    assert.equal((await inspectRecoveryStatus(directory)).closureAbortContinuations.completed.length, 0);
    await assert.rejects(access(join(directory, "closure-abort-continuation-" + review.operationId + ".json")));
  });
});

test("fallo al escribir auditoría mantiene cancelación v2 pendiente y finalización intacta", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { abort } = await interruptedClosureAbort(directory, kind, "source-removed"), review = reviewFor(await prepareClosureAbortContinuation(directory));
    const code = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';" +
      "const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].includes('closure-abort-continuation-')&&!a[0].endsWith('.intent.json'))throw Error('PRIVATE_IO');return open(...a);};" +
      "syncBuiltinESMExports();const{continueClosureAbort}=await import(" + JSON.stringify(module) + ");try{await continueClosureAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
    const status = await inspectRecoveryStatus(directory); assert.equal(status.finalization.state, "inactive"); assert.equal(status.closureAbortContinuations.pending.length, 1);
    assert.equal(status.closureAborts.completed.length, 0); assert.equal(status.closureAborts.pending.length, 1);
    assert.equal(JSON.parse(await readFile(join(directory, "closure-abort-" + abort.operationId + ".json"), "utf8")).schemaVersion, 2);
  });
});

test("rechazo de admisión anterior al intento de intención libera únicamente reserva propia intacta", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosureAbort(directory, kind, "source-removed"); const review = reviewFor(await prepareClosureAbortContinuation(directory)), before = await snapshot(directory);
    const code = "import crypto from'node:crypto';import{syncBuiltinESMExports}from'node:module';crypto.randomUUID=()=>{throw Error('PRIVATE_ADMISSION');};syncBuiltinESMExports();" +
      "const{continueClosureAbort}=await import(" + JSON.stringify(module) + ");try{await continueClosureAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("alteración posterior de archivo recibo vínculo origen o recibo de cierre invalida diagnóstico y replay", async () => {
  const faults = ["claim", "receipt", "intent", "old-receipt", "borrowed-link", "original-receipt", "closure-receipt", "closure-archive"];
  for (let index = 0; index < faults.length; index++) await temporary(async directory => {
    const kind = kinds[index % 2], fault = faults[index], { original, close, abort } = await interruptedClosureAbort(directory, kind, "source-removed", "source-archived");
    const review = reviewFor(await prepareClosureAbortContinuation(directory)); await continueClosureAbort(directory, review); const names = closureNames(kind, close.operationId);
    const targets = { claim: "publish-continued-closure-abort-finalization-" + abort.operationId + ".lock", receipt: "closure-abort-continuation-" + review.operationId + ".json",
      intent: "closure-abort-continuation-" + review.operationId + ".intent.json", "old-receipt": "closure-abort-" + abort.operationId + ".json",
      "borrowed-link": "closure-abort-" + abort.operationId + ".json", "original-receipt": "recovery-reconciliation-" + original.operationId + ".json",
      "closure-receipt": names.receipt, "closure-archive": names.archive };
    if (fault === "borrowed-link") { const receipt = JSON.parse(await readFile(join(directory, targets[fault]), "utf8")); receipt.abortContinuationId = randomUUID(); await writeFile(join(directory, targets[fault]), JSON.stringify(receipt)); }
    else await writeFile(join(directory, targets[fault]), "PRIVATE_ALTERED");
    const before = await snapshot(directory); assert.equal((await inspectRecoveryStatus(directory)).closureAbortContinuations.completed.length, 0);
    await assert.rejects(continueClosureAbort(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("dos auditorías completas del mismo recibo v1 son ambiguas sin invalidar cancelación histórica", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosureAbort(directory, kind, "completed-before-release"); const review = reviewFor(await prepareClosureAbortContinuation(directory)); await continueClosureAbort(directory, review);
    const id = randomUUID(), intent = JSON.parse(await readFile(join(directory, "closure-abort-continuation-" + review.operationId + ".intent.json"), "utf8")); intent.operationId = id;
    const raw = JSON.stringify(intent), receipt = JSON.parse(await readFile(join(directory, "closure-abort-continuation-" + review.operationId + ".json"), "utf8")); receipt.operationId = id; receipt.intentSha256 = hash(raw);
    await writeFile(join(directory, "closure-abort-continuation-" + id + ".intent.json"), raw); await writeFile(join(directory, "closure-abort-continuation-" + id + ".json"), JSON.stringify(receipt));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.closureAbortContinuations.completed.length, 0); assert.equal(status.closureAbortContinuations.pending.length, 2);
    assert.ok(status.closureAbortContinuations.pending.every(item => item.issue === "ambiguous-closure-abort-continuation"));
    assert.equal(status.closureAborts.completed.length, 1); await assert.rejects(continueClosureAbort(directory, review));
  });
});

test("reserva todos los destinos dentro del límite600 y no trunca historial", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosureAbort(directory, kind, "intent-only", "intent-only", false, async directory => {
      const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")), raw = await readFile(join(directory, name)), owner = JSON.parse(raw), writes = [];
      for (let count = (await evidenceNames(directory)).length; count < 600; count += 2) {
        const id = randomUUID(); writes.push(writeFile(join(directory, "publish-orphan-" + id + ".lock"), raw), writeFile(join(directory, "lock-recovery-" + id + ".json"),
          JSON.stringify({ owner: { ...owner, sha256: hash(raw), active: false }, reviewer: "Fixture límite", decision: "recover-local-lock", createdAt: new Date().toISOString() })));
      }
      await Promise.all(writes);
    });
    const before = await snapshot(directory); assert.equal((await inspectClosureAbortContinuation(directory)).stage, "history-limit");
    await assert.rejects(prepareClosureAbortContinuation(directory)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("CLI observa sin mutar y reemplaza éxito anterior por resultado no confirmado sin valores privados", () => temporary(async directory => {
  await interruptedClosureAbort(directory, "resumption", "source-removed"); const before = await snapshot(directory), path = join(artifacts, "web-closure-abort-continuation-result.json");
  await writeFile(path, JSON.stringify({ continued: true }));
  const failure = spawnSync(process.execPath, [cli, "--apply", "--directory=" + directory, "--review=PRIVATE_MISSING_REVIEW"], { encoding: "utf8", windowsHide: true });
  assert.equal(failure.status, 1); assert.ok(!failure.stderr.includes("PRIVATE_")); const result = JSON.parse(await readFile(path, "utf8")); assert.equal(result.resultConfirmed, false); assert.equal(result.continued, undefined);
  for (const mode of ["--inspect", "--plan"]) { const result = spawnSync(process.execPath, [cli, mode, "--directory=" + directory], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr); }
  for (const args of [["--inspect", "--plan"], ["--plan", "--directory="], ["--inspect", "--review=PRIVATE_REVIEW"], ["--inspect", "--unexpected"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 1); assert.ok(!result.stderr.includes("PRIVATE_"));
  }
  assert.deepEqual(await snapshot(directory), before);
}));

test("cierre sucesor nuevamente interrumpido conserva cancelación v2 y continúa con su herramienta independiente", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { close } = await interruptedClosureAbort(directory, kind, "source-removed", "source-archived");
    const review = reviewFor(await prepareClosureAbortContinuation(directory)); await continueClosureAbort(directory, review);
    const proposal = kind === "maintenance" ? await prepareMaintenanceReview(directory) : await prepareResumptionGuardReview(directory), successor = closureFor(proposal, kind);
    const nextModule = new URL(kind === "maintenance" ? "../maintenance-review.mjs" : "../resumption-guard-review.mjs", import.meta.url).href;
    const code = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';const link=fs.link;fs.link=async(...a)=>{await link(...a);process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};" +
      "syncBuiltinESMExports();const m=await import(" + JSON.stringify(nextModule) + ");await m[" + JSON.stringify(kind === "maintenance" ? "finalizeMaintenance" : "finalizeResumptionGuard") + "](process.argv[1],JSON.parse(process.argv[2]));";
    await pauseChild(code, [directory, JSON.stringify(successor)], async (_, stop) => stop());
    const status = await inspectRecoveryStatus(directory); assert.equal(status.closureAborts.completed.length, 1); assert.equal(status.closureAbortContinuations.completed.length, 1);
    assert.equal(status.status, "needs-review"); const before = await snapshot(directory);
    assert.equal((await continueClosureAbort(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), before);
    const plan = await prepareClosureResumption(directory); assert.equal(plan.plan.closureId, successor.operationId);
    await resumeClosure(directory, { operationId: randomUUID(), decision: "resume-local-closure", reviewer: "Fixture continuación sucesora", planSha256: plan.planSha256 });
    await closeResidual(directory, kind); assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    await assert.rejects(access(join(directory, closureNames(kind, close.operationId).receipt)));
  });
});
