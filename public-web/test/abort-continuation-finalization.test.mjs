import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectAbortContinuationFinalization, prepareAbortContinuationFinalization, finalizeAbortContinuation } from "../abort-continuation-finalization.mjs";
import { inspectRecoveryStatus, evidenceNames, abortContinuationNames, closureNames } from "../recovery-status.mjs";
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
import { prepareClosureAbortContinuation, continueClosureAbort } from "../closure-abort-continuation.mjs";
import { temporary, snapshot, pauseChild, residualAbortContinuation, interruptedResumptionAbort } from "./support/closure-fixtures.mjs";

const module = new URL("../abort-continuation-finalization.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../abort-continuation-finalization.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const kinds = ["reconciliation", "resumption", "closure"];
const hash = raw => createHash("sha256").update(raw).digest("hex");
const reviewFor = proposal => ({ operationId: randomUUID(), decision: "finalize-completed-abort-continuation", reviewer: "Fixture cierre PRIVATE_REVIEWER", planSha256: proposal.planSha256 });
const prepares = [prepareRecoveryReconciliation, prepareRecoveryResumption, prepareMaintenanceReview, prepareResumptionGuardReview,
  prepareClosureResumption, prepareClosureAbort, prepareResumptionContinuation, prepareResumptionAbort, prepareReconciliationAbort,
  prepareReconciliationAbortContinuation, prepareResumptionAbortContinuation, prepareClosureAbortContinuation];
const variants = [];
for (const priorReceipt of [false, true]) {
  for (const originalStage of ["intent-only", "guard-archived", "guard-removed"]) variants.push({ kind: "reconciliation", priorReceipt, originalStage });
  for (const resumeStage of ["intent-only", "guard-archived", "guard-removed", "reconciliation-completed"]) variants.push({ kind: "resumption", priorReceipt, resumeStage });
  for (const closureKind of ["maintenance", "resumption"]) for (const closureStage of ["intent-only", "source-archived", "source-removed"])
    variants.push({ kind: "closure", priorReceipt, closureKind, closureStage });
}
async function independentResolution(directory, kind, fixture) {
  if (kind === "resumption" && (await inspectRecoveryStatus(directory)).reconciliations.pending.length) {
    const proposal = await prepareRecoveryResumption(directory);
    await resumeRecoveryReconciliation(directory, { operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture origen independiente", planSha256: proposal.planSha256 });
  }
  if (kind === "closure" && (await readdir(directory)).includes("publish-resume.lock")) {
    const proposal = await prepareResumptionGuardReview(directory);
    await finalizeResumptionGuard(directory, { operationId: randomUUID(), decision: "archive-completed-resumption", reviewer: "Fixture cierre independiente", planSha256: proposal.planSha256 });
  }
  if ((await readdir(directory)).includes("publish-maintenance.lock")) {
    const proposal = await prepareMaintenanceReview(directory);
    await finalizeMaintenance(directory, { operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture mantenimiento separado", planSha256: proposal.planSha256 });
  }
  if ((await readdir(directory)).includes("publish.lock")) {
    const owner = await inspectPublicationLock(directory); await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture publicación independiente", sha256: owner.sha256 });
  }
  const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "ready"); assert.equal(status.abortContinuationFinalizations.completed.length, 1);
  const originalNames = abortContinuationNames(kind, fixture.continuation.operationId, fixture.abort.operationId);
  assert.equal(status[originalNames.summary].completed.length, 1);
}

test("veintiséis contextos válidos cierran sólo el control residual y conservan bytes, recibos y decisiones", async () => {
  assert.equal(variants.length, 26);
  for (const options of variants) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    const fixture = await residualAbortContinuation(directory, options.kind, options), before = await snapshot(directory);
    const proposal = await prepareAbortContinuationFinalization(directory); assert.equal(proposal.plan.continuationKind, options.kind);
    assert.equal(proposal.plan.residualControl, fixture.control); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_")); assert.deepEqual(await snapshot(directory), before);
    const review = reviewFor(proposal), result = await finalizeAbortContinuation(directory, review), after = await snapshot(directory);
    assert.equal(result.finalized, true); assert.equal(result.replayed, false);
    for (const [name, raw] of Object.entries(before)) {
      if (name === fixture.control) assert.equal(after["publish-completed-abort-continuation-control-" + review.operationId + ".lock"], raw);
      else assert.equal(after[name], raw, name);
    }
    await assert.rejects(access(join(directory, fixture.control))); await assert.rejects(access(join(directory, proposal.plan.coordinationControl)));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.abortContinuationFinalizations.completed[0].operationId, review.operationId);
    assert.equal(status.abortContinuationFinalizations.pending.length, 0);
    assert.equal((await finalizeAbortContinuation(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), after);
    await independentResolution(directory, options.kind, fixture);
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const historical = await snapshot(directory); assert.equal((await finalizeAbortContinuation(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), historical);
  });
});

test("campos exactos y UUID nuevos rechazan reutilizar cualquiera de los IDs originales sin mutar", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const fixture = await residualAbortContinuation(directory, kind), proposal = await prepareAbortContinuationFinalization(directory), before = await snapshot(directory);
    const patches = [{ operationId: fixture.original.operationId }, { operationId: fixture.abort.operationId }, { operationId: fixture.continuation.operationId },
      { operationId: randomUUID().toUpperCase() }, { reviewer: "" }, { reviewer: "a\n" }, { reviewer: "a".repeat(101) }, { decision: "continue-local-closure-abort" },
      { planSha256: "a".repeat(64) }, { private: "PRIVATE_EXTRA" }];
    if (fixture.resume) patches.push({ operationId: fixture.resume.operationId }); if (fixture.close) patches.push({ operationId: fixture.close.operationId });
    for (const patch of patches) { await assert.rejects(finalizeAbortContinuation(directory, { ...reviewFor(proposal), ...patch })); assert.deepEqual(await snapshot(directory), before); }
  });
});

