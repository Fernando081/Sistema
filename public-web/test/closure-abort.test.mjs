import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectClosureAbort, prepareClosureAbort, abortInterruptedClosure } from "../closure-abort.mjs";
import { inspectRecoveryStatus, closureNames, evidenceNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock, inspectPublicationLock } from "../publication-lock.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { inspectResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { inspectResumptionGuard, prepareResumptionGuardReview, finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { inspectMaintenance, prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { inspectClosureResumption, prepareClosureResumption, resumeClosure } from "../closure-resumption.mjs";
import { inspectReconciliationAbort, abortRecoveryReconciliation } from "../reconciliation-abort.mjs";
import { inspectResumptionContinuation, continueRecoveryResumption } from "../resumption-continuation.mjs";
import { inspectResumptionAbort, abortRecoveryResumption } from "../resumption-abort.mjs";
import { temporary, snapshot, pauseChild, interruptedClosure } from "./support/closure-fixtures.mjs";

const moduleUrl = new URL("../closure-abort.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../closure-abort.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const kinds = ["maintenance", "resumption"], stages = ["intent-only", "source-archived", "source-removed"];
const reviewFor = plan => ({ operationId: randomUUID(), decision: "abort-local-closure", reviewer: "Fixture revisión actual", reason: "PRIVATE_REASON cancelación separada", planSha256: plan.planSha256 });
const continuationFor = plan => ({ operationId: randomUUID(), decision: "resume-local-closure", reviewer: "Fixture continuación separada", planSha256: plan.planSha256 });
const closeFor = (plan, kind = "maintenance") => ({ operationId: randomUUID(), decision: closureNames(kind, "unused").decision, reviewer: "Fixture cierre separado", planSha256: plan.planSha256 });
const summaryFor = (status, kind) => kind === "maintenance" ? status.maintenanceReviews : status.resumptionReviews;
async function closeResidual(directory, kind) {
  const source = closureNames(kind, "unused").source;
  if ((await readdir(directory)).includes(source)) {
    const plan = kind === "maintenance" ? await prepareMaintenanceReview(directory) : await prepareResumptionGuardReview(directory);
    await (kind === "maintenance" ? finalizeMaintenance : finalizeResumptionGuard)(directory, closeFor(plan, kind));
  }
  if (kind === "resumption") await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
}

test("cancela seis casos sin crear recibo de cierre, conserva origen y permite revisión nueva de bloques residuales", async () => {
  for (const kind of kinds) for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const { original, close } = await interruptedClosure(directory, kind, stage), before = await snapshot(directory), names = closureNames(kind, close.operationId);
    const plan = await prepareClosureAbort(directory), review = reviewFor(plan); assert.equal(plan.stage, stage); assert.equal(plan.closureKind, kind);
    assert.equal((await inspectClosureAbort(directory)).eligible, true); assert.deepEqual(await snapshot(directory), before); assert.ok(!JSON.stringify(plan).includes("PRIVATE_"));
    const result = await abortInterruptedClosure(directory, review), after = await snapshot(directory);
    assert.equal(result.aborted, true); assert.equal(result.replayed, false); assert.equal(result.closureId, close.operationId);
    for (const [name, bytes] of Object.entries(before)) {
      if (name === "publish-recovery.lock") assert.equal(after[`publish-aborted-closure-recovery-${review.operationId}.lock`], bytes);
      else assert.equal(after[name], bytes, name);
    }
    await assert.rejects(access(join(directory, "publish-recovery.lock"))); await assert.rejects(access(join(directory, "publish-finalization.lock")));
    await assert.rejects(access(join(directory, names.receipt)));
    const status = await inspectRecoveryStatus(directory), summary = summaryFor(status, kind);
    assert.equal(status.closureAborts.completed.length, 1); assert.equal(status.closureAborts.pending.length, 0);
    assert.equal(summary.aborted[0].operationId, close.operationId); assert.equal(summary.aborted[0].abortId, review.operationId);
    assert.equal(summary.completed.length, 0); assert.equal(summary.pending.length, 0);
    assert.equal(status.reconciliations.completed[0].operationId, original.operationId); assert.ok(!JSON.stringify(status).includes("PRIVATE_REASON"));
    assert.equal(status.status, kind === "maintenance" && stage === "source-removed" ? "ready" : "needs-review");
    await assert.rejects((kind === "maintenance" ? finalizeMaintenance : finalizeResumptionGuard)(directory, close));
    await assert.rejects(resumeClosure(directory, continuationFor({ planSha256: "a".repeat(64) }))); assert.deepEqual(await snapshot(directory), after);
    await closeResidual(directory, kind); assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    assert.equal((await inspectRecoveryStatus(directory)).closureAborts.completed.length, 1);
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const historical = await snapshot(directory); assert.equal((await abortInterruptedClosure(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), historical);
  });
});

