import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validReconciliationIntent, validReconciliationAbortPlan, validReconciliationAbortIntent,
  inspectRecoveryStatus, evidenceNames, directoryDigest, planDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Reconciliación parcial no elegible para cancelación o revisión/evidencia desactualizada");
const scope = "Cancelación local revisada; conserva evidencia sin completar recibos originales ni cambiar versiones o captación";
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reason,reviewer" ||
    input.decision !== "abort-local-reconciliation" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 ||
    typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500 || /[\u0000-\u001f\u007f]/.test(input.reviewer + input.reason) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim(), reason: input.reason.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
export async function reconciliationAbortHistoryHash(directory, abortId, excluded = []) {
  const skip = new Set(["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock",
    `reconciliation-abort-${abortId}.intent.json`, `reconciliation-abort-${abortId}.json`,
    `publish-aborted-maintenance-${abortId}.lock`, `publish-aborted-recovery-${abortId}.lock`, ...excluded]);
  const entries = [];
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
const historyHash = reconciliationAbortHistoryHash;
async function acknowledgedIntact(directory, origin) {
  for (const item of origin.plan.acknowledgedArchives) {
    const archive = await fileState(join(directory, `publish-orphan-${item.id}.lock`));
    if (ownership(archive).state !== "inactive" || archive.sha256 !== item.sha256) throw fail();
    await absent(join(directory, `lock-recovery-${item.id}.json`));
  }
}
async function observe(directory, ownFinalization = false) {
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
  if (!ownFinalization && status.finalization.state !== "absent") return blocked(`finalization-${status.finalization.state}`);
  if (status.reconciliationAborts.pending.length) return blocked("abort-needs-review");
  if (status.resumption.state !== "absent" || status.resumptions.pending.length || status.resumptionReviews.pending.length ||
    status.maintenanceReviews.pending.length || status.closureResumptions.pending.length) return blocked("other-operation-needs-review");
  if (status.maintenance.state === "absent") return status.reconciliations.pending.length ? blocked("maintenance-absent") :
    { ...base, status: "not-needed", stage: "maintenance-absent" };
  if (status.maintenance.state !== "inactive") return blocked(`maintenance-${status.maintenance.state}`);
  const candidates = [];
  for (const { operationId: id } of [...status.reconciliations.completed, ...status.reconciliations.pending]) {
    const intent = await fileState(join(directory, `recovery-reconciliation-${id}.intent.json`));
    if (validReconciliationIntent(intent.value, id) && intent.value.schemaVersion === 2 && intent.value.maintenanceSha256 === status.maintenance.sha256)
      candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-maintenance");
  const { id, intent } = candidates[0], origin = intent.value;
  if ((await fileState(join(directory, `recovery-reconciliation-${id}.json`))).kind !== "absent") return blocked("receipt-present");
  if (!status.reconciliations.pending.some(item => item.operationId === id) || status.reconciliations.pending.some(item => item.operationId !== id) ||
    !["absent", "inactive"].includes(status.publication.state)) return blocked("divergent-evidence");
  const ids = origin.plan.acknowledgedArchives.map(item => item.id).sort();
  if (status.archives.pending.some(item => item.issue !== "missing-record") ||
    JSON.stringify(status.archives.pending.map(item => item.id).sort()) !== JSON.stringify(ids)) return blocked("divergent-evidence");
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
  const extra = 3 + Number(source.kind === "present");
  if ((await evidenceNames(directory)).length + extra > 605) return blocked("history-limit");
  const plan = { schemaVersion: 1, decision: "abort-local-reconciliation", directorySha256, maintenanceSha256: status.maintenance.sha256,
    reconciliationId: id, intentSha256: intent.sha256, stage, sourceGuardSha256: source.sha256 || null,
    archivedGuardSha256: archive.sha256 || null, publicationSha256, pointerSha256, historySha256: await historyHash(directory) };
  if (!validReconciliationAbortPlan(plan)) throw fail();
  return { ...base, status: "prepared-local", eligible: true, stage, planSha256: planDigest(plan), plan };
}
export async function inspectReconciliationAbort(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareReconciliationAbort(directory = join(root, "dist")) {
  const result = await inspectReconciliationAbort(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, abortId, maintenancePresent, recoveryPresent, maintenanceArchived, recoveryArchived) {
  const intent = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.intent.json`)), origin = intent.value;
  const maintenance = await fileState(join(directory, "publish-maintenance.lock")), recovery = await fileState(join(directory, "publish-recovery.lock"));
  const maintenanceArchive = await fileState(join(directory, `publish-aborted-maintenance-${abortId}.lock`));
  const recoveryArchive = await fileState(join(directory, `publish-aborted-recovery-${abortId}.lock`));
  const oldArchive = await fileState(join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`));
  const publication = await fileState(join(directory, "publish.lock"));
  if (!validReconciliationIntent(origin, plan.reconciliationId) || origin.schemaVersion !== 2 || intent.sha256 !== plan.intentSha256 ||
    origin.maintenanceSha256 !== plan.maintenanceSha256 ||
    (maintenancePresent ? ownership(maintenance).state !== "inactive" || maintenance.sha256 !== plan.maintenanceSha256 : maintenance.kind !== "absent") ||
    (recoveryPresent ? ownership(recovery).state !== "inactive" || recovery.sha256 !== plan.sourceGuardSha256 : recovery.kind !== "absent") ||
    (maintenanceArchived ? ownership(maintenanceArchive).state !== "inactive" || maintenanceArchive.sha256 !== plan.maintenanceSha256 : maintenanceArchive.kind !== "absent") ||
    (recoveryArchived ? ownership(recoveryArchive).state !== "inactive" || recoveryArchive.sha256 !== plan.sourceGuardSha256 : recoveryArchive.kind !== "absent") ||
    (plan.archivedGuardSha256 === null ? oldArchive.kind !== "absent" : ownership(oldArchive).state !== "inactive" || oldArchive.sha256 !== plan.archivedGuardSha256) ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await historyHash(directory, abortId) !== plan.historySha256) throw fail();
  await absent(join(directory, "publish-resume.lock"));
  await absent(join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`));
  await acknowledgedIntact(directory, origin);
}
export async function abortRecoveryReconciliation(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  await absent(join(directory, "publish-resume.lock"));
  if (["invalid", "changed"].includes((await inspectRecoveryStatus(directory)).status)) throw fail();
  // Reuse the existing finalization gate: no new lock tier or automatic cleanup.
  const guardPath = join(directory, "publish-finalization.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const id = review.operationId, intentPath = join(directory, `reconciliation-abort-${id}.intent.json`), receiptPath = join(directory, `reconciliation-abort-${id}.json`);
    const maintenanceArchive = join(directory, `publish-aborted-maintenance-${id}.lock`), recoveryArchive = join(directory, `publish-aborted-recovery-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || !validReconciliationAbortIntent(previous.value, id) || previous.value.reviewer !== review.reviewer ||
        previous.value.reason !== review.reason || previous.value.planSha256 !== review.planSha256 ||
        !status.reconciliationAborts.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned();
      return { aborted: true, operationId: id, reconciliationId: previous.value.plan.reconciliationId, replayed: true };
    }
    await absent(receiptPath); await absent(maintenanceArchive); await absent(recoveryArchive);
    const observation = await observe(directory, true), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.reconciliationId) throw fail();
    let maintenancePresent = true, recoveryPresent = plan.sourceGuardSha256 !== null, maintenanceArchived = false, recoveryArchived = false;
    const stable = async () => { await unchanged(directory, plan, id, maintenancePresent, recoveryPresent, maintenanceArchived, recoveryArchived); await owned(); };
    await stable();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer, reason: review.reason,
      planSha256: review.planSha256, plan, finalizationSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const ownIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    const verified = async () => { await stable(); await ownIntent(); };
    await verified();
    await link(join(directory, "publish-maintenance.lock"), maintenanceArchive); maintenanceArchived = true;
    await verified();
    if (recoveryPresent) { await link(join(directory, "publish-recovery.lock"), recoveryArchive); recoveryArchived = true; }
    await verified();
    if (recoveryPresent) { await unlink(join(directory, "publish-recovery.lock")); recoveryPresent = false; }
    await verified();
    await unlink(join(directory, "publish-maintenance.lock")); maintenancePresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, outcome: "aborted", intentSha256: hash(intent),
      maintenanceArchiveSha256: plan.maintenanceSha256, recoveryArchiveSha256: plan.sourceGuardSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const status = await inspectRecoveryStatus(directory);
    if (!status.reconciliationAborts?.completed.some(item => item.operationId === id) ||
      !status.reconciliations?.aborted.some(item => item.operationId === plan.reconciliationId && item.abortId === id)) throw fail();
    await verified();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { aborted: true, operationId: id, reconciliationId: plan.reconciliationId, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-reconciliation-abort-status.json" : applying ? "web-reconciliation-abort-result.json" : "web-reconciliation-abort-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectReconciliationAbort(directory) : applying ?
      await abortRecoveryReconciliation(directory, (await fileState(resolve(reviewPath))).value) : await prepareReconciliationAbort(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Cancelación de reconciliación: ${result.stage}.` : applying ? "Cancelación registrada con evidencia; comprueba coordinación por separado." : "Plan de cancelación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Do not expose raw IO errors, reviewer, reason or private paths. */ }
    console.error("No se completó la cancelación; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
