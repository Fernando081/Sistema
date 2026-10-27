import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectReconciliationAbort, prepareReconciliationAbort, abortRecoveryReconciliation } from "../reconciliation-abort.mjs";
import { inspectRecoveryStatus, evidenceNames } from "../recovery-status.mjs";
import { acquirePublicationLock, inspectPublicationLock, recoverPublicationLock } from "../publication-lock.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { prepareRecoveryResumption, resumeRecoveryReconciliation, inspectResumption } from "../recovery-resumption.mjs";
import { prepareMaintenanceReview, finalizeMaintenance, inspectMaintenance } from "../maintenance-review.mjs";
import { finalizeResumptionGuard, inspectResumptionGuard } from "../resumption-guard-review.mjs";
import { resumeClosure, inspectClosureResumption } from "../closure-resumption.mjs";
import { temporary, snapshot, pauseChild, interruptedReconciliation } from "./support/closure-fixtures.mjs";

const abortModule = new URL("../reconciliation-abort.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../reconciliation-abort.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const stages = ["intent-only", "guard-archived", "guard-removed"];
const hash = raw => createHash("sha256").update(raw).digest("hex");
const reviewFor = plan => ({ operationId: randomUUID(), decision: "abort-local-reconciliation", reviewer: "Fixture cancelación",
  reason: "PRIVATE_REASON: se decide detener esta revisión de prueba", planSha256: plan.planSha256 });

test("cancelación de tres etapas conserva evidencia, no crea recibo original y registra aborted separado de completed", async () => {
  for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const original = await interruptedReconciliation(directory, stage), before = await snapshot(directory);
    const proposal = await prepareReconciliationAbort(directory), report = await inspectReconciliationAbort(directory);
    assert.equal(report.eligible, true); assert.equal(proposal.stage, stage); assert.ok(!JSON.stringify(proposal).includes("PRIVATE_"));
    assert.deepEqual(await snapshot(directory), before);
    const continuation = { operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture", planSha256: (await prepareRecoveryResumption(directory)).planSha256 };
    const review = reviewFor(proposal), result = await abortRecoveryReconciliation(directory, review), after = await snapshot(directory);
    assert.equal(result.aborted, true); assert.equal(result.replayed, false); assert.equal(result.reconciliationId, original.operationId);
    for (const [name, raw] of Object.entries(before)) {
      if (name === "publish-maintenance.lock") assert.equal(after[`publish-aborted-maintenance-${review.operationId}.lock`], raw);
      else if (name === "publish-recovery.lock") assert.equal(after[`publish-aborted-recovery-${review.operationId}.lock`], raw);
      else assert.equal(after[name], raw, name);
    }
    await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`)));
    if (stage === "intent-only") await assert.rejects(access(join(directory, `publish-recovery-orphan-${original.operationId}.lock`)));
    if (stage === "guard-removed") await assert.rejects(access(join(directory, `publish-aborted-recovery-${review.operationId}.lock`)));
    for (const name of ["publish-maintenance.lock", "publish-recovery.lock", "publish-finalization.lock"]) await assert.rejects(access(join(directory, name)));
    const status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "ready"); assert.equal(status.reconciliationAborts.completed.length, 1); assert.equal(status.reconciliationAborts.pending.length, 0);
    assert.equal(status.reconciliations.completed.length, 0); assert.equal(status.reconciliations.pending.length, 0); assert.equal(status.reconciliations.aborted.length, 1);
    assert.equal(status.reconciliations.aborted[0].abortId, review.operationId); assert.equal(status.archives.acknowledged, 1); assert.equal(status.archives.complete, 0);
    assert.ok(!JSON.stringify(status).includes("PRIVATE_REASON"));
    const receipt = JSON.parse(await readFile(join(directory, `reconciliation-abort-${review.operationId}.json`), "utf8")); assert.equal(receipt.outcome, "aborted");
    await assert.rejects(applyRecoveryReconciliation(directory, original)); await assert.rejects(resumeRecoveryReconciliation(directory, continuation));
    await assert.rejects(prepareMaintenanceReview(directory)); assert.deepEqual(await snapshot(directory), after);
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const later = await snapshot(directory);
    assert.equal((await abortRecoveryReconciliation(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), later);
    const release = await acquirePublicationLock(directory); await release();
  });
});

test("publicación residual se conserva para recuperación ordinaria independiente después de cancelar", () => temporary(async directory => {
  await interruptedReconciliation(directory, "intent-only", true); const before = await snapshot(directory);
  const review = reviewFor(await prepareReconciliationAbort(directory)); await abortRecoveryReconciliation(directory, review);
  const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.publication.state, "inactive");
  assert.equal((await snapshot(directory))["publish.lock"], before["publish.lock"]);
  const owner = await inspectPublicationLock(directory);
  await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture separado", sha256: owner.sha256 });
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready"); assert.equal((await abortRecoveryReconciliation(directory, review)).replayed, true);
}));

test("rechaza operación ya terminada, v1 sin vínculo y guardas activas/ajenas/antiguas o intención ambigua", async () => {
  for (const kind of ["completed", "legacy", "active", "foreign", "invalid", "unlinked", "ambiguous", "recovery-active", "resumption", "finalization", "receipt"]) await temporary(async directory => {
    const original = await interruptedReconciliation(directory, kind === "completed" ? "completed-before-release" : "intent-only");
    const intentPath = join(directory, `recovery-reconciliation-${original.operationId}.intent.json`);
    if (kind === "legacy") { const value = JSON.parse(await readFile(intentPath, "utf8")); value.schemaVersion = 1; delete value.maintenanceSha256; await writeFile(intentPath, JSON.stringify(value)); }
    if (["active", "foreign", "unlinked", "recovery-active"].includes(kind)) {
      const path = join(directory, kind === "recovery-active" ? "publish-recovery.lock" : "publish-maintenance.lock"), value = JSON.parse(await readFile(path, "utf8"));
      if (kind === "active" || kind === "recovery-active") value.pid = process.pid;
      if (kind === "foreign") value.host = hostname() + "-foreign";
      if (kind === "unlinked") value.nonce = randomUUID();
      await writeFile(path, JSON.stringify(value));
    }
    if (kind === "invalid") await writeFile(join(directory, "publish-maintenance.lock"), "PRIVATE_LEGACY_GUARD");
    if (kind === "ambiguous") { const value = JSON.parse(await readFile(intentPath, "utf8")); value.operationId = randomUUID(); await writeFile(join(directory, `recovery-reconciliation-${value.operationId}.intent.json`), JSON.stringify(value)); }
    if (kind === "resumption") await writeFile(join(directory, "publish-resume.lock"), "PRIVATE_RESUMPTION_GUARD");
    if (kind === "finalization") await writeFile(join(directory, "publish-finalization.lock"), "PRIVATE_FINALIZATION_GUARD");
    if (kind === "receipt") await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.json`), "PRIVATE_RECEIPT");
    const before = await snapshot(directory), report = await inspectReconciliationAbort(directory);
    assert.equal(report.eligible, false, kind); assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    await assert.rejects(prepareReconciliationAbort(directory)); await assert.rejects(abortRecoveryReconciliation(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("revisión ligada a etapa, intención, archivos, directorio, puntero e historial rechaza cambios sin mutar", async () => {
  for (const kind of ["hash", "extra", "id", "reason-empty", "reason-control", "pointer", "source", "old-intent", "record", "archive", "history", "directory"]) await temporary(async directory => {
    const original = await interruptedReconciliation(directory, "guard-archived"), proposal = await prepareReconciliationAbort(directory), review = reviewFor(proposal);
    if (kind === "hash") review.planSha256 = "a".repeat(64);
    if (kind === "extra") review.secret = "PRIVATE_EXTRA";
    if (kind === "id") review.operationId = original.operationId;
    if (kind === "reason-empty") review.reason = " ";
    if (kind === "reason-control") review.reason = "PRIVATE_REASON\n";
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    if (kind === "source") await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_SOURCE");
    if (kind === "old-intent") await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.intent.json`), "PRIVATE_INTENT");
    if (kind === "record") { const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")); await writeFile(join(directory, name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json")), "{}"); }
    if (kind === "archive") await writeFile(join(directory, `publish-recovery-orphan-${original.operationId}.lock`), "PRIVATE_ARCHIVE");
    if (kind === "history") await writeFile(join(directory, `reconciliation-abort-${randomUUID()}.intent.json`), "{}");
    if (kind === "directory") await temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(abortRecoveryReconciliation(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    else { const before = await snapshot(directory); await assert.rejects(abortRecoveryReconciliation(directory, review)); assert.deepEqual(await snapshot(directory), before, kind); }
  });
});

test("revisores concurrentes registran una sola cancelación y motivo cambiado impide replay", () => temporary(async directory => {
  await interruptedReconciliation(directory, "intent-only"); const proposal = await prepareReconciliationAbort(directory);
  const reviews = [reviewFor(proposal), reviewFor(proposal)], results = await Promise.allSettled(reviews.map(review => abortRecoveryReconciliation(directory, review)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); const winner = reviews[results.findIndex(result => result.status === "fulfilled")];
  assert.equal((await inspectRecoveryStatus(directory)).reconciliationAborts.completed.length, 1);
  const before = await snapshot(directory); await assert.rejects(abortRecoveryReconciliation(directory, { ...winner, reason: "Motivo diferente" })); assert.deepEqual(await snapshot(directory), before);
}));

test("seis cortes de cancelación conservan exclusión y evidencia, también tras recibo antes de liberar guarda", async () => {
  for (const stage of ["before-link", "after-maintenance-link", "after-recovery-link", "after-recovery-unlink", "after-maintenance-unlink", "before-release"]) await temporary(async directory => {
    const original = await interruptedReconciliation(directory, "intent-only"), review = reviewFor(await prepareReconciliationAbort(directory));
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='before-link')await pause();await link(...a);
        if(process.argv[3]==='after-maintenance-link'&&a[0].endsWith('publish-maintenance.lock'))await pause();
        if(process.argv[3]==='after-recovery-link'&&a[0].endsWith('publish-recovery.lock'))await pause();};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();await unlink(...a);
        if(process.argv[3]==='after-recovery-unlink'&&a[0].endsWith('publish-recovery.lock'))await pause();
        if(process.argv[3]==='after-maintenance-unlink'&&a[0].endsWith('publish-maintenance.lock'))await pause();};
      syncBuiltinESMExports();const{abortRecoveryReconciliation}=await import(${JSON.stringify(abortModule)});await abortRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`;
    await pauseChild(code, [directory, JSON.stringify(review), stage], async (_, stop) => {
      assert.equal((await inspectRecoveryStatus(directory)).status, "finalizing");
      await assert.rejects(acquirePublicationLock(directory));
      await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
      await assert.rejects(applyRecoveryReconciliation(directory, original));
      await assert.rejects(resumeRecoveryReconciliation(directory, { ...original, decision: "resume-local-reconciliation" }));
      await assert.rejects(finalizeMaintenance(directory, { ...original, decision: "archive-completed-maintenance" }));
      await assert.rejects(finalizeResumptionGuard(directory, { ...original, decision: "archive-completed-resumption" }));
      await assert.rejects(resumeClosure(directory, { ...original, decision: "resume-local-closure" }));
      await assert.rejects(abortRecoveryReconciliation(directory, review));
      await stop();
      const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
      assert.equal(status.status, "needs-review"); assert.equal(status.finalization.state, "inactive");
      assert.equal(status.reconciliationAborts.completed.length, Number(stage === "before-release"));
      assert.equal(status.reconciliations.completed.length, 0); await assert.rejects(access(join(directory, `recovery-reconciliation-${original.operationId}.json`)));
      await assert.rejects(prepareReconciliationAbort(directory)); await assert.rejects(abortRecoveryReconciliation(directory, review));
      assert.deepEqual(await snapshot(directory), before);
    });
  });
});

test("sustituciones durante archivo conservan guardas y no certifican cancelación", async () => {
  for (const kind of ["owner", "maintenance", "recovery", "old-intent", "own-intent", "archive", "pointer", "record"]) await temporary(async directory => {
    const original = await interruptedReconciliation(directory, "intent-only"), review = reviewFor(await prepareReconciliationAbort(directory));
    const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
    const record = name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json");
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;fs.link=async(...a)=>{await link(...a);const k=process.argv[3],id=JSON.parse(process.argv[2]).operationId;
        const target=k==='owner'?'publish-finalization.lock':k==='maintenance'?'publish-maintenance.lock':k==='recovery'?'publish-recovery.lock':
          k==='old-intent'?'recovery-reconciliation-'+process.argv[4]+'.intent.json':k==='own-intent'?'reconciliation-abort-'+id+'.intent.json':
          k==='archive'?'publish-aborted-maintenance-'+id+'.lock':k==='record'?process.argv[5]:'current-release.json';
        await fs.writeFile(join(process.argv[1],target),'PRIVATE_REPLACEMENT');};syncBuiltinESMExports();
      const{abortRecoveryReconciliation}=await import(${JSON.stringify(abortModule)});
      try{await abortRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{console.log('preserved');}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, original.operationId, record], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr); await access(join(directory, "publish-finalization.lock"));
    await assert.rejects(access(join(directory, `reconciliation-abort-${review.operationId}.json`))); assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    if (kind === "owner") assert.equal(await readFile(join(directory, "publish-finalization.lock"), "utf8"), "PRIVATE_REPLACEMENT");
  });
});

test("alteración de intención, archivos, recibo o nueva evidencia original invalida cancelación y replay sin guardas", async () => {
  for (const kind of ["intent", "maintenance-archive", "recovery-archive", "receipt", "old-archive", "old-receipt", "old-intent", "record"]) await temporary(async directory => {
    const original = await interruptedReconciliation(directory, "guard-archived"), review = reviewFor(await prepareReconciliationAbort(directory));
    await abortRecoveryReconciliation(directory, review);
    const names = { intent: `reconciliation-abort-${review.operationId}.intent.json`, "maintenance-archive": `publish-aborted-maintenance-${review.operationId}.lock`,
      "recovery-archive": `publish-aborted-recovery-${review.operationId}.lock`, receipt: `reconciliation-abort-${review.operationId}.json`,
      "old-archive": `publish-recovery-orphan-${original.operationId}.lock`, "old-intent": `recovery-reconciliation-${original.operationId}.intent.json` };
    if (kind === "old-receipt") {
      const intent = await readFile(join(directory, `recovery-reconciliation-${original.operationId}.intent.json`));
      await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.json`), JSON.stringify({ schemaVersion: 1, operationId: original.operationId,
        decision: original.decision, intentSha256: hash(intent), completedAt: new Date().toISOString() }));
    } else if (kind === "record") {
      const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-")); await writeFile(join(directory, name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json")), "{}");
    } else await writeFile(join(directory, names[kind]), "PRIVATE_TAMPER");
    const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.reconciliationAborts.pending.length, 1); assert.equal(status.reconciliations.aborted.length, 0);
    assert.ok(!JSON.stringify(status).includes("PRIVATE_")); await assert.rejects(abortRecoveryReconciliation(directory, review));
    await assert.rejects(applyRecoveryReconciliation(directory, original)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("dos cancelaciones completas del mismo origen son ambiguas y no liberan coordinación por historial", () => temporary(async directory => {
  await interruptedReconciliation(directory, "intent-only"); const review = reviewFor(await prepareReconciliationAbort(directory)); await abortRecoveryReconciliation(directory, review);
  const intent = JSON.parse(await readFile(join(directory, `reconciliation-abort-${review.operationId}.intent.json`), "utf8")); intent.operationId = randomUUID();
  const raw = JSON.stringify(intent); await writeFile(join(directory, `reconciliation-abort-${intent.operationId}.intent.json`), raw);
  for (const prefix of ["publish-aborted-maintenance-", "publish-aborted-recovery-"]) await writeFile(join(directory, `${prefix}${intent.operationId}.lock`), await readFile(join(directory, `${prefix}${review.operationId}.lock`)));
  const receipt = JSON.parse(await readFile(join(directory, `reconciliation-abort-${review.operationId}.json`), "utf8")); receipt.operationId = intent.operationId; receipt.intentSha256 = hash(raw);
  await writeFile(join(directory, `reconciliation-abort-${intent.operationId}.json`), JSON.stringify(receipt));
  const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
  assert.equal(status.reconciliationAborts.completed.length, 0); assert.equal(status.reconciliationAborts.pending.length, 2);
  assert.equal(status.reconciliations.aborted.length, 0); assert.equal(status.status, "needs-review");
  await assert.rejects(abortRecoveryReconciliation(directory, review)); assert.deepEqual(await snapshot(directory), before);
}));

test("límite de historial reserva todos los archivos de cancelación sin truncar ni borrar evidencia", () => temporary(async directory => {
  await interruptedReconciliation(directory, "intent-only"); const originalName = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
  const raw = await readFile(join(directory, originalName)), owner = JSON.parse(raw), writes = [];
  for (let count = (await evidenceNames(directory)).length; count < 602; count += 2) {
    const id = randomUUID(); writes.push(writeFile(join(directory, `publish-orphan-${id}.lock`), raw), writeFile(join(directory, `lock-recovery-${id}.json`),
      JSON.stringify({ owner: { ...owner, sha256: hash(raw), active: false }, reviewer: "Fixture límite", decision: "recover-local-lock", createdAt: new Date().toISOString() })));
  }
  await Promise.all(writes); const before = await snapshot(directory);
  assert.equal((await inspectReconciliationAbort(directory)).stage, "history-limit"); await assert.rejects(prepareReconciliationAbort(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("CLI diagnostica sin mutar, aplica solo revisión exacta con motivo e invalida resultados anteriores sin secretos", () => temporary(async directory => {
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0);
  await interruptedReconciliation(directory, "guard-removed"); const before = await snapshot(directory);
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), before);
  const proposal = JSON.parse(await readFile(join(artifacts, "web-reconciliation-abort-plan.json"), "utf8")), path = join(directory, "fixture-review.json");
  await writeFile(path, JSON.stringify(reviewFor(proposal)));
  const result = run(["--apply", `--directory=${directory}`, `--review=${path}`]); assert.equal(result.status, 0, result.stderr);
  assert.ok(!(result.stdout + result.stderr).includes("PRIVATE_REASON")); assert.equal(JSON.parse(await readFile(join(artifacts, "web-reconciliation-abort-result.json"), "utf8")).aborted, true);
  const bad = run(["--apply", "--secret=PRIVATE_ARGUMENT"]); assert.equal(bad.status, 1); assert.ok(!(bad.stdout + bad.stderr).includes("PRIVATE_ARGUMENT"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-reconciliation-abort-result.json"), "utf8")).resultConfirmed, false);
  assert.equal(run(["--plan", "--plan", `--directory=${directory}`]).status, 1);
  assert.equal(run(["--inspect", `--directory=${directory}`, `--review=${path}`]).status, 1);
}));

test("fallo de recibo después de retirar ambas guardas conserva bloqueo y deja cancelación pendiente aunque se pierda", () => temporary(async directory => {
  const original = await interruptedReconciliation(directory, "intent-only"), review = reviewFor(await prepareReconciliationAbort(directory)), path = join(directory, "fixture-review.json");
  await writeFile(path, JSON.stringify(review));
  const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const id=process.argv[4],open=fs.open;fs.open=async(...a)=>{if(String(a[0]).endsWith('reconciliation-abort-'+id+'.json'))throw new Error('PRIVATE_IO_FAILURE');return open(...a);};
    syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];await import(${JSON.stringify(abortModule)});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, cli, directory, path, review.operationId], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 1); assert.ok(!(child.stdout + child.stderr).includes("PRIVATE_IO_FAILURE"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-reconciliation-abort-result.json"), "utf8")).resultConfirmed, false);
  await access(join(directory, "publish-finalization.lock")); for (const name of ["publish-maintenance.lock", "publish-recovery.lock", `recovery-reconciliation-${original.operationId}.json`]) await assert.rejects(access(join(directory, name)));
  let status = await inspectRecoveryStatus(directory); assert.equal(status.reconciliationAborts.pending.length, 1); assert.equal(status.reconciliations.aborted.length, 0);
  // Simulated loss of our temporary guard must still leave unresolved history.
  await unlink(join(directory, "publish-finalization.lock")); status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review");
  for (const inspect of [inspectResumption, inspectMaintenance, inspectResumptionGuard, inspectClosureResumption]) assert.equal((await inspect(directory)).stage, "abort-needs-review");
  await assert.rejects(prepareRecoveryReconciliation(directory)); await assert.rejects(prepareRecoveryResumption(directory));
}));