test("cierre ya terminado usa continuación existente y registros v1 no reciben vínculos inventados", async () => {
  for (const kind of kinds) for (const legacy of [false, true]) await temporary(async directory => {
    const { close } = await interruptedClosure(directory, kind, legacy ? "source-archived" : "completed-before-release"), names = closureNames(kind, close.operationId);
    if (legacy) { const path = join(directory, names.intent), value = JSON.parse(await readFile(path, "utf8")); value.schemaVersion = 1; delete value.recoverySha256; await writeFile(path, JSON.stringify(value)); }
    const before = await snapshot(directory), report = await inspectClosureAbort(directory); assert.equal(report.eligible, false);
    if (!legacy) assert.equal(report.stage, "closure-completed-use-resumption");
    await assert.rejects(prepareClosureAbort(directory)); await assert.rejects(abortInterruptedClosure(directory, reviewFor({ planSha256: "a".repeat(64) }))); assert.deepEqual(await snapshot(directory), before);
    if (!legacy) { await resumeClosure(directory, continuationFor(await prepareClosureResumption(directory))); await closeResidual(directory, kind); assert.equal((await inspectRecoveryStatus(directory)).status, "ready"); }
  });
});

test("publicación residual queda intacta y conserva recuperación ordinaria independiente", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosure(directory, kind, "source-removed", true); const bytes = await readFile(join(directory, "publish.lock"));
    const review = reviewFor(await prepareClosureAbort(directory)); await abortInterruptedClosure(directory, review); assert.deepEqual(await readFile(join(directory, "publish.lock")), bytes);
    await closeResidual(directory, kind); assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    const owner = await inspectPublicationLock(directory); await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture independiente", sha256: owner.sha256 });
    assert.equal((await inspectRecoveryStatus(directory)).status, "ready"); assert.equal((await abortInterruptedClosure(directory, review)).replayed, true);
  });
});

test("guardas ajenas activas corruptas sin vínculo y evidencia divergente o ambigua se rechazan sin mutar", async () => {
  for (const kind of kinds) for (const fault of ["active", "foreign", "invalid", "unlinked", "ambiguous", "source", "archive", "receipt", "origin", "history", "finalization"]) await temporary(async directory => {
    const { original, close } = await interruptedClosure(directory, kind, "source-archived"), names = closureNames(kind, close.operationId);
    if (["active", "foreign", "unlinked"].includes(fault)) {
      const path = join(directory, "publish-recovery.lock"), value = JSON.parse(await readFile(path, "utf8"));
      if (fault === "active") value.pid = process.pid; if (fault === "foreign") value.host = hostname() + "-foreign"; if (fault === "unlinked") value.nonce = randomUUID();
      await writeFile(path, JSON.stringify(value));
    }
    if (fault === "ambiguous") { const value = JSON.parse(await readFile(join(directory, names.intent), "utf8")); value.operationId = randomUUID(); await writeFile(join(directory, closureNames(kind, value.operationId).intent), JSON.stringify(value)); }
    const corrupt = { invalid: "publish-recovery.lock", source: names.source, archive: names.archive, receipt: names.receipt,
      origin: `recovery-reconciliation-${original.operationId}.json`, history: `closure-abort-${randomUUID()}.intent.json`, finalization: "publish-finalization.lock" };
    if (corrupt[fault]) await writeFile(join(directory, corrupt[fault]), "PRIVATE_CORRUPT");
    const before = await snapshot(directory), report = await inspectClosureAbort(directory); assert.equal(report.eligible, false, `${kind}/${fault}`); assert.ok(!JSON.stringify(report).includes("PRIVATE_CORRUPT"));
    await assert.rejects(prepareClosureAbort(directory)); await assert.rejects(abortInterruptedClosure(directory, reviewFor({ planSha256: "a".repeat(64) }))); assert.deepEqual(await snapshot(directory), before);
  });
});

