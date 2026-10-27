import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, closureNames, validClosureIntent, validClosureReceipt, validClosureResumptionPlan,
  validClosureResumptionIntent, validClosureAbortPlan, inspectRecoveryStatus, evidenceNames, directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Cierre interrumpido no elegible o revisión/evidencia desactualizada");
const scope = "Reanudación local revisada de cierres vinculados; no publica, activa captación ni modifica recibos existentes";
export const closureAbortScope = "Cancelación local revisada de cierre v2 parcial sin recibo; conserva origen y bloqueos residuales para revisión separada";
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "resume-local-closure" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
export async function closureHistoryHash(directory, excluded = []) {
  const skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock", ...excluded]);
  const entries = [];
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function historyHash(directory, kind, closureId, resumeId) {
  const names = closureNames(kind, closureId);
  return closureHistoryHash(directory, [names.archive, names.receipt, `closure-resumption-${resumeId}.intent.json`,
    `closure-resumption-${resumeId}.json`, `publish-closure-recovery-orphan-${resumeId}.lock`]);
}
async function contextIntact(directory, origin, kind, status) {
  const plan = origin.plan, id = plan.reconciliationId;
  if (!status.reconciliations.completed.some(item => item.operationId === id)) throw fail();
  const expected = kind === "maintenance" ? [[`recovery-reconciliation-${id}.intent.json`, plan.intentSha256],
    [`recovery-reconciliation-${id}.json`, plan.receiptSha256], [`publish-recovery-orphan-${id}.lock`, plan.archivedGuardSha256]] :
    [[`recovery-reconciliation-${id}.intent.json`, plan.reconciliationIntentSha256],
      [`recovery-reconciliation-${id}.json`, plan.reconciliationReceiptSha256], [`publish-recovery-orphan-${id}.lock`, plan.archivedGuardSha256],
      [`reconciliation-resume-${plan.resumptionId}.intent.json`, plan.resumptionIntentSha256],
      [`reconciliation-resume-${plan.resumptionId}.json`, plan.resumptionReceiptSha256]];
  for (const [name, sha256] of expected) if ((await fileState(join(directory, name))).sha256 !== sha256) throw fail();
  const original = (await fileState(join(directory, `recovery-reconciliation-${id}.intent.json`))).value;
  if (original?.schemaVersion !== 2 || original.maintenanceSha256 !== plan.maintenanceSha256 ||
    original.plan.directorySha256 !== plan.directorySha256 || original.plan.publicationSha256 !== plan.publicationSha256 ||
    original.plan.pointerSha256 !== plan.pointerSha256) throw fail();
  if (kind === "resumption") {
    const resumed = (await fileState(join(directory, `reconciliation-resume-${plan.resumptionId}.intent.json`))).value;
    if (!status.resumptions.completed.some(item => item.operationId === plan.resumptionId) || resumed?.schemaVersion !== 2 ||
      resumed.resumptionSha256 !== plan.resumptionSha256 || resumed.plan.reconciliationId !== id ||
      resumed.plan.maintenanceSha256 !== plan.maintenanceSha256) throw fail();
  }
}
export const closureOriginContextIntact = contextIntact;
export async function observeInterruptedClosure(directory, owned = false, purpose = "resume") {
  if (!["resume", "abort"].includes(purpose)) throw fail();
  const status = await inspectRecoveryStatus(directory);
  const base = { schemaVersion: 1, scope: purpose === "abort" ? closureAbortScope : scope, coordinationStatus: status.status, eligible: false };
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
  if (!owned && status.finalization.state !== "absent") return blocked(`finalization-${status.finalization.state}`);
  if (status.closureResumptions.pending.length) return blocked("closure-resumption-needs-review");
  if (status.recovery.state === "absent") return status.maintenanceReviews.pending.length || status.resumptionReviews.pending.length ?
    blocked("unlinked-recovery-guard") : { ...base, status: "not-needed", stage: "recovery-guard-absent" };
  if (status.recovery.state !== "inactive") return blocked(`recovery-${status.recovery.state}`);
  const candidates = [];
  for (const [kind, summary] of [["maintenance", status.maintenanceReviews], ["resumption", status.resumptionReviews]]) {
    for (const { operationId: id } of [...summary.completed, ...summary.pending]) {
      const intent = await fileState(join(directory, closureNames(kind, id).intent));
      if (validClosureIntent(intent.value, id, kind) && intent.value.schemaVersion === 2 && intent.value.recoverySha256 === status.recovery.sha256)
        candidates.push({ kind, id, intent });
    }
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-recovery-guard");
  const { kind, id, intent } = candidates[0], origin = intent.value, oldPlan = origin.plan, names = closureNames(kind, id);
  if (status.archives.pending.length || status.reconciliations.pending.length || status.resumptions.pending.length ||
    status.maintenanceReviews.pending.some(item => kind !== "maintenance" || item.operationId !== id) ||
    status.resumptionReviews.pending.some(item => kind !== "resumption" || item.operationId !== id) ||
    status.closureResumptions.completed.some(item => item.closureId === id && item.closureKind === kind)) return blocked("divergent-evidence");
  if (kind === "maintenance" ? status.resumption.state !== "absent" :
    status.maintenance.state !== "inactive" || status.maintenance.sha256 !== oldPlan.maintenanceSha256) return blocked("divergent-evidence");
  const directorySha256 = await directoryDigest(directory), publicationSha256 = status.publication.sha256 || null;
  let pointerSha256;
  try { pointerSha256 = await pointerHash(directory); await contextIntact(directory, origin, kind, status); }
  catch { return blocked("divergent-evidence"); }
  if (directorySha256 !== oldPlan.directorySha256 || !["absent", "inactive"].includes(status.publication.state) ||
    publicationSha256 !== oldPlan.publicationSha256 || pointerSha256 !== oldPlan.pointerSha256) return blocked("divergent-evidence");
  const source = await fileState(join(directory, names.source)), archive = await fileState(join(directory, names.archive));
  const receipt = await fileState(join(directory, names.receipt));
  const expected = kind === "maintenance" ? oldPlan.maintenanceSha256 : oldPlan.resumptionSha256;
  const present = ownership(source).state === "inactive" && source.sha256 === expected;
  const archived = ownership(archive).state === "inactive" && archive.sha256 === expected;
  let stage;
  if (receipt.kind === "absent") {
    if (present && archive.kind === "absent") stage = "intent-only";
    else if (present && archived) stage = "source-archived";
    else if (source.kind === "absent" && archived) stage = "source-removed";
  } else if (source.kind === "absent" && archived && receipt.value?.schemaVersion === 1 &&
    validClosureReceipt(receipt.value, id, intent.sha256, kind) &&
    (kind === "maintenance" ? status.maintenanceReviews : status.resumptionReviews).completed.some(item => item.operationId === id)) stage = "completed-before-release";
  if (!stage) return blocked("divergent-evidence");
  if (purpose === "abort" && stage === "completed-before-release")
    return { ...base, status: "not-needed", stage: "closure-completed-use-resumption", closureKind: kind };
  // Reserve all missing evidence before starting; never truncate history.
  const extra = purpose === "abort" ? 3 : 3 + Number(archive.kind === "absent") + Number(receipt.kind === "absent");
  if ((await evidenceNames(directory)).length + extra > 605) return blocked("history-limit");
  const plan = { schemaVersion: 1, decision: purpose === "abort" ? "abort-local-closure" : "resume-local-closure", closureKind: kind, closureId: id, closureIntentSha256: intent.sha256,
    closureReceiptSha256: receipt.sha256 || null, stage, directorySha256, recoverySha256: status.recovery.sha256,
    sourceSha256: source.sha256 || null, archivedSourceSha256: archive.sha256 || null,
    maintenanceSha256: kind === "resumption" ? oldPlan.maintenanceSha256 : null, publicationSha256, pointerSha256,
    historySha256: purpose === "abort" ? await closureHistoryHash(directory) : await historyHash(directory, kind, id) };
  if (!(purpose === "abort" ? validClosureAbortPlan(plan) : validClosureResumptionPlan(plan))) throw fail();
  return { ...base, status: "prepared-local", eligible: true, stage, closureKind: kind, planSha256: planDigest(plan), plan };
}
const observe = (directory, owned = false) => observeInterruptedClosure(directory, owned);
export async function inspectClosureResumption(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareClosureResumption(directory = join(root, "dist")) {
  const result = await inspectClosureResumption(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, resumeId, sourcePresent, archivePresent, recoveryPresent, recoveryArchived, receiptSha256) {
  const names = closureNames(plan.closureKind, plan.closureId);
  const intent = await fileState(join(directory, names.intent)), origin = intent.value;
  const source = await fileState(join(directory, names.source)), archive = await fileState(join(directory, names.archive));
  const recovery = await fileState(join(directory, "publish-recovery.lock"));
  const recovered = await fileState(join(directory, `publish-closure-recovery-orphan-${resumeId}.lock`));
  const receipt = await fileState(join(directory, names.receipt)), publication = await fileState(join(directory, "publish.lock"));
  const expected = plan.sourceSha256 || plan.archivedSourceSha256;
  if (!validClosureIntent(origin, plan.closureId, plan.closureKind) || origin.schemaVersion !== 2 || intent.sha256 !== plan.closureIntentSha256 ||
    origin.recoverySha256 !== plan.recoverySha256 ||
    (sourcePresent ? ownership(source).state !== "inactive" || source.sha256 !== expected : source.kind !== "absent") ||
    (archivePresent ? ownership(archive).state !== "inactive" || archive.sha256 !== expected : archive.kind !== "absent") ||
    (recoveryPresent ? ownership(recovery).state !== "inactive" || recovery.sha256 !== plan.recoverySha256 : recovery.kind !== "absent") ||
    (recoveryArchived ? ownership(recovered).state !== "inactive" || recovered.sha256 !== plan.recoverySha256 : recovered.kind !== "absent") ||
    (receiptSha256 === null ? receipt.kind !== "absent" : receipt.kind !== "present" || receipt.sha256 !== receiptSha256) ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await historyHash(directory, plan.closureKind, plan.closureId, resumeId) !== plan.historySha256) throw fail();
  const other = await fileState(join(directory, plan.closureKind === "maintenance" ? "publish-resume.lock" : "publish-maintenance.lock"));
  if (plan.closureKind === "maintenance" ? other.kind !== "absent" : ownership(other).state !== "inactive" || other.sha256 !== plan.maintenanceSha256) throw fail();
  const status = await inspectRecoveryStatus(directory);
  if (["invalid", "changed"].includes(status.status)) throw fail();
  await contextIntact(directory, origin, plan.closureKind, status);
}
export async function resumeClosure(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  const initial = await inspectRecoveryStatus(directory);
  if (["invalid", "changed"].includes(initial.status)) throw fail();
  const guardPath = join(directory, "publish-finalization.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const id = review.operationId, intentPath = join(directory, `closure-resumption-${id}.intent.json`);
    const receiptPath = join(directory, `closure-resumption-${id}.json`), recoveryArchive = join(directory, `publish-closure-recovery-orphan-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || !validClosureResumptionIntent(previous.value, id) ||
        previous.value.reviewer !== review.reviewer || previous.value.planSha256 !== review.planSha256 ||
        !status.closureResumptions.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned();
      return { resumed: true, operationId: id, replayed: true };
    }
    await absent(receiptPath); await absent(recoveryArchive);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.closureId) throw fail();
    const names = closureNames(plan.closureKind, plan.closureId), origin = (await fileState(join(directory, names.intent))).value;
    if (id === origin.plan.reconciliationId || id === origin.plan.resumptionId) throw fail();
    let sourcePresent = plan.sourceSha256 !== null, archivePresent = plan.archivedSourceSha256 !== null;
    let recoveryPresent = true, recoveryArchived = false, oldReceiptSha256 = plan.closureReceiptSha256;
    const stable = async () => { await unchanged(directory, plan, id, sourcePresent, archivePresent, recoveryPresent, recoveryArchived, oldReceiptSha256); await owned(); };
    await stable();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, finalizationSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const ownIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    const verified = async () => { await stable(); await ownIntent(); };
    await verified();
    if (!archivePresent) { await link(join(directory, names.source), join(directory, names.archive)); archivePresent = true; }
    await verified();
    if (sourcePresent) { await unlink(join(directory, names.source)); sourcePresent = false; }
    await verified();
    if (oldReceiptSha256 === null) {
      const receipt = JSON.stringify({ schemaVersion: 2, operationId: plan.closureId, decision: names.decision, intentSha256: plan.closureIntentSha256,
        closureResumptionId: id, closureResumptionIntentSha256: hash(intent), completedAt: new Date().toISOString() });
      await writeExclusive(join(directory, names.receipt), receipt); oldReceiptSha256 = hash(receipt);
    }
    await verified();
    await link(join(directory, "publish-recovery.lock"), recoveryArchive); recoveryArchived = true;
    await verified();
    await unlink(join(directory, "publish-recovery.lock")); recoveryPresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision,
      intentSha256: hash(intent), closureReceiptSha256: oldReceiptSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory);
    const summary = plan.closureKind === "maintenance" ? result.maintenanceReviews : result.resumptionReviews;
    if (!result.closureResumptions?.completed.some(item => item.operationId === id) || !summary?.completed.some(item => item.operationId === plan.closureId)) throw fail();
    await verified();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { resumed: true, operationId: id, replayed: false, closureKind: plan.closureKind, closureId: plan.closureId };
  } finally {
    await guard.close();
    // Interrupted new reviews keep their own guard/journal for manual review.
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-closure-resumption-status.json" : applying ? "web-closure-resumption-result.json" : "web-closure-resumption-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectClosureResumption(directory) : applying ?
      await resumeClosure(directory, (await fileState(resolve(reviewPath))).value) : await prepareClosureResumption(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Cierre interrumpido: ${result.stage}.` : applying ? "Reanudación de cierre registrada; consulta coordinación y evidencia." : "Plan de reanudación de cierre preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Never expose raw IO errors or private review values. */ }
    console.error("No se completó la reanudación de cierre; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
