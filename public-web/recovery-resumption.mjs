import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validOwner, validReconciliationIntent, validResumptionPlan, validResumptionIntent,
  inspectRecoveryStatus, evidenceNames, directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";
import { assertNoFinalization } from "./publication-lock.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Reanudación no elegible o revisión/evidencia desactualizada");
const scope = "Reanudación local revisada; no cierra mantenimiento ni autoriza publicación, activación o lanzamiento";
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "resume-local-reconciliation" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
async function historyHash(directory, originId, resumeId) {
  // The original archive/receipt are the only old evidence we may create.
  // Their bytes are verified separately; all other names and bytes stay bound.
  const skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock",
    `publish-recovery-orphan-${originId}.lock`, `recovery-reconciliation-${originId}.json`,
    `reconciliation-resume-${resumeId}.intent.json`, `reconciliation-resume-${resumeId}.json`]);
  const entries = [];
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function acknowledgedIntact(directory, origin) {
  for (const item of origin.plan.acknowledgedArchives) {
    const archive = await fileState(join(directory, `publish-orphan-${item.id}.lock`));
    if (ownership(archive).state !== "inactive" || archive.sha256 !== item.sha256) throw fail();
    await absent(join(directory, `lock-recovery-${item.id}.json`));
  }
}
async function observe(directory, owned = false) {
  const status = await inspectRecoveryStatus(directory);
  const base = { schemaVersion: 1, scope, coordinationStatus: status.status, eligible: false };
  const blocked = stage => ({ ...base, status: "blocked-review", stage });
  if (["changed", "invalid"].includes(status.status)) return blocked(status.status);
  if (status.reconciliationAbortContinuations.pending.length) return blocked("abort-continuation-needs-review");
  if (status.resumptionAbortContinuations.pending.length) return blocked("resumption-abort-continuation-needs-review");
  if (status.closureAbortContinuations.pending.length) return blocked("closure-abort-continuation-needs-review");
  if (status.abortContinuationFinalizations.pending.length) return blocked("abort-continuation-finalization-needs-review");
  if (status.closureAborts.pending.length) return blocked("closure-abort-needs-review");
  if (status.resumptionAborts.pending.length) return blocked("resumption-abort-needs-review");
  if (status.resumptionContinuations.pending.length) return blocked("continuation-needs-review");
  if (status.reconciliationAborts.pending.length) return blocked("abort-needs-review");
  if (status.finalization.state !== "absent" || status.closureResumptions.pending.length) return blocked("closure-needs-review");
  if ((!owned && status.resumption.state !== "absent") || status.resumptions.pending.length || status.resumptionReviews.pending.length) return blocked("resumption-needs-review");
  if (status.maintenance.state === "absent") return { ...base, status: "not-needed", stage: "maintenance-absent" };
  if (status.maintenance.state !== "inactive") return blocked(`maintenance-${status.maintenance.state}`);
  const candidates = [];
  for (const { operationId: id } of [...status.reconciliations.completed, ...status.reconciliations.pending]) {
    const intent = await fileState(join(directory, `recovery-reconciliation-${id}.intent.json`));
    if (intent.kind === "present" && validReconciliationIntent(intent.value, id) && intent.value.schemaVersion === 2 &&
      intent.value.maintenanceSha256 === status.maintenance.sha256) candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-maintenance");
  const { id, intent } = candidates[0], origin = intent.value;
  const receipt = await fileState(join(directory, `recovery-reconciliation-${id}.json`));
  if (receipt.kind !== "absent") return blocked("receipt-present");
  if (!status.reconciliations.pending.some(item => item.operationId === id) ||
    status.reconciliations.pending.some(item => item.operationId !== id) || status.maintenanceReviews.pending.length ||
    !["absent", "inactive"].includes(status.publication.state)) return blocked("divergent-evidence");
  const ackIds = origin.plan.acknowledgedArchives.map(item => item.id).sort();
  if (status.archives.pending.some(item => item.issue !== "missing-record") ||
    JSON.stringify(status.archives.pending.map(item => item.id).sort()) !== JSON.stringify(ackIds)) return blocked("divergent-evidence");
  let pointerSha256;
  try { pointerSha256 = await pointerHash(directory); await acknowledgedIntact(directory, origin); }
  catch { return blocked("divergent-evidence"); }
  const directorySha256 = await directoryDigest(directory), publicationSha256 = status.publication.sha256 || null;
  if (directorySha256 !== origin.plan.directorySha256 || publicationSha256 !== origin.plan.publicationSha256 ||
    pointerSha256 !== origin.plan.pointerSha256) return blocked("divergent-evidence");
  const source = await fileState(join(directory, "publish-recovery.lock"));
  const archive = await fileState(join(directory, `publish-recovery-orphan-${id}.lock`));
  const sourceValid = ownership(source).state === "inactive" && source.sha256 === origin.plan.guardSha256;
  const archiveValid = ownership(archive).state === "inactive" && archive.sha256 === origin.plan.guardSha256;
  let stage;
  if (sourceValid && archive.kind === "absent") stage = "intent-only";
  else if (sourceValid && archiveValid) stage = "guard-archived";
  else if (source.kind === "absent" && archiveValid) stage = "guard-removed";
  else return blocked("divergent-evidence");
  // Reserve room for both new journals and the original missing evidence.
  if ((await evidenceNames(directory)).length + 4 > 605) return blocked("history-limit");
  const plan = { schemaVersion: 1, decision: "resume-local-reconciliation", directorySha256,
    maintenanceSha256: status.maintenance.sha256, reconciliationId: id, intentSha256: intent.sha256, stage,
    sourceGuardSha256: source.sha256 || null, archivedGuardSha256: archive.sha256 || null,
    publicationSha256, pointerSha256, historySha256: await historyHash(directory, id) };
  if (!validResumptionPlan(plan)) throw fail();
  return { ...base, status: "prepared-local", stage, eligible: true, planSha256: planDigest(plan), plan };
}
export async function inspectResumption(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareRecoveryResumption(directory = join(root, "dist")) {
  const result = await inspectResumption(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, resumeId, sourcePresent, archivePresent, receiptSha256 = null) {
  const maintenance = await fileState(join(directory, "publish-maintenance.lock"));
  const publication = await fileState(join(directory, "publish.lock"));
  const source = await fileState(join(directory, "publish-recovery.lock"));
  const archive = await fileState(join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`));
  const intent = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.intent.json`));
  const receipt = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`));
  const origin = intent.value;
  if (ownership(maintenance).state !== "inactive" || maintenance.sha256 !== plan.maintenanceSha256 ||
    intent.sha256 !== plan.intentSha256 || !validReconciliationIntent(origin, plan.reconciliationId) || origin.schemaVersion !== 2 ||
    origin.maintenanceSha256 !== plan.maintenanceSha256 || !["absent", "inactive"].includes(ownership(publication).state) ||
    (publication.sha256 || null) !== plan.publicationSha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 ||
    (sourcePresent ? ownership(source).state !== "inactive" || source.sha256 !== origin.plan.guardSha256 : source.kind !== "absent") ||
    (archivePresent ? ownership(archive).state !== "inactive" || archive.sha256 !== origin.plan.guardSha256 : archive.kind !== "absent") ||
    (receiptSha256 === null ? receipt.kind !== "absent" : receipt.kind !== "present" || receipt.sha256 !== receiptSha256) ||
    await historyHash(directory, plan.reconciliationId, resumeId) !== plan.historySha256) throw fail();
  await acknowledgedIntact(directory, origin);
}
export async function resumeRecoveryReconciliation(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  const initial = await inspectRecoveryStatus(directory);
  if (["invalid", "changed"].includes(initial.status) || !["absent", "inactive"].includes(initial.recovery.state)) throw fail();
  await assertNoFinalization(directory);
  const guardPath = join(directory, "publish-resume.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    await assertNoFinalization(directory);
    if (!["absent", "inactive"].includes(ownership(await fileState(join(directory, "publish-recovery.lock"))).state)) throw fail();
    const id = review.operationId, intentPath = join(directory, `reconciliation-resume-${id}.intent.json`);
    const receiptPath = join(directory, `reconciliation-resume-${id}.json`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["changed", "invalid"].includes(status.status) || !validResumptionIntent(previous.value, id) || previous.value.reviewer !== review.reviewer || previous.value.planSha256 !== review.planSha256 ||
        !status.resumptions?.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned();
      return { resumed: true, operationId: id, replayed: true };
    }
    await absent(receiptPath);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.reconciliationId) throw fail();
    let sourcePresent = plan.sourceGuardSha256 !== null, archivePresent = plan.archivedGuardSha256 !== null;
    await unchanged(directory, plan, id, sourcePresent, archivePresent); await owned();
    const intent = JSON.stringify({ schemaVersion: 2, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, resumptionSha256: hash(raw), createdAt: new Date().toISOString() });
    // No automatic retry/cleanup once any intent write has been attempted.
    mutation = true; await writeExclusive(intentPath, intent);
    const ourIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    await unchanged(directory, plan, id, sourcePresent, archivePresent); await owned(); await ourIntent();
    if (!archivePresent) {
      await link(join(directory, "publish-recovery.lock"), join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`));
      archivePresent = true;
    }
    await unchanged(directory, plan, id, sourcePresent, archivePresent); await owned(); await ourIntent();
    if (sourcePresent) {
      await unlink(join(directory, "publish-recovery.lock")); sourcePresent = false;
    }
    await unchanged(directory, plan, id, sourcePresent, archivePresent); await owned(); await ourIntent();
    const originReceiptPath = join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`);
    const originReceipt = JSON.stringify({ schemaVersion: 2, operationId: plan.reconciliationId, decision: "reconcile-local-recovery",
      intentSha256: plan.intentSha256, resumptionId: id, resumptionIntentSha256: hash(intent), completedAt: new Date().toISOString() });
    await writeExclusive(originReceiptPath, originReceipt);
    await unchanged(directory, plan, id, false, true, hash(originReceipt)); await owned(); await ourIntent();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision,
      intentSha256: hash(intent), reconciliationReceiptSha256: hash(originReceipt), completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory);
    if (!result.resumptions?.completed.some(item => item.operationId === id) ||
      !result.reconciliations?.completed.some(item => item.operationId === plan.reconciliationId)) throw fail();
    await unchanged(directory, plan, id, false, true, hash(originReceipt)); await owned(); await ourIntent();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { resumed: true, operationId: id, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-resumption-status.json" : applying ? "web-resumption-result.json" : "web-resumption-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectResumption(directory) : applying ?
      await resumeRecoveryReconciliation(directory, (await fileState(resolve(reviewPath))).value) : await prepareRecoveryResumption(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Reanudación local: ${result.stage}.` : applying ? "Reanudación registrada; mantenimiento pendiente de revisión separada." : "Plan de reanudación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* No private paths, review values or filesystem errors in output. */ }
    console.error("No se completó la reanudación; conserva bloqueos/evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