test("revisión exacta exige motivo acotado IDs nuevos y rechaza etapa puntero historial o directorio cambiados", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { original, resume, close } = await interruptedClosure(directory, kind, "source-removed"), names = closureNames(kind, close.operationId);
    const plan = await prepareClosureAbort(directory), baseline = await snapshot(directory);
    const patches = [{ operationId: original.operationId }, { operationId: close.operationId }, { reason: "" }, { reason: "a\n" }, { reason: "a".repeat(501) },
      { reviewer: "" }, { reviewer: "a\n" }, { reviewer: "a".repeat(101) }, { private: "PRIVATE_EXTRA" }, { decision: "resume-local-closure" }, { planSha256: "a".repeat(64) }];
    if (resume) patches.push({ operationId: resume.operationId });
    for (const patch of patches) { await assert.rejects(abortInterruptedClosure(directory, { ...reviewFor(plan), ...patch })); assert.deepEqual(await snapshot(directory), baseline); }
    const pointer = join(directory, "current-release.json"); await writeFile(pointer, JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const changed = await snapshot(directory); await assert.rejects(abortInterruptedClosure(directory, reviewFor(plan))); assert.deepEqual(await snapshot(directory), changed); await unlink(pointer);
    const extra = join(directory, `closure-abort-${randomUUID()}.json`); await writeFile(extra, "{}"); await assert.rejects(abortInterruptedClosure(directory, reviewFor(plan))); await unlink(extra);
    await temporary(async other => { for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(abortInterruptedClosure(other, reviewFor(plan))); assert.deepEqual(await snapshot(other), before); });
    await writeFile(join(directory, names.receipt), JSON.stringify({ schemaVersion: 1, operationId: close.operationId, decision: names.decision, intentSha256: hash(await readFile(join(directory, names.intent))), completedAt: new Date().toISOString() }));
    assert.equal((await inspectClosureAbort(directory)).stage, "closure-completed-use-resumption");
    const after = await snapshot(directory); await assert.rejects(abortInterruptedClosure(directory, reviewFor(plan))); assert.deepEqual(await snapshot(directory), after);
  });
});

