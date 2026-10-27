import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, access, readdir, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectClosureResumption, prepareClosureResumption, resumeClosure } from "../closure-resumption.mjs";
import { inspectRecoveryStatus, closureNames } from "../recovery-status.mjs";
import { acquirePublicationLock, recoverPublicationLock } from "../publication-lock.mjs";
import { applyRecoveryReconciliation } from "../recovery-reconciliation.mjs";
import { resumeRecoveryReconciliation } from "../recovery-resumption.mjs";
import { finalizeResumptionGuard } from "../resumption-guard-review.mjs";
import { prepareMaintenanceReview, finalizeMaintenance } from "../maintenance-review.mjs";
import { temporary, snapshot, pauseChild, interruptedClosure, closureModule, stages } from "./support/closure-fixtures.mjs";

const cli = fileURLToPath(new URL("../closure-resumption.mjs", import.meta.url));
const artifacts = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const reviewFor = plan => ({ operationId: randomUUID(), decision: "resume-local-closure", reviewer: "Fixture revisión nueva", planSha256: plan.planSha256 });

test("ambos cierres se reanudan desde cuatro etapas preservando bytes/recibos y dejando mantenimiento separado", async () => {
  for (const kind of ["maintenance", "resumption"]) for (const stage of stages) await temporary(async directory => {
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "a".repeat(64) }));
    await writeFile(join(directory, "private-catalog.json"), "PRIVATE_PRODUCTS_CONTACTS");
    const { close } = await interruptedClosure(directory, kind, stage), before = await snapshot(directory);
    const proposal = await prepareClosureResumption(directory), inspection = await inspectClosureResumption(directory);
    assert.equal(inspection.eligible, true); assert.equal(proposal.stage, stage); assert.equal(proposal.closureKind, kind);
    assert.ok(!JSON.stringify(proposal).includes("PRIVATE_PRODUCTS_CONTACTS")); assert.deepEqual(await snapshot(directory), before);
    const names = closureNames(kind, close.operationId), origin = JSON.parse(await readFile(join(directory, names.intent), "utf8"));
    assert.equal(origin.schemaVersion, 2); assert.equal(origin.recoverySha256, proposal.plan.recoverySha256);
    const review = reviewFor(proposal), result = await resumeClosure(directory, review), after = await snapshot(directory);
    assert.equal(result.resumed, true); assert.equal(result.replayed, false);
    for (const [name, raw] of Object.entries(before)) {
      if (name === "publish-recovery.lock") assert.equal(after[`publish-closure-recovery-orphan-${review.operationId}.lock`], raw);
      else if (name === names.source) assert.equal(after[names.archive], raw);
      else assert.equal(after[name], raw, name);
    }
    const receipt = JSON.parse(await readFile(join(directory, names.receipt), "utf8"));
    if (stage === "completed-before-release") assert.equal(receipt.schemaVersion, 1);
    else { assert.equal(receipt.schemaVersion, 2); assert.equal(receipt.closureResumptionId, review.operationId); assert.ok(receipt.completedAt >= origin.createdAt); }
    await assert.rejects(access(join(directory, names.source))); await assert.rejects(access(join(directory, "publish-recovery.lock")));
    await assert.rejects(access(join(directory, "publish-finalization.lock")));
    let status = await inspectRecoveryStatus(directory);
    assert.equal(status.closureResumptions.completed.length, 1); assert.equal(status.closureResumptions.pending.length, 0);
    assert.equal((kind === "maintenance" ? status.maintenanceReviews : status.resumptionReviews).pending.length, 0);
    if (kind === "resumption") {
      assert.equal(status.status, "needs-review"); assert.equal(status.maintenance.state, "inactive");
      const maintenance = await prepareMaintenanceReview(directory);
      await finalizeMaintenance(directory, { operationId: randomUUID(), decision: "archive-completed-maintenance", reviewer: "Fixture separado", planSha256: maintenance.planSha256 });
    }
    status = await inspectRecoveryStatus(directory); assert.equal(status.status, "ready");
    await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    const later = await snapshot(directory);
    assert.equal((await resumeClosure(directory, review)).replayed, true); assert.deepEqual(await snapshot(directory), later);
    if (kind === "maintenance") assert.equal((await finalizeMaintenance(directory, close)).replayed, true);
    else assert.equal((await finalizeResumptionGuard(directory, close)).replayed, true);
    const release = await acquirePublicationLock(directory); await release();
  });
});

