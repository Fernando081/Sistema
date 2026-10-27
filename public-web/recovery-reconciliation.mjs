import { open, access, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRecoveryStatus, fileState, validOwner, ownership, validPlan, planDigest, directoryDigest } from "./recovery-status.mjs";
import { assertNoResumption } from "./publication-lock.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = raw => createHash("sha256").update(raw).digest("hex");
const invalid = () => new Error("Reconciliación no preparada o evidencia/revisión desactualizada");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
function validateReview(review) {
  if (!exact(review, ["operationId", "decision", "reviewer", "planSha256"]) || typeof review.operationId !== "string" || !uuid.test(review.operationId) ||
    review.decision !== "reconcile-local-recovery" || typeof review.reviewer !== "string" || !review.reviewer.trim() || review.reviewer.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(review.reviewer) || typeof review.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(review.planSha256)) throw invalid();
  return { ...review, reviewer: review.reviewer.trim() };
}
export async function pointerHash(directory) {
  const state = await fileState(join(directory, "current-release.json"));
  if (state.kind === "absent") return null;
  if (state.kind !== "present" || !exact(state.value, ["release", "integrity"]) || typeof state.value.release !== "string" ||
    !uuid.test(state.value.release) || typeof state.value.integrity !== "string" || !/^[a-f0-9]{64}$/.test(state.value.integrity)) throw invalid();
  return state.sha256;
}
async function currentPlan(directory, maintenanceAllowed = false) {
  await assertNoResumption(directory);
  const status = await inspectRecoveryStatus(directory);
  if (["changed", "invalid"].includes(status.status) || (!maintenanceAllowed && status.maintenance?.state !== "absent") ||
    status.recovery?.state !== "inactive" || !["absent", "inactive"].includes(status.publication?.state) || status.reconciliationAbortContinuations.pending.length || status.resumptionAbortContinuations.pending.length || status.closureAbortContinuations.pending.length || status.abortContinuationFinalizations.pending.length || status.reconciliations.pending.length || status.maintenanceReviews.pending.length || status.resumptions.pending.length || status.resumptionReviews.pending.length || status.closureResumptions.pending.length || status.reconciliationAborts.pending.length || status.resumptionContinuations.pending.length || status.resumptionAborts.pending.length || status.closureAborts.pending.length ||
    status.archives.pending.length > 20 || status.archives.pending.some(item => item.issue !== "missing-record")) throw invalid();
  const acknowledgedArchives = [];
  for (const item of status.archives.pending) {
    const archive = await fileState(join(directory, `publish-orphan-${item.id}.lock`));
    if (ownership(archive).state !== "inactive") throw invalid();
    acknowledgedArchives.push({ id: item.id, sha256: archive.sha256 });
  }
  const plan = { schemaVersion: 1, decision: "archive-inactive-recovery-guard", directorySha256: await directoryDigest(directory),
    guardSha256: status.recovery.sha256, publicationSha256: status.publication.sha256 || null,
    pointerSha256: await pointerHash(directory), acknowledgedArchives };
  if (!validPlan(plan)) throw invalid();
  return plan;
}
export async function prepareRecoveryReconciliation(directory = join(root, "dist")) {
  const plan = await currentPlan(directory);
  // A plan is a proposal. Repeat observation before handing its hash to a reviewer.
  if (planDigest(plan) !== planDigest(await currentPlan(directory))) throw invalid();
  return { schemaVersion: 1, status: "prepared-local", planSha256: planDigest(plan), plan,
    scope: "Plan de revisión local; no aprobado, no aplicado y sin cambios en publicaciones" };
}
async function writeExclusive(path, raw) {
  const handle = await open(path, "wx");
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
}
async function absent(path) {
  try { await access(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw invalid();
}
async function unchanged(directory, plan, guardPresent = true) {
  const guard = await fileState(join(directory, "publish-recovery.lock"));
  const publication = await fileState(join(directory, "publish.lock"));
  if ((guardPresent ? ownership(guard).state !== "inactive" || guard.sha256 !== plan.guardSha256 : guard.kind !== "absent") ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await pointerHash(directory) !== plan.pointerSha256 || await directoryDigest(directory) !== plan.directorySha256) throw invalid();
  for (const item of plan.acknowledgedArchives) {
    const archive = await fileState(join(directory, `publish-orphan-${item.id}.lock`));
    if (ownership(archive).state !== "inactive" || archive.sha256 !== item.sha256) throw invalid();
    await absent(join(directory, `lock-recovery-${item.id}.json`));
  }
}
export async function applyRecoveryReconciliation(directory, input) {
  const review = validateReview(input);
  directory = resolve(directory);
  // Validate the directory before creating any maintenance file.
  const initial = await inspectRecoveryStatus(directory);
  if (initial.status === "invalid") throw invalid();
  await assertNoResumption(directory);
  const maintenancePath = join(directory, "publish-maintenance.lock");
  const handle = await open(maintenancePath, "wx");
  const rawOwner = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  async function ownMaintenance() {
    if ((await fileState(maintenancePath)).sha256 !== digest(rawOwner))
      throw new Error("Cambió propietario de mantenimiento; se conserva bloqueo");
  }
  let mutation = false, completed = false;
  try {
    await handle.writeFile(rawOwner); await handle.sync();
    await assertNoResumption(directory);
    const id = review.operationId;
    const intentPath = join(directory, `recovery-reconciliation-${id}.intent.json`);
    const receiptPath = join(directory, `recovery-reconciliation-${id}.json`);
    const guardArchive = join(directory, `publish-recovery-orphan-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || status.reconciliationAbortContinuations.pending.length || status.resumptionAbortContinuations.pending.length || status.closureAbortContinuations.pending.length || status.abortContinuationFinalizations.pending.length || status.reconciliationAborts.pending.length || status.resumptionContinuations.pending.length || status.resumptionAborts.pending.length || status.closureAborts.pending.length || previous.kind !== "present" || previous.value?.planSha256 !== review.planSha256 || previous.value?.reviewer !== review.reviewer ||
        !status.reconciliations?.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256)) throw invalid();
      return { reconciled: true, operationId: id, replayed: true };
    }
    await absent(receiptPath); await absent(guardArchive);
    const plan = await currentPlan(directory, true);
    if (planDigest(plan) !== review.planSha256) throw invalid();
    await unchanged(directory, plan);
    const intent = JSON.stringify({ schemaVersion: 2, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, maintenanceSha256: digest(rawOwner), createdAt: new Date().toISOString() });
    await ownMaintenance();
    // From this point any failure leaves maintenance in place. Intent is evidence
    // of proposed action, never a fabricated historical recovery receipt.
    mutation = true;
    await writeExclusive(intentPath, intent);
    await unchanged(directory, plan);
    await ownMaintenance();
    await link(join(directory, "publish-recovery.lock"), guardArchive); // Exclusive destination; same filesystem.
    const archived = await fileState(guardArchive);
    if (!validOwner(archived.value) || archived.sha256 !== plan.guardSha256) throw invalid();
    await unchanged(directory, plan);
    await ownMaintenance();
    await unlink(join(directory, "publish-recovery.lock"));
    await unchanged(directory, plan, false);
    await ownMaintenance();
    await writeExclusive(receiptPath, JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision,
      intentSha256: digest(intent), completedAt: new Date().toISOString() }));
    const final = await inspectRecoveryStatus(directory);
    if (!final.reconciliations?.completed.some(item => item.operationId === id)) throw invalid();
    await unchanged(directory, plan, false);
    await ownMaintenance();
    completed = true;
    return { reconciled: true, operationId: id, replayed: false };
  } finally {
    await handle.close();
    if (!mutation || completed) {
      await ownMaintenance();
      await unlink(maintenancePath);
    }
    // A failure after intent/archive requires manual review; no unsafe automatic
    // resume or cleanup of orphaned maintenance gates.
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(root, "..", ".artifacts");
  const args = process.argv.slice(2);
  const applying = args.includes("--apply");
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw invalid();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewFile = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewFile) throw invalid();
    const result = applying ? await applyRecoveryReconciliation(directory, (await fileState(resolve(reviewFile))).value) : await prepareRecoveryReconciliation(directory);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, applying ? "web-reconciliation-result.json" : "web-reconciliation-plan.json"), JSON.stringify(result, null, 2));
    console.log(applying ? "Reconciliación local registrada; revisa diagnóstico y evidencia." : "Plan local preparado; no aplicado. Reporte: .artifacts/web-reconciliation-plan.json");
  } catch {
    try {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, applying ? "web-reconciliation-result.json" : "web-reconciliation-plan.json"), JSON.stringify({ status: "not-completed", resultConfirmed: false,
        scope: "Sin confirmación de resultado; inspecciona bloqueos/evidencia antes de reintentar" }, null, 2));
    } catch { /* Output storage failure must not expose raw error or private input. */ }
    console.error("No se completó la operación; revisa diagnóstico, revisión y evidencia. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