test("recibos originales, puntero, historia, fuentes independientes y trasplante desactualizan revisión", async () => {
  const faults = ["pointer", "continuation-intent", "continuation-receipt", "abort-intent", "abort-receipt", "source", "maintenance", "history", "directory"];
  for (let index = 0; index < faults.length; index++) await temporary(async directory => {
    const kind = kinds[index % 3], fixture = await residualAbortContinuation(directory, kind), proposal = await prepareAbortContinuationFinalization(directory), review = reviewFor(proposal);
    const names = abortContinuationNames(kind, fixture.continuation.operationId, fixture.abort.operationId), fault = faults[index];
    const targets = { pointer: "current-release.json", "continuation-intent": names.intent, "continuation-receipt": names.receipt,
      "abort-intent": names.abortIntent, "abort-receipt": names.abortReceipt, source: fixture.control, maintenance: "publish-maintenance.lock",
      history: "abort-continuation-finalization-" + randomUUID() + ".intent.json" };
    if (targets[fault]) await writeFile(join(directory, targets[fault]), "PRIVATE_CHANGED");
    if (fault === "directory") await temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(finalizeAbortContinuation(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    else { const before = await snapshot(directory); await assert.rejects(finalizeAbortContinuation(directory, review)); assert.deepEqual(await snapshot(directory), before); }
  });
});

test("controles activos ajenos antiguos ausentes sin vínculo o coordinación ocupada requieren revisión", async () => {
  const faults = ["active", "foreign", "legacy", "absent", "unlinked", "busy", "missing-audit", "unrelated-pending"];
  for (const kind of kinds) for (const fault of faults) await temporary(async directory => {
    const fixture = await residualAbortContinuation(directory, kind), names = abortContinuationNames(kind, fixture.continuation.operationId, fixture.abort.operationId);
    const path = join(directory, fixture.control), owner = JSON.parse(await readFile(path, "utf8"));
    if (fault === "active") owner.pid = process.pid;
    if (fault === "foreign") owner.host += "-FOREIGN";
    if (fault === "unlinked") owner.nonce = randomUUID();
    if (["active", "foreign", "unlinked"].includes(fault)) await writeFile(path, JSON.stringify(owner));
    if (fault === "legacy") await writeFile(path, "{}");
    if (fault === "absent") await unlink(path);
    if (fault === "busy") await writeFile(join(directory, names.coordinationControl), JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() }));
    if (fault === "missing-audit") await unlink(join(directory, names.receipt));
    if (fault === "unrelated-pending") await writeFile(join(directory, "closure-abort-continuation-" + randomUUID() + ".intent.json"), "{}");
    const before = await snapshot(directory); assert.equal((await inspectAbortContinuationFinalization(directory)).eligible, false);
    await assert.rejects(prepareAbortContinuationFinalization(directory)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("propietario declarado ajeno en continuación completa conserva historia pero rechaza intervención local", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const fixture = await residualAbortContinuation(directory, kind, { priorReceipt: true }), names = abortContinuationNames(kind, fixture.continuation.operationId, fixture.abort.operationId);
    const intent = JSON.parse(await readFile(join(directory, names.intent), "utf8"));
    if (kind === "reconciliation") {
      const owner = JSON.parse(await readFile(join(directory, fixture.control), "utf8")); owner.host += "-FOREIGN"; const raw = JSON.stringify(owner);
      await writeFile(join(directory, fixture.control), raw); intent.resumptionSha256 = hash(raw);
    } else intent.claimOwner.host += "-FOREIGN";
    const raw = JSON.stringify(intent); await writeFile(join(directory, names.intent), raw);
    const receipt = JSON.parse(await readFile(join(directory, names.receipt), "utf8")); receipt.intentSha256 = hash(raw);
    await writeFile(join(directory, names.receipt), JSON.stringify(receipt));
    assert.equal((await inspectRecoveryStatus(directory))[names.summary].completed.length, 1);
    assert.equal((await inspectAbortContinuationFinalization(directory)).stage, "continuation-worker-foreign");
    await assert.rejects(prepareAbortContinuationFinalization(directory));
  });
});

const cuts = ["guard-only", "own-intent", "control-archived", "control-removed", "before-release"];
const cutCode = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';" +
  "const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};" +
  "const link=fs.link;fs.link=async(...a)=>{await link(...a);if(process.argv[3]==='control-archived')await pause();};" +
  "const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='before-release'&&a[0].endsWith(process.argv[5]))await pause();await unlink(...a);" +
    "if(process.argv[3]==='control-removed'&&a[0].endsWith(process.argv[4]))await pause();};" +
  "const open=fs.open;fs.open=async(...a)=>{const h=await open(...a);if(a[1]==='wx'&&process.argv[3]==='guard-only'&&a[0].endsWith(process.argv[5])){" +
    "const sync=h.sync.bind(h);h.sync=async()=>{await sync();await pause();};}" +
    "if(a[1]==='wx'&&process.argv[3]==='own-intent'&&a[0].includes('abort-continuation-finalization-')&&a[0].endsWith('.intent.json')){" +
    "const close=h.close.bind(h);h.close=async()=>{await close();await pause();};}return h;};" +
  "syncBuiltinESMExports();const{finalizeAbortContinuation}=await import(" + JSON.stringify(module) + ");await finalizeAbortContinuation(process.argv[1],JSON.parse(process.argv[2]));";
async function othersBlocked(directory, fixture, proposal) {
  await assert.rejects(acquirePublicationLock(directory));
  await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
  await assert.rejects(applyRecoveryReconciliation(directory, fixture.original));
  for (const [apply, decision, reason] of [[resumeRecoveryReconciliation, "resume-local-reconciliation"], [finalizeMaintenance, "archive-completed-maintenance"],
    [finalizeResumptionGuard, "archive-completed-resumption"], [resumeClosure, "resume-local-closure"], [continueRecoveryResumption, "continue-local-resumption"],
    [continueReconciliationAbort, "continue-local-reconciliation-abort"], [continueResumptionAbort, "continue-local-resumption-abort"],
    [continueClosureAbort, "continue-local-closure-abort"], [abortInterruptedClosure, "abort-local-closure", "Fixture"],
    [abortRecoveryResumption, "abort-local-resumption", "Fixture"], [abortRecoveryReconciliation, "abort-local-reconciliation", "Fixture"]])
    await assert.rejects(apply(directory, { ...fixture.original, operationId: randomUUID(), decision, ...(reason ? { reason } : {}) }));
  await assert.rejects(finalizeAbortContinuation(directory, reviewFor(proposal)));
}

test("cinco cortes por tipo excluyen catorce herramientas y no certifican cierres parciales", async () => {
  for (const kind of kinds) for (const cut of cuts) await temporary(async directory => {
    const fixture = await residualAbortContinuation(directory, kind), proposal = await prepareAbortContinuationFinalization(directory), review = reviewFor(proposal);
    await pauseChild(cutCode, [directory, JSON.stringify(review), cut, proposal.plan.residualControl, proposal.plan.coordinationControl], async (_, stop) => {
      const status = await inspectRecoveryStatus(directory); assert.equal(status.coordinationClear, false);
      assert.equal(status.abortContinuationFinalizations.completed.length, Number(cut === "before-release")); await othersBlocked(directory, fixture, proposal);
      await stop(); const before = await snapshot(directory); await assert.rejects(prepareAbortContinuationFinalization(directory));
      if (cut === "before-release") assert.equal((await finalizeAbortContinuation(directory, review)).replayed, true);
      else await assert.rejects(finalizeAbortContinuation(directory, review));
      assert.deepEqual(await snapshot(directory), before);
      if (!["guard-only", "before-release"].includes(cut)) {
        for (const name of ["publish.lock", "publish-maintenance.lock", "publish-recovery.lock", "publish-resume.lock", "publish-finalization.lock"])
          if ((await readdir(directory)).includes(name)) await unlink(join(directory, name));
        const lost = await inspectRecoveryStatus(directory); assert.equal(lost.status, "needs-review"); assert.equal(lost.abortContinuationFinalizations.pending.length, 1);
        for (const prepare of prepares) await assert.rejects(prepare(directory));
      }
    });
  });
});

test("sustituciones durante archivo preservan control propio y evitan certificar resultado", async () => {
  const faults = ["guard", "source", "archive", "intent", "continuation-receipt", "abort-receipt", "pointer", "history"];
  for (let index = 0; index < faults.length; index++) await temporary(async directory => {
    const kind = kinds[index % 3], fixture = await residualAbortContinuation(directory, kind), proposal = await prepareAbortContinuationFinalization(directory), review = reviewFor(proposal);
    const names = abortContinuationNames(kind, fixture.continuation.operationId, fixture.abort.operationId);
    const targets = { guard: proposal.plan.coordinationControl, source: proposal.plan.residualControl, archive: "publish-completed-abort-continuation-control-" + review.operationId + ".lock",
      intent: "abort-continuation-finalization-" + review.operationId + ".intent.json", "continuation-receipt": names.receipt, "abort-receipt": names.abortReceipt,
      pointer: "current-release.json", history: "abort-continuation-finalization-" + randomUUID() + ".intent.json" };
    const code = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';const link=fs.link;fs.link=async(...a)=>{await link(...a);await fs.writeFile(join(process.argv[1],process.argv[3]),'PRIVATE_REPLACEMENT');};" +
      "syncBuiltinESMExports();const{finalizeAbortContinuation}=await import(" + JSON.stringify(module) + ");try{await finalizeAbortContinuation(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), targets[faults[index]]], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr); await access(join(directory, proposal.plan.coordinationControl));
    assert.equal((await inspectRecoveryStatus(directory)).abortContinuationFinalizations.completed.length, 0);
    await assert.rejects(access(join(directory, "abort-continuation-finalization-" + review.operationId + ".json")));
  });
});

test("fallo de recibo después de retirar control conserva intención archivo y guarda con resultado pendiente", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await residualAbortContinuation(directory, kind); const proposal = await prepareAbortContinuationFinalization(directory), review = reviewFor(proposal);
    const code = "import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].includes('abort-continuation-finalization-')&&!a[0].endsWith('.intent.json'))throw Error('PRIVATE_IO');return open(...a);};" +
      "syncBuiltinESMExports();const{finalizeAbortContinuation}=await import(" + JSON.stringify(module) + ");try{await finalizeAbortContinuation(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
    const status = await inspectRecoveryStatus(directory); assert.equal(status.abortContinuationFinalizations.pending.length, 1); assert.equal(status.abortContinuationFinalizations.completed.length, 0);
    await access(join(directory, proposal.plan.coordinationControl)); await access(join(directory, "publish-completed-abort-continuation-control-" + review.operationId + ".lock"));
    await assert.rejects(access(join(directory, proposal.plan.residualControl)));
  });
});