test("revisores concurrentes registran una cancelación y motivo o responsable diferente impide replay", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosure(directory, kind, "intent-only"); const plan = await prepareClosureAbort(directory), reviews = [reviewFor(plan), reviewFor(plan)];
    const results = await Promise.allSettled(reviews.map(review => abortInterruptedClosure(directory, review))); assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const review = reviews[results.findIndex(result => result.status === "fulfilled")]; assert.equal((await inspectRecoveryStatus(directory)).closureAborts.completed.length, 1);
    const before = await snapshot(directory); for (const patch of [{ reviewer: "Otro revisor" }, { reason: "Otro motivo" }]) await assert.rejects(abortInterruptedClosure(directory, { ...review, ...patch }));
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("cinco cortes de ambos tipos conservan exclusión de once herramientas y evidencia para revisión manual", async () => {
  for (const kind of kinds) for (const stage of ["before-archive", "after-archive", "after-source", "before-receipt", "before-release"]) await temporary(async directory => {
    await interruptedClosure(directory, kind, "intent-only"); const beforeOriginal = await snapshot(directory), review = reviewFor(await prepareClosureAbort(directory));
    await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const stage=process.argv[3],id=JSON.parse(process.argv[2]).operationId,pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...a)=>{if(stage==='before-archive')await pause();await link(...a);if(stage==='after-archive')await pause();};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(a[0].endsWith('publish-finalization.lock')&&stage==='before-release')await pause();await unlink(...a);if(a[0].endsWith('publish-recovery.lock')&&stage==='after-source')await pause();};
      const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].endsWith('closure-abort-'+id+'.json')&&stage==='before-receipt')await pause();return open(...a);};
      syncBuiltinESMExports();const{abortInterruptedClosure}=await import(${JSON.stringify(moduleUrl)});await abortInterruptedClosure(process.argv[1],JSON.parse(process.argv[2]));`,
      [directory, JSON.stringify(review), stage], async (_, stop) => {
        assert.equal((await inspectRecoveryStatus(directory)).status, "finalizing"); const before = await snapshot(directory), dummy = reviewFor({ planSha256: "a".repeat(64) });
        const base = { operationId: dummy.operationId, reviewer: dummy.reviewer, planSha256: dummy.planSha256 };
        for (const operation of [() => acquirePublicationLock(directory), () => recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }),
          () => applyRecoveryReconciliation(directory, { ...base, decision: "reconcile-local-recovery" }), () => resumeRecoveryReconciliation(directory, { ...base, decision: "resume-local-reconciliation" }),
          () => finalizeMaintenance(directory, { ...base, decision: "archive-completed-maintenance" }), () => finalizeResumptionGuard(directory, { ...base, decision: "archive-completed-resumption" }),
          () => resumeClosure(directory, { ...base, decision: "resume-local-closure" }), () => abortRecoveryReconciliation(directory, { ...dummy, decision: "abort-local-reconciliation" }),
          () => continueRecoveryResumption(directory, { ...base, decision: "continue-local-resumption" }), () => abortRecoveryResumption(directory, { ...dummy, decision: "abort-local-resumption" }),
          () => abortInterruptedClosure(directory, review)]) await assert.rejects(operation());
        assert.deepEqual(await snapshot(directory), before); await stop();
      });
    const status = await inspectRecoveryStatus(directory); assert.equal(status.finalization.state, "inactive"); assert.equal(status.coordinationClear, false);
    assert.equal(status.closureAborts.completed.length, Number(stage === "before-release")); assert.equal(status.closureAborts.pending.length, Number(stage !== "before-release"));
    const after = await snapshot(directory); for (const [name, bytes] of Object.entries(beforeOriginal)) if (name !== "publish-recovery.lock") assert.equal(after[name], bytes);
    await assert.rejects(abortInterruptedClosure(directory, review)); assert.deepEqual(await snapshot(directory), after);
  });
});

test("sustituciones entre pasos conservan guarda sin certificar cancelación de ninguno de los tipos", async () => {
  for (const kind of kinds) for (const fault of ["owner", "recovery", "source", "archive", "pointer", "own-intent", "old-intent", "origin-receipt"]) await temporary(async directory => {
    const { original, close } = await interruptedClosure(directory, kind, "source-archived"), names = closureNames(kind, close.operationId), review = reviewFor(await prepareClosureAbort(directory));
    const paths = { owner: "publish-finalization.lock", recovery: "publish-recovery.lock", source: names.source, archive: names.archive, pointer: "current-release.json",
      "own-intent": `closure-abort-${review.operationId}.intent.json`, "old-intent": names.intent, "origin-receipt": `recovery-reconciliation-${original.operationId}.json` };
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from'node:fs/promises';import{join}from'node:path';import{syncBuiltinESMExports}from'node:module';
      const link=fs.link;fs.link=async(...a)=>{await link(...a);await fs.writeFile(join(process.argv[1],process.argv[3]),'PRIVATE_REPLACEMENT');};
      syncBuiltinESMExports();const{abortInterruptedClosure}=await import(${JSON.stringify(moduleUrl)});try{await abortInterruptedClosure(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{process.exitCode=0;}`,
      directory, JSON.stringify(review), paths[fault]], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); await access(join(directory, "publish-finalization.lock"));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.closureAborts.completed.length, 0); assert.equal(status.coordinationClear, false);
  });
});

test("alteraciones históricas o recibo original agregado invalidan cancelación aun sin guardas", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { original, resume, close } = await interruptedClosure(directory, kind, "source-removed"), names = closureNames(kind, close.operationId), review = reviewFor(await prepareClosureAbort(directory));
    await abortInterruptedClosure(directory, review); await closeResidual(directory, kind); assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    const paths = [`closure-abort-${review.operationId}.intent.json`, `closure-abort-${review.operationId}.json`, `publish-aborted-closure-recovery-${review.operationId}.lock`, names.intent, names.archive,
      `recovery-reconciliation-${original.operationId}.intent.json`, `recovery-reconciliation-${original.operationId}.json`, `publish-recovery-orphan-${original.operationId}.lock`];
    if (resume) paths.push(`reconciliation-resume-${resume.operationId}.intent.json`, `reconciliation-resume-${resume.operationId}.json`);
    for (const name of paths) { const path = join(directory, name), bytes = await readFile(path); await writeFile(path, "{}"); const status = await inspectRecoveryStatus(directory);
      assert.equal(status.status, "needs-review"); assert.equal(status.closureAborts.pending.length, 1); assert.equal(summaryFor(status, kind).aborted.length, 0);
      const before = await snapshot(directory); await assert.rejects(abortInterruptedClosure(directory, review)); assert.deepEqual(await snapshot(directory), before); await writeFile(path, bytes); }
    await writeFile(join(directory, names.receipt), JSON.stringify({ schemaVersion: 1, operationId: close.operationId, decision: names.decision,
      intentSha256: hash(await readFile(join(directory, names.intent))), completedAt: new Date().toISOString() }));
    assert.equal((await inspectRecoveryStatus(directory)).closureAborts.completed.length, 0); await unlink(join(directory, names.receipt));
    assert.equal((await abortInterruptedClosure(directory, review)).replayed, true);
  });
});

