import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validReconciliationIntent, validReconciliationReceipt, validResumptionIntent,
  validResumptionContinuationPlan, validResumptionContinuationIntent, validResumptionAbortPlan, inspectRecoveryStatus, evidenceNames,
  directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Reanudación interrumpida no elegible o revisión/evidencia desactualizada");
const scope = "Continuación local revisada de reanudación v2 parcial; conserva recibos existentes y mantenimiento, no publica ni activa captación";
export const resumptionAbortScope = "Cancelación local revisada de reanudación v2 parcial; conserva recibos y reconciliación original, no publica ni activa captación";
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "continue-local-resumption" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
export async function resumptionHistoryHash(directory, excluded = []) {
  const skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock",
    ...excluded]);
  const entries = [];
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function historyHash(directory, originalId, resumptionId, continuationId) {
  return resumptionHistoryHash(directory, [`publish-recovery-orphan-${originalId}.lock`, `recovery-reconciliation-${originalId}.json`,
    `reconciliation-resume-${resumptionId}.json`, `resumption-continuation-${continuationId}.intent.json`,
    `resumption-continuation-${continuationId}.json`, `publish-continued-resume-${continuationId}.lock`]);
}
async function acknowledgedIntact(directory, origin) {
  for (const item of origin.plan.acknowledgedArchives) {
    const archive = await fileState(join(directory, `publish-orphan-${item.id}.lock`));
    if (ownership(archive).state !== "inactive" || archive.sha256 !== item.sha256) throw fail();
    await absent(join(directory, `lock-recovery-${item.id}.json`));
  }
}
function contextMatches(resume, origin, plan) {
  const previous = resume?.plan;
  return validResumptionIntent(resume, plan.resumptionId) && resume.schemaVersion === 2 && resume.resumptionSha256 === plan.resumptionSha256 &&
    validReconciliationIntent(origin, plan.reconciliationId) && origin.schemaVersion === 2 &&
    previous.reconciliationId === plan.reconciliationId && previous.intentSha256 === plan.reconciliationIntentSha256 &&
    previous.directorySha256 === plan.directorySha256 && origin.plan.directorySha256 === plan.directorySha256 &&
    previous.maintenanceSha256 === plan.maintenanceSha256 && origin.maintenanceSha256 === plan.maintenanceSha256 &&
    previous.publicationSha256 === plan.publicationSha256 && origin.plan.publicationSha256 === plan.publicationSha256 &&
    previous.pointerSha256 === plan.pointerSha256 && origin.plan.pointerSha256 === plan.pointerSha256 &&
    [previous.sourceGuardSha256, previous.archivedGuardSha256, plan.sourceGuardSha256, plan.archivedGuardSha256].every(value => value === null || value === origin.plan.guardSha256) &&
    (previous.sourceGuardSha256 !== null || plan.sourceGuardSha256 === null) &&
    (previous.archivedGuardSha256 === null || plan.archivedGuardSha256 === previous.archivedGuardSha256);
}
export async function observeIncompleteResumption(directory, owned = false, purpose = "continue") {
  if (!["continue", "abort"].includes(purpose)) throw fail();
  const status = await inspectRecoveryStatus(directory);
  const base = { schemaVersion: 1, scope: purpose === "abort" ? resumptionAbortScope : scope, coordinationStatus: status.status, eligible: false };
  const blocked = stage => ({ ...base, status: "blocked-review", stage });
  if (["changed", "invalid"].includes(status.status)) return blocked(status.status);
  if (status.reconciliationAbortContinuations.pending.length) return blocked("abort-continuation-needs-review");
  if (status.resumptionAbortContinuations.pending.length) return blocked("resumption-abort-continuation-needs-review");
  if (status.closureAbortContinuations.pending.length) return blocked("closure-abort-continuation-needs-review");
  if (status.abortContinuationFinalizations.pending.length) return blocked("abort-continuation-finalization-needs-review");
  if (status.closureAborts.pending.length) return blocked("closure-abort-needs-review");
  if (status.resumptionAborts.pending.length) return blocked("resumption-abort-needs-review");
  if (!owned && status.finalization.state !== "absent") return blocked(`finalization-${status.finalization.state}`);
  if (status.resumptionContinuations.pending.length) return blocked("continuation-needs-review");
  if (status.reconciliationAborts.pending.length || status.closureResumptions.pending.length || status.maintenanceReviews.pending.length ||
    status.resumptionReviews.pending.length) return blocked("other-operation-needs-review");
  if (status.resumption.state === "absent") return status.resumptions.pending.length ? blocked("resumption-guard-absent") :
    { ...base, status: "not-needed", stage: "resumption-guard-absent" };
  if (status.resumption.state !== "inactive") return blocked(`resumption-guard-${status.resumption.state}`);
  if (status.maintenance.state !== "inactive") return blocked(`maintenance-${status.maintenance.state}`);
  const candidates = [];
  for (const { operationId: id } of [...status.resumptions.completed, ...status.resumptions.pending]) {
    const intent = await fileState(join(directory, `reconciliation-resume-${id}.intent.json`));
    if (validResumptionIntent(intent.value, id) && intent.value.schemaVersion === 2 && intent.value.resumptionSha256 === status.resumption.sha256)
      candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-resumption-guard");
  const { id, intent } = candidates[0], resume = intent.value, originalId = resume.plan.reconciliationId;
  const resumedReceipt = await fileState(join(directory, `reconciliation-resume-${id}.json`));
  if (resumedReceipt.kind !== "absent") return status.resumptions.completed.some(item => item.operationId === id) ?
    { ...base, status: "not-needed", stage: "resumption-completed-use-guard-review" } : blocked("resumption-receipt-present");
  if (!status.resumptions.pending.some(item => item.operationId === id) || status.resumptions.pending.some(item => item.operationId !== id) ||
    !status.reconciliations.pending.some(item => item.operationId === originalId) || status.reconciliations.pending.some(item => item.operationId !== originalId) ||
    status.resumptionContinuations.completed.some(item => item.resumptionId === id) || !["absent", "inactive"].includes(status.publication.state)) return blocked("divergent-evidence");
  const originalIntent = await fileState(join(directory, `recovery-reconciliation-${originalId}.intent.json`)), origin = originalIntent.value;
  const receipt = await fileState(join(directory, `recovery-reconciliation-${originalId}.json`));
  const source = await fileState(join(directory, "publish-recovery.lock"));
  const archive = await fileState(join(directory, `publish-recovery-orphan-${originalId}.lock`));
  const sourceValid = ownership(source).state === "inactive" && source.sha256 === origin?.plan?.guardSha256;
  const archived = ownership(archive).state === "inactive" && archive.sha256 === origin?.plan?.guardSha256;
  let stage;
  if (receipt.kind === "absent") {
    if (sourceValid && archive.kind === "absent") stage = "intent-only";
    else if (sourceValid && archived) stage = "guard-archived";
    else if (source.kind === "absent" && archived) stage = "guard-removed";
  } else if (source.kind === "absent" && archived && receipt.kind === "present" &&
    validReconciliationReceipt(receipt.value, originalId, originalIntent.sha256) && receipt.value.schemaVersion === 2 &&
    receipt.value.resumptionId === id && receipt.value.resumptionIntentSha256 === intent.sha256) stage = "reconciliation-completed";
  if (!stage) return blocked("divergent-evidence");
  let pointerSha256;
  try { pointerSha256 = await pointerHash(directory); await acknowledgedIntact(directory, origin); }
  catch { return blocked("divergent-evidence"); }
  const ackIds = origin.plan.acknowledgedArchives.map(item => item.id).sort();
  if (status.archives.pending.some(item => item.issue !== "missing-record") ||
    JSON.stringify(status.archives.pending.map(item => item.id).sort()) !== JSON.stringify(ackIds)) return blocked("divergent-evidence");
  const plan = { schemaVersion: 1, decision: purpose === "abort" ? "abort-local-resumption" : "continue-local-resumption", directorySha256: await directoryDigest(directory),
    resumptionId: id, resumptionIntentSha256: intent.sha256, resumptionSha256: status.resumption.sha256,
    reconciliationId: originalId, reconciliationIntentSha256: originalIntent.sha256, reconciliationReceiptSha256: receipt.sha256 || null,
    stage, sourceGuardSha256: source.sha256 || null, archivedGuardSha256: archive.sha256 || null,
    maintenanceSha256: status.maintenance.sha256, publicationSha256: status.publication.sha256 || null, pointerSha256,
    historySha256: purpose === "abort" ? await resumptionHistoryHash(directory) : await historyHash(directory, originalId, id) };
  if (!(purpose === "abort" ? validResumptionAbortPlan(plan) : validResumptionContinuationPlan(plan)) || !contextMatches(resume, origin, plan)) return blocked("divergent-evidence");
  const extra = purpose === "abort" ? 3 : 4 + Number(archive.kind === "absent") + Number(receipt.kind === "absent");
  if ((await evidenceNames(directory)).length + extra > 605) return blocked("history-limit");
  return { ...base, status: "prepared-local", stage, eligible: true, planSha256: planDigest(plan), plan };
}
const observe = (directory, owned = false) => observeIncompleteResumption(directory, owned);
export { contextMatches as resumptionContextMatches, acknowledgedIntact as acknowledgedResumptionArchives };
export async function inspectResumptionContinuation(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareResumptionContinuation(directory = join(root, "dist")) {
  const result = await inspectResumptionContinuation(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, id, sourcePresent, archivePresent, originalReceiptSha256, resumedReceiptSha256, resumePresent, resumeArchived) {
  const originalIntent = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.intent.json`));
  const resumedIntent = await fileState(join(directory, `reconciliation-resume-${plan.resumptionId}.intent.json`));
  const originalReceipt = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`));
  const resumedReceipt = await fileState(join(directory, `reconciliation-resume-${plan.resumptionId}.json`));
  const maintenance = await fileState(join(directory, "publish-maintenance.lock")), publication = await fileState(join(directory, "publish.lock"));
  const source = await fileState(join(directory, "publish-recovery.lock")), archive = await fileState(join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`));
  const resume = await fileState(join(directory, "publish-resume.lock")), resumedArchive = await fileState(join(directory, `publish-continued-resume-${id}.lock`));
  const sourceHash = plan.sourceGuardSha256 || plan.archivedGuardSha256;
  if (originalIntent.sha256 !== plan.reconciliationIntentSha256 || resumedIntent.sha256 !== plan.resumptionIntentSha256 ||
    !contextMatches(resumedIntent.value, originalIntent.value, plan) || ownership(maintenance).state !== "inactive" || maintenance.sha256 !== plan.maintenanceSha256 ||
    (sourcePresent ? ownership(source).state !== "inactive" || source.sha256 !== sourceHash : source.kind !== "absent") ||
    (archivePresent ? ownership(archive).state !== "inactive" || archive.sha256 !== sourceHash : archive.kind !== "absent") ||
    (resumePresent ? ownership(resume).state !== "inactive" || resume.sha256 !== plan.resumptionSha256 : resume.kind !== "absent") ||
    (resumeArchived ? ownership(resumedArchive).state !== "inactive" || resumedArchive.sha256 !== plan.resumptionSha256 : resumedArchive.kind !== "absent") ||
    (originalReceiptSha256 === null ? originalReceipt.kind !== "absent" : originalReceipt.kind !== "present" || originalReceipt.sha256 !== originalReceiptSha256) ||
    (resumedReceiptSha256 === null ? resumedReceipt.kind !== "absent" : resumedReceipt.kind !== "present" || resumedReceipt.sha256 !== resumedReceiptSha256) ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await historyHash(directory, plan.reconciliationId, plan.resumptionId, id) !== plan.historySha256) throw fail();
  await acknowledgedIntact(directory, originalIntent.value);
}
export async function continueRecoveryResumption(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  if (["invalid", "changed"].includes((await inspectRecoveryStatus(directory)).status)) throw fail();
  const guardPath = join(directory, "publish-finalization.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const id = review.operationId, intentPath = join(directory, `resumption-continuation-${id}.intent.json`);
    const receiptPath = join(directory, `resumption-continuation-${id}.json`), resumeArchivePath = join(directory, `publish-continued-resume-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || !validResumptionContinuationIntent(previous.value, id) ||
        previous.value.reviewer !== review.reviewer || previous.value.planSha256 !== review.planSha256 ||
        !status.resumptionContinuations.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned(); return { continued: true, operationId: id, replayed: true };
    }
    await absent(receiptPath); await absent(resumeArchivePath);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.resumptionId || id === plan.reconciliationId) throw fail();
    let sourcePresent = plan.sourceGuardSha256 !== null, archivePresent = plan.archivedGuardSha256 !== null;
    let originalReceiptSha256 = plan.reconciliationReceiptSha256, resumedReceiptSha256 = null, resumePresent = true, resumeArchived = false;
    const stable = async () => {
      await unchanged(directory, plan, id, sourcePresent, archivePresent, originalReceiptSha256, resumedReceiptSha256, resumePresent, resumeArchived);
      await owned();
    };
    await stable();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, finalizationSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const ownIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    const verified = async () => { await stable(); await ownIntent(); };
    await verified();
    if (!archivePresent) { await link(join(directory, "publish-recovery.lock"), join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`)); archivePresent = true; }
    await verified();
    if (sourcePresent) { await unlink(join(directory, "publish-recovery.lock")); sourcePresent = false; }
    await verified();
    if (originalReceiptSha256 === null) {
      const receipt = JSON.stringify({ schemaVersion: 2, operationId: plan.reconciliationId, decision: "reconcile-local-recovery",
        intentSha256: plan.reconciliationIntentSha256, resumptionId: plan.resumptionId, resumptionIntentSha256: plan.resumptionIntentSha256, completedAt: new Date().toISOString() });
      await writeExclusive(join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`), receipt); originalReceiptSha256 = hash(receipt);
    }
    await verified();
    const resumedReceipt = JSON.stringify({ schemaVersion: 2, operationId: plan.resumptionId, decision: "resume-local-reconciliation",
      intentSha256: plan.resumptionIntentSha256, reconciliationReceiptSha256: originalReceiptSha256,
      resumptionContinuationId: id, resumptionContinuationIntentSha256: hash(intent), completedAt: new Date().toISOString() });
    await writeExclusive(join(directory, `reconciliation-resume-${plan.resumptionId}.json`), resumedReceipt); resumedReceiptSha256 = hash(resumedReceipt);
    await verified();
    await link(join(directory, "publish-resume.lock"), resumeArchivePath); resumeArchived = true;
    await verified();
    await unlink(join(directory, "publish-resume.lock")); resumePresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, intentSha256: hash(intent),
      resumptionReceiptSha256: resumedReceiptSha256, reconciliationReceiptSha256: originalReceiptSha256,
      resumptionArchiveSha256: plan.resumptionSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory);
    if (!result.resumptionContinuations?.completed.some(item => item.operationId === id) ||
      !result.resumptions?.completed.some(item => item.operationId === plan.resumptionId) ||
      !result.reconciliations?.completed.some(item => item.operationId === plan.reconciliationId)) throw fail();
    await verified();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { continued: true, operationId: id, replayed: false, resumptionId: plan.resumptionId };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-resumption-continuation-status.json" : applying ? "web-resumption-continuation-result.json" : "web-resumption-continuation-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectResumptionContinuation(directory) : applying ?
      await continueRecoveryResumption(directory, (await fileState(resolve(reviewPath))).value) : await prepareResumptionContinuation(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Reanudación interrumpida: ${result.stage}.` : applying ? "Continuación registrada; mantenimiento requiere cierre separado." : "Plan de continuación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Never expose private review values or raw filesystem errors. */ }
    console.error("No se completó la continuación; conserva bloqueos/evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
