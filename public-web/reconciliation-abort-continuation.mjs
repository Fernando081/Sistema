import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validReconciliationIntent, validReconciliationAbortIntent, validReconciliationAbortReceipt,
  validReconciliationAbortContinuationPlan, validReconciliationAbortContinuationIntent, inspectRecoveryStatus,
  evidenceNames, directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";
import { reconciliationAbortHistoryHash } from "./reconciliation-abort.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Cancelación interrumpida no elegible o revisión/evidencia desactualizada");
const scope = "Continuación local revisada de cancelación de reconciliación; conserva resultado aborted, recibos existentes y bloqueos independientes";
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "continue-local-reconciliation-abort" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
const ownNames = id => [`reconciliation-abort-continuation-${id}.intent.json`, `reconciliation-abort-continuation-${id}.json`,
  `publish-continued-abort-finalization-${id}.lock`];
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
async function historyHash(directory, abortId, continuationId) {
  const entries = [], skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock",
    `publish-aborted-maintenance-${abortId}.lock`, `publish-aborted-recovery-${abortId}.lock`, `reconciliation-abort-${abortId}.json`, ...ownNames(continuationId)]);
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function originalContext(directory, abortId, intent, continuationId) {
  const origin = intent.value, plan = origin?.plan;
  if (!validReconciliationAbortIntent(origin, abortId)) throw fail();
  const original = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.intent.json`));
  const oldArchive = await fileState(join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`));
  const publication = await fileState(join(directory, "publish.lock"));
  if (!validReconciliationIntent(original.value, plan.reconciliationId) || original.value.schemaVersion !== 2 ||
    original.sha256 !== plan.intentSha256 || original.value.maintenanceSha256 !== plan.maintenanceSha256 ||
    original.value.plan.directorySha256 !== plan.directorySha256 || original.value.plan.publicationSha256 !== plan.publicationSha256 ||
    original.value.plan.pointerSha256 !== plan.pointerSha256 ||
    (plan.sourceGuardSha256 !== null && plan.sourceGuardSha256 !== original.value.plan.guardSha256) ||
    (plan.archivedGuardSha256 === null ? oldArchive.kind !== "absent" : ownership(oldArchive).state !== "inactive" ||
      oldArchive.sha256 !== plan.archivedGuardSha256 || oldArchive.sha256 !== original.value.plan.guardSha256) ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await reconciliationAbortHistoryHash(directory, abortId, ownNames(continuationId)) !== plan.historySha256) throw fail();
  await absent(join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`));
  for (const item of original.value.plan.acknowledgedArchives) {
    const archive = await fileState(join(directory, `publish-orphan-${item.id}.lock`));
    if (ownership(archive).state !== "inactive" || archive.sha256 !== item.sha256) throw fail();
    await absent(join(directory, `lock-recovery-${item.id}.json`));
  }
  return original.value;
}
async function observe(directory, ownResumption = false) {
  const status = await inspectRecoveryStatus(directory);
  const base = { schemaVersion: 1, scope, coordinationStatus: status.status, eligible: false };
  const blocked = stage => ({ ...base, status: "blocked-review", stage });
  if (["changed", "invalid"].includes(status.status)) return blocked(status.status);
  if (status.reconciliationAbortContinuations.pending.length) return blocked("abort-continuation-needs-review");
  if (status.resumptionAbortContinuations.pending.length) return blocked("resumption-abort-continuation-needs-review");
  if (status.closureAbortContinuations.pending.length) return blocked("closure-abort-continuation-needs-review");
  if (status.abortContinuationFinalizations.pending.length) return blocked("abort-continuation-finalization-needs-review");
  if (!ownResumption && status.resumption.state !== "absent") return blocked(`resumption-${status.resumption.state}`);
  if (status.finalization.state === "absent") return status.reconciliationAborts.pending.length ? blocked("finalization-absent") :
    { ...base, status: "not-needed", stage: "finalization-absent" };
  if (status.finalization.state !== "inactive") return blocked(`finalization-${status.finalization.state}`);
  if (status.resumptions.pending.length || status.resumptionReviews.pending.length || status.maintenanceReviews.pending.length ||
    status.closureResumptions.pending.length || status.resumptionContinuations.pending.length || status.resumptionAborts.pending.length ||
    status.closureAborts.pending.length) return blocked("other-operation-needs-review");
  const candidates = [];
  for (const { operationId: id } of [...status.reconciliationAborts.completed, ...status.reconciliationAborts.pending]) {
    const intent = await fileState(join(directory, `reconciliation-abort-${id}.intent.json`));
    if (validReconciliationAbortIntent(intent.value, id) && intent.value.finalizationSha256 === status.finalization.sha256) candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-finalization");
  const { id, intent } = candidates[0], original = intent.value;
  if (status.reconciliationAborts.pending.some(item => item.operationId !== id) ||
    status.reconciliations.pending.some(item => item.operationId !== original.plan.reconciliationId) ||
    status.reconciliationAbortContinuations.completed.some(item => item.abortId === id)) return blocked("divergent-evidence");
  try { await originalContext(directory, id, intent); } catch { return blocked("divergent-evidence"); }
  const maintenance = await fileState(join(directory, "publish-maintenance.lock")), recovery = await fileState(join(directory, "publish-recovery.lock"));
  const maintenanceArchive = await fileState(join(directory, `publish-aborted-maintenance-${id}.lock`));
  const recoveryArchive = await fileState(join(directory, `publish-aborted-recovery-${id}.lock`));
  const receipt = await fileState(join(directory, `reconciliation-abort-${id}.json`));
  for (const [state, expected] of [[maintenance, original.plan.maintenanceSha256], [maintenanceArchive, original.plan.maintenanceSha256],
    [recovery, original.plan.sourceGuardSha256], [recoveryArchive, original.plan.sourceGuardSha256]]) {
    if (state.kind !== "absent" && (expected === null || ownership(state).state !== "inactive" || state.sha256 !== expected)) return blocked("divergent-evidence");
  }
  if (receipt.kind !== "absent" && (receipt.kind !== "present" || receipt.value?.schemaVersion !== 1 ||
    !validReconciliationAbortReceipt(receipt.value, id, intent.sha256, original.plan.maintenanceSha256, original.plan.sourceGuardSha256))) return blocked("divergent-evidence");
  const plan = { schemaVersion: 1, decision: "continue-local-reconciliation-abort", directorySha256: original.plan.directorySha256,
    abortId: id, abortIntentSha256: intent.sha256, finalizationSha256: status.finalization.sha256, stage: "",
    initialRecoverySha256: original.plan.sourceGuardSha256, maintenancePresent: maintenance.kind === "present", recoveryPresent: recovery.kind === "present",
    maintenanceArchived: maintenanceArchive.kind === "present", recoveryArchived: recoveryArchive.kind === "present", abortReceiptSha256: receipt.sha256 || null,
    publicationSha256: original.plan.publicationSha256, pointerSha256: original.plan.pointerSha256, historySha256: await historyHash(directory, id) };
  for (const stage of ["intent-only", "maintenance-archived", "sources-archived", "recovery-removed", "maintenance-removed", "completed-before-release"])
    if (validReconciliationAbortContinuationPlan({ ...plan, stage })) { plan.stage = stage; break; }
  if (!plan.stage) return blocked("divergent-evidence");
  const ackIds = (await originalContext(directory, id, intent)).plan.acknowledgedArchives.map(item => item.id).sort();
  if (status.archives.pending.some(item => item.issue !== "missing-record") ||
    (receipt.kind === "absent" ? JSON.stringify(status.archives.pending.map(item => item.id).sort()) !== JSON.stringify(ackIds) : status.archives.pending.length)) return blocked("divergent-evidence");
  const extra = 3 + Number(!plan.maintenanceArchived) + Number(plan.initialRecoverySha256 !== null && !plan.recoveryArchived) + Number(receipt.kind === "absent");
  if ((await evidenceNames(directory)).length + extra > 605) return blocked("history-limit");
  return { ...base, status: "prepared-local", eligible: true, stage: plan.stage, planSha256: planDigest(plan), plan };
}
export async function inspectReconciliationAbortContinuation(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareReconciliationAbortContinuation(directory = join(root, "dist")) {
  const result = await inspectReconciliationAbortContinuation(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, id, progress) {
  const intent = await fileState(join(directory, `reconciliation-abort-${plan.abortId}.intent.json`));
  const original = await originalContext(directory, plan.abortId, intent, id);
  if (intent.sha256 !== plan.abortIntentSha256 || intent.value.finalizationSha256 !== plan.finalizationSha256 ||
    intent.value.plan.sourceGuardSha256 !== plan.initialRecoverySha256 || id === original.operationId ||
    await historyHash(directory, plan.abortId, id) !== plan.historySha256) throw fail();
  for (const [name, present, sha256] of [
    ["publish-maintenance.lock", progress.maintenancePresent, intent.value.plan.maintenanceSha256],
    ["publish-recovery.lock", progress.recoveryPresent, plan.initialRecoverySha256],
    [`publish-aborted-maintenance-${plan.abortId}.lock`, progress.maintenanceArchived, intent.value.plan.maintenanceSha256],
    [`publish-aborted-recovery-${plan.abortId}.lock`, progress.recoveryArchived, plan.initialRecoverySha256],
    ["publish-finalization.lock", progress.finalizationPresent, plan.finalizationSha256],
    [`publish-continued-abort-finalization-${id}.lock`, progress.finalizationArchived, plan.finalizationSha256]]) {
    const state = await fileState(join(directory, name));
    if (present ? ownership(state).state !== "inactive" || state.sha256 !== sha256 : state.kind !== "absent") throw fail();
  }
  const receipt = await fileState(join(directory, `reconciliation-abort-${plan.abortId}.json`));
  if (progress.abortReceiptSha256 === null ? receipt.kind !== "absent" : receipt.sha256 !== progress.abortReceiptSha256) throw fail();
}
export async function continueReconciliationAbort(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  if (["invalid", "changed"].includes((await inspectRecoveryStatus(directory)).status)) throw fail();
  // The original finalization gate stays in place until the existing resume gate
  // excludes cooperative publishers/recoverers. No sixth control is introduced.
  const guardPath = join(directory, "publish-resume.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const id = review.operationId, [intentName, receiptName, archiveName] = ownNames(id);
    const intentPath = join(directory, intentName), receiptPath = join(directory, receiptName), archivePath = join(directory, archiveName);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || !validReconciliationAbortContinuationIntent(previous.value, id) ||
        previous.value.reviewer !== review.reviewer || previous.value.planSha256 !== review.planSha256 ||
        !status.reconciliationAbortContinuations.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned();
      return { continued: true, operationId: id, abortId: previous.value.plan.abortId, replayed: true };
    }
    await absent(receiptPath); await absent(archivePath);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.abortId) throw fail();
    const progress = { ...plan, finalizationPresent: true, finalizationArchived: false };
    const stable = async () => { await unchanged(directory, plan, id, progress); await owned(); };
    await stable();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, resumptionSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const verified = async () => { await stable(); if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    await verified();
    if (!progress.maintenanceArchived) { await link(join(directory, "publish-maintenance.lock"), join(directory, `publish-aborted-maintenance-${plan.abortId}.lock`)); progress.maintenanceArchived = true; }
    await verified();
    if (plan.initialRecoverySha256 !== null && !progress.recoveryArchived) { await link(join(directory, "publish-recovery.lock"), join(directory, `publish-aborted-recovery-${plan.abortId}.lock`)); progress.recoveryArchived = true; }
    await verified();
    if (progress.recoveryPresent) { await unlink(join(directory, "publish-recovery.lock")); progress.recoveryPresent = false; }
    await verified();
    if (progress.maintenancePresent) { await unlink(join(directory, "publish-maintenance.lock")); progress.maintenancePresent = false; }
    await verified();
    if (progress.abortReceiptSha256 === null) {
      const original = (await fileState(join(directory, `reconciliation-abort-${plan.abortId}.intent.json`))).value;
      const receipt = JSON.stringify({ schemaVersion: 2, operationId: plan.abortId, decision: "abort-local-reconciliation", outcome: "aborted",
        intentSha256: plan.abortIntentSha256, maintenanceArchiveSha256: original.plan.maintenanceSha256, recoveryArchiveSha256: plan.initialRecoverySha256,
        abortContinuationId: id, abortContinuationIntentSha256: hash(intent), completedAt: new Date().toISOString() });
      await writeExclusive(join(directory, `reconciliation-abort-${plan.abortId}.json`), receipt); progress.abortReceiptSha256 = hash(receipt);
    }
    await verified();
    await link(join(directory, "publish-finalization.lock"), archivePath); progress.finalizationArchived = true;
    await verified();
    await unlink(join(directory, "publish-finalization.lock")); progress.finalizationPresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, intentSha256: hash(intent),
      abortReceiptSha256: progress.abortReceiptSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory);
    if (!result.reconciliationAbortContinuations?.completed.some(item => item.operationId === id) ||
      !result.reconciliationAborts?.completed.some(item => item.operationId === plan.abortId)) throw fail();
    await verified();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { continued: true, operationId: id, abortId: plan.abortId, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-reconciliation-abort-continuation-status.json" :
    applying ? "web-reconciliation-abort-continuation-result.json" : "web-reconciliation-abort-continuation-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectReconciliationAbortContinuation(directory) : applying ?
      await continueReconciliationAbort(directory, (await fileState(resolve(reviewPath))).value) : await prepareReconciliationAbortContinuation(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Cancelación interrumpida: ${result.stage}.` : applying ? "Continuación de cancelación registrada; consulta coordinación por separado." :
      "Plan de continuación de cancelación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Never expose raw IO errors, private review values or paths. */ }
    console.error("No se completó la continuación de cancelación; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
