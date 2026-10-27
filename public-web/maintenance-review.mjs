import { open, access, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validOwner, validReconciliationIntent, validMaintenancePlan, inspectRecoveryStatus,
  evidenceNames, directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";
import { assertNoResumption } from "./publication-lock.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Mantenimiento no elegible o revisión/evidencia desactualizada");
const scope = "Revisión local de evidencia; no autoriza publicación, activación o lanzamiento";
function reviewInput(input) {
  if (!input || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" || input.decision !== "archive-completed-maintenance" ||
    typeof input.operationId !== "string" || !uuid.test(input.operationId) || typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(input.reviewer) || typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) {
  try { await access(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw fail();
}
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
async function historyHash(directory, skipId) {
  const skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock",
    `maintenance-review-${skipId}.intent.json`, `maintenance-review-${skipId}.json`, `publish-maintenance-orphan-${skipId}.lock`]);
  const files = (await evidenceNames(directory)).filter(name => !skip.has(name));
  const entries = [];
  for (const name of files) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function observe(directory, ownGuard = false) {
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
  if (status.resumption.state !== "absent" || status.resumptions.pending.length || status.resumptionReviews.pending.length) return blocked("resumption-needs-review");
  if (status.maintenance.state === "absent") return { ...base, status: "not-needed", stage: "maintenance-absent" };
  if (status.maintenance.state !== "inactive") return blocked(`maintenance-${status.maintenance.state}`);
  const ids = [...status.reconciliations.completed, ...status.reconciliations.pending].map(item => item.operationId);
  const candidates = [];
  for (const id of ids) {
    const intent = await fileState(join(directory, `recovery-reconciliation-${id}.intent.json`));
    if (intent.kind === "present" && validReconciliationIntent(intent.value, id) && intent.value.schemaVersion === 2 &&
      intent.value.maintenanceSha256 === status.maintenance.sha256) candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-maintenance");
  const { id, intent } = candidates[0], draft = intent.value;
  const receipt = await fileState(join(directory, `recovery-reconciliation-${id}.json`));
  const archivedGuard = await fileState(join(directory, `publish-recovery-orphan-${id}.lock`));
  const sourceGuard = ownGuard ? { kind: "absent" } : await fileState(join(directory, "publish-recovery.lock"));
  const directorySha256 = await directoryDigest(directory);
  const publicationSha256 = status.publication.sha256 || null;
  let pointerSha256;
  try { pointerSha256 = await pointerHash(directory); } catch { return blocked("divergent-evidence"); }
  if (directorySha256 !== draft.plan.directorySha256 || !["absent", "inactive"].includes(status.publication.state) ||
    publicationSha256 !== draft.plan.publicationSha256 || pointerSha256 !== draft.plan.pointerSha256 ||
    status.reconciliations.pending.some(item => item.operationId !== id) || status.maintenanceReviews.pending.length) return blocked("divergent-evidence");
  const originalPresent = ownership(sourceGuard).state === "inactive" && sourceGuard.sha256 === draft.plan.guardSha256;
  const archived = archivedGuard.kind === "present" && validOwner(archivedGuard.value) && archivedGuard.sha256 === draft.plan.guardSha256;
  if (receipt.kind === "absent") {
    let stage = "divergent-evidence";
    if (originalPresent && archivedGuard.kind === "absent") stage = "intent-only";
    else if (originalPresent && archived) stage = "guard-archived";
    else if (sourceGuard.kind === "absent" && archived) stage = "guard-removed";
    return { ...blocked(stage), reconciliationId: id };
  }
  if (sourceGuard.kind !== "absent" || !archived || !status.reconciliations.completed.some(item => item.operationId === id) ||
    status.archives.pending.length || status.reconciliations.pending.length) return { ...blocked("divergent-evidence"), reconciliationId: id };
  const plan = { schemaVersion: 1, decision: "archive-completed-maintenance", directorySha256, maintenanceSha256: status.maintenance.sha256,
    reconciliationId: id, intentSha256: intent.sha256, receiptSha256: receipt.sha256, archivedGuardSha256: archivedGuard.sha256,
    publicationSha256, pointerSha256, historySha256: await historyHash(directory) };
  if (!validMaintenancePlan(plan)) throw fail();
  return { ...base, status: "prepared-local", stage: "completed-before-release", eligible: true, planSha256: planDigest(plan), plan };
}
export async function inspectMaintenance(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareMaintenanceReview(directory = join(root, "dist")) {
  const result = await inspectMaintenance(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, skipId, maintenancePresent) {
  const state = await fileState(join(directory, "publish-maintenance.lock"));
  const publication = await fileState(join(directory, "publish.lock"));
  if ((maintenancePresent ? ownership(state).state !== "inactive" || state.sha256 !== plan.maintenanceSha256 : state.kind !== "absent") ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await pointerHash(directory) !== plan.pointerSha256 || await directoryDigest(directory) !== plan.directorySha256 ||
    await historyHash(directory, skipId) !== plan.historySha256) throw fail();
}
export async function finalizeMaintenance(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  if ((await inspectRecoveryStatus(directory)).status === "invalid") throw fail();
  await assertNoResumption(directory);
  // Reuse the existing recovery guard: both publishers and ordinary recoverers
  // honor it, including the interval after maintenance removal. No new lock tier.
  const guardPath = join(directory, "publish-recovery.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    await assertNoResumption(directory);
    const id = review.operationId, intentPath = join(directory, `maintenance-review-${id}.intent.json`);
    const receiptPath = join(directory, `maintenance-review-${id}.json`), archivePath = join(directory, `publish-maintenance-orphan-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (previous.value?.reviewer !== review.reviewer || previous.value?.planSha256 !== review.planSha256 ||
        !status.maintenanceReviews?.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256)) throw fail();
      return { finalized: true, operationId: id, replayed: true };
    }
    await absent(receiptPath); await absent(archivePath);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256) throw fail();
    await unchanged(directory, plan, id, true); await owned();
    const intent = JSON.stringify({ schemaVersion: 2, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, recoverySha256: hash(raw), createdAt: new Date().toISOString() });
    // Once intent is attempted, failures preserve guard and evidence for review.
    mutation = true; await writeExclusive(intentPath, intent);
    await unchanged(directory, plan, id, true); await owned();
    await link(join(directory, "publish-maintenance.lock"), archivePath);
    const archived = await fileState(archivePath);
    if (archived.sha256 !== plan.maintenanceSha256 || !validOwner(archived.value)) throw fail();
    await unchanged(directory, plan, id, true); await owned();
    await unlink(join(directory, "publish-maintenance.lock"));
    await unchanged(directory, plan, id, false); await owned();
    await writeExclusive(receiptPath, JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision,
      intentSha256: hash(intent), completedAt: new Date().toISOString() }));
    const result = await inspectRecoveryStatus(directory);
    if (!result.maintenanceReviews?.completed.some(item => item.operationId === id)) throw fail();
    await unchanged(directory, plan, id, false); await owned();
    completed = true;
    return { finalized: true, operationId: id, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-maintenance-status.json" : applying ? "web-maintenance-result.json" : "web-maintenance-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectMaintenance(directory) : applying ?
      await finalizeMaintenance(directory, (await fileState(resolve(reviewPath))).value) : await prepareMaintenanceReview(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Mantenimiento local: ${result.stage}.` : applying ? "Cierre de mantenimiento registrado; revisa evidencia y coordinación." : "Plan de mantenimiento preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try {
      await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2));
    } catch { /* Do not expose filesystem details or private review values. */ }
    console.error("No se completó la revisión; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
