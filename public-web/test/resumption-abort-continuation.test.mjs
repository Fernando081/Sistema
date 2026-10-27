import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectResumptionAbortContinuation, prepareResumptionAbortContinuation, continueResumptionAbort } from "../resumption-abort-continuation.mjs";
import { inspectRecoveryStatus, evidenceNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock } from "../publication-lock.mjs";
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
import { temporary, snapshot, pauseChild, interruptedResumptionAbort } from "./support/closure-fixtures.mjs";

const module = new URL("../resumption-abort-continuation.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../resumption-abort-continuation.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const stages = ["intent-only", "source-archived", "source-removed", "completed-before-release"];
const resumeStages = ["intent-only", "guard-archived", "guard-removed", "reconciliation-completed"];
const reviewFor = proposal => ({ operationId: randomUUID(), decision: "continue-local-resumption-abort", reviewer: "Fixture continuación PRIVATE_REVIEWER", planSha256: proposal.planSha256 });
const resumeFor = plan => ({ operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture nueva reanudación", planSha256: plan.planSha256 });
const closeFor = plan => ({ operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture cierre independiente", planSha256: plan.planSha256 });
const prepares = [prepareRecoveryReconciliation, prepareRecoveryResumption, prepareMaintenanceReview, prepareResumptionGuardReview,
  prepareClosureResumption, prepareClosureAbort, prepareResumptionContinuation, prepareResumptionAbort, prepareReconciliationAbort, prepareReconciliationAbortContinuation];

test("dieciséis combinaciones conservan recibos y decisión; no crean éxito original ni retiran mantenimiento o recuperación", async () => {
  for (const resumeStage of resumeStages) for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const { original, resume, abort } = await interruptedResumptionAbort(directory, stage, resumeStage), before = await snapshot(directory);
    const proposal = await prepareResumptionAbortContinuation(directory);
    assert.equal(proposal.stage, stage); assert.equal(proposal.eligible, true); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_"));
    assert.deepEqual(await snapshot(directory), before);
    const review = reviewFor(proposal), result = await continueResumptionAbort(directory, review), after = await snapshot(directory);
    assert.equal(result.continued, true); assert.equal(result.replayed, false); assert.equal(result.abortId, abort.operationId);
    for (const [name, raw] of Object.entries(before)) {
      if (name === "publish-finalization.lock") assert.equal(after[`publish-continued-resumption-abort-finalization-${abort.operationId}.lock`], raw);
      else if (name === "publish-resume.lock") assert.equal(after[`publish-aborted-resume-${abort.operationId}.lock`], raw);
      else assert.equal(after[name], raw, name);
    }
    for (const name of ["publish-resume.lock", "publish-finalization.lock", `reconciliation-resume-${resume.operationId}.json`]) await assert.rejects(access(join(directory, name)));
    const receipt = JSON.parse(await readFile(join(directory, `resumption-abort-${abort.operationId}.json`), "utf8"));
    assert.equal(receipt.schemaVersion, stage === "completed-before-release" ? 1 : 2); assert.equal(receipt.outcome, "aborted");
    if (receipt.schemaVersion === 2) assert.equal(receipt.abortContinuationId, review.operationId);
    const status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive");
    assert.equal(status.resumptions.completed.length, 0); assert.equal(status.resumptions.aborted[0].operationId, resume.operationId);
    assert.equal(status.resumptionAbortContinuations.completed[0].operationId, review.operationId); assert.equal(status.resumptionAborts.completed[0].operationId, abort.operationId);
    if (resumeStage === "reconciliation-completed") {
      assert.equal(status.reconciliations.completed[0].operationId, original.operationId); assert.equal(status.reconciliations.completed[0].completionEvidence, "preserved-reconciliation-receipt");
    } else {
      await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`))); assert.equal(status.reconciliations.pending[0].operationId, original.operationId);
    }
    assert.equal((await continueResumptionAbort(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), after);
    assert.equal((await abortRecoveryResumption(directory, abort)).replayed, true); assert.deepEqual(await snapshot(directory), after);
    await assert.rejects(resumeRecoveryReconciliation(directory, resume));
  });
});

test("origen pendiente continúa por revisión nueva y cierre separado; historial y puntero posterior conservan replay", async () => {
  for (const resumeStage of resumeStages) await temporary(async directory => {
    const { original, abort } = await interruptedResumptionAbort(directory, "source-removed", resumeStage);
    const review = reviewFor(await prepareResumptionAbortContinuation(directory)); await continueResumptionAbort(directory, review);
    if (resumeStage !== "reconciliation-completed") await resumeRecoveryReconciliation(directory, resumeFor(await prepareRecoveryResumption(directory)));
    await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
    assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const before = await snapshot(directory); assert.equal((await continueResumptionAbort(directory, review)).replayed, true);
    assert.equal((await abortRecoveryResumption(directory, abort)).replayed, true); assert.deepEqual(await snapshot(directory), before);
    assert.equal((await inspectRecoveryStatus(directory)).reconciliations.completed[0].operationId, original.operationId);
  });
});

test("publicación residual queda intacta para recuperación ordinaria independiente", () => temporary(async directory => {
  await interruptedResumptionAbort(directory, "source-removed", "guard-removed", true); const before = await snapshot(directory);
  await continueResumptionAbort(directory, reviewFor(await prepareResumptionAbortContinuation(directory)));
  assert.equal((await snapshot(directory))["publish.lock"], before["publish.lock"]); assert.equal((await inspectRecoveryStatus(directory)).publication.state, "inactive");
}));

test("concurrencia con IDs distintos comparte un solo destino exclusivo por cancelación", () => temporary(async directory => {
  const { abort } = await interruptedResumptionAbort(directory, "intent-only"), proposal = await prepareResumptionAbortContinuation(directory);
  const reviews = [reviewFor(proposal), reviewFor(proposal), reviewFor(proposal)], results = await Promise.allSettled(reviews.map(review => continueResumptionAbort(directory, review)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const status = await inspectRecoveryStatus(directory); assert.equal(status.resumptionAbortContinuations.completed.length, 1); assert.equal(status.resumptionAbortContinuations.pending.length, 0);
  assert.equal((await readdir(directory)).filter(name => name.startsWith("publish-continued-resumption-abort-finalization-")).length, 1);
  const winner = reviews[results.findIndex(result => result.status === "fulfilled")], before = await snapshot(directory);
  await assert.rejects(continueResumptionAbort(directory, { ...winner, reviewer: "Otro responsable" })); assert.deepEqual(await snapshot(directory), before);
  assert.equal(status.resumptionAborts.completed[0].operationId, abort.operationId);
}));

test("revisiones mal formadas IDs originales cambios previos y trasplante se rechazan sin mutar", async () => {
  for (const kind of ["review", "abort-id", "resume-id", "original-id", "pointer", "old-intent", "source", "archive", "original-receipt", "history", "directory", "lost-source", "receipt"]) await temporary(async directory => {
    const { original, resume, abort } = await interruptedResumptionAbort(directory, "source-archived", "reconciliation-completed");
    const proposal = await prepareResumptionAbortContinuation(directory), review = reviewFor(proposal);
    if (kind === "review") review.extra = "PRIVATE_EXTRA";
    if (kind === "abort-id") review.operationId = abort.operationId;
    if (kind === "resume-id") review.operationId = resume.operationId;
    if (kind === "original-id") review.operationId = original.operationId;
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), "{}");
    if (kind === "old-intent") await writeFile(join(directory, `resumption-abort-${abort.operationId}.intent.json`), "PRIVATE_INTENT");
    if (kind === "source") await writeFile(join(directory, "publish-resume.lock"), "PRIVATE_SOURCE");
    if (kind === "archive") await writeFile(join(directory, `publish-aborted-resume-${abort.operationId}.lock`), "PRIVATE_ARCHIVE");
    if (kind === "original-receipt") await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.json`), "PRIVATE_RECEIPT");
    if (kind === "history") await writeFile(join(directory, `resumption-abort-continuation-${randomUUID()}.intent.json`), "{}");
    if (kind === "lost-source") await unlink(join(directory, "publish-resume.lock"));
    if (kind === "receipt") await writeFile(join(directory, `resumption-abort-${abort.operationId}.json`), "{}");
    if (kind === "directory") await temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(continueResumptionAbort(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    else { const before = await snapshot(directory); await assert.rejects(continueResumptionAbort(directory, review)); assert.deepEqual(await snapshot(directory), before, kind); }
  });
});

test("guardas activas extranjeras inválidas ausentes o sin vínculo e intenciones ambiguas requieren revisión", async () => {
  for (const kind of ["active", "foreign", "invalid", "absent", "unlinked", "ambiguous", "maintenance", "recovery"]) await temporary(async directory => {
    const { abort } = await interruptedResumptionAbort(directory, "source-removed"), path = join(directory, "publish-finalization.lock"), owner = JSON.parse(await readFile(path, "utf8"));
    if (kind === "active") owner.pid = process.pid;
    if (kind === "foreign") owner.host = hostname() + "-OTHER";
    if (kind === "unlinked") owner.nonce = randomUUID();
    if (["active", "foreign", "unlinked"].includes(kind)) await writeFile(path, JSON.stringify(owner));
    if (kind === "invalid") await writeFile(path, "PRIVATE_OWNER");
    if (kind === "absent") await unlink(path);
    if (kind === "ambiguous") { const intent = JSON.parse(await readFile(join(directory, `resumption-abort-${abort.operationId}.intent.json`), "utf8")); intent.operationId = randomUUID(); await writeFile(join(directory, `resumption-abort-${intent.operationId}.intent.json`), JSON.stringify(intent)); }
    if (kind === "maintenance") await writeFile(join(directory, "publish-maintenance.lock"), "{}");
    if (kind === "recovery") await writeFile(join(directory, "publish-recovery.lock"), "{}");
    const before = await snapshot(directory); assert.equal((await inspectResumptionAbortContinuation(directory)).eligible, false);
    await assert.rejects(prepareResumptionAbortContinuation(directory)); assert.deepEqual(await snapshot(directory), before);
  });
});

const cuts = ["claimed", "own-intent", "source-archived", "source-removed", "abort-receipt", "before-release"];
const cutCode = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
  const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
  const link=fs.link;fs.link=async(...a)=>{await link(...a);if(process.argv[3]==='claimed'&&a[0].endsWith('publish-finalization.lock')||
    process.argv[3]==='source-archived'&&a[0].endsWith('publish-resume.lock'))await pause();};
  const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();await unlink(...a);
    if(process.argv[3]==='source-removed'&&a[0].endsWith('publish-resume.lock'))await pause();};
  const open=fs.open;fs.open=async(...a)=>{const h=await open(...a);if(a[1]==='wx'&&(process.argv[3]==='own-intent'&&a[0].includes('resumption-abort-continuation-')&&a[0].endsWith('.intent.json')||
    process.argv[3]==='abort-receipt'&&a[0].includes('resumption-abort-')&&!a[0].includes('continuation-')&&a[0].endsWith('.json')&&!a[0].endsWith('.intent.json'))){const close=h.close.bind(h);h.close=async()=>{await close();await pause();};}return h;};
  syncBuiltinESMExports();const{continueResumptionAbort}=await import(${JSON.stringify(module)});await continueResumptionAbort(process.argv[1],JSON.parse(process.argv[2]));`;
async function othersBlocked(directory, original, abort, proposal) {
  await assert.rejects(acquirePublicationLock(directory));
  await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
  await assert.rejects(applyRecoveryReconciliation(directory, original));
  for (const [apply, decision] of [[resumeRecoveryReconciliation, "resume-local-reconciliation"], [finalizeMaintenance, "archive-completed-maintenance"],
    [finalizeResumptionGuard, "archive-completed-resumption"], [resumeClosure, "resume-local-closure"], [abortInterruptedClosure, "abort-local-closure"],
    [continueRecoveryResumption, "continue-local-resumption"], [continueReconciliationAbort, "continue-local-reconciliation-abort"]])
    await assert.rejects(apply(directory, { ...original, operationId: randomUUID(), decision, ...(apply === abortInterruptedClosure ? { reason: "Fixture" } : {}) }));
  await assert.rejects(abortRecoveryResumption(directory, abort));
  await assert.rejects(abortRecoveryReconciliation(directory, { ...original, operationId: randomUUID(), decision: "abort-local-reconciliation", reason: "Fixture" }));
  await assert.rejects(continueResumptionAbort(directory, reviewFor(proposal)));
}

test("seis cortes conservan finalización y excluyen doce herramientas incluso con cinco controles ocupados", async () => {
  for (const cut of cuts) await temporary(async directory => {
    const { original, resume, abort } = await interruptedResumptionAbort(directory, "intent-only", "intent-only", true);
    const proposal = await prepareResumptionAbortContinuation(directory), review = reviewFor(proposal);
    await pauseChild(cutCode, [directory, JSON.stringify(review), cut], async (_, stop) => {
      const status = await inspectRecoveryStatus(directory); assert.equal(status.finalization.state, "inactive"); assert.equal(status.coordinationClear, false);
      assert.equal(status.resumptionAborts.completed.length, Number(cut === "before-release"));
      await othersBlocked(directory, original, abort, proposal);
      await stop(); const before = await snapshot(directory);
      await assert.rejects(prepareResumptionAbortContinuation(directory));
      if (cut === "before-release") { assert.equal((await continueResumptionAbort(directory, review)).replayed, true); }
      else await assert.rejects(continueResumptionAbort(directory, review));
      assert.deepEqual(await snapshot(directory), before);
      await assert.rejects(access(join(directory, `reconciliation-resume-${resume.operationId}.json`)));
      if (cut !== "before-release") {
        for (const name of ["publish.lock", "publish-maintenance.lock", "publish-recovery.lock", "publish-resume.lock", "publish-finalization.lock"])
          if ((await readdir(directory)).includes(name)) await unlink(join(directory, name));
        const lost = await inspectRecoveryStatus(directory); assert.equal(lost.status, "needs-review"); assert.ok(lost.resumptionAbortContinuations.pending.length);
        for (const prepare of prepares) await assert.rejects(prepare(directory));
      }
    });
  });
});

test("recibo v1 previo sigue cancelado cuando la nueva auditoría parcial pierde controles", () => temporary(async directory => {
  const { abort } = await interruptedResumptionAbort(directory, "completed-before-release", "reconciliation-completed");
  const path = join(directory, `resumption-abort-${abort.operationId}.json`), receipt = await readFile(path, "utf8");
  const review = reviewFor(await prepareResumptionAbortContinuation(directory));
  await pauseChild(cutCode, [directory, JSON.stringify(review), "own-intent"], async (_, stop) => stop());
  await unlink(join(directory, "publish-finalization.lock")); await unlink(join(directory, "publish-maintenance.lock"));
  const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.resumptionAborts.completed.length, 1);
  assert.equal(status.resumptionAbortContinuations.pending.length, 1); assert.equal(await readFile(path, "utf8"), receipt);
  for (const prepare of prepares) await assert.rejects(prepare(directory));
}));

test("sustituciones entre archivo y retirada conservan controles sin certificar resultado", async () => {
  for (const kind of ["gate", "claim", "source", "archive", "own-intent", "old-intent", "recovery", "maintenance", "pointer", "record"]) await temporary(async directory => {
    const { abort } = await interruptedResumptionAbort(directory, "intent-only"), review = reviewFor(await prepareResumptionAbortContinuation(directory));
    const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")), record = name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json");
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;fs.link=async(...a)=>{await link(...a);if(!a[0].endsWith('publish-resume.lock'))return;const k=process.argv[3],id=JSON.parse(process.argv[2]).operationId,abort=process.argv[4];
        const target=k==='gate'?'publish-finalization.lock':k==='claim'?'publish-continued-resumption-abort-finalization-'+abort+'.lock':k==='source'?'publish-resume.lock':
          k==='archive'?'publish-aborted-resume-'+abort+'.lock':k==='own-intent'?'resumption-abort-continuation-'+id+'.intent.json':k==='old-intent'?'resumption-abort-'+abort+'.intent.json':
          k==='recovery'?'publish-recovery.lock':k==='maintenance'?'publish-maintenance.lock':k==='record'?process.argv[5]:'current-release.json';await fs.writeFile(join(process.argv[1],target),'PRIVATE_REPLACEMENT');};
      syncBuiltinESMExports();const{continueResumptionAbort}=await import(${JSON.stringify(module)});try{await continueResumptionAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, abort.operationId, record], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr); await access(join(directory, "publish-finalization.lock"));
    assert.equal((await inspectRecoveryStatus(directory)).resumptionAbortContinuations.completed.length, 0);
    await assert.rejects(access(join(directory, `resumption-abort-continuation-${review.operationId}.json`)));
  });
});

test("fallo al escribir auditoría no confirma recibo v2 aislado y mantiene finalización y archivo", () => temporary(async directory => {
  const { abort } = await interruptedResumptionAbort(directory, "source-removed"), review = reviewFor(await prepareResumptionAbortContinuation(directory));
  const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].includes('resumption-abort-continuation-')&&!a[0].endsWith('.intent.json'))throw Error('PRIVATE_IO');return open(...a);};
    syncBuiltinESMExports();const{continueResumptionAbort}=await import(${JSON.stringify(module)});try{await continueResumptionAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
  const status = await inspectRecoveryStatus(directory); assert.equal(status.finalization.state, "inactive"); assert.equal(status.resumptionAbortContinuations.pending.length, 1);
  assert.equal(status.resumptionAborts.completed.length, 0); assert.equal(status.resumptionAborts.pending.length, 1);
  assert.equal(JSON.parse(await readFile(join(directory, `resumption-abort-${abort.operationId}.json`), "utf8")).schemaVersion, 2);
}));

test("rechazo antes de intentar intención libera sólo su archivo propio intacto", () => temporary(async directory => {
  await interruptedResumptionAbort(directory, "source-removed"); const review = reviewFor(await prepareResumptionAbortContinuation(directory)), before = await snapshot(directory);
  const code = `import crypto from'node:crypto';import{syncBuiltinESMExports}from'node:module';crypto.randomUUID=()=>{throw Error('PRIVATE_ADMISSION');};syncBuiltinESMExports();
    const{continueResumptionAbort}=await import(${JSON.stringify(module)});try{await continueResumptionAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(await snapshot(directory), before);
}));

test("alteración posterior de archivo recibo vínculo u origen invalida diagnóstico y replay", async () => {
  for (const kind of ["claim", "receipt", "intent", "old-receipt", "borrowed-link", "original-receipt", "resume-receipt"]) await temporary(async directory => {
    const { original, resume, abort } = await interruptedResumptionAbort(directory, "source-removed", "reconciliation-completed"), review = reviewFor(await prepareResumptionAbortContinuation(directory));
    await continueResumptionAbort(directory, review);
    const target = kind === "claim" ? `publish-continued-resumption-abort-finalization-${abort.operationId}.lock` : kind === "receipt" ? `resumption-abort-continuation-${review.operationId}.json` :
      kind === "intent" ? `resumption-abort-continuation-${review.operationId}.intent.json` : kind === "old-receipt" || kind === "borrowed-link" ? `resumption-abort-${abort.operationId}.json` :
      kind === "original-receipt" ? `recovery-reconciliation-${original.operationId}.json` : `reconciliation-resume-${resume.operationId}.json`;
    if (kind === "borrowed-link") { const receipt = JSON.parse(await readFile(join(directory, target), "utf8")); receipt.abortContinuationId = randomUUID(); await writeFile(join(directory, target), JSON.stringify(receipt)); }
    else await writeFile(join(directory, target), "PRIVATE_ALTERED");
    const before = await snapshot(directory); assert.equal((await inspectRecoveryStatus(directory)).resumptionAbortContinuations.completed.length, 0);
    await assert.rejects(continueResumptionAbort(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("dos auditorías válidas de un mismo recibo v1 son ambiguas y no eligen revisor", () => temporary(async directory => {
  await interruptedResumptionAbort(directory, "completed-before-release"); const review = reviewFor(await prepareResumptionAbortContinuation(directory));
  await continueResumptionAbort(directory, review);
  const id = randomUUID(), intent = JSON.parse(await readFile(join(directory, `resumption-abort-continuation-${review.operationId}.intent.json`), "utf8")); intent.operationId = id;
  const raw = JSON.stringify(intent), receipt = JSON.parse(await readFile(join(directory, `resumption-abort-continuation-${review.operationId}.json`), "utf8")); receipt.operationId = id; receipt.intentSha256 = hash(raw);
  await writeFile(join(directory, `resumption-abort-continuation-${id}.intent.json`), raw); await writeFile(join(directory, `resumption-abort-continuation-${id}.json`), JSON.stringify(receipt));
  const status = await inspectRecoveryStatus(directory); assert.equal(status.resumptionAbortContinuations.completed.length, 0); assert.equal(status.resumptionAbortContinuations.pending.length, 2);
  assert.ok(status.resumptionAbortContinuations.pending.every(item => item.issue === "ambiguous-resumption-abort-continuation"));
  assert.equal(status.resumptionAborts.completed.length, 1); await assert.rejects(continueResumptionAbort(directory, review));
}));

test("reserva todos los destinos bajo límite600 y no trunca historial", () => temporary(async directory => {
  await interruptedResumptionAbort(directory, "intent-only", "intent-only", false, async directory => {
    const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")), raw = await readFile(join(directory, name)), owner = JSON.parse(raw), writes = [];
    for (let count = (await evidenceNames(directory)).length; count < 600; count += 2) {
      const id = randomUUID(); writes.push(writeFile(join(directory, `publish-orphan-${id}.lock`), raw), writeFile(join(directory, `lock-recovery-${id}.json`),
        JSON.stringify({ owner: { ...owner, sha256: hash(raw), active: false }, reviewer: "Fixture límite", decision: "recover-local-lock", createdAt: new Date().toISOString() })));
    }
    await Promise.all(writes);
  });
  const before = await snapshot(directory); assert.equal((await inspectResumptionAbortContinuation(directory)).stage, "history-limit");
  await assert.rejects(prepareResumptionAbortContinuation(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("CLI sólo observa al preparar y reemplaza éxito previo por resultado incierto sin datos privados", () => temporary(async directory => {
  await interruptedResumptionAbort(directory, "source-removed"); const before = await snapshot(directory), path = join(artifacts, "web-resumption-abort-continuation-result.json");
  await writeFile(path, JSON.stringify({ continued: true }));
  const failure = spawnSync(process.execPath, [cli, "--apply", `--directory=${directory}`, "--review=PRIVATE_MISSING_REVIEW"], { encoding: "utf8", windowsHide: true });
  assert.equal(failure.status, 1); assert.ok(!failure.stderr.includes("PRIVATE_")); const result = JSON.parse(await readFile(path, "utf8")); assert.equal(result.resultConfirmed, false); assert.equal(result.continued, undefined);
  for (const mode of ["--inspect", "--plan"]) { const result = spawnSync(process.execPath, [cli, mode, `--directory=${directory}`], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr); }
  for (const args of [["--inspect", "--plan"], ["--plan", "--directory="], ["--inspect", "--review=PRIVATE_REVIEW"], ["--inspect", "--unexpected"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 1); assert.ok(!result.stderr.includes("PRIVATE_"));
  }
  assert.deepEqual(await snapshot(directory), before);
}));
