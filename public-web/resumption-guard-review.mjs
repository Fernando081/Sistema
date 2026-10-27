import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validOwner, validResumptionIntent, validResumptionGuardPlan,
  inspectRecoveryStatus, evidenceNames, directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";
import { assertNoFinalization } from "./publication-lock.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Guarda de reanudación no elegible o revisión/evidencia desactualizada");
const scope = "Cierre local revisado de guarda residual; no completa reanudaciones parciales ni cierra mantenimiento o autoriza publicación";
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "archive-completed-resumption" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
async function historyHash(directory, skipId) {
  const skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock",
    `resumption-review-${skipId}.intent.json`, `resumption-review-${skipId}.json`, `publish-resume-orphan-${skipId}.lock`]);
  const entries = [];
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function observe(directory, ownRecovery = false) {
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
  if (status.resumption.state === "absent") return { ...base, status: "not-needed", stage: "resumption-guard-absent" };
  if (status.resumption.state !== "inactive") return blocked(`resumption-guard-${status.resumption.state}`);
  if (!ownRecovery && status.recovery.state !== "absent") return blocked(`recovery-${status.recovery.state}`);
  if (status.maintenance.state !== "inactive") return blocked(`maintenance-${status.maintenance.state}`);
  const candidates = [];
  for (const { operationId: id } of [...status.resumptions.completed, ...status.resumptions.pending]) {
    const intent = await fileState(join(directory, `reconciliation-resume-${id}.intent.json`));
    if (validResumptionIntent(intent.value, id) && intent.value.schemaVersion === 2 &&
      intent.value.resumptionSha256 === status.resumption.sha256) candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-resumption-guard");
  const { id, intent } = candidates[0], origin = intent.value, reconciliationId = origin.plan.reconciliationId;
  if (!status.resumptions.completed.some(item => item.operationId === id)) return blocked("resumption-incomplete");
  if (status.resumptions.pending.length || status.reconciliations.pending.length || status.maintenanceReviews.pending.length ||
    status.resumptionReviews.pending.length || status.archives.pending.length ||
    !status.reconciliations.completed.some(item => item.operationId === reconciliationId)) return blocked("divergent-evidence");
  const directorySha256 = await directoryDigest(directory), publicationSha256 = status.publication.sha256 || null;
  let pointerSha256;
  try { pointerSha256 = await pointerHash(directory); } catch { return blocked("divergent-evidence"); }
  if (directorySha256 !== origin.plan.directorySha256 || status.maintenance.sha256 !== origin.plan.maintenanceSha256 ||
    !["absent", "inactive"].includes(status.publication.state) || publicationSha256 !== origin.plan.publicationSha256 ||
    pointerSha256 !== origin.plan.pointerSha256) return blocked("divergent-evidence");
  const receipt = await fileState(join(directory, `reconciliation-resume-${id}.json`));
  const oldIntent = await fileState(join(directory, `recovery-reconciliation-${reconciliationId}.intent.json`));
  const oldReceipt = await fileState(join(directory, `recovery-reconciliation-${reconciliationId}.json`));
  const archivedGuard = await fileState(join(directory, `publish-recovery-orphan-${reconciliationId}.lock`));
  if ([receipt, oldIntent, oldReceipt, archivedGuard].some(state => state.kind !== "present") ||
    oldIntent.sha256 !== origin.plan.intentSha256 || !validOwner(archivedGuard.value)) return blocked("divergent-evidence");
  // Three new evidence files must fit without truncating the known history.
  if ((await evidenceNames(directory)).length + 3 > 605) return blocked("history-limit");
  const plan = { schemaVersion: 1, decision: "archive-completed-resumption", directorySha256, resumptionSha256: status.resumption.sha256,
    resumptionId: id, resumptionIntentSha256: intent.sha256, resumptionReceiptSha256: receipt.sha256, reconciliationId,
    reconciliationIntentSha256: oldIntent.sha256, reconciliationReceiptSha256: oldReceipt.sha256, archivedGuardSha256: archivedGuard.sha256,
    maintenanceSha256: status.maintenance.sha256, publicationSha256, pointerSha256, historySha256: await historyHash(directory) };
  if (!validResumptionGuardPlan(plan)) throw fail();
  return { ...base, status: "prepared-local", stage: "completed-before-release", eligible: true, planSha256: planDigest(plan), plan };
}
export async function inspectResumptionGuard(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareResumptionGuardReview(directory = join(root, "dist")) {
  const result = await inspectResumptionGuard(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, skipId, sourcePresent) {
  const source = await fileState(join(directory, "publish-resume.lock"));
  const maintenance = await fileState(join(directory, "publish-maintenance.lock"));
  const publication = await fileState(join(directory, "publish.lock"));
  if ((sourcePresent ? ownership(source).state !== "inactive" || source.sha256 !== plan.resumptionSha256 : source.kind !== "absent") ||
    ownership(maintenance).state !== "inactive" || maintenance.sha256 !== plan.maintenanceSha256 ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await pointerHash(directory) !== plan.pointerSha256 || await directoryDigest(directory) !== plan.directorySha256 ||
    await historyHash(directory, skipId) !== plan.historySha256) throw fail();
}
export async function finalizeResumptionGuard(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  const initial = await inspectRecoveryStatus(directory);
  if (["invalid", "changed"].includes(initial.status) || !["absent", "inactive"].includes(initial.resumption.state)) throw fail();
  await assertNoFinalization(directory);
  // The existing recovery guard protects the interval after resume removal.
  const guardPath = join(directory, "publish-recovery.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    await assertNoFinalization(directory);
    const id = review.operationId, intentPath = join(directory, `resumption-review-${id}.intent.json`);
    const receiptPath = join(directory, `resumption-review-${id}.json`), archivePath = join(directory, `publish-resume-orphan-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || previous.value?.reviewer !== review.reviewer || previous.value?.planSha256 !== review.planSha256 ||
        !status.resumptionReviews?.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned();
      return { finalized: true, operationId: id, replayed: true };
    }
    await absent(receiptPath); await absent(archivePath);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.resumptionId || id === plan.reconciliationId) throw fail();
    await unchanged(directory, plan, id, true); await owned();
    const intent = JSON.stringify({ schemaVersion: 2, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, recoverySha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const ownIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    const archived = async () => {
      const state = await fileState(archivePath);
      if (!validOwner(state.value) || state.sha256 !== plan.resumptionSha256) throw fail();
    };
    await unchanged(directory, plan, id, true); await owned(); await ownIntent();
    await link(join(directory, "publish-resume.lock"), archivePath);
    await archived(); await unchanged(directory, plan, id, true); await owned(); await ownIntent();
    await unlink(join(directory, "publish-resume.lock"));
    await archived(); await unchanged(directory, plan, id, false); await owned(); await ownIntent();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, intentSha256: hash(intent), completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const status = await inspectRecoveryStatus(directory);
    if (!status.resumptionReviews?.completed.some(item => item.operationId === id)) throw fail();
    await archived(); await unchanged(directory, plan, id, false); await owned(); await ownIntent();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { finalized: true, operationId: id, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-resume-guard-status.json" : applying ? "web-resume-guard-result.json" : "web-resume-guard-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectResumptionGuard(directory) : applying ?
      await finalizeResumptionGuard(directory, (await fileState(resolve(reviewPath))).value) : await prepareResumptionGuardReview(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Guarda de reanudación: ${result.stage}.` : applying ? "Cierre de guarda registrado; mantenimiento pendiente de revisión separada." : "Plan de cierre de guarda preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Do not expose private review values, paths or raw IO errors. */ }
    console.error("No se completó el cierre de guarda; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
