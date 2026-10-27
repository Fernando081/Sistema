import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { inspectResumption, prepareRecoveryResumption, resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { inspectRecoveryStatus } from "../recovery-status.mjs";
import { prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { prepareRecoveryReconciliation, applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { acquirePublicationLock, inspectPublicationLock, recoverPublicationLock } from "../publication-lock.mjs";

const lockModule = new URL("../publication-lock.mjs", import.meta.url).href;
const reconciliationModule = new URL("../recovery-reconciliation.mjs", import.meta.url).href;
const resumptionModule = new URL("../recovery-resumption.mjs", import.meta.url).href;
const cli = fileURLToPath(new URL("../recovery-resumption.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const digest = raw => createHash("sha256").update(raw).digest("hex");
const reviewFor = plan => ({ operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture", planSha256: plan.planSha256 });
const closeFor = plan => ({ operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture cierre separado", planSha256: plan.planSha256 });
async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-resumption-test-"));
  try { await work(directory); } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("rtt-resumption-test-")) throw new Error("Temporal fuera de alcance");
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
    await Promise.race([once(child, "message"), exit.then(([status]) => { throw new Error(`Proceso fixture terminó ${status}: ${stderr}`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Proceso fixture no alcanzó etapa")), 10000); })]);
    clearTimeout(timer);
    await work(child, async () => { child.kill(); await exit; });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; }
  }
}
async function interruptedRecovery(directory, beforeArchive = false) {
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `const {acquirePublicationLock}=await import(${JSON.stringify(lockModule)}); await acquirePublicationLock(process.argv[1]);`, directory],
    { stdio: "ignore", windowsHide: true });
  assert.equal((await once(child, "exit"))[0], 0);
  const owner = await inspectPublicationLock(directory);
  const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const rename=fs.rename;fs.rename=async(...args)=>{if(process.argv[3]!=='before')await rename(...args);
      process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};syncBuiltinESMExports();
    const{recoverPublicationLock}=await import(${JSON.stringify(lockModule)});
    await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[2]});`;
  await pauseChild(code, [directory, owner.sha256, beforeArchive ? "before" : "after"], async (_, stop) => stop());
  return owner;
}
async function orphanedMaintenance(directory, stage = "intent", beforeArchive = false) {
  const owner = await interruptedRecovery(directory, beforeArchive);
  const prepared = await prepareRecoveryReconciliation(directory);
  const review = { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture inicial", planSha256: prepared.planSha256 };
  const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...args)=>{if(process.argv[3]==='intent')await pause();await link(...args);if(process.argv[3]==='archive')await pause();};
    const unlink=fs.unlink;fs.unlink=async(...args)=>{await unlink(...args);if(process.argv[3]==='removed'&&args[0].endsWith('publish-recovery.lock'))await pause();};
    syncBuiltinESMExports();const{applyRecoveryReconciliation}=await import(${JSON.stringify(reconciliationModule)});
    await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`;
  await pauseChild(code, [directory, JSON.stringify(review), stage], async (_, stop) => stop());
  assert.equal((await inspectRecoveryStatus(directory)).maintenance.state, "inactive");
  return { owner, origin: review };
}

test("reanudación de las tres etapas conserva evidencia, completa recibo ligado y requiere cierre separado", async () => {
  for (const [stage, expected] of [["intent", "intent-only"], ["archive", "guard-archived"], ["removed", "guard-removed"]]) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCT_CONTACT_MARKER");
    const { origin } = await orphanedMaintenance(directory, stage), before = await snapshot(directory);
    const report = await inspectResumption(directory), plan = await prepareRecoveryResumption(directory);
    assert.equal(report.eligible, true); assert.equal(plan.status, "prepared-local"); assert.equal(plan.stage, expected);
    assert.deepEqual(await snapshot(directory), before); assert.ok(!JSON.stringify(plan).includes("PRIVATE_PRODUCT_CONTACT_MARKER"));
    const review = reviewFor(plan), result = await resumeRecoveryReconciliation(directory, review);
    assert.equal(result.resumed, true); assert.equal(result.replayed, false);
    const after = await snapshot(directory), guardArchive = `publish-recovery-orphan-${origin.operationId}.lock`;
    for (const [name, value] of Object.entries(before)) {
      if (name === "publish-recovery.lock") assert.equal(after[guardArchive], value);
      else assert.equal(after[name], value, name);
    }
    await assert.rejects(access(join(directory, "publish-recovery.lock")));
    await assert.rejects(access(join(directory, "publish-resume.lock")));
    const receipt = JSON.parse(await readFile(join(directory, `recovery-reconciliation-${origin.operationId}.json`), "utf8"));
    assert.equal(receipt.schemaVersion, 2); assert.equal(receipt.resumptionId, review.operationId);
    assert.match(receipt.resumptionIntentSha256, /^[a-f0-9]{64}$/);
    for (const name of await readdir(directory)) assert.ok(!name.startsWith("lock-recovery-"), "No inventa recuperación histórica");
    const status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive");
    assert.equal(status.reconciliations.pending.length, 0); assert.equal(status.resumptions.pending.length, 0);
    assert.ok(status.resumptions.completed.some(item => item.operationId === review.operationId));
    assert.equal((await resumeRecoveryReconciliation(directory, review)).replayed, true);
    assert.deepEqual(await snapshot(directory), after);
    await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
    assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    const closed = await snapshot(directory);
    assert.equal((await resumeRecoveryReconciliation(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), closed);
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const later = await snapshot(directory);
    assert.equal((await resumeRecoveryReconciliation(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), later);
    assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
    const release = await acquirePublicationLock(directory); await release();
  });
});

test("bloqueo ordinario previo sigue necesitando aprobación propia después de reanudar y cerrar mantenimiento", () => temporary(async directory => {
  const { owner } = await orphanedMaintenance(directory, "intent", true), raw = await readFile(join(directory, "publish.lock"), "utf8");
  await resumeRecoveryReconciliation(directory, reviewFor(await prepareRecoveryResumption(directory)));
  await finalizeMaintenance(directory, closeFor(await prepareMaintenanceReview(directory)));
  assert.equal(await readFile(join(directory, "publish.lock"), "utf8"), raw);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  await recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture aprobación independiente", sha256: owner.sha256 });
  assert.equal((await inspectRecoveryStatus(directory)).status, "ready");
}));

test("fuente v1, propietarios activos/ajenos, archivos inconsistentes, intención ambigua y recibo existente no se reanudan", async () => {
  for (const kind of ["v1", "active-maintenance", "foreign-maintenance", "legacy-maintenance", "active-guard", "foreign-guard", "active-resume", "foreign-resume", "intent-missing", "guard-missing", "ambiguous", "receipt", "archive", "ack-archive", "ack-record", "pending-history"]) await temporary(async directory => {
    const { origin } = await orphanedMaintenance(directory);
    if (kind === "v1") {
      const path = join(directory, `recovery-reconciliation-${origin.operationId}.intent.json`), value = JSON.parse(await readFile(path, "utf8"));
      value.schemaVersion = 1; delete value.maintenanceSha256; await writeFile(path, JSON.stringify(value));
    }
    if (kind.endsWith("maintenance") || kind.endsWith("guard")) {
      const path = join(directory, kind.endsWith("maintenance") ? "publish-maintenance.lock" : "publish-recovery.lock");
      if (kind.startsWith("legacy")) await writeFile(path, "PRIVATE_LEGACY_OWNER");
      else {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (kind.startsWith("active")) value.pid = process.pid; else value.host = hostname() + "-foreign";
        await writeFile(path, JSON.stringify(value));
      }
    }
    if (kind.endsWith("resume")) await writeFile(join(directory, "publish-resume.lock"), JSON.stringify({ schemaVersion: 1, pid: process.pid,
      host: kind.startsWith("foreign") ? hostname() + "-foreign" : hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() }));
    if (kind === "intent-missing") await rm(join(directory, `recovery-reconciliation-${origin.operationId}.intent.json`));
    if (kind === "guard-missing") await rm(join(directory, "publish-recovery.lock"));
    if (kind === "ambiguous") {
      const id = randomUUID(), value = JSON.parse(await readFile(join(directory, `recovery-reconciliation-${origin.operationId}.intent.json`), "utf8"));
      value.operationId = id; await writeFile(join(directory, `recovery-reconciliation-${id}.intent.json`), JSON.stringify(value));
    }
    if (kind === "receipt") await writeFile(join(directory, `recovery-reconciliation-${origin.operationId}.json`), "PRIVATE_EXISTING_RECEIPT");
    if (kind === "archive") await writeFile(join(directory, `publish-recovery-orphan-${origin.operationId}.lock`), "PRIVATE_ARCHIVE");
    if (kind === "ack-archive") {
      const path = join(directory, (await readdir(directory)).find(name => name.startsWith("publish-orphan-")));
      const value = JSON.parse(await readFile(path, "utf8")); value.nonce = randomUUID(); await writeFile(path, JSON.stringify(value));
    }
    if (kind === "ack-record") {
      const name = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
      await writeFile(join(directory, name.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json")), "{}");
    }
    if (kind === "pending-history") await writeFile(join(directory, `maintenance-review-${randomUUID()}.intent.json`), "{}");
    const before = await snapshot(directory), report = await inspectResumption(directory);
    assert.equal(report.eligible, false, kind); assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    await assert.rejects(prepareRecoveryResumption(directory));
    await assert.rejects(resumeRecoveryReconciliation(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("revisión exacta, ID distinto y cambios posteriores de guarda, mantenimiento, puntero o historia rechazan sin mutar", async () => {
  for (const kind of ["hash", "extra-review-field", "original-id", "guard", "maintenance", "pointer", "history", "directory"]) await temporary(async directory => {
    const { origin } = await orphanedMaintenance(directory), plan = await prepareRecoveryResumption(directory), review = reviewFor(plan);
    if (kind === "hash") review.planSha256 = "0".repeat(64);
    if (kind === "extra-review-field") review.secret = "PRIVATE_REVIEW_FIELD";
    if (kind === "original-id") review.operationId = origin.operationId;
    if (kind === "guard" || kind === "maintenance") {
      const path = join(directory, kind === "guard" ? "publish-recovery.lock" : "publish-maintenance.lock");
      const value = JSON.parse(await readFile(path, "utf8")); value.nonce = randomUUID(); await writeFile(path, JSON.stringify(value));
    }
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    if (kind === "history") await writeFile(join(directory, `publish-orphan-${randomUUID()}.lock`), await readFile(join(directory, "publish-maintenance.lock")));
    if (kind === "directory") return temporary(async copy => {
      for (const name of await readdir(directory)) await writeFile(join(copy, name), await readFile(join(directory, name)));
      const before = await snapshot(copy); await assert.rejects(resumeRecoveryReconciliation(copy, review)); assert.deepEqual(await snapshot(copy), before);
    });
    const before = await snapshot(directory); await assert.rejects(resumeRecoveryReconciliation(directory, review)); assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("dos revisores concurrentes producen una sola reanudación y ningún cierre automático", () => temporary(async directory => {
  await orphanedMaintenance(directory);
  const source = await readFile(join(directory, "publish-maintenance.lock"), "utf8"), plan = await prepareRecoveryResumption(directory);
  const outcomes = await Promise.allSettled([resumeRecoveryReconciliation(directory, reviewFor(plan)), resumeRecoveryReconciliation(directory, reviewFor(plan))]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal((await inspectRecoveryStatus(directory)).resumptions.completed.length, 1);
  assert.equal(await readFile(join(directory, "publish-maintenance.lock"), "utf8"), source);
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  assert.equal((await readdir(directory)).filter(name => /^reconciliation-resume-.*\.intent\.json$/.test(name)).length, 1);
}));

test("interrupción antes/después de enlace, retiro y escritura conserva exclusión y no permite reinicio automático", async () => {
  for (const stage of ["before-link", "after-link", "after-unlink", "before-receipt", "after-receipt"]) await temporary(async directory => {
    const { origin } = await orphanedMaintenance(directory), before = await snapshot(directory), review = reviewFor(await prepareRecoveryResumption(directory));
    const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...args)=>{if(process.argv[3]==='before-link')await pause();await link(...args);if(process.argv[3]==='after-link')await pause();};
      const unlink=fs.unlink;fs.unlink=async(...args)=>{await unlink(...args);if(process.argv[3]==='after-unlink'&&args[0].endsWith('publish-recovery.lock'))await pause();};
      const open=fs.open;fs.open=async(...args)=>{const receipt=String(args[0]).endsWith('recovery-reconciliation-'+process.argv[4]+'.json');
        if(receipt&&process.argv[3]==='before-receipt')await pause();const handle=await open(...args);
        if(receipt&&process.argv[3]==='after-receipt'){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();await pause();};}return handle;};
      syncBuiltinESMExports();const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumptionModule)});
      await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`;
    await pauseChild(code, [directory, JSON.stringify(review), stage, origin.operationId], async (_, stop) => {
      assert.equal((await inspectRecoveryStatus(directory)).status, "resuming");
      await assert.rejects(acquirePublicationLock(directory));
      await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
      await assert.rejects(finalizeMaintenance(directory, closeFor({ planSha256: "a".repeat(64) })));
      await assert.rejects(applyRecoveryReconciliation(directory, { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture", planSha256: "a".repeat(64) }));
      await assert.rejects(resumeRecoveryReconciliation(directory, review));
      await stop();
      const report = await inspectRecoveryStatus(directory), interrupted = await snapshot(directory);
      assert.equal(report.status, "needs-review"); assert.equal(report.resumptions.pending.length, 1);
      assert.ok(interrupted["publish-resume.lock"]); assert.ok(interrupted[`reconciliation-resume-${review.operationId}.intent.json`]);
      for (const [name, raw] of Object.entries(before)) {
        if (name === "publish-recovery.lock" && ["after-unlink", "before-receipt", "after-receipt"].includes(stage))
          assert.equal(interrupted[`publish-recovery-orphan-${origin.operationId}.lock`], raw);
        else assert.equal(interrupted[name], raw, name);
      }
      await assert.rejects(prepareRecoveryResumption(directory)); await assert.rejects(resumeRecoveryReconciliation(directory, review));
      assert.deepEqual(await snapshot(directory), interrupted);
    });
  });
});

test("cambios durante reanudación preservan bloqueos y no certifican un recibo original", async () => {
  for (const kind of ["resume-owner", "pointer", "history", "archive"]) await temporary(async directory => {
    const { origin } = await orphanedMaintenance(directory), source = await readFile(join(directory, "publish-maintenance.lock"), "utf8");
    const review = reviewFor(await prepareRecoveryResumption(directory));
    const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;fs.link=async(...args)=>{await link(...args);const kind=process.argv[3];
        if(kind==='resume-owner')await fs.writeFile(join(process.argv[1],'publish-resume.lock'),'PRIVATE_FOREIGN_GUARD');
        if(kind==='pointer')await fs.writeFile(join(process.argv[1],'current-release.json'),'PRIVATE_ALTERED_POINTER');
        if(kind==='history')await fs.writeFile(join(process.argv[1],'recovery-reconciliation-'+process.argv[4]+'.intent.json'),'PRIVATE_ALTERED_HISTORY');
        if(kind==='archive')await fs.writeFile(args[1],'PRIVATE_ALTERED_ARCHIVE');};
      syncBuiltinESMExports();const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumptionModule)});
      try{await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{console.log('preserved');}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, origin.operationId], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(await readFile(join(directory, "publish-maintenance.lock"), "utf8"), source);
    await assert.rejects(access(join(directory, `recovery-reconciliation-${origin.operationId}.json`)));
    assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    if (kind === "resume-owner") assert.equal(await readFile(join(directory, "publish-resume.lock"), "utf8"), "PRIVATE_FOREIGN_GUARD");
  });
});

test("intención o recibos alterados invalidan historial y replay sin sobrescribir evidencia", async () => {
  for (const kind of ["resume-intent", "resume-receipt", "original-receipt", "original-intent", "ack-archive", "ack-record"]) await temporary(async directory => {
    const { origin } = await orphanedMaintenance(directory), review = reviewFor(await prepareRecoveryResumption(directory));
    await resumeRecoveryReconciliation(directory, review);
    if (kind.startsWith("ack-")) {
      const archiveName = (await readdir(directory)).find(name => name.startsWith("publish-orphan-"));
      const archivePath = join(directory, archiveName), raw = await readFile(archivePath), owner = JSON.parse(raw);
      if (kind === "ack-archive") { owner.nonce = randomUUID(); await writeFile(archivePath, JSON.stringify(owner)); }
      else await writeFile(join(directory, archiveName.replace("publish-orphan-", "lock-recovery-").replace(".lock", ".json")), JSON.stringify({
        owner: { ...owner, sha256: digest(raw), active: false }, reviewer: "Fixture registro posterior simulado", decision: "recover-local-lock", createdAt: new Date().toISOString()
      }));
    } else {
      const name = kind.startsWith("resume") ? `reconciliation-resume-${review.operationId}${kind.endsWith("intent") ? ".intent" : ""}.json` :
        `recovery-reconciliation-${origin.operationId}${kind.endsWith("intent") ? ".intent" : ""}.json`;
      await writeFile(join(directory, name), "PRIVATE_TAMPER");
    }
    const before = await snapshot(directory), report = await inspectRecoveryStatus(directory);
    assert.equal(report.status, "needs-review"); assert.ok(report.resumptions.pending.length > 0); assert.ok(!JSON.stringify(report).includes("PRIVATE_TAMPER"));
    if (kind === "ack-record") assert.equal(report.archives.complete, 1, "Registro posterior construido con forma válida; no legitima la reanudación histórica");
    await assert.rejects(resumeRecoveryReconciliation(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("CLI diagnostica y prepara sin mutar; aplica con revisión exacta e invalida resultados anteriores al fallar", () => temporary(async directory => {
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0);
  await orphanedMaintenance(directory, "removed");
  const before = await snapshot(directory);
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), before);
  const plan = JSON.parse(await readFile(join(artifacts, "web-resumption-plan.json"), "utf8"));
  const reviewPath = join(directory, "fixture-review.json"); await writeFile(reviewPath, JSON.stringify(reviewFor(plan)));
  const applied = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-resumption-result.json"), "utf8")).resumed, true);
  const invalid = run(["--apply", "--secret=PRIVATE_MARKER"]);
  assert.equal(invalid.status, 1); assert.ok(!(invalid.stdout + invalid.stderr).includes("PRIVATE_MARKER"));
  const failed = JSON.parse(await readFile(join(artifacts, "web-resumption-result.json"), "utf8"));
  assert.equal(failed.resultConfirmed, false); assert.equal(failed.resumed, undefined); assert.equal(failed.applied, undefined);
  assert.equal(run(["--plan", "--plan", `--directory=${directory}`]).status, 1);
  assert.equal(run(["--inspect", `--directory=${directory}`, `--review=${reviewPath}`]).status, 1);
}));

test("CLI con fallo de escritura tras retirar guarda deja mantenimiento intacto y resultado incierto sin revelar excepción", () => temporary(async directory => {
  const { origin } = await orphanedMaintenance(directory), reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(reviewFor(await prepareRecoveryResumption(directory))));
  const maintenance = await readFile(join(directory, "publish-maintenance.lock"), "utf8");
  const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const originId=process.argv[4];const open=fs.open;fs.open=async(...args)=>{if(String(args[0]).endsWith('recovery-reconciliation-'+originId+'.json'))throw new Error('PRIVATE_IO_ERROR');return open(...args);};
    syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];
    await import(${JSON.stringify(resumptionModule)});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, cli, directory, reviewPath, origin.operationId], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 1); assert.ok(!(child.stdout + child.stderr).includes("PRIVATE_IO_ERROR"));
  const report = JSON.parse(await readFile(join(artifacts, "web-resumption-result.json"), "utf8"));
  assert.equal(report.resultConfirmed, false); assert.equal(report.resumed, undefined); assert.equal(report.applied, undefined);
  assert.equal(await readFile(join(directory, "publish-maintenance.lock"), "utf8"), maintenance);
  await assert.rejects(access(join(directory, "publish-recovery.lock")));
  await assert.rejects(access(join(directory, `recovery-reconciliation-${origin.operationId}.json`)));
  assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
  assert.equal((await inspectRecoveryStatus(directory)).resumptions.pending.length, 1);
}));

test("recibo original no puede atribuirse reanudación de otra reconciliación ni aceptar hash de intención falso", async () => {
  for (const kind of ["other-reconciliation", "false-intent-hash"]) await temporary(async directory => {
    await interruptedRecovery(directory);
    const initialPlan = await prepareRecoveryReconciliation(directory);
    const initialReview = { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture inicial X", planSha256: initialPlan.planSha256 };
    await applyRecoveryReconciliation(directory, initialReview);
    const { origin } = await orphanedMaintenance(directory), review = reviewFor(await prepareRecoveryResumption(directory));
    await resumeRecoveryReconciliation(directory, review);
    const originalPath = join(directory, `recovery-reconciliation-${initialReview.operationId}.json`);
    const value = JSON.parse(await readFile(originalPath, "utf8"));
    value.schemaVersion = 2; value.resumptionId = review.operationId;
    value.resumptionIntentSha256 = kind === "false-intent-hash" ? "0".repeat(64) :
      digest(await readFile(join(directory, `reconciliation-resume-${review.operationId}.intent.json`)));
    await writeFile(originalPath, JSON.stringify(value));
    const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
    assert.ok(status.reconciliations.pending.some(item => item.operationId === initialReview.operationId));
    assert.ok(!status.reconciliations.completed.some(item => item.operationId === initialReview.operationId));
    assert.ok(status.reconciliations.completed.some(item => item.operationId === origin.operationId));
    assert.ok(status.resumptions.completed.some(item => item.operationId === review.operationId));
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("interrupción después de ambos recibos conserva historial completado y guarda residual sin replay automático", () => temporary(async directory => {
  const { origin } = await orphanedMaintenance(directory), before = await snapshot(directory), review = reviewFor(await prepareRecoveryResumption(directory));
  const code = `import fs from 'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const unlink=fs.unlink;fs.unlink=async(...args)=>{if(args[0].endsWith('publish-resume.lock')){
      process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});}return unlink(...args);};
    syncBuiltinESMExports();const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumptionModule)});
    await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`;
  await pauseChild(code, [directory, JSON.stringify(review)], async (_, stop) => {
    const active = await inspectRecoveryStatus(directory);
    assert.equal(active.status, "resuming");
    assert.ok(active.resumptions.completed.some(item => item.operationId === review.operationId));
    assert.ok(active.reconciliations.completed.some(item => item.operationId === origin.operationId));
    await stop();
    const status = await inspectRecoveryStatus(directory), interrupted = await snapshot(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.resumption.state, "inactive");
    assert.equal(status.resumptions.pending.length, 0);
    assert.ok(status.resumptions.completed.some(item => item.operationId === review.operationId));
    assert.ok(status.reconciliations.completed.some(item => item.operationId === origin.operationId));
    assert.ok(interrupted["publish-resume.lock"]);
    for (const [name, raw] of Object.entries(before)) {
      if (name === "publish-recovery.lock") assert.equal(interrupted[`publish-recovery-orphan-${origin.operationId}.lock`], raw);
      else assert.equal(interrupted[name], raw, name);
    }
    await assert.rejects(resumeRecoveryReconciliation(directory, review));
    await assert.rejects(prepareRecoveryResumption(directory));
    await assert.rejects(finalizeMaintenance(directory, closeFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), interrupted);
  });
}));
