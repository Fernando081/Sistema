import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { inspectResumptionGuard, prepareResumptionGuardReview, finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { prepareRecoveryResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { inspectRecoveryStatus } from "../recovery-status.mjs";
import { prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { acquirePublicationLock, inspectPublicationLock, recoverPublicationLock } from "../publication-lock.mjs";

const lockModule = new URL("../publication-lock.mjs", import.meta.url).href;
const reconcileModule = new URL("../recovery-reconciliation.mjs", import.meta.url).href;
const resumeModule = new URL("../recovery-resumption.mjs", import.meta.url).href;
const closeModule = new URL("../resumption-guard-review.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../resumption-guard-review.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const reviewFor = plan => ({ operationId: randomUUID(), decision: "archive-completed-resumption", reviewer: "Fixture cierre guarda", planSha256: plan.planSha256 });
const maintenanceReview = plan => ({ operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture cierre separado", planSha256: plan.planSha256 });
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-resume-guard-test-"));
  try { await work(directory); } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("rtt-resume-guard-test-")) throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
}
async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, (await readFile(join(directory, name))).toString("base64")])));
}
async function pauseChild(code, args, work) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  let stderr = "", timer;
  child.stderr.on("data", bytes => { stderr += bytes.toString(); });
  const exit = once(child, "exit");
  try {
    await Promise.race([once(child, "message"), exit.then(([status]) => { throw new Error(`Fixture terminó ${status}: ${stderr}`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture no alcanzó etapa")), 10000); })]);
    clearTimeout(timer);
    await work(child, async () => { child.kill(); await exit; });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; }
  }
}
async function orphanedReconciliation(directory) {
  const publisher = spawn(process.execPath, ["--input-type=module", "-e",
    `const{acquirePublicationLock}=await import(${JSON.stringify(lockModule)});await acquirePublicationLock(process.argv[1]);`, directory], { stdio: "ignore", windowsHide: true });
  assert.equal((await once(publisher, "exit"))[0], 0);
  const owner = await inspectPublicationLock(directory);
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const rename=fs.rename;fs.rename=async(...a)=>{await rename(...a);process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    syncBuiltinESMExports();const{recoverPublicationLock}=await import(${JSON.stringify(lockModule)});
    await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[2]});`,
    [directory, owner.sha256], async (_, stop) => stop());
  const proposal = await prepareRecoveryReconciliation(directory);
  const origin = { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture original", planSha256: proposal.planSha256 };
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    fs.link=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};syncBuiltinESMExports();
    const{applyRecoveryReconciliation}=await import(${JSON.stringify(reconcileModule)});await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`,
    [directory, JSON.stringify(origin)], async (_, stop) => stop());
  return origin;
}
async function orphanedResume(directory, complete = true) {
  const origin = await orphanedReconciliation(directory);
  const proposal = await prepareRecoveryResumption(directory);
  const resume = { operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture continuación", planSha256: proposal.planSha256 };
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='complete'&&a[0].endsWith('publish-resume.lock'))await pause();await unlink(...a);};
    const open=fs.open;fs.open=async(...a)=>{if(process.argv[3]==='partial'&&String(a[0]).endsWith('recovery-reconciliation-'+process.argv[4]+'.json'))await pause();return open(...a);};
    syncBuiltinESMExports();const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumeModule)});
    await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`,
    [directory, JSON.stringify(resume), complete ? "complete" : "partial", origin.operationId], async (_, stop) => stop());
  assert.equal((await inspectRecoveryStatus(directory)).resumption.state, "inactive");
  return { origin, resume };
}

test("cierre residual conserva bytes, liga guarda v2, deja mantenimiento separado y repite históricamente", () => temporary(async directory => {
  await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
  await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
  const { resume } = await orphanedResume(directory), before = await snapshot(directory);
  const proposal = await prepareResumptionGuardReview(directory), inspection = await inspectResumptionGuard(directory);
  assert.equal(inspection.eligible, true); assert.equal(proposal.stage, "completed-before-release");
  assert.ok(!JSON.stringify(proposal).includes("PRIVATE_PRODUCTS_CONTACTS")); assert.deepEqual(await snapshot(directory), before);
  const sourceIntent = JSON.parse(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.intent.json`), "utf8"));
  assert.equal(sourceIntent.schemaVersion, 2); assert.equal(sourceIntent.resumptionSha256, proposal.plan.resumptionSha256);
  const review = reviewFor(proposal), result = await finalizeResumptionGuard(directory, review), after = await snapshot(directory);
  assert.equal(result.finalized, true); assert.equal(result.replayed, false);
  for (const [name, raw] of Object.entries(before)) {
    if (name === "publish-resume.lock") assert.equal(after[`publish-resume-orphan-${review.operationId}.lock`], raw);
    else assert.equal(after[name], raw, name);
  }
  await assert.rejects(access(join(directory, "publish-resume.lock"))); await assert.rejects(access(join(directory, "publish-recovery.lock")));
  const status = await inspectRecoveryStatus(directory);
  assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive"); assert.equal(status.resumptionReviews.pending.length, 0);
  assert.ok(status.resumptionReviews.completed.some(item => item.operationId === review.operationId));
  assert.equal((await finalizeResumptionGuard(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), after);
  await finalizeMaintenance(directory, maintenanceReview(await prepareMaintenanceReview(directory)));
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
  await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
  const later = await snapshot(directory);
  assert.equal((await finalizeResumptionGuard(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), later);
  assert.equal((await resumeRecoveryReconciliation(directory, resume)).replayed, true);
  const release = await acquirePublicationLock(directory); await release();
}));

