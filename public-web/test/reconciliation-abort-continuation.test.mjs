import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, readdir, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectReconciliationAbortContinuation, prepareReconciliationAbortContinuation, continueReconciliationAbort } from "../reconciliation-abort-continuation.mjs";
import { inspectRecoveryStatus, evidenceNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock } from "../publication-lock.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { prepareRecoveryResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { prepareResumptionGuardReview, finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { prepareClosureResumption, resumeClosure } from "../closure-resumption.mjs";
import { prepareClosureAbort, abortInterruptedClosure as abortClosure } from "../closure-abort.mjs";
import { prepareResumptionContinuation, continueRecoveryResumption as continueResumption } from "../resumption-continuation.mjs";
import { prepareResumptionAbort, abortRecoveryResumption as abortResumption } from "../resumption-abort.mjs";
import { prepareReconciliationAbort, abortRecoveryReconciliation } from "../reconciliation-abort.mjs";
import { temporary, snapshot, pauseChild, interruptedReconciliationAbort, abortStages } from "./support/closure-fixtures.mjs";

const module = new URL("../reconciliation-abort-continuation.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../reconciliation-abort-continuation.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const reviewFor = plan => ({ operationId: randomUUID(), decision: "continue-local-reconciliation-abort", reviewer: "Fixture continuación PRIVATE_REVIEWER", planSha256: plan.planSha256 });
const hash = raw => createHash("sha256").update(raw).digest("hex");
const prepareTools = [prepareRecoveryReconciliation, prepareRecoveryResumption, prepareMaintenanceReview, prepareResumptionGuardReview,
  prepareClosureResumption, prepareClosureAbort, prepareResumptionContinuation, prepareResumptionAbort, prepareReconciliationAbort];
async function othersBlocked(directory, original, abort, review) {
  await assert.rejects(acquirePublicationLock(directory));
  await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
  await assert.rejects(applyRecoveryReconciliation(directory, original));
  for (const [apply, decision] of [[resumeRecoveryReconciliation, "resume-local-reconciliation"], [finalizeMaintenance, "archive-completed-maintenance"],
    [finalizeResumptionGuard, "archive-completed-resumption"], [resumeClosure, "resume-local-closure"], [abortClosure, "abort-local-closure"],
    [continueResumption, "continue-local-resumption"], [abortResumption, "abort-local-resumption"]])
    await assert.rejects(apply(directory, { ...original, operationId: randomUUID(), decision, ...([abortClosure, abortResumption].includes(apply) ? { reason: "Fixture" } : {}) }));
  await assert.rejects(abortRecoveryReconciliation(directory, abort));
  await assert.rejects(continueReconciliationAbort(directory, review));
}

test("continúa las seis etapas desde tres reconciliaciones; preserva bytes y sólo crea recibos faltantes de cancelación", async () => {
  for (const originalStage of ["intent-only", "guard-archived", "guard-removed"]) {
    for (const stage of abortStages.filter(stage => originalStage !== "guard-removed" || !["sources-archived", "recovery-removed"].includes(stage))) await temporary(async directory => {
      await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
      await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
      const { original, abort } = await interruptedReconciliationAbort(directory, stage, originalStage), before = await snapshot(directory);
      const proposal = await prepareReconciliationAbortContinuation(directory);
      assert.equal(proposal.stage, stage); assert.equal(proposal.eligible, true); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_"));
      assert.deepEqual(await snapshot(directory), before);
      const review = reviewFor(proposal), result = await continueReconciliationAbort(directory, review), after = await snapshot(directory);
      assert.equal(result.continued, true); assert.equal(result.replayed, false); assert.equal(result.abortId, abort.operationId);
      for (const [name, raw] of Object.entries(before)) {
        if (name === "publish-finalization.lock") assert.equal(after[`publish-continued-abort-finalization-${review.operationId}.lock`], raw);
        else if (name === "publish-maintenance.lock") assert.equal(after[`publish-aborted-maintenance-${abort.operationId}.lock`], raw);
        else if (name === "publish-recovery.lock") assert.equal(after[`publish-aborted-recovery-${abort.operationId}.lock`], raw);
        else assert.equal(after[name], raw, name);
      }
      const receipt = JSON.parse(await readFile(join(directory, `reconciliation-abort-${abort.operationId}.json`), "utf8"));
      assert.equal(receipt.schemaVersion, stage === "completed-before-release" ? 1 : 2); assert.equal(receipt.outcome, "aborted");
      if (receipt.schemaVersion === 2) assert.equal(receipt.abortContinuationId, review.operationId);
      if (originalStage === "guard-removed") await assert.rejects(access(join(directory, `publish-aborted-recovery-${abort.operationId}.lock`)));
      await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`)));
      for (const name of ["publish-maintenance.lock", "publish-recovery.lock", "publish-finalization.lock", "publish-resume.lock"]) await assert.rejects(access(join(directory, name)));
      const status = await inspectRecoveryStatus(directory);
      assert.equal(status.status, "ready"); assert.equal(status.reconciliations.completed.length, 0);
      assert.equal(status.reconciliations.aborted[0].operationId, original.operationId); assert.equal(status.reconciliationAborts.completed[0].operationId, abort.operationId);
      assert.equal(status.reconciliationAbortContinuations.completed[0].operationId, review.operationId);
      assert.equal(status.archives.acknowledged, 1); assert.equal(status.archives.pending.length, 0);
      assert.equal((await inspectReconciliationAbortContinuation(directory)).stage, "finalization-absent");
      assert.equal((await continueReconciliationAbort(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), after);
      assert.equal((await abortRecoveryReconciliation(directory, abort)).replayed, true); assert.deepEqual(await snapshot(directory), after);
      await assert.rejects(applyRecoveryReconciliation(directory, original)); await assert.rejects(prepareRecoveryResumption(directory));
    });
  }
});

test("conserva publicación residual y requiere su recuperación independiente", () => temporary(async directory => {
  const { original } = await interruptedReconciliationAbort(directory, "maintenance-removed", "intent-only", true);
  const before = await snapshot(directory);
  await continueReconciliationAbort(directory, reviewFor(await prepareReconciliationAbortContinuation(directory)));
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.status, "needs-review"); assert.equal(status.publication.state, "inactive");
  assert.equal((await snapshot(directory))["publish.lock"], before["publish.lock"]); assert.equal(status.reconciliations.aborted[0].operationId, original.operationId);
}));

test("rechaza revisión mal formada, IDs originales, cambios previos, trasplante y secuencias imposibles sin mutar", async () => {
  for (const kind of ["review", "abort-id", "original-id", "pointer", "old-intent", "source", "archive", "record", "history", "directory", "missing-source", "receipt", "regression"]) await temporary(async directory => {
    const { original, abort } = await interruptedReconciliationAbort(directory, "maintenance-archived", "guard-archived");
    const proposal = await prepareReconciliationAbortContinuation(directory), review = reviewFor(proposal);
    if (kind === "review") review.extra = "PRIVATE_EXTRA";
    if (kind === "abort-id") review.operationId = abort.operationId;
    if (kind === "original-id") review.operationId = original.operationId;
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), "{}");
    if (kind === "old-intent") await writeFile(join(directory, `reconciliation-abort-${abort.operationId}.intent.json`), "PRIVATE_INTENT");
    if (kind === "source") await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_SOURCE");
    if (kind === "archive") await writeFile(join(directory, `publish-aborted-maintenance-${abort.operationId}.lock`), "PRIVATE_ARCHIVE");
    if (kind === "record") { const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")); await writeFile(join(directory, name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json")), "{}"); }
    if (kind === "history") await writeFile(join(directory, `reconciliation-abort-continuation-${randomUUID()}.intent.json`), "{}");
    if (kind === "missing-source") await unlink(join(directory, "publish-recovery.lock"));
    if (kind === "receipt") await writeFile(join(directory, `reconciliation-abort-${abort.operationId}.json`), "{}");
    if (kind === "regression") await unlink(join(directory, `publish-aborted-maintenance-${abort.operationId}.lock`));
    if (kind === "directory") await temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(continueReconciliationAbort(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    else { const before = await snapshot(directory); await assert.rejects(continueReconciliationAbort(directory, review)); assert.deepEqual(await snapshot(directory), before, kind); }
  });
});

test("propietario activo, extranjero, inválido, guarda ausente o sin vínculo no son elegibles", async () => {
  for (const kind of ["active", "foreign", "invalid", "absent", "unlinked", "resume"]) await temporary(async directory => {
    await interruptedReconciliationAbort(directory, "maintenance-removed");
    const path = join(directory, "publish-finalization.lock"), owner = JSON.parse(await readFile(path, "utf8"));
    if (kind === "active") owner.pid = process.pid;
    if (kind === "foreign") owner.host = hostname() + "-OTHER";
    if (kind === "unlinked") owner.nonce = randomUUID();
    if (["active", "foreign", "unlinked"].includes(kind)) await writeFile(path, JSON.stringify(owner));
    if (kind === "invalid") await writeFile(path, "PRIVATE_OWNER");
    if (kind === "absent") await unlink(path);
    if (kind === "resume") await writeFile(join(directory, "publish-resume.lock"), "{}");
    const before = await snapshot(directory);
    assert.equal((await inspectReconciliationAbortContinuation(directory)).eligible, false); await assert.rejects(prepareReconciliationAbortContinuation(directory));
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("concurrencia permite una continuación y cambio de revisor impide replay", () => temporary(async directory => {
  await interruptedReconciliationAbort(directory, "recovery-removed"); const plan = await prepareReconciliationAbortContinuation(directory);
  const reviews = [reviewFor(plan), reviewFor(plan)], results = await Promise.allSettled(reviews.map(review => continueReconciliationAbort(directory, review)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); const winner = reviews[results.findIndex(result => result.status === "fulfilled")];
  const before = await snapshot(directory); await assert.rejects(continueReconciliationAbort(directory, { ...winner, reviewer: "Otro" })); assert.deepEqual(await snapshot(directory), before);
}));

const cuts = ["own-intent", "maintenance-archived", "recovery-archived", "recovery-removed", "maintenance-removed", "abort-receipt", "finalization-archived", "finalization-removed", "before-release"];
const cutCode = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
  const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
  const link=fs.link;fs.link=async(...a)=>{await link(...a);const k=process.argv[3];
    if(k==='maintenance-archived'&&a[0].endsWith('publish-maintenance.lock')||k==='recovery-archived'&&a[0].endsWith('publish-recovery.lock')||
      k==='finalization-archived'&&a[0].endsWith('publish-finalization.lock'))await pause();};
  const unlink=fs.unlink;fs.unlink=async(...a)=>{const k=process.argv[3];if(k==='before-release'&&a[0].endsWith('publish-resume.lock'))await pause();await unlink(...a);
    if(k==='recovery-removed'&&a[0].endsWith('publish-recovery.lock')||k==='maintenance-removed'&&a[0].endsWith('publish-maintenance.lock')||
      k==='finalization-removed'&&a[0].endsWith('publish-finalization.lock'))await pause();};
  const open=fs.open;fs.open=async(...a)=>{const h=await open(...a);if(a[1]==='wx'&&(process.argv[3]==='own-intent'&&a[0].includes('reconciliation-abort-continuation-')&&a[0].endsWith('.intent.json')||
    process.argv[3]==='abort-receipt'&&a[0].includes('reconciliation-abort-')&&!a[0].includes('continuation-')&&a[0].endsWith('.json')&&!a[0].endsWith('.intent.json'))){
    const close=h.close.bind(h);h.close=async()=>{await close();await pause();};}return h;};
  syncBuiltinESMExports();const{continueReconciliationAbort}=await import(${JSON.stringify(module)});await continueReconciliationAbort(process.argv[1],JSON.parse(process.argv[2]));`;

test("nueve cortes mantienen exclusión de once herramientas y no certifican un recibo v2 hasta cerrar su auditoría", async () => {
  for (const cut of cuts) await temporary(async directory => {
    const { original, abort } = await interruptedReconciliationAbort(directory, "intent-only"), review = reviewFor(await prepareReconciliationAbortContinuation(directory));
    await pauseChild(cutCode, [directory, JSON.stringify(review), cut], async (_, stop) => {
      const status = await inspectRecoveryStatus(directory);
      assert.equal(status.resumption.state, "active"); assert.equal(status.coordinationClear, false);
      assert.equal(status.reconciliationAborts.completed.length, Number(cut === "before-release"));
      await othersBlocked(directory, original, abort, review);
      await stop();
      const before = await snapshot(directory);
      assert.equal((await inspectRecoveryStatus(directory)).resumption.state, "inactive");
      await assert.rejects(continueReconciliationAbort(directory, review)); await assert.rejects(prepareReconciliationAbortContinuation(directory));
      for (const prepare of prepareTools) await assert.rejects(prepare(directory));
      assert.deepEqual(await snapshot(directory), before); await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`)));
      if (cut !== "before-release") {
        await unlink(join(directory, "publish-resume.lock"));
        if ((await readdir(directory)).includes("publish-finalization.lock")) await unlink(join(directory, "publish-finalization.lock"));
        const lost = await inspectRecoveryStatus(directory);
        assert.equal(lost.status, "needs-review"); assert.equal(lost.reconciliationAbortContinuations.pending.length, 1);
        for (const prepare of prepareTools) await assert.rejects(prepare(directory));
      }
    });
  });
});

test("recibo v1 previo permanece cancelled aunque una nueva auditoría quede parcial y pierda guardas", () => temporary(async directory => {
  const { abort } = await interruptedReconciliationAbort(directory, "completed-before-release");
  const receipt = await readFile(join(directory, `reconciliation-abort-${abort.operationId}.json`), "utf8");
  const review = reviewFor(await prepareReconciliationAbortContinuation(directory));
  await pauseChild(cutCode, [directory, JSON.stringify(review), "finalization-removed"], async (_, stop) => stop());
  await unlink(join(directory, "publish-resume.lock"));
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.status, "needs-review"); assert.equal(status.reconciliationAborts.completed.length, 1); assert.equal(status.reconciliationAbortContinuations.pending.length, 1);
  assert.equal(await readFile(join(directory, `reconciliation-abort-${abort.operationId}.json`), "utf8"), receipt);
  for (const prepare of prepareTools) await assert.rejects(prepare(directory));
}));

test("sustituciones durante continuación conservan evidencia y no confirman éxito", async () => {
  for (const kind of ["owner", "old-guard", "maintenance", "recovery", "old-intent", "own-intent", "archive", "pointer", "record"]) await temporary(async directory => {
    const { abort } = await interruptedReconciliationAbort(directory, "intent-only"), review = reviewFor(await prepareReconciliationAbortContinuation(directory));
    const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
    const record = name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json");
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;fs.link=async(...a)=>{await link(...a);const k=process.argv[3],id=JSON.parse(process.argv[2]).operationId;
        const target=k==='owner'?'publish-resume.lock':k==='old-guard'?'publish-finalization.lock':k==='maintenance'?'publish-maintenance.lock':k==='recovery'?'publish-recovery.lock':
          k==='old-intent'?'reconciliation-abort-'+process.argv[4]+'.intent.json':k==='own-intent'?'reconciliation-abort-continuation-'+id+'.intent.json':
          k==='archive'?'publish-aborted-maintenance-'+process.argv[4]+'.lock':k==='record'?process.argv[5]:'current-release.json';
        await fs.writeFile(join(process.argv[1],target),'PRIVATE_REPLACEMENT');};syncBuiltinESMExports();
      const{continueReconciliationAbort}=await import(${JSON.stringify(module)});try{await continueReconciliationAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, abort.operationId, record], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes("PRIVATE_"));
    assert.ok((await readdir(directory)).includes("publish-resume.lock"));
    assert.equal((await inspectRecoveryStatus(directory)).reconciliationAbortContinuations.completed.length, 0);
    await assert.rejects(access(join(directory, `reconciliation-abort-continuation-${review.operationId}.json`)));
  });
});

test("fallo de IO tras retirar finalización deja resultado incierto, guarda propia y cancelación v2 pendiente", () => temporary(async directory => {
  const { abort } = await interruptedReconciliationAbort(directory, "maintenance-removed"), review = reviewFor(await prepareReconciliationAbortContinuation(directory));
  const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].includes('reconciliation-abort-continuation-')&&!a[0].endsWith('.intent.json'))throw Error('PRIVATE_IO');return open(...a);};
    syncBuiltinESMExports();const{continueReconciliationAbort}=await import(${JSON.stringify(module)});try{await continueReconciliationAbort(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=9;}catch{process.exitCode=0;}`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review)], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.finalization.state, "absent"); assert.equal(status.resumption.state, "inactive");
  assert.equal(status.reconciliationAborts.completed.length, 0); assert.equal(status.reconciliationAborts.pending.length, 1);
  assert.equal(status.reconciliationAbortContinuations.pending.length, 1);
  assert.equal(JSON.parse(await readFile(join(directory, `reconciliation-abort-${abort.operationId}.json`), "utf8")).schemaVersion, 2);
}));

test("alteración posterior de archivos, recibos o vínculos invalida el diagnóstico y el replay", async () => {
  for (const kind of ["archive", "receipt", "old-receipt", "intent", "old-intent", "original-receipt"]) await temporary(async directory => {
    const { original, abort } = await interruptedReconciliationAbort(directory, "maintenance-removed"), review = reviewFor(await prepareReconciliationAbortContinuation(directory));
    await continueReconciliationAbort(directory, review);
    const name = kind === "archive" ? `publish-continued-abort-finalization-${review.operationId}.lock` : kind === "receipt" ? `reconciliation-abort-continuation-${review.operationId}.json` :
      kind === "old-receipt" ? `reconciliation-abort-${abort.operationId}.json` : kind === "intent" ? `reconciliation-abort-continuation-${review.operationId}.intent.json` :
      kind === "old-intent" ? `reconciliation-abort-${abort.operationId}.intent.json` : `recovery-reconciliation-${original.operationId}.json`;
    await writeFile(join(directory, name), "PRIVATE_ALTERED"); const before = await snapshot(directory);
    assert.equal((await inspectRecoveryStatus(directory)).coordinationClear, false);
    await assert.rejects(continueReconciliationAbort(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("dos intenciones vinculadas al mismo bloqueo no eligen una cancelación arbitraria", () => temporary(async directory => {
  const { abort } = await interruptedReconciliationAbort(directory, "intent-only"), path = join(directory, `reconciliation-abort-${abort.operationId}.intent.json`);
  const draft = JSON.parse(await readFile(path, "utf8")), id = randomUUID(); draft.operationId = id;
  await writeFile(join(directory, `reconciliation-abort-${id}.intent.json`), JSON.stringify(draft));
  const before = await snapshot(directory); assert.equal((await inspectReconciliationAbortContinuation(directory)).stage, "ambiguous-intents");
  await assert.rejects(prepareReconciliationAbortContinuation(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("CLI valida argumentos, planes sólo observan y fallo elimina resultado anterior sin divulgar datos", () => temporary(async directory => {
  await interruptedReconciliationAbort(directory, "maintenance-removed"); const before = await snapshot(directory);
  const resultPath = join(artifacts, "web-reconciliation-abort-continuation-result.json"); await writeFile(resultPath, JSON.stringify({ continued: true }));
  const failure = spawnSync(process.execPath, [cli, "--apply", `--directory=${directory}`, "--review=PRIVATE_MISSING_REVIEW"], { encoding: "utf8", windowsHide: true });
  assert.equal(failure.status, 1); assert.ok(!failure.stderr.includes("PRIVATE_"));
  const report = JSON.parse(await readFile(resultPath, "utf8")); assert.equal(report.resultConfirmed, false); assert.equal(report.continued, undefined);
  for (const mode of ["--inspect", "--plan"]) {
    const result = spawnSync(process.execPath, [cli, mode, `--directory=${directory}`], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr);
  }
  for (const args of [["--inspect", "--plan"], ["--plan", "--directory="], ["--inspect", "--review=PRIVATE_REVIEW"], ["--inspect", "--unexpected"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 1); assert.ok(!result.stderr.includes("PRIVATE_"));
  }
  assert.deepEqual(await snapshot(directory), before);
}));

test("reserva archivos faltantes dentro del límite600 y rechaza sin truncar evidencia", () => temporary(async directory => {
  await interruptedReconciliationAbort(directory, "intent-only", "intent-only", false, async directory => {
    const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
    const raw = await readFile(join(directory, name)), owner = JSON.parse(raw), writes = [];
    for (let count = (await evidenceNames(directory)).length; count < 599; count += 2) {
      const id = randomUUID(); writes.push(writeFile(join(directory, `publish-orphan-${id}.lock`), raw), writeFile(join(directory, `lock-recovery-${id}.json`),
        JSON.stringify({ owner: { ...owner, sha256: hash(raw), active: false }, reviewer: "Fixture límite", decision: "recover-local-lock", createdAt: new Date().toISOString() })));
    }
    await Promise.all(writes);
  });
  const before = await snapshot(directory);
  assert.equal((await evidenceNames(directory)).length, 600); assert.equal((await inspectReconciliationAbortContinuation(directory)).stage, "history-limit");
  await assert.rejects(prepareReconciliationAbortContinuation(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("dos auditorías completas del mismo aborto previo son ambiguas aunque sus vínculos sean válidos", () => temporary(async directory => {
  await interruptedReconciliationAbort(directory, "completed-before-release"); const review = reviewFor(await prepareReconciliationAbortContinuation(directory));
  await continueReconciliationAbort(directory, review);
  const id = randomUUID(), draft = JSON.parse(await readFile(join(directory, `reconciliation-abort-continuation-${review.operationId}.intent.json`), "utf8"));
  draft.operationId = id; const raw = JSON.stringify(draft);
  const receipt = JSON.parse(await readFile(join(directory, `reconciliation-abort-continuation-${review.operationId}.json`), "utf8")); receipt.operationId = id; receipt.intentSha256 = hash(raw);
  await writeFile(join(directory, `reconciliation-abort-continuation-${id}.intent.json`), raw);
  await writeFile(join(directory, `reconciliation-abort-continuation-${id}.json`), JSON.stringify(receipt));
  await writeFile(join(directory, `publish-continued-abort-finalization-${id}.lock`), await readFile(join(directory, `publish-continued-abort-finalization-${review.operationId}.lock`)));
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.reconciliationAbortContinuations.completed.length, 0); assert.equal(status.reconciliationAbortContinuations.pending.length, 2);
  assert.ok(status.reconciliationAbortContinuations.pending.every(item => item.issue === "ambiguous-reconciliation-abort-continuation"));
  assert.equal(status.reconciliationAborts.completed.length, 1); assert.equal(status.coordinationClear, false);
  await assert.rejects(continueReconciliationAbort(directory, review));
}));

test("recibo ligado a otra continuación no certifica cancelación y replay histórico conserva puntero posterior", () => temporary(async directory => {
  const { abort } = await interruptedReconciliationAbort(directory, "maintenance-removed"), review = reviewFor(await prepareReconciliationAbortContinuation(directory));
  await continueReconciliationAbort(directory, review);
  await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
  const before = await snapshot(directory); assert.equal((await continueReconciliationAbort(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), before);
  const path = join(directory, `reconciliation-abort-${abort.operationId}.json`), receipt = JSON.parse(await readFile(path, "utf8")); receipt.abortContinuationId = randomUUID();
  await writeFile(path, JSON.stringify(receipt));
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.reconciliationAborts.completed.length, 0); assert.equal(status.reconciliationAbortContinuations.completed.length, 0);
  await assert.rejects(continueReconciliationAbort(directory, review));
}));