test("dos cancelaciones válidas del mismo cierre quedan ambiguas sin seleccionar una", async () => {
  for (const kind of kinds) await temporary(async directory => {
    const { close } = await interruptedClosure(directory, kind, "source-removed"), review = reviewFor(await prepareClosureAbort(directory)); await abortInterruptedClosure(directory, review);
    const id = randomUUID(), intent = JSON.parse(await readFile(join(directory, `closure-abort-${review.operationId}.intent.json`), "utf8")); intent.operationId = id;
    const raw = JSON.stringify(intent), receipt = JSON.parse(await readFile(join(directory, `closure-abort-${review.operationId}.json`), "utf8")); receipt.operationId = id; receipt.intentSha256 = hash(raw);
    await writeFile(join(directory, `closure-abort-${id}.intent.json`), raw); await writeFile(join(directory, `closure-abort-${id}.json`), JSON.stringify(receipt));
    await writeFile(join(directory, `publish-aborted-closure-recovery-${id}.lock`), await readFile(join(directory, `publish-aborted-closure-recovery-${review.operationId}.lock`)));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.closureAborts.completed.length, 0); assert.equal(status.closureAborts.pending.length, 2);
    assert.ok(status.closureAborts.pending.every(item => item.issue === "ambiguous-closure-abort"));
    assert.equal(summaryFor(status, kind).aborted.length, 0); assert.equal(summaryFor(status, kind).pending[0].operationId, close.operationId); assert.notEqual(status.status, "ready");
  });
});

test("reserva tres destinos dentro del límite cuando no caben cinco de continuación sin truncar", () => temporary(async directory => {
  await interruptedClosure(directory, "maintenance", "intent-only");
  const orphan = (await readdir(directory)).find(name => /^publish-orphan-/.test(name)), bytes = await readFile(join(directory, orphan)), owner = JSON.parse(bytes), pairs = [];
  const count = (599 - ((await evidenceNames(directory)).length - 5)) / 2; assert.ok(Number.isInteger(count));
  for (let i = 0; i < count; i++) { const id = randomUUID(); pairs.push(id); await writeFile(join(directory, `publish-orphan-${id}.lock`), bytes);
    await writeFile(join(directory, `lock-recovery-${id}.json`), JSON.stringify({ owner: { ...owner, sha256: hash(bytes), active: false }, reviewer: "Fixture", decision: "recover-local-lock", createdAt: new Date().toISOString() })); }
  assert.equal((await inspectClosureAbort(directory)).stage, "history-limit"); const before = await snapshot(directory);
  await assert.rejects(abortInterruptedClosure(directory, reviewFor({ planSha256: "a".repeat(64) }))); assert.deepEqual(await snapshot(directory), before);
  await unlink(join(directory, `publish-orphan-${pairs[0]}.lock`)); await unlink(join(directory, `lock-recovery-${pairs[0]}.json`));
  assert.equal((await inspectClosureResumption(directory)).stage, "history-limit");
  await abortInterruptedClosure(directory, reviewFor(await prepareClosureAbort(directory))); assert.equal((await evidenceNames(directory)).length, 605);
  assert.equal((await inspectRecoveryStatus(directory)).closureAborts.completed.length, 1);
}));