test("operación parcial, guarda antigua/activa/ajena/sin vínculo, ambigüedad e historial alterado rechazan sin mutar", async () => {
  for (const kind of ["partial", "active", "foreign", "legacy", "unlinked", "ambiguous", "receipt", "ack-record", "pending-review", "recovery"]) await temporary(async directory => {
    const { resume } = await orphanedResume(directory, kind !== "partial");
    if (["active", "foreign", "unlinked"].includes(kind)) {
      const path = join(directory, "publish-resume.lock"), value = JSON.parse(await readFile(path, "utf8"));
      if (kind === "active") value.pid = process.pid;
      if (kind === "foreign") value.host = hostname() + "-foreign";
      if (kind === "unlinked") value.nonce = randomUUID();
      await writeFile(path, JSON.stringify(value));
    }
    if (kind === "legacy") await writeFile(join(directory, "publish-resume.lock"), "PRIVATE_LEGACY");
    if (kind === "ambiguous") {
      const intent = JSON.parse(await readFile(join(directory, `reconciliation-resume-${resume.operationId}.intent.json`), "utf8"));
      intent.operationId = randomUUID(); await writeFile(join(directory, `reconciliation-resume-${intent.operationId}.intent.json`), JSON.stringify(intent));
    }
    if (kind === "receipt") await writeFile(join(directory, `reconciliation-resume-${resume.operationId}.json`), "PRIVATE_RECEIPT");
    if (kind === "ack-record") {
      const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
      await writeFile(join(directory, name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json")), "{}");
    }
    if (kind === "pending-review") await writeFile(join(directory, `resumption-review-${randomUUID()}.intent.json`), "{}");
    if (kind === "recovery") await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_RECOVERY_GUARD");
    const before = await snapshot(directory), report = await inspectResumptionGuard(directory);
    assert.equal(report.eligible, false, kind); assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    await assert.rejects(prepareResumptionGuardReview(directory)); await assert.rejects(finalizeResumptionGuard(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("lectura histórica v1 compatible sin atribuirle vínculo de guarda ni cierre elegible", () => temporary(async directory => {
  const { origin, resume } = await orphanedResume(directory);
  const intentPath = join(directory, `reconciliation-resume-${resume.operationId}.intent.json`);
  const oldReceiptPath = join(directory, `recovery-reconciliation-${origin.operationId}.json`), receiptPath = join(directory, `reconciliation-resume-${resume.operationId}.json`);
  const intent = JSON.parse(await readFile(intentPath, "utf8")); intent.schemaVersion = 1; delete intent.resumptionSha256;
  const raw = JSON.stringify(intent); await writeFile(intentPath, raw);
  const original = JSON.parse(await readFile(oldReceiptPath, "utf8")); original.resumptionIntentSha256 = hash(raw);
  const originalRaw = JSON.stringify(original); await writeFile(oldReceiptPath, originalRaw);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")); receipt.intentSha256 = hash(raw); receipt.reconciliationReceiptSha256 = hash(originalRaw);
  await writeFile(receiptPath, JSON.stringify(receipt));
  const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
  assert.equal(status.resumptions.pending.length, 0); assert.equal(status.reconciliations.pending.length, 0);
  assert.equal((await inspectResumptionGuard(directory)).stage, "unlinked-resumption-guard");
  await assert.rejects(prepareResumptionGuardReview(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("revisión exacta y plan ligados a fuente, mantenimiento, puntero, historial y directorio físico", async () => {
  for (const kind of ["hash", "extra", "resume-id", "origin-id", "source", "maintenance", "pointer", "history", "directory"]) await temporary(async directory => {
    const { origin, resume } = await orphanedResume(directory), proposal = await prepareResumptionGuardReview(directory), review = reviewFor(proposal);
    if (kind === "hash") review.planSha256 = "0".repeat(64);
    if (kind === "extra") review.secret = "PRIVATE_REVIEW";
    if (kind === "resume-id") review.operationId = resume.operationId;
    if (kind === "origin-id") review.operationId = origin.operationId;
    if (kind === "source" || kind === "maintenance") {
      const path = join(directory, kind === "source" ? "publish-resume.lock" : "publish-maintenance.lock"), owner = JSON.parse(await readFile(path, "utf8"));
      owner.nonce = randomUUID(); await writeFile(path, JSON.stringify(owner));
    }
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "c".repeat(64) }));
    if (kind === "history") await writeFile(join(directory, `resumption-review-${randomUUID()}.json`), "{}");
    if (kind === "directory") return temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(finalizeResumptionGuard(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    const before = await snapshot(directory); await assert.rejects(finalizeResumptionGuard(directory, review)); assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("dos revisores concurrentes completan solo un cierre de guarda", () => temporary(async directory => {
  await orphanedResume(directory);
  const proposal = await prepareResumptionGuardReview(directory);
  const results = await Promise.allSettled([finalizeResumptionGuard(directory, reviewFor(proposal)), finalizeResumptionGuard(directory, reviewFor(proposal))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const status = await inspectRecoveryStatus(directory); assert.equal(status.resumptionReviews.completed.length, 1); assert.equal(status.resumptionReviews.pending.length, 0);
}));

test("corte antes/después de archivar, tras retirar fuente y antes de liberar recuperación conserva exclusión/evidencia", async () => {
  for (const stage of ["before-link", "after-link", "after-unlink", "after-receipt"]) await temporary(async directory => {
    const { resume } = await orphanedResume(directory), before = await snapshot(directory), review = reviewFor(await prepareResumptionGuardReview(directory));
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='before-link')await pause();await link(...a);if(process.argv[3]==='after-link')await pause();};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='after-receipt'&&a[0].endsWith('publish-recovery.lock'))await pause();
        await unlink(...a);if(process.argv[3]==='after-unlink'&&a[0].endsWith('publish-resume.lock'))await pause();};
      syncBuiltinESMExports();const{finalizeResumptionGuard}=await import(${JSON.stringify(closeModule)});await finalizeResumptionGuard(process.argv[1],JSON.parse(process.argv[2]));`;
    await pauseChild(code, [directory, JSON.stringify(review), stage], async (_, stop) => {
      await assert.rejects(acquirePublicationLock(directory));
      await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
      await assert.rejects(applyRecoveryReconciliation(directory, { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture", planSha256: "a".repeat(64) }));
      await assert.rejects(resumeRecoveryReconciliation(directory, resume));
      await assert.rejects(finalizeMaintenance(directory, maintenanceReview({ planSha256: "a".repeat(64) })));
      await assert.rejects(finalizeResumptionGuard(directory, review));
      await stop();
      const after = await snapshot(directory), status = await inspectRecoveryStatus(directory);
      assert.equal(status.status, "needs-review"); assert.equal(status.recovery.state, "inactive");
      assert.ok(after[`resumption-review-${review.operationId}.intent.json`]);
      for (const [name, raw] of Object.entries(before)) {
        if (name === "publish-resume.lock" && ["after-unlink", "after-receipt"].includes(stage)) assert.equal(after[`publish-resume-orphan-${review.operationId}.lock`], raw);
        else assert.equal(after[name], raw, name);
      }
      if (stage === "after-receipt") assert.equal(status.resumptionReviews.completed.length, 1);
      else assert.equal(status.resumptionReviews.pending.length, 1);
      await assert.rejects(prepareResumptionGuardReview(directory)); await assert.rejects(finalizeResumptionGuard(directory, review));
      assert.deepEqual(await snapshot(directory), after);
    });
  });
});

test("evidencia o propietario sustituidos durante enlace conservan bloqueos y no certifican cierre", async () => {
  for (const kind of ["owner", "source", "maintenance", "pointer", "intent", "archive-after-unlink"]) await temporary(async directory => {
    const { resume } = await orphanedResume(directory), review = reviewFor(await prepareResumptionGuardReview(directory));
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;let archive;fs.link=async(...a)=>{await link(...a);archive=a[1];const k=process.argv[3];
        if(k==='owner')await fs.writeFile(join(process.argv[1],'publish-recovery.lock'),'PRIVATE_REPLACED_OWNER');
        if(k==='source')await fs.writeFile(join(process.argv[1],'publish-resume.lock'),'PRIVATE_REPLACED_SOURCE');
        if(k==='maintenance')await fs.writeFile(join(process.argv[1],'publish-maintenance.lock'),'PRIVATE_REPLACED_MAINTENANCE');
        if(k==='pointer')await fs.writeFile(join(process.argv[1],'current-release.json'),'PRIVATE_REPLACED_POINTER');
        if(k==='intent')await fs.writeFile(join(process.argv[1],'reconciliation-resume-'+process.argv[4]+'.intent.json'),'PRIVATE_REPLACED_INTENT');};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{await unlink(...a);if(process.argv[3]==='archive-after-unlink'&&a[0].endsWith('publish-resume.lock'))await fs.writeFile(archive,'PRIVATE_REPLACED_ARCHIVE');};
      syncBuiltinESMExports();const{finalizeResumptionGuard}=await import(${JSON.stringify(closeModule)});
      try{await finalizeResumptionGuard(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{console.log('preserved');}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, resume.operationId], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr); await assert.rejects(access(join(directory, `resumption-review-${review.operationId}.json`)));
    assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    if (kind === "owner") assert.equal(await readFile(join(directory, "publish-recovery.lock"), "utf8"), "PRIVATE_REPLACED_OWNER");
    else await access(join(directory, "publish-recovery.lock"));
  });
});

test("archivo, intención o recibo de cierre alterados impiden replay y diagnóstico ready aun sin mantenimiento", async () => {
  for (const kind of ["archive", "intent", "receipt"]) await temporary(async directory => {
    await orphanedResume(directory); const review = reviewFor(await prepareResumptionGuardReview(directory));
    await finalizeResumptionGuard(directory, review); await finalizeMaintenance(directory, maintenanceReview(await prepareMaintenanceReview(directory)));
    const name = kind === "archive" ? `publish-resume-orphan-${review.operationId}.lock` : `resumption-review-${review.operationId}${kind === "intent" ? ".intent" : ""}.json`;
    await writeFile(join(directory, name), "PRIVATE_TAMPER");
    const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.resumptionReviews.pending.length, 1); assert.ok(!JSON.stringify(status).includes("PRIVATE_TAMPER"));
    await assert.rejects(finalizeResumptionGuard(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("CLI exige revisión nueva, diagnostica sin intervenir e invalida reporte anterior al fallar", () => temporary(async directory => {
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0);
  await orphanedResume(directory); const before = await snapshot(directory);
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), before);
  const plan = JSON.parse(await readFile(join(artifacts, "web-resume-guard-plan.json"), "utf8")), reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(reviewFor(plan)));
  const applied = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]); assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resume-guard-result.json"), "utf8")).finalized, true);
  const invalid = run(["--apply", "--secret=PRIVATE_ARGUMENT"]); assert.equal(invalid.status, 1); assert.ok(!(invalid.stdout + invalid.stderr).includes("PRIVATE_ARGUMENT"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resume-guard-result.json"), "utf8")).resultConfirmed, false);
  assert.equal(run(["--plan", "--plan", `--directory=${directory}`]).status, 1);
  assert.equal(run(["--inspect", `--directory=${directory}`, `--review=${reviewPath}`]).status, 1);
}));

test("fallo de E/S tras retirar fuente conserva recuperación e informa resultado incierto sin revelar excepción", () => temporary(async directory => {
  await orphanedResume(directory); const review = reviewFor(await prepareResumptionGuardReview(directory)), reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(review));
  const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const id=process.argv[4],open=fs.open;fs.open=async(...a)=>{if(String(a[0]).endsWith('resumption-review-'+id+'.json'))throw new Error('PRIVATE_IO_FAILURE');return open(...a);};
    syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];
    await import(${JSON.stringify(closeModule)});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, cli, directory, reviewPath, review.operationId], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 1); assert.ok(!(child.stdout + child.stderr).includes("PRIVATE_IO_FAILURE"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resume-guard-result.json"), "utf8")).resultConfirmed, false);
  await access(join(directory, "publish-recovery.lock")); await assert.rejects(access(join(directory, "publish-resume.lock")));
  const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review"); assert.equal(status.resumptionReviews.pending.length, 1);
}));