test("resolución de admisión inválida no crea intención y libera sólo su control nuevo intacto", () => temporary(async directory => {
  const fixture = await residualAbortContinuation(directory, "closure"), proposal = await prepareAbortContinuationFinalization(directory), before = await snapshot(directory);
  await assert.rejects(finalizeAbortContinuation(directory, { ...reviewFor(proposal), operationId: fixture.original.operationId })); assert.deepEqual(await snapshot(directory), before);
  const code = "import crypto from'node:crypto';import{syncBuiltinESMExports}from'node:module';crypto.randomUUID=()=>{throw Error('PRIVATE_NONCE');};syncBuiltinESMExports();" +
    "const{finalizeAbortContinuation}=await import(" + JSON.stringify(module) + ");try{await finalizeAbortContinuation(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(reviewFor(proposal))], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(await snapshot(directory), before);
}));

test("alteración posterior de auditoría recibo archivo o enlace histórico invalida diagnóstico y replay", async () => {
  const faults = ["intent", "receipt", "archive", "continuation-receipt", "abort-receipt", "borrowed-link"];
  for (let index = 0; index < faults.length; index++) await temporary(async directory => {
    const kind = kinds[index % 3], fixture = await residualAbortContinuation(directory, kind), review = reviewFor(await prepareAbortContinuationFinalization(directory));
    await finalizeAbortContinuation(directory, review); const names = abortContinuationNames(kind, fixture.continuation.operationId, fixture.abort.operationId);
    const targets = { intent: "abort-continuation-finalization-" + review.operationId + ".intent.json", receipt: "abort-continuation-finalization-" + review.operationId + ".json",
      archive: "publish-completed-abort-continuation-control-" + review.operationId + ".lock", "continuation-receipt": names.receipt, "abort-receipt": names.abortReceipt,
      "borrowed-link": "abort-continuation-finalization-" + review.operationId + ".intent.json" };
    if (faults[index] === "borrowed-link") {
      const value = JSON.parse(await readFile(join(directory, targets["borrowed-link"]), "utf8")); value.plan.continuationId = randomUUID();
      await writeFile(join(directory, targets["borrowed-link"]), JSON.stringify(value));
    } else await writeFile(join(directory, targets[faults[index]]), "PRIVATE_ALTERED");
    const before = await snapshot(directory); assert.equal((await inspectRecoveryStatus(directory)).abortContinuationFinalizations.completed.length, 0);
    await assert.rejects(finalizeAbortContinuation(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("dos cierres completos del mismo origen son ambiguos y un archivo huérfano bloquea ready", () => temporary(async directory => {
  await residualAbortContinuation(directory, "reconciliation"); const review = reviewFor(await prepareAbortContinuationFinalization(directory));
  await finalizeAbortContinuation(directory, review); const id = randomUUID();
  const intent = JSON.parse(await readFile(join(directory, "abort-continuation-finalization-" + review.operationId + ".intent.json"), "utf8")); intent.operationId = id;
  const raw = JSON.stringify(intent), receipt = JSON.parse(await readFile(join(directory, "abort-continuation-finalization-" + review.operationId + ".json"), "utf8")); receipt.operationId = id; receipt.intentSha256 = hash(raw);
  await writeFile(join(directory, "abort-continuation-finalization-" + id + ".intent.json"), raw); await writeFile(join(directory, "abort-continuation-finalization-" + id + ".json"), JSON.stringify(receipt));
  await writeFile(join(directory, "publish-completed-abort-continuation-control-" + id + ".lock"), await readFile(join(directory, "publish-completed-abort-continuation-control-" + review.operationId + ".lock")));
  const status = await inspectRecoveryStatus(directory); assert.equal(status.abortContinuationFinalizations.completed.length, 0); assert.equal(status.abortContinuationFinalizations.pending.length, 2);
  assert.ok(status.abortContinuationFinalizations.pending.every(item => item.issue === "ambiguous-abort-continuation-finalization"));
  await assert.rejects(finalizeAbortContinuation(directory, review));
  await unlink(join(directory, "abort-continuation-finalization-" + id + ".intent.json")); await unlink(join(directory, "abort-continuation-finalization-" + id + ".json"));
  const orphan = await inspectRecoveryStatus(directory); assert.equal(orphan.status, "needs-review"); assert.equal(orphan.abortContinuationFinalizations.pending.length, 1);
  for (const prepare of prepares) await assert.rejects(prepare(directory));
}));

test("límite de historial reserva tres destinos y rechaza saturación sin truncar", () => temporary(async directory => {
  await residualAbortContinuation(directory, "reconciliation", { beforeAbort: async directory => {
    const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")), raw = await readFile(join(directory, name)), owner = JSON.parse(raw), writes = [];
    for (let count = (await evidenceNames(directory)).length; count < 596; count += 2) {
      const id = randomUUID(); writes.push(writeFile(join(directory, "publish-orphan-" + id + ".lock"), raw), writeFile(join(directory, "lock-recovery-" + id + ".json"),
        JSON.stringify({ owner: { ...owner, sha256: hash(raw), active: false }, reviewer: "Fixture límite", decision: "recover-local-lock", createdAt: new Date().toISOString() })));
    }
    await Promise.all(writes);
  }});
  const before = await snapshot(directory); assert.equal((await inspectAbortContinuationFinalization(directory)).stage, "history-limit");
  await assert.rejects(prepareAbortContinuationFinalization(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("CLI inspección y plan no intervienen; fallo reemplaza éxito anterior sin valores privados", () => temporary(async directory => {
  await residualAbortContinuation(directory, "resumption"); const before = await snapshot(directory), path = join(artifacts, "web-abort-continuation-finalization-result.json");
  await writeFile(path, JSON.stringify({ finalized: true }));
  const result = spawnSync(process.execPath, [cli, "--apply", "--directory=" + directory, "--review=PRIVATE_MISSING"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 1); assert.ok(!result.stderr.includes("PRIVATE_")); assert.equal(JSON.parse(await readFile(path, "utf8")).resultConfirmed, false);
  for (const mode of ["--inspect", "--plan"]) { const result = spawnSync(process.execPath, [cli, mode, "--directory=" + directory], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr); }
  for (const args of [["--inspect", "--plan"], ["--plan", "--directory="], ["--inspect", "--review=PRIVATE_REVIEW"], ["--inspect", "--unexpected"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 1); assert.ok(!result.stderr.includes("PRIVATE_"));
  }
  assert.deepEqual(await snapshot(directory), before);
}));

test("auditoría completa con proceso aún activo rechaza cierre hasta que termina", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await residualAbortContinuation(directory, kind, {}, async (_, stop) => {
      const before = await snapshot(directory), proposal = await inspectAbortContinuationFinalization(directory);
      assert.equal(proposal.eligible, false); assert.equal(proposal.stage, "continuation-worker-active");
      await assert.rejects(prepareAbortContinuationFinalization(directory)); assert.deepEqual(await snapshot(directory), before); await stop();
    });
    assert.equal((await prepareAbortContinuationFinalization(directory)).eligible, true);
  });
});

test("concurrencia con IDs distintos admite un cierre y replay no retira una guarda posterior", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await residualAbortContinuation(directory, kind); const proposal = await prepareAbortContinuationFinalization(directory), reviews = Array.from({ length: 3 }, () => reviewFor(proposal));
    const results = await Promise.allSettled(reviews.map(review => finalizeAbortContinuation(directory, review))); assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const index = results.findIndex(result => result.status === "fulfilled"), review = reviews[index], status = await inspectRecoveryStatus(directory);
    assert.equal(status.abortContinuationFinalizations.completed.length, 1); assert.equal(status.abortContinuationFinalizations.pending.length, 0);
    await writeFile(join(directory, proposal.plan.coordinationControl), JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() }));
    const before = await snapshot(directory); assert.equal((await finalizeAbortContinuation(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), before);
    await assert.rejects(finalizeAbortContinuation(directory, { ...review, reviewer: "Revisor distinto" }));
  });
});