test("CLI conserva inspección sin mutación y un fallo reemplaza éxito anterior sin valores privados", () => temporary(async directory => {
  await interruptedClosure(directory, "resumption", "source-removed"); const before = await snapshot(directory), run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0); assert.deepEqual(await snapshot(directory), before);
  const review = reviewFor(await prepareClosureAbort(directory)), path = join(directory, "review-private.json"); await writeFile(path, JSON.stringify(review));
  const success = run(["--apply", `--directory=${directory}`, `--review=${path}`]); assert.equal(success.status, 0, success.stderr); assert.ok(!success.stdout.includes("PRIVATE_REASON"));
  await writeFile(path, JSON.stringify({ ...review, reviewer: "PRIVATE_CHANGED_REVIEWER", reason: "PRIVATE_CHANGED_REASON" }));
  const failed = run(["--apply", `--directory=${directory}`, `--review=${path}`]); assert.equal(failed.status, 1); assert.ok(!failed.stderr.includes("PRIVATE_"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-closure-abort-result.json"), "utf8")).resultConfirmed, false);
  for (const args of [["--plan", "--inspect"], ["--inspect", "--unknown"], ["--inspect", "--directory="], ["--inspect", `--directory=${directory}`, `--directory=${directory}`], ["--apply"], ["--plan", `--review=${path}`]]) assert.equal(run(args).status, 1);
}));

test("fallo tras retirar recuperación conserva intención pendiente y bloquea preparaciones aun sin guardas", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosure(directory, kind, "source-removed"); const before = await snapshot(directory), review = reviewFor(await prepareClosureAbort(directory)), reviewPath = join(directory, "review.json"); await writeFile(reviewPath, JSON.stringify(review));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const id=process.argv[4],open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].endsWith('closure-abort-'+id+'.json'))throw new Error('PRIVATE_IO_FAILURE');return open(...a);};
      syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];await import(${JSON.stringify(moduleUrl)});`,
      cli, directory, reviewPath, review.operationId], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 1, result.stderr); assert.ok(!result.stderr.includes("PRIVATE_IO_FAILURE"));
    await assert.rejects(access(join(directory, "publish-recovery.lock"))); await access(join(directory, "publish-finalization.lock"));
    const after = await snapshot(directory); for (const [name, bytes] of Object.entries(before)) if (name !== "publish-recovery.lock") assert.equal(after[name], bytes);
    await unlink(join(directory, "publish-finalization.lock")); if (kind === "resumption") await unlink(join(directory, "publish-maintenance.lock"));
    const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.closureAborts.pending.length, 1); assert.equal(summaryFor(status, kind).aborted.length, 0);
    for (const inspect of [inspectResumption, inspectResumptionGuard, inspectMaintenance, inspectClosureResumption, inspectReconciliationAbort, inspectResumptionContinuation, inspectResumptionAbort, inspectClosureAbort]) {
      const report = await inspect(directory); assert.equal(report.eligible, false); assert.equal(report.stage, "closure-abort-needs-review");
    }
    const preserved = await snapshot(directory); await assert.rejects(prepareRecoveryReconciliation(directory)); await assert.rejects(abortInterruptedClosure(directory, review)); assert.deepEqual(await snapshot(directory), preserved);
    assert.equal(JSON.parse(await readFile(join(artifacts, "web-closure-abort-result.json"), "utf8")).resultConfirmed, false);
  });
});

test("cierre sucesor nuevamente interrumpido conserva cancelación previa y se continúa por revisión separada", async () => {
  for (const kind of kinds) await temporary(async directory => {
    await interruptedClosure(directory, kind, "source-archived"); const review = reviewFor(await prepareClosureAbort(directory)); await abortInterruptedClosure(directory, review);
    const plan = kind === "maintenance" ? await prepareMaintenanceReview(directory) : await prepareResumptionGuardReview(directory), next = closeFor(plan, kind);
    const closeUrl = new URL(kind === "maintenance" ? "../maintenance-review.mjs" : "../resumption-guard-review.mjs", import.meta.url).href;
    await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      fs.link=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};syncBuiltinESMExports();
      const module=await import(${JSON.stringify(closeUrl)});await module[process.argv[3]](process.argv[1],JSON.parse(process.argv[2]));`,
      [directory, JSON.stringify(next), kind === "maintenance" ? "finalizeMaintenance" : "finalizeResumptionGuard"], async (_, stop) => stop());
    let status = await inspectRecoveryStatus(directory); assert.equal(status.closureAborts.completed.length, 1); assert.equal(status.closureAborts.pending.length, 0);
    assert.equal(summaryFor(status, kind).pending[0].operationId, next.operationId); assert.notEqual(status.status, "ready");
    await resumeClosure(directory, continuationFor(await prepareClosureResumption(directory))); await closeResidual(directory, kind);
    status = await inspectRecoveryStatus(directory); assert.equal(status.status, "ready"); assert.equal(status.closureAborts.completed.length, 1);
    assert.equal((await abortInterruptedClosure(directory, review)).replayed, true);
  });
});