test("registro histórico v1 completo o parcial se conserva y no recibe un vínculo de recuperación inventado", async () => {
  for (const kind of ["maintenance", "resumption"]) for (const stage of ["intent-only", "completed-before-release"]) await temporary(async directory => {
    const { close } = await interruptedClosure(directory, kind, stage), names = closureNames(kind, close.operationId);
    const intent = JSON.parse(await readFile(join(directory, names.intent), "utf8")); intent.schemaVersion = 1; delete intent.recoverySha256;
    const raw = JSON.stringify(intent); await writeFile(join(directory, names.intent), raw);
    if (stage === "completed-before-release") {
      const receipt = JSON.parse(await readFile(join(directory, names.receipt), "utf8")); receipt.intentSha256 = hash(raw);
      await writeFile(join(directory, names.receipt), JSON.stringify(receipt));
    }
    const before = await snapshot(directory), status = await inspectRecoveryStatus(directory), summary = kind === "maintenance" ? status.maintenanceReviews : status.resumptionReviews;
    assert.equal(summary.completed.length, Number(stage === "completed-before-release"));
    assert.equal((await inspectClosureResumption(directory)).stage, "unlinked-recovery-guard");
    await assert.rejects(prepareClosureResumption(directory)); await assert.rejects(resumeClosure(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("guardas activas/ajenas/inválidas/sin vínculo y evidencia ambigua o divergente se rechazan sin mutar", async () => {
  for (const kind of ["active", "foreign", "invalid", "unlinked", "ambiguous", "source", "receipt", "origin", "history", "finalization"]) await temporary(async directory => {
    const { close, original } = await interruptedClosure(directory, "maintenance", "source-archived"), names = closureNames("maintenance", close.operationId);
    if (["active", "foreign", "unlinked"].includes(kind)) {
      const path = join(directory, "publish-recovery.lock"), owner = JSON.parse(await readFile(path, "utf8"));
      if (kind === "active") owner.pid = process.pid;
      if (kind === "foreign") owner.host = hostname() + "-foreign";
      if (kind === "unlinked") owner.nonce = randomUUID();
      await writeFile(path, JSON.stringify(owner));
    }
    if (kind === "invalid") await writeFile(join(directory, "publish-recovery.lock"), "PRIVATE_INVALID_GUARD");
    if (kind === "ambiguous") {
      const intent = JSON.parse(await readFile(join(directory, names.intent), "utf8")); intent.operationId = randomUUID();
      await writeFile(join(directory, closureNames("maintenance", intent.operationId).intent), JSON.stringify(intent));
    }
    if (kind === "source") await writeFile(join(directory, names.source), "PRIVATE_SOURCE");
    if (kind === "receipt") await writeFile(join(directory, names.receipt), "PRIVATE_RECEIPT");
    if (kind === "origin") await writeFile(join(directory, `recovery-reconciliation-${original.operationId}.json`), "PRIVATE_ORIGIN");
    if (kind === "history") await writeFile(join(directory, `closure-resumption-${randomUUID()}.intent.json`), "{}");
    if (kind === "finalization") await writeFile(join(directory, "publish-finalization.lock"), "PRIVATE_OLD_GUARD");
    const before = await snapshot(directory), report = await inspectClosureResumption(directory);
    assert.equal(report.eligible, false, kind); assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    await assert.rejects(prepareClosureResumption(directory)); await assert.rejects(resumeClosure(directory, reviewFor({ planSha256: "a".repeat(64) })));
    assert.deepEqual(await snapshot(directory), before, kind);
  });
});

test("revisión exacta ligada a directorio, puntero, historial y cada huella impide aplicar planes obsoletos", async () => {
  for (const kind of ["hash", "extra", "closure-id", "original-id", "pointer", "history", "guard", "directory"]) await temporary(async directory => {
    const { close, original } = await interruptedClosure(directory, "maintenance", "source-removed");
    const proposal = await prepareClosureResumption(directory), review = reviewFor(proposal);
    if (kind === "hash") review.planSha256 = "a".repeat(64);
    if (kind === "extra") review.secret = "PRIVATE_EXTRA";
    if (kind === "closure-id") review.operationId = close.operationId;
    if (kind === "original-id") review.operationId = original.operationId;
    if (kind === "pointer") await writeFile(join(directory, "current-release.json"), JSON.stringify({ release: randomUUID(), integrity: "b".repeat(64) }));
    if (kind === "history") await writeFile(join(directory, `maintenance-review-${randomUUID()}.intent.json`), "{}");
    if (kind === "guard") { const path = join(directory, "publish-recovery.lock"), owner = JSON.parse(await readFile(path, "utf8")); owner.nonce = randomUUID(); await writeFile(path, JSON.stringify(owner)); }
    if (kind === "directory") await temporary(async other => {
      for (const name of await readdir(directory)) await writeFile(join(other, name), await readFile(join(directory, name)));
      const before = await snapshot(other); await assert.rejects(resumeClosure(other, review)); assert.deepEqual(await snapshot(other), before);
    });
    if (kind !== "directory") { const before = await snapshot(directory); await assert.rejects(resumeClosure(directory, review)); assert.deepEqual(await snapshot(directory), before, kind); }
  });
});

test("dos revisores concurrentes completan un solo cierre y no duplican recibos", () => temporary(async directory => {
  await interruptedClosure(directory, "maintenance", "intent-only");
  const proposal = await prepareClosureResumption(directory);
  const results = await Promise.allSettled([resumeClosure(directory, reviewFor(proposal)), resumeClosure(directory, reviewFor(proposal))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const status = await inspectRecoveryStatus(directory); assert.equal(status.status, "ready"); assert.equal(status.closureResumptions.completed.length, 1);
}));

test("cortes durante la nueva revisión conservan exclusión de todas las herramientas y nunca habilitan ready", async () => {
  for (const stage of ["before-source-link", "before-source-unlink", "before-old-receipt", "before-recovery-link", "after-recovery-unlink", "before-release"]) await temporary(async directory => {
    const { close, original } = await interruptedClosure(directory, "maintenance", "intent-only"), names = closureNames("maintenance", close.operationId);
    const review = reviewFor(await prepareClosureResumption(directory));
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
      const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='before-source-link'&&a[0].endsWith('publish-maintenance.lock'))await pause();
        if(process.argv[3]==='before-recovery-link'&&a[0].endsWith('publish-recovery.lock'))await pause();await link(...a);};
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='before-source-unlink'&&a[0].endsWith('publish-maintenance.lock'))await pause();
        if(process.argv[3]==='before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();await unlink(...a);
        if(process.argv[3]==='after-recovery-unlink'&&a[0].endsWith('publish-recovery.lock'))await pause();};
      const open=fs.open;fs.open=async(...a)=>{if(process.argv[3]==='before-old-receipt'&&String(a[0]).endsWith(process.argv[4]))await pause();return open(...a);};
      syncBuiltinESMExports();const{resumeClosure}=await import(${JSON.stringify(closureModule)});await resumeClosure(process.argv[1],JSON.parse(process.argv[2]));`;
    await pauseChild(code, [directory, JSON.stringify(review), stage, names.receipt], async (_, stop) => {
      assert.equal((await inspectRecoveryStatus(directory)).status, "finalizing");
      await assert.rejects(acquirePublicationLock(directory));
      await assert.rejects(recoverPublicationLock(directory, { decision: "recover-local-lock", reviewer: "Fixture", sha256: "a".repeat(64) }));
      await assert.rejects(applyRecoveryReconciliation(directory, original));
      await assert.rejects(resumeRecoveryReconciliation(directory, { ...original, decision: "resume-local-reconciliation" }));
      await assert.rejects(finalizeMaintenance(directory, close));
      await assert.rejects(finalizeResumptionGuard(directory, { ...close, decision: "archive-completed-resumption" }));
      await assert.rejects(resumeClosure(directory, review));
      await stop();
      const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
      assert.equal(status.status, "needs-review"); assert.equal(status.finalization.state, "inactive");
      assert.equal(status.closureResumptions.completed.length, Number(stage === "before-release"));
      assert.equal((await inspectClosureResumption(directory)).stage, "finalization-inactive");
      await assert.rejects(prepareClosureResumption(directory)); await assert.rejects(resumeClosure(directory, review));
      assert.deepEqual(await snapshot(directory), before);
    });
  });
});

test("sustitución durante enlace/retirada conserva guarda y no certifica el nuevo cierre", async () => {
  for (const kind of ["owner", "source", "recovery", "intent", "archive", "pointer"]) await temporary(async directory => {
    const { close } = await interruptedClosure(directory, "maintenance", "intent-only"), names = closureNames("maintenance", close.operationId);
    const review = reviewFor(await prepareClosureResumption(directory));
    const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{join}from'node:path';
      const link=fs.link;fs.link=async(...a)=>{await link(...a);const k=process.argv[3];
        const target=k==='owner'?'publish-finalization.lock':k==='source'?'publish-maintenance.lock':k==='recovery'?'publish-recovery.lock':k==='intent'?process.argv[4]:k==='archive'?process.argv[5]:'current-release.json';
        await fs.writeFile(join(process.argv[1],target),'PRIVATE_REPLACEMENT');};
      syncBuiltinESMExports();const{resumeClosure}=await import(${JSON.stringify(closureModule)});
      try{await resumeClosure(process.argv[1],JSON.parse(process.argv[2]));process.exitCode=2;}catch{console.log('preserved');}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, directory, JSON.stringify(review), kind, names.intent, names.archive], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr); await assert.rejects(access(join(directory, `closure-resumption-${review.operationId}.json`)));
    await access(join(directory, "publish-finalization.lock")); assert.equal((await inspectRecoveryStatus(directory)).status, "needs-review");
    if (kind === "owner") assert.equal(await readFile(join(directory, "publish-finalization.lock"), "utf8"), "PRIVATE_REPLACEMENT");
  });
});

test("alteraciones históricas de intención, archivo, recibos o vínculo v2 impiden replay y ready sin guardas", async () => {
  for (const kind of ["intent", "archive", "receipt", "old-receipt", "borrowed-link"]) await temporary(async directory => {
    const { close } = await interruptedClosure(directory, "maintenance", "source-removed"), names = closureNames("maintenance", close.operationId);
    const review = reviewFor(await prepareClosureResumption(directory)); await resumeClosure(directory, review);
    if (kind === "borrowed-link") {
      const original = JSON.parse(await readFile(join(directory, names.receipt), "utf8")); original.closureResumptionId = randomUUID();
      const raw = JSON.stringify(original); await writeFile(join(directory, names.receipt), raw);
      const receipt = JSON.parse(await readFile(join(directory, `closure-resumption-${review.operationId}.json`), "utf8")); receipt.closureReceiptSha256 = hash(raw);
      await writeFile(join(directory, `closure-resumption-${review.operationId}.json`), JSON.stringify(receipt));
    } else {
      const name = kind === "intent" ? `closure-resumption-${review.operationId}.intent.json` : kind === "archive" ?
        `publish-closure-recovery-orphan-${review.operationId}.lock` : kind === "receipt" ? `closure-resumption-${review.operationId}.json` : names.receipt;
      await writeFile(join(directory, name), "PRIVATE_TAMPER");
    }
    const before = await snapshot(directory), status = await inspectRecoveryStatus(directory);
    assert.equal(status.status, "needs-review"); assert.equal(status.closureResumptions.pending.length, 1);
    assert.equal(status.maintenanceReviews.pending.length, 1); assert.ok(!JSON.stringify(status).includes("PRIVATE_"));
    await assert.rejects(resumeClosure(directory, review)); assert.deepEqual(await snapshot(directory), before);
  });
});

test("el límite reserva toda la evidencia futura y rechaza sin truncar historial", () => temporary(async directory => {
  await interruptedClosure(directory, "maintenance", "intent-only");
  const sourceName = (await readdir(directory)).find(name => /^publish-orphan-/.test(name)), raw = await readFile(join(directory, sourceName)), owner = JSON.parse(raw);
  const writes = [], current = (await readdir(directory)).length + 2; // absent fixed resume/finalization entries
  for (let count = current; count < 601; count += 2) {
    const id = randomUUID(); writes.push(writeFile(join(directory, `publish-orphan-${id}.lock`), raw), writeFile(join(directory, `lock-recovery-${id}.json`),
      JSON.stringify({ owner: { ...owner, sha256: hash(raw), active: false }, reviewer: "Fixture límite", decision: "recover-local-lock", createdAt: new Date().toISOString() })));
  }
  await Promise.all(writes);
  const before = await snapshot(directory), report = await inspectClosureResumption(directory);
  assert.equal(report.stage, "history-limit"); await assert.rejects(prepareClosureResumption(directory)); assert.deepEqual(await snapshot(directory), before);
}));

test("diagnóstico y CLI separados exigen revisión nueva e invalidan resultados anteriores al fallar", () => temporary(async directory => {
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal((await inspectClosureResumption(directory)).stage, "recovery-guard-absent");
  await interruptedClosure(directory, "resumption", "completed-before-release"); const before = await snapshot(directory);
  assert.equal(run(["--inspect", `--directory=${directory}`]).status, 0); assert.equal(run(["--plan", `--directory=${directory}`]).status, 0);
  assert.deepEqual(await snapshot(directory), before);
  const proposal = JSON.parse(await readFile(join(artifacts, "web-closure-resumption-plan.json"), "utf8")), reviewPath = join(directory, "fixture-review.json");
  await writeFile(reviewPath, JSON.stringify(reviewFor(proposal)));
  const applied = run(["--apply", `--directory=${directory}`, `--review=${reviewPath}`]); assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-closure-resumption-result.json"), "utf8")).resumed, true);
  const bad = run(["--apply", "--secret=PRIVATE_ARGUMENT"]); assert.equal(bad.status, 1); assert.ok(!(bad.stdout + bad.stderr).includes("PRIVATE_ARGUMENT"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-closure-resumption-result.json"), "utf8")).resultConfirmed, false);
  assert.equal(run(["--plan", "--plan", `--directory=${directory}`]).status, 1);
  assert.equal(run(["--inspect", `--directory=${directory}`, `--review=${reviewPath}`]).status, 1);
}));

test("fallo al persistir el recibo nuevo después de retirar recuperación mantiene ambas operaciones pendientes", () => temporary(async directory => {
  const { close } = await interruptedClosure(directory, "maintenance", "intent-only"), review = reviewFor(await prepareClosureResumption(directory));
  const reviewPath = join(directory, "fixture-review.json"); await writeFile(reviewPath, JSON.stringify(review));
  const code = `import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const id=process.argv[4],open=fs.open;fs.open=async(...a)=>{if(String(a[0]).endsWith('closure-resumption-'+id+'.json'))throw new Error('PRIVATE_IO_FAILURE');return open(...a);};
    syncBuiltinESMExports();process.argv=[process.execPath,process.argv[1],'--apply','--directory='+process.argv[2],'--review='+process.argv[3]];await import(${JSON.stringify(closureModule)});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, cli, directory, reviewPath, review.operationId], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 1); assert.ok(!(child.stdout + child.stderr).includes("PRIVATE_IO_FAILURE"));
  assert.equal(JSON.parse(await readFile(join(artifacts, "web-closure-resumption-result.json"), "utf8")).resultConfirmed, false);
  await access(join(directory, "publish-finalization.lock")); await assert.rejects(access(join(directory, "publish-recovery.lock")));
  const original = JSON.parse(await readFile(join(directory, closureNames("maintenance", close.operationId).receipt), "utf8")); assert.equal(original.schemaVersion, 2);
  let status = await inspectRecoveryStatus(directory); assert.equal(status.closureResumptions.pending.length, 1); assert.equal(status.maintenanceReviews.pending.length, 1);
  // Loss of the guard does not make an unfinished/altered journal ready.
  await unlink(join(directory, "publish-finalization.lock")); status = await inspectRecoveryStatus(directory); assert.equal(status.status, "needs-review");
}));

test("una guarda de finalización corrupta o simbólica bloquea publicadores sin divulgarla", () => temporary(async directory => {
  await writeFile(join(directory, "publish-finalization.lock"), "PRIVATE_GUARD");
  await assert.rejects(acquirePublicationLock(directory)); const status = await inspectRecoveryStatus(directory);
  assert.equal(status.finalization.state, "invalid"); assert.equal(status.status, "needs-review"); assert.ok(!JSON.stringify(status).includes("PRIVATE_GUARD"));
  await unlink(join(directory, "publish-finalization.lock"));
  // Directory junctions are supported without Windows symlink privileges.
  await symlink(directory, join(directory, "publish-finalization.lock"), "junction");
  await assert.rejects(acquirePublicationLock(directory)); assert.equal((await inspectRecoveryStatus(directory)).finalization.state, "invalid");
  await unlink(join(directory, "publish-finalization.lock"));
}));
