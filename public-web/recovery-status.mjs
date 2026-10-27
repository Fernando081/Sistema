import { open, lstat, opendir, mkdir, writeFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const archiveName = new RegExp(`^publish-orphan-(${uuid})\\.lock$`);
const recordName = new RegExp(`^lock-recovery-(${uuid})\\.json$`);
const guardArchiveName = new RegExp(`^publish-recovery-orphan-(${uuid})\\.lock$`);
const reconcileName = new RegExp(`^recovery-reconciliation-(${uuid})(?:\\.intent)?\\.json$`);
const maintenanceArchiveName = new RegExp(`^publish-maintenance-orphan-(${uuid})\\.lock$`);
const maintenanceReviewName = new RegExp(`^maintenance-review-(${uuid})(?:\\.intent)?\\.json$`);
const resumptionName = new RegExp(`^reconciliation-resume-(${uuid})(?:\\.intent)?\\.json$`);
const resumptionContinuationName = new RegExp(`^resumption-continuation-(${uuid})(?:\\.intent)?\\.json$`);
const continuedResumptionArchiveName = new RegExp(`^publish-continued-resume-(${uuid})\\.lock$`);
const resumptionAbortName = new RegExp(`^resumption-abort-(${uuid})(?:\\.intent)?\\.json$`);
const abortedResumptionArchiveName = new RegExp(`^publish-aborted-resume-(${uuid})\\.lock$`);
const resumptionGuardArchiveName = new RegExp(`^publish-resume-orphan-(${uuid})\\.lock$`);
const resumptionReviewName = new RegExp(`^resumption-review-(${uuid})(?:\\.intent)?\\.json$`);
const closureResumptionName = new RegExp(`^closure-resumption-(${uuid})(?:\\.intent)?\\.json$`);
const closureRecoveryArchiveName = new RegExp(`^publish-closure-recovery-orphan-(${uuid})\\.lock$`);
const closureAbortName = new RegExp(`^closure-abort-(${uuid})(?:\\.intent)?\\.json$`);
const closureAbortContinuationName = new RegExp(`^closure-abort-continuation-(${uuid})(?:\\.intent)?\\.json$`);
const continuedClosureAbortArchiveName = new RegExp(`^publish-continued-closure-abort-finalization-(${uuid})\\.lock$`);
const abortedClosureRecoveryName = new RegExp(`^publish-aborted-closure-recovery-(${uuid})\\.lock$`);
const abortName = new RegExp(`^reconciliation-abort-(${uuid})(?:\\.intent)?\\.json$`);
const abortMaintenanceName = new RegExp(`^publish-aborted-maintenance-(${uuid})\\.lock$`);
const abortRecoveryName = new RegExp(`^publish-aborted-recovery-(${uuid})\\.lock$`);
const abortContinuationName = new RegExp(`^reconciliation-abort-continuation-(${uuid})(?:\\.intent)?\\.json$`);
const continuedAbortArchiveName = new RegExp(`^publish-continued-abort-finalization-(${uuid})\\.lock$`);
const resumeAbortContinuationName = new RegExp(`^resumption-abort-continuation-(${uuid})(?:\\.intent)?\\.json$`);
// This exclusive destination is shared by all reviewers of the SAME abort.
const continuedResumeAbortArchiveName = new RegExp(`^publish-continued-resumption-abort-finalization-(${uuid})\\.lock$`);
const abortFinalizationName = new RegExp(`^abort-continuation-finalization-(${uuid})(?:\\.intent)?\\.json$`);
const completedAbortControlName = new RegExp(`^publish-completed-abort-continuation-control-(${uuid})\\.lock$`);
const hash = raw => createHash("sha256").update(raw).digest("hex");
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...fields].sort().join(",");

// Bounded, regular files only. Raw contents never enter diagnostic reports.
export async function fileState(path) {
  let handle;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) return { kind: "invalid" };
    handle = await open(path, "r");
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || !opened.isFile()) return { kind: "invalid" };
    const buffer = Buffer.alloc(16385);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > 16384) return { kind: "invalid" };
    const data = buffer.subarray(0, bytes);
    let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); } catch { /* incomplete metadata */ }
    return { kind: "present", sha256: hash(data), value };
  } catch (error) {
    return { kind: error.code === "ENOENT" ? "absent" : "invalid" };
  } finally { await handle?.close(); }
}
export function validOwner(owner) {
  if (!exact(owner, ["schemaVersion", "pid", "host", "nonce", "createdAt"]) || owner.schemaVersion !== 1 ||
    !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid > 2147483647 ||
    typeof owner.host !== "string" || !owner.host || owner.host.length > 255 ||
    typeof owner.nonce !== "string" || !new RegExp(`^${uuid}$`).test(owner.nonce) ||
    typeof owner.createdAt !== "string") return false;
  const time = Date.parse(owner.createdAt);
  return Number.isFinite(time) && new Date(time).toISOString() === owner.createdAt;
}
export function ownership(state) {
  if (state.kind === "absent") return { state: "absent" };
  // A corrupt/legacy file could contain arbitrary private bytes; don't publish
  // even their digest. Only valid lock metadata is projected into the report.
  if (state.kind !== "present" || !validOwner(state.value)) return { state: "invalid" };
  const owner = state.value;
  const metadata = { pid: owner.pid, createdAt: owner.createdAt, sha256: state.sha256 };
  if (owner.host !== hostname()) return { state: "foreign", ...metadata };
  try { process.kill(owner.pid, 0); return { state: "active", ...metadata }; }
  catch (error) { return { state: error.code === "ESRCH" ? "inactive" : "unverifiable", ...metadata }; }
}
export async function evidenceNames(directory) {
  const result = ["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock"];
  let entries = 0;
  for await (const entry of await opendir(directory)) {
    if (++entries > 10000) throw new Error("Inspección acotada");
    if (archiveName.test(entry.name) || recordName.test(entry.name) || guardArchiveName.test(entry.name) || reconcileName.test(entry.name) ||
      maintenanceArchiveName.test(entry.name) || maintenanceReviewName.test(entry.name) || resumptionName.test(entry.name) ||
      resumptionGuardArchiveName.test(entry.name) || resumptionReviewName.test(entry.name) || closureResumptionName.test(entry.name) || closureRecoveryArchiveName.test(entry.name) ||
      abortName.test(entry.name) || abortMaintenanceName.test(entry.name) || abortRecoveryName.test(entry.name) ||
      resumptionContinuationName.test(entry.name) || continuedResumptionArchiveName.test(entry.name) ||
      resumptionAbortName.test(entry.name) || abortedResumptionArchiveName.test(entry.name) ||
      closureAbortName.test(entry.name) || abortedClosureRecoveryName.test(entry.name) ||
      abortContinuationName.test(entry.name) || continuedAbortArchiveName.test(entry.name) ||
      resumeAbortContinuationName.test(entry.name) || continuedResumeAbortArchiveName.test(entry.name) ||
      closureAbortContinuationName.test(entry.name) || continuedClosureAbortArchiveName.test(entry.name) ||
      abortFinalizationName.test(entry.name) || completedAbortControlName.test(entry.name)) {
      result.push(entry.name);
      if (result.length > 605) throw new Error("Historial requiere revisión");
    }
  }
  return result.sort();
}
const token = state => state.kind + ":" + (state.sha256 || "");
export const planDigest = plan => hash(JSON.stringify(plan));
export const directoryDigest = async directory => hash(await realpath(directory));
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validReconciliationIntent(draft, id) {
  const fields = ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "createdAt"];
  if (draft?.schemaVersion === 2) fields.push("maintenanceSha256");
  return exact(draft, fields) && [1, 2].includes(draft.schemaVersion) && draft.operationId === id &&
    draft.decision === "reconcile-local-recovery" && typeof draft.reviewer === "string" && draft.reviewer.trim() &&
    draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) && validPlan(draft.plan) &&
    draft.planSha256 === planDigest(draft.plan) && validDate(draft.createdAt) && (draft.schemaVersion === 1 || validHash(draft.maintenanceSha256));
}
export function validMaintenancePlan(plan) {
  return exact(plan, ["schemaVersion", "decision", "directorySha256", "maintenanceSha256", "reconciliationId", "intentSha256", "receiptSha256",
    "archivedGuardSha256", "publicationSha256", "pointerSha256", "historySha256"]) && plan.schemaVersion === 1 &&
    plan.decision === "archive-completed-maintenance" && new RegExp(`^${uuid}$`).test(plan.reconciliationId) &&
    ["directorySha256", "maintenanceSha256", "intentSha256", "receiptSha256", "archivedGuardSha256", "historySha256"].every(key => validHash(plan[key])) &&
    ["publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key]));
}
export function validPlan(plan) {
  return exact(plan, ["schemaVersion", "decision", "directorySha256", "guardSha256", "publicationSha256", "pointerSha256", "acknowledgedArchives"]) &&
    plan.schemaVersion === 1 && plan.decision === "archive-inactive-recovery-guard" && validHash(plan.guardSha256) &&
    validHash(plan.directorySha256) &&
    (plan.publicationSha256 === null || validHash(plan.publicationSha256)) && (plan.pointerSha256 === null || validHash(plan.pointerSha256)) &&
    Array.isArray(plan.acknowledgedArchives) && plan.acknowledgedArchives.length <= 20 &&
    plan.acknowledgedArchives.every(item => exact(item, ["id", "sha256"]) && new RegExp(`^${uuid}$`).test(item.id) && validHash(item.sha256)) &&
    new Set(plan.acknowledgedArchives.map(item => item.id)).size === plan.acknowledgedArchives.length;
}
export function validResumptionPlan(plan) {
  if (!exact(plan, ["schemaVersion", "decision", "directorySha256", "maintenanceSha256", "reconciliationId", "intentSha256", "stage",
    "sourceGuardSha256", "archivedGuardSha256", "publicationSha256", "pointerSha256", "historySha256"]) || plan.schemaVersion !== 1 ||
    plan.decision !== "resume-local-reconciliation" || !new RegExp(`^${uuid}$`).test(plan.reconciliationId) ||
    !["directorySha256", "maintenanceSha256", "intentSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !["sourceGuardSha256", "archivedGuardSha256", "publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key]))) return false;
  return (plan.stage === "intent-only" && validHash(plan.sourceGuardSha256) && plan.archivedGuardSha256 === null) ||
    (plan.stage === "guard-archived" && validHash(plan.sourceGuardSha256) && plan.sourceGuardSha256 === plan.archivedGuardSha256) ||
    (plan.stage === "guard-removed" && plan.sourceGuardSha256 === null && validHash(plan.archivedGuardSha256));
}
export function validResumptionIntent(draft, id) {
  const fields = ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "createdAt"];
  if (draft?.schemaVersion === 2) fields.push("resumptionSha256");
  return exact(draft, fields) && [1, 2].includes(draft.schemaVersion) &&
    draft.operationId === id && draft.decision === "resume-local-reconciliation" && typeof draft.reviewer === "string" && draft.reviewer.trim() &&
    draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) && validResumptionPlan(draft.plan) &&
    id !== draft.plan.reconciliationId && draft.planSha256 === planDigest(draft.plan) && validDate(draft.createdAt) &&
    (draft.schemaVersion === 1 || validHash(draft.resumptionSha256));
}
export function validResumptionReceipt(result, id, intentSha256, reconciliationReceiptSha256) {
  const fields = ["schemaVersion", "operationId", "decision", "intentSha256", "reconciliationReceiptSha256", "completedAt"];
  if (result?.schemaVersion === 2) fields.push("resumptionContinuationId", "resumptionContinuationIntentSha256");
  return exact(result, fields) && [1, 2].includes(result.schemaVersion) && result.operationId === id &&
    result.decision === "resume-local-reconciliation" && result.intentSha256 === intentSha256 &&
    result.reconciliationReceiptSha256 === reconciliationReceiptSha256 && validDate(result.completedAt) &&
    (result.schemaVersion === 1 || new RegExp(`^${uuid}$`).test(result.resumptionContinuationId) &&
      result.resumptionContinuationId !== id && validHash(result.resumptionContinuationIntentSha256));
}
export function validResumptionContinuationPlan(plan) {
  if (!exact(plan, ["schemaVersion", "decision", "directorySha256", "resumptionId", "resumptionIntentSha256", "resumptionSha256",
    "reconciliationId", "reconciliationIntentSha256", "reconciliationReceiptSha256", "stage", "sourceGuardSha256", "archivedGuardSha256",
    "maintenanceSha256", "publicationSha256", "pointerSha256", "historySha256"]) || plan.schemaVersion !== 1 ||
    plan.decision !== "continue-local-resumption" || !new RegExp(`^${uuid}$`).test(plan.resumptionId) ||
    !new RegExp(`^${uuid}$`).test(plan.reconciliationId) || plan.resumptionId === plan.reconciliationId ||
    !["directorySha256", "resumptionIntentSha256", "resumptionSha256", "reconciliationIntentSha256", "maintenanceSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !["reconciliationReceiptSha256", "sourceGuardSha256", "archivedGuardSha256", "publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key]))) return false;
  return (plan.stage === "intent-only" && validHash(plan.sourceGuardSha256) && plan.archivedGuardSha256 === null && plan.reconciliationReceiptSha256 === null) ||
    (plan.stage === "guard-archived" && validHash(plan.sourceGuardSha256) && plan.sourceGuardSha256 === plan.archivedGuardSha256 && plan.reconciliationReceiptSha256 === null) ||
    (plan.stage === "guard-removed" && plan.sourceGuardSha256 === null && validHash(plan.archivedGuardSha256) && plan.reconciliationReceiptSha256 === null) ||
    (plan.stage === "reconciliation-completed" && plan.sourceGuardSha256 === null && validHash(plan.archivedGuardSha256) && validHash(plan.reconciliationReceiptSha256));
}
export function validResumptionContinuationIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "finalizationSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "continue-local-resumption" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    validResumptionContinuationPlan(draft.plan) && id !== draft.plan.resumptionId && id !== draft.plan.reconciliationId &&
    draft.planSha256 === planDigest(draft.plan) && validHash(draft.finalizationSha256) && validDate(draft.createdAt);
}
export function validResumptionAbortPlan(plan) {
  return plan?.decision === "abort-local-resumption" && validResumptionContinuationPlan({ ...plan, decision: "continue-local-resumption" });
}
export function validResumptionAbortIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "reason", "planSha256", "plan", "finalizationSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "abort-local-resumption" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 &&
    typeof draft.reason === "string" && draft.reason.trim() && draft.reason.length <= 500 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer + draft.reason) &&
    validResumptionAbortPlan(draft.plan) && id !== draft.plan.resumptionId && id !== draft.plan.reconciliationId &&
    draft.planSha256 === planDigest(draft.plan) && validHash(draft.finalizationSha256) && validDate(draft.createdAt);
}
export function validResumptionAbortReceipt(result, id, intentSha256, archiveSha256, reconciliationReceiptSha256) {
  const fields = ["schemaVersion", "operationId", "decision", "outcome", "intentSha256", "resumptionArchiveSha256", "reconciliationReceiptSha256", "completedAt"];
  if (result?.schemaVersion === 2) fields.push("abortContinuationId", "abortContinuationIntentSha256");
  return exact(result, fields) && [1, 2].includes(result.schemaVersion) && result.operationId === id &&
    result.decision === "abort-local-resumption" && result.outcome === "aborted" && result.intentSha256 === intentSha256 &&
    result.resumptionArchiveSha256 === archiveSha256 && result.reconciliationReceiptSha256 === reconciliationReceiptSha256 && validDate(result.completedAt) &&
    (result.schemaVersion === 1 || new RegExp(`^${uuid}$`).test(result.abortContinuationId) && result.abortContinuationId !== id && validHash(result.abortContinuationIntentSha256));
}
export function validResumptionAbortContinuationPlan(plan) {
  if (!exact(plan, ["schemaVersion", "decision", "directorySha256", "abortId", "abortIntentSha256", "finalizationSha256", "stage",
    "sourceSha256", "archivedSourceSha256", "abortReceiptSha256", "maintenanceSha256", "publicationSha256", "pointerSha256", "historySha256"]) ||
    plan.schemaVersion !== 1 || plan.decision !== "continue-local-resumption-abort" || !new RegExp(`^${uuid}$`).test(plan.abortId) ||
    !["directorySha256", "abortIntentSha256", "finalizationSha256", "maintenanceSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !["sourceSha256", "archivedSourceSha256", "abortReceiptSha256", "publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key]))) return false;
  return (plan.stage === "intent-only" && validHash(plan.sourceSha256) && plan.archivedSourceSha256 === null && plan.abortReceiptSha256 === null) ||
    (plan.stage === "source-archived" && validHash(plan.sourceSha256) && plan.sourceSha256 === plan.archivedSourceSha256 && plan.abortReceiptSha256 === null) ||
    (plan.stage === "source-removed" && plan.sourceSha256 === null && validHash(plan.archivedSourceSha256) && plan.abortReceiptSha256 === null) ||
    (plan.stage === "completed-before-release" && plan.sourceSha256 === null && validHash(plan.archivedSourceSha256) && validHash(plan.abortReceiptSha256));
}
export function validResumptionAbortContinuationIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "claimOwner", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "continue-local-resumption-abort" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    validResumptionAbortContinuationPlan(draft.plan) && id !== draft.plan.abortId && draft.planSha256 === planDigest(draft.plan) &&
    validOwner(draft.claimOwner) && validDate(draft.createdAt);
}
export function validReconciliationAbortPlan(plan) {
  return plan?.decision === "abort-local-reconciliation" && validResumptionPlan({ ...plan, decision: "resume-local-reconciliation" });
}
export function validReconciliationAbortIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "reason", "planSha256", "plan", "finalizationSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && typeof id === "string" && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id &&
    draft.decision === "abort-local-reconciliation" && typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 &&
    typeof draft.reason === "string" && draft.reason.trim() && draft.reason.length <= 500 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer + draft.reason) &&
    validReconciliationAbortPlan(draft.plan) && id !== draft.plan.reconciliationId && draft.planSha256 === planDigest(draft.plan) &&
    validHash(draft.finalizationSha256) && validDate(draft.createdAt);
}
export function validReconciliationAbortReceipt(result, id, intentSha256, maintenanceSha256, recoverySha256) {
  const fields = ["schemaVersion", "operationId", "decision", "outcome", "intentSha256", "maintenanceArchiveSha256", "recoveryArchiveSha256", "completedAt"];
  if (result?.schemaVersion === 2) fields.push("abortContinuationId", "abortContinuationIntentSha256");
  return exact(result, fields) && [1, 2].includes(result.schemaVersion) && result.operationId === id &&
    result.decision === "abort-local-reconciliation" && result.outcome === "aborted" && result.intentSha256 === intentSha256 &&
    result.maintenanceArchiveSha256 === maintenanceSha256 && result.recoveryArchiveSha256 === recoverySha256 && validDate(result.completedAt) &&
    (result.schemaVersion === 1 || new RegExp(`^${uuid}$`).test(result.abortContinuationId) && result.abortContinuationId !== id &&
      validHash(result.abortContinuationIntentSha256));
}
export function validReconciliationAbortContinuationPlan(plan) {
  if (!exact(plan, ["schemaVersion", "decision", "directorySha256", "abortId", "abortIntentSha256", "finalizationSha256", "stage",
    "initialRecoverySha256", "maintenancePresent", "recoveryPresent", "maintenanceArchived", "recoveryArchived", "abortReceiptSha256",
    "publicationSha256", "pointerSha256", "historySha256"]) || plan.schemaVersion !== 1 || plan.decision !== "continue-local-reconciliation-abort" ||
    !new RegExp(`^${uuid}$`).test(plan.abortId) || !["directorySha256", "abortIntentSha256", "finalizationSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !["initialRecoverySha256", "abortReceiptSha256", "publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key])) ||
    !["maintenancePresent", "recoveryPresent", "maintenanceArchived", "recoveryArchived"].every(key => typeof plan[key] === "boolean")) return false;
  const hasRecovery = plan.initialRecoverySha256 !== null;
  const matches = (mp, rp, ma, ra, receipt) => plan.maintenancePresent === mp && plan.recoveryPresent === rp &&
    plan.maintenanceArchived === ma && plan.recoveryArchived === ra && (receipt ? validHash(plan.abortReceiptSha256) : plan.abortReceiptSha256 === null);
  return (plan.stage === "intent-only" && matches(true, hasRecovery, false, false, false)) ||
    (plan.stage === "maintenance-archived" && matches(true, hasRecovery, true, false, false)) ||
    (hasRecovery && plan.stage === "sources-archived" && matches(true, true, true, true, false)) ||
    (hasRecovery && plan.stage === "recovery-removed" && matches(true, false, true, true, false)) ||
    (plan.stage === "maintenance-removed" && matches(false, false, true, hasRecovery, false)) ||
    (plan.stage === "completed-before-release" && matches(false, false, true, hasRecovery, true));
}
export function validReconciliationAbortContinuationIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "resumptionSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "continue-local-reconciliation-abort" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    validReconciliationAbortContinuationPlan(draft.plan) && id !== draft.plan.abortId && draft.planSha256 === planDigest(draft.plan) &&
    validHash(draft.resumptionSha256) && validDate(draft.createdAt);
}
export function validResumptionGuardPlan(plan) {
  return exact(plan, ["schemaVersion", "decision", "directorySha256", "resumptionSha256", "resumptionId", "resumptionIntentSha256",
    "resumptionReceiptSha256", "reconciliationId", "reconciliationIntentSha256", "reconciliationReceiptSha256", "archivedGuardSha256",
    "maintenanceSha256", "publicationSha256", "pointerSha256", "historySha256"]) && plan.schemaVersion === 1 &&
    plan.decision === "archive-completed-resumption" && typeof plan.resumptionId === "string" && new RegExp(`^${uuid}$`).test(plan.resumptionId) &&
    typeof plan.reconciliationId === "string" && new RegExp(`^${uuid}$`).test(plan.reconciliationId) && plan.resumptionId !== plan.reconciliationId &&
    ["directorySha256", "resumptionSha256", "resumptionIntentSha256", "resumptionReceiptSha256", "reconciliationIntentSha256",
      "reconciliationReceiptSha256", "archivedGuardSha256", "maintenanceSha256", "historySha256"].every(key => validHash(plan[key])) &&
    ["publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key]));
}
export function validReconciliationReceipt(result, id, intentSha256) {
  const keys = ["schemaVersion", "operationId", "decision", "intentSha256", "completedAt"];
  if (result?.schemaVersion === 2) keys.push("resumptionId", "resumptionIntentSha256");
  return exact(result, keys) && [1, 2].includes(result.schemaVersion) && result.operationId === id &&
    result.decision === "reconcile-local-recovery" && result.intentSha256 === intentSha256 && validDate(result.completedAt) &&
    (result.schemaVersion === 1 || (new RegExp(`^${uuid}$`).test(result.resumptionId) && validHash(result.resumptionIntentSha256)));
}
export function closureNames(kind, id) {
  return kind === "maintenance" ? { source: "publish-maintenance.lock", intent: `maintenance-review-${id}.intent.json`,
    receipt: `maintenance-review-${id}.json`, archive: `publish-maintenance-orphan-${id}.lock`, decision: "archive-completed-maintenance" } :
    { source: "publish-resume.lock", intent: `resumption-review-${id}.intent.json`, receipt: `resumption-review-${id}.json`,
      archive: `publish-resume-orphan-${id}.lock`, decision: "archive-completed-resumption" };
}
export function validClosureIntent(draft, id, kind) {
  const fields = ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "createdAt"];
  if (draft?.schemaVersion === 2) fields.push("recoverySha256");
  return ["maintenance", "resumption"].includes(kind) && exact(draft, fields) && [1, 2].includes(draft.schemaVersion) &&
    new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === closureNames(kind, id).decision &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    (kind === "maintenance" ? validMaintenancePlan(draft.plan) : validResumptionGuardPlan(draft.plan) &&
      id !== draft.plan.resumptionId && id !== draft.plan.reconciliationId) && draft.planSha256 === planDigest(draft.plan) &&
    validDate(draft.createdAt) && (draft.schemaVersion === 1 || validHash(draft.recoverySha256));
}
export function validClosureReceipt(result, id, intentSha256, kind) {
  const fields = ["schemaVersion", "operationId", "decision", "intentSha256", "completedAt"];
  if (result?.schemaVersion === 2) fields.push("closureResumptionId", "closureResumptionIntentSha256");
  return ["maintenance", "resumption"].includes(kind) && exact(result, fields) && [1, 2].includes(result.schemaVersion) &&
    result.operationId === id && result.decision === closureNames(kind, id).decision && result.intentSha256 === intentSha256 && validDate(result.completedAt) &&
    (result.schemaVersion === 1 || (new RegExp(`^${uuid}$`).test(result.closureResumptionId) && result.closureResumptionId !== id &&
      validHash(result.closureResumptionIntentSha256)));
}
export function validClosureResumptionPlan(plan) {
  if (!exact(plan, ["schemaVersion", "decision", "closureKind", "closureId", "closureIntentSha256", "closureReceiptSha256", "stage",
    "directorySha256", "recoverySha256", "sourceSha256", "archivedSourceSha256", "maintenanceSha256", "publicationSha256", "pointerSha256", "historySha256"]) ||
    plan.schemaVersion !== 1 || plan.decision !== "resume-local-closure" || !["maintenance", "resumption"].includes(plan.closureKind) ||
    !new RegExp(`^${uuid}$`).test(plan.closureId) || !["directorySha256", "recoverySha256", "closureIntentSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !["sourceSha256", "archivedSourceSha256", "closureReceiptSha256", "maintenanceSha256", "publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key])) ||
    (plan.closureKind === "maintenance" ? plan.maintenanceSha256 !== null : !validHash(plan.maintenanceSha256))) return false;
  return (plan.stage === "intent-only" && validHash(plan.sourceSha256) && plan.archivedSourceSha256 === null && plan.closureReceiptSha256 === null) ||
    (plan.stage === "source-archived" && validHash(plan.sourceSha256) && plan.sourceSha256 === plan.archivedSourceSha256 && plan.closureReceiptSha256 === null) ||
    (plan.stage === "source-removed" && plan.sourceSha256 === null && validHash(plan.archivedSourceSha256) && plan.closureReceiptSha256 === null) ||
    (plan.stage === "completed-before-release" && plan.sourceSha256 === null && validHash(plan.archivedSourceSha256) && validHash(plan.closureReceiptSha256));
}
export function validClosureResumptionIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "finalizationSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "resume-local-closure" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    validClosureResumptionPlan(draft.plan) && id !== draft.plan.closureId && draft.planSha256 === planDigest(draft.plan) &&
    validHash(draft.finalizationSha256) && validDate(draft.createdAt);
}
export function validClosureAbortPlan(plan) {
  return plan?.decision === "abort-local-closure" && plan.closureReceiptSha256 === null &&
    validClosureResumptionPlan({ ...plan, decision: "resume-local-closure" });
}
export function validClosureAbortIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "reason", "planSha256", "plan", "finalizationSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "abort-local-closure" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 &&
    typeof draft.reason === "string" && draft.reason.trim() && draft.reason.length <= 500 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer + draft.reason) &&
    validClosureAbortPlan(draft.plan) && id !== draft.plan.closureId && draft.planSha256 === planDigest(draft.plan) &&
    validHash(draft.finalizationSha256) && validDate(draft.createdAt);
}
export function validClosureAbortReceipt(result, id, intentSha256, recoverySha256) {
  const fields = ["schemaVersion", "operationId", "decision", "outcome", "intentSha256", "recoveryArchiveSha256", "completedAt"];
  if (result?.schemaVersion === 2) fields.push("abortContinuationId", "abortContinuationIntentSha256");
  return exact(result, fields) && [1, 2].includes(result.schemaVersion) && result.operationId === id &&
    result.decision === "abort-local-closure" && result.outcome === "aborted" && result.intentSha256 === intentSha256 &&
    result.recoveryArchiveSha256 === recoverySha256 && validDate(result.completedAt) &&
    (result.schemaVersion === 1 || new RegExp(`^${uuid}$`).test(result.abortContinuationId) && result.abortContinuationId !== id &&
      validHash(result.abortContinuationIntentSha256));
}
export function validClosureAbortContinuationPlan(plan) {
  if (!exact(plan, ["schemaVersion", "decision", "directorySha256", "abortId", "abortIntentSha256", "finalizationSha256", "closureKind", "closureId", "stage",
    "sourceSha256", "archivedSourceSha256", "abortReceiptSha256", "maintenanceSha256", "publicationSha256", "pointerSha256", "historySha256"]) ||
    plan.schemaVersion !== 1 || plan.decision !== "continue-local-closure-abort" || !["maintenance", "resumption"].includes(plan.closureKind) ||
    ![plan.abortId, plan.closureId].every(id => typeof id === "string" && new RegExp(`^${uuid}$`).test(id)) || plan.abortId === plan.closureId ||
    !["directorySha256", "abortIntentSha256", "finalizationSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !["sourceSha256", "archivedSourceSha256", "abortReceiptSha256", "maintenanceSha256", "publicationSha256", "pointerSha256"].every(key => plan[key] === null || validHash(plan[key])) ||
    (plan.closureKind === "maintenance" ? plan.maintenanceSha256 !== null : !validHash(plan.maintenanceSha256))) return false;
  return (plan.stage === "intent-only" && validHash(plan.sourceSha256) && plan.archivedSourceSha256 === null && plan.abortReceiptSha256 === null) ||
    (plan.stage === "source-archived" && validHash(plan.sourceSha256) && plan.sourceSha256 === plan.archivedSourceSha256 && plan.abortReceiptSha256 === null) ||
    (plan.stage === "source-removed" && plan.sourceSha256 === null && validHash(plan.archivedSourceSha256) && plan.abortReceiptSha256 === null) ||
    (plan.stage === "completed-before-release" && plan.sourceSha256 === null && validHash(plan.archivedSourceSha256) && validHash(plan.abortReceiptSha256));
}
export function validClosureAbortContinuationIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "claimOwner", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "continue-local-closure-abort" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    validClosureAbortContinuationPlan(draft.plan) && id !== draft.plan.abortId && id !== draft.plan.closureId && draft.planSha256 === planDigest(draft.plan) &&
    validOwner(draft.claimOwner) && validDate(draft.createdAt);
}
export function abortContinuationNames(kind, id, abortId) {
  const summary = { reconciliation: "reconciliationAbortContinuations", resumption: "resumptionAbortContinuations", closure: "closureAbortContinuations" }[kind];
  if (!summary) return null;
  return { intent: `${kind}-abort-continuation-${id}.intent.json`, receipt: `${kind}-abort-continuation-${id}.json`,
    abortIntent: `${kind}-abort-${abortId}.intent.json`, abortReceipt: `${kind}-abort-${abortId}.json`, summary,
    residualControl: kind === "reconciliation" ? "publish-resume.lock" : "publish-finalization.lock",
    coordinationControl: kind === "reconciliation" ? "publish-finalization.lock" : kind === "resumption" ? "publish-resume.lock" : "publish-recovery.lock" };
}
export function expectedAbortContinuationControls(kind, plan, continuation) {
  const controls = { "publish.lock": plan.publicationSha256, "publish-recovery.lock": null, "publish-maintenance.lock": null,
    "publish-resume.lock": null, "publish-finalization.lock": null };
  if (kind === "reconciliation") controls["publish-resume.lock"] = continuation.resumptionSha256;
  else {
    controls["publish-finalization.lock"] = continuation.plan.finalizationSha256;
    if (kind === "resumption") { controls["publish-maintenance.lock"] = plan.maintenanceSha256; controls["publish-recovery.lock"] = plan.sourceGuardSha256; }
    else if (plan.closureKind === "maintenance") controls["publish-maintenance.lock"] = plan.sourceSha256;
    else { controls["publish-maintenance.lock"] = plan.maintenanceSha256; controls["publish-resume.lock"] = plan.sourceSha256; }
  }
  return controls;
}
export function validAbortContinuationFinalizationPlan(plan) {
  const controls = ["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock"];
  if (!exact(plan, ["schemaVersion", "decision", "directorySha256", "continuationKind", "continuationId", "continuationIntentSha256",
    "continuationReceiptSha256", "abortId", "abortIntentSha256", "abortReceiptSha256", "residualControl", "residualSha256", "coordinationControl",
    "controlSha256", "pointerSha256", "historySha256"]) || plan.schemaVersion !== 1 || plan.decision !== "finalize-completed-abort-continuation" ||
    !["reconciliation", "resumption", "closure"].includes(plan.continuationKind) ||
    ![plan.continuationId, plan.abortId].every(id => typeof id === "string" && new RegExp(`^${uuid}$`).test(id)) || plan.continuationId === plan.abortId ||
    !["directorySha256", "continuationIntentSha256", "continuationReceiptSha256", "abortIntentSha256", "abortReceiptSha256", "residualSha256", "historySha256"].every(key => validHash(plan[key])) ||
    !(plan.pointerSha256 === null || validHash(plan.pointerSha256)) || !exact(plan.controlSha256, controls) ||
    !controls.every(name => plan.controlSha256[name] === null || validHash(plan.controlSha256[name]))) return false;
  const names = abortContinuationNames(plan.continuationKind, plan.continuationId, plan.abortId);
  return plan.residualControl === names.residualControl && plan.coordinationControl === names.coordinationControl &&
    plan.controlSha256[plan.residualControl] === plan.residualSha256 && plan.controlSha256[plan.coordinationControl] === null;
}
export function validAbortContinuationFinalizationIntent(draft, id) {
  return exact(draft, ["schemaVersion", "operationId", "decision", "reviewer", "planSha256", "plan", "coordinationSha256", "createdAt"]) &&
    draft.schemaVersion === 1 && new RegExp(`^${uuid}$`).test(id) && draft.operationId === id && draft.decision === "finalize-completed-abort-continuation" &&
    typeof draft.reviewer === "string" && draft.reviewer.trim() && draft.reviewer.length <= 100 && !/[\u0000-\u001f\u007f]/.test(draft.reviewer) &&
    validAbortContinuationFinalizationPlan(draft.plan) && id !== draft.plan.continuationId && id !== draft.plan.abortId &&
    draft.planSha256 === planDigest(draft.plan) && validHash(draft.coordinationSha256) && validDate(draft.createdAt);
}
function resumptions(states, files, directorySha256, continuations) {
  const ids = [...new Set(files.flatMap(name => name.match(resumptionName)?.slice(1, 2) || []))].sort();
  const completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`reconciliation-resume-${id}.intent.json`), receipt = states.get(`reconciliation-resume-${id}.json`);
    const draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const oldIntent = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.intent.json`);
    const oldReceipt = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.json`);
    const guard = plan && states.get(`publish-recovery-orphan-${plan.reconciliationId}.lock`), origin = oldIntent?.value;
    // Historical completeness deliberately ignores current PID/pointer state.
    // It verifies the linked bytes, never replays the old filesystem steps.
    const valid = intent?.kind === "present" && receipt?.kind === "present" && validResumptionIntent(draft, id) &&
      plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.intentSha256 && origin?.schemaVersion === 2 &&
      validReconciliationIntent(origin, plan.reconciliationId) && origin.maintenanceSha256 === plan.maintenanceSha256 &&
      origin.plan.directorySha256 === plan.directorySha256 && origin.plan.publicationSha256 === plan.publicationSha256 &&
      origin.plan.pointerSha256 === plan.pointerSha256 &&
      (plan.sourceGuardSha256 === null || plan.sourceGuardSha256 === origin.plan.guardSha256) &&
      (plan.archivedGuardSha256 === null || plan.archivedGuardSha256 === origin.plan.guardSha256) &&
      guard?.kind === "present" && validOwner(guard.value) && guard.sha256 === origin.plan.guardSha256 &&
      origin.plan.acknowledgedArchives.every(item => {
        const archive = states.get(`publish-orphan-${item.id}.lock`);
        const historicalRecord = states.get(`lock-recovery-${item.id}.json`);
        return archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === item.sha256 &&
          (!historicalRecord || historicalRecord.kind === "absent");
      }) && oldReceipt?.kind === "present" && validReconciliationReceipt(oldReceipt.value, plan.reconciliationId, oldIntent.sha256) &&
      oldReceipt.value.schemaVersion === 2 && oldReceipt.value.resumptionId === id && oldReceipt.value.resumptionIntentSha256 === intent.sha256 &&
      validResumptionReceipt(result, id, intent.sha256, oldReceipt.sha256) && (result.schemaVersion === 1 || !continuations ||
        continuations.completed.some(item => item.operationId === result.resumptionContinuationId && item.resumptionId === id) &&
        states.get(`resumption-continuation-${result.resumptionContinuationId}.intent.json`)?.sha256 === result.resumptionContinuationIntentSha256);
    if (valid) completed.push({ operationId: id, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-resumption" });
  }
  return { completed, pending };
}
function resumptionContinuations(states, files, directorySha256, resumed) {
  const ids = [...new Set(files.flatMap(name => (name.match(resumptionContinuationName) || name.match(continuedResumptionArchiveName))?.slice(1, 2) || []))].sort();
  const completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`resumption-continuation-${id}.intent.json`), receipt = states.get(`resumption-continuation-${id}.json`);
    const archive = states.get(`publish-continued-resume-${id}.lock`), draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const resumedIntent = plan && states.get(`reconciliation-resume-${plan.resumptionId}.intent.json`), origin = resumedIntent?.value, oldPlan = origin?.plan;
    const resumedReceipt = plan && states.get(`reconciliation-resume-${plan.resumptionId}.json`);
    const reconciledReceipt = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.json`);
    const valid = intent?.kind === "present" && receipt?.kind === "present" && validResumptionContinuationIntent(draft, id) &&
      plan.directorySha256 === directorySha256 && resumedIntent?.sha256 === plan.resumptionIntentSha256 && origin?.schemaVersion === 2 &&
      validResumptionIntent(origin, plan.resumptionId) && origin.resumptionSha256 === plan.resumptionSha256 && oldPlan.reconciliationId === plan.reconciliationId &&
      oldPlan.intentSha256 === plan.reconciliationIntentSha256 && oldPlan.directorySha256 === plan.directorySha256 &&
      oldPlan.maintenanceSha256 === plan.maintenanceSha256 && oldPlan.publicationSha256 === plan.publicationSha256 && oldPlan.pointerSha256 === plan.pointerSha256 &&
      (oldPlan.sourceGuardSha256 !== null || plan.sourceGuardSha256 === null) &&
      (oldPlan.archivedGuardSha256 === null || plan.archivedGuardSha256 === oldPlan.archivedGuardSha256) &&
      [plan.sourceGuardSha256, plan.archivedGuardSha256].every(value => value === null || value === (oldPlan.sourceGuardSha256 || oldPlan.archivedGuardSha256)) &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.resumptionSha256 &&
      resumed.completed.some(item => item.operationId === plan.resumptionId) && resumedReceipt?.value?.schemaVersion === 2 &&
      resumedReceipt.value.resumptionContinuationId === id && resumedReceipt.value.resumptionContinuationIntentSha256 === intent.sha256 &&
      (plan.reconciliationReceiptSha256 === null || reconciledReceipt?.sha256 === plan.reconciliationReceiptSha256) &&
      exact(result, ["schemaVersion", "operationId", "decision", "intentSha256", "resumptionReceiptSha256", "reconciliationReceiptSha256", "resumptionArchiveSha256", "completedAt"]) &&
      result.schemaVersion === 1 && result.operationId === id && result.decision === "continue-local-resumption" && result.intentSha256 === intent.sha256 &&
      result.resumptionReceiptSha256 === resumedReceipt.sha256 && result.reconciliationReceiptSha256 === reconciledReceipt.sha256 &&
      result.resumptionArchiveSha256 === archive.sha256 && validDate(result.completedAt);
    if (valid) completed.push({ operationId: id, resumptionId: plan.resumptionId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-resumption-continuation" });
  }
  return { completed, pending };
}
function resumptionAborts(states, files, directorySha256, continued, preliminary = false) {
  const ids = [...new Set(files.flatMap(name => (name.match(resumptionAbortName) || name.match(abortedResumptionArchiveName))?.slice(1, 2) || []))].sort();
  const candidates = [], completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`resumption-abort-${id}.intent.json`), receipt = states.get(`resumption-abort-${id}.json`);
    const archive = states.get(`publish-aborted-resume-${id}.lock`), draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const resumeIntent = plan && states.get(`reconciliation-resume-${plan.resumptionId}.intent.json`), resume = resumeIntent?.value, previous = resume?.plan;
    const resumeReceipt = plan && states.get(`reconciliation-resume-${plan.resumptionId}.json`);
    const originalIntent = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.intent.json`), origin = originalIntent?.value;
    const originalReceipt = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.json`), originalResult = originalReceipt?.value;
    const originalArchive = plan && states.get(`publish-recovery-orphan-${plan.reconciliationId}.lock`);
    const successorIntent = originalResult?.schemaVersion === 2 && states.get(`reconciliation-resume-${originalResult.resumptionId}.intent.json`);
    const successor = successorIntent?.value, successorPlan = successor?.plan;
    // A later reviewed resumption can finish the still-pending reconciliation.
    // Its own receipt chain determines success; it need not be finished to keep
    // this earlier cancellation valid as historical evidence.
    const successorValid = plan && originalResult?.resumptionId !== plan.resumptionId && successorIntent?.sha256 === originalResult?.resumptionIntentSha256 &&
      validResumptionIntent(successor, originalResult?.resumptionId) && successor.schemaVersion === 2 &&
      successorPlan.reconciliationId === plan.reconciliationId && successorPlan.intentSha256 === plan.reconciliationIntentSha256 &&
      successorPlan.directorySha256 === plan.directorySha256 && successorPlan.maintenanceSha256 === plan.maintenanceSha256 &&
      successorPlan.publicationSha256 === plan.publicationSha256 && successorPlan.pointerSha256 === plan.pointerSha256 &&
      [successorPlan.sourceGuardSha256, successorPlan.archivedGuardSha256].every(value => value === null || value === origin?.plan?.guardSha256);
    const originalReceiptValid = origin && validReconciliationReceipt(originalResult, plan.reconciliationId, originalIntent.sha256) &&
      originalResult.schemaVersion === 2 && (plan.reconciliationReceiptSha256 === null ?
        successorValid :
        originalReceipt.sha256 === plan.reconciliationReceiptSha256 && originalResult.resumptionId === plan.resumptionId && originalResult.resumptionIntentSha256 === resumeIntent?.sha256);
    const valid = intent?.kind === "present" && receipt?.kind === "present" && validResumptionAbortIntent(draft, id) &&
      plan.directorySha256 === directorySha256 && resumeIntent?.sha256 === plan.resumptionIntentSha256 && resume?.schemaVersion === 2 &&
      validResumptionIntent(resume, plan.resumptionId) && resume.resumptionSha256 === plan.resumptionSha256 &&
      previous.reconciliationId === plan.reconciliationId && previous.intentSha256 === plan.reconciliationIntentSha256 && originalIntent?.sha256 === plan.reconciliationIntentSha256 &&
      origin?.schemaVersion === 2 && validReconciliationIntent(origin, plan.reconciliationId) && origin.maintenanceSha256 === plan.maintenanceSha256 &&
      [previous, origin.plan].every(value => value.directorySha256 === plan.directorySha256 && value.publicationSha256 === plan.publicationSha256 && value.pointerSha256 === plan.pointerSha256) &&
      previous.maintenanceSha256 === plan.maintenanceSha256 && (!resumeReceipt || resumeReceipt.kind === "absent") &&
      [previous.sourceGuardSha256, previous.archivedGuardSha256, plan.sourceGuardSha256, plan.archivedGuardSha256].every(value => value === null || value === origin.plan.guardSha256) &&
      (previous.sourceGuardSha256 !== null || plan.sourceGuardSha256 === null) && (previous.archivedGuardSha256 === null || plan.archivedGuardSha256 === previous.archivedGuardSha256) &&
      (plan.archivedGuardSha256 === null && (!originalArchive || originalArchive.kind === "absent") ||
        originalArchive?.kind === "present" && validOwner(originalArchive.value) && originalArchive.sha256 === origin.plan.guardSha256) &&
      (plan.reconciliationReceiptSha256 === null && (!originalReceipt || originalReceipt.kind === "absent") || originalReceiptValid) &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.resumptionSha256 &&
      origin.plan.acknowledgedArchives.every(item => {
        const acknowledged = states.get(`publish-orphan-${item.id}.lock`), record = states.get(`lock-recovery-${item.id}.json`);
        return acknowledged?.kind === "present" && validOwner(acknowledged.value) && acknowledged.sha256 === item.sha256 && (!record || record.kind === "absent");
      }) && validResumptionAbortReceipt(result, id, intent.sha256, archive.sha256, plan.reconciliationReceiptSha256) &&
      (result.schemaVersion === 1 || preliminary || continued?.completed.some(item => item.operationId === result.abortContinuationId &&
        item.abortId === id && states.get(`resumption-abort-continuation-${item.operationId}.intent.json`)?.sha256 === result.abortContinuationIntentSha256));
    if (valid) candidates.push({ operationId: id, resumptionId: plan.resumptionId, reconciliationId: plan.reconciliationId,
      planSha256: draft.planSha256, reconciliationReceiptSha256: plan.reconciliationReceiptSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-resumption-abort" });
  }
  for (const candidate of candidates) {
    if (candidates.filter(item => item.resumptionId === candidate.resumptionId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-resumption-abort" });
    else completed.push(candidate);
  }
  return { completed, pending };
}
function resumptionAbortContinuations(states, files, directorySha256, cancelled) {
  const ids = [...new Set(files.flatMap(name => name.match(resumeAbortContinuationName)?.slice(1, 2) || []))].sort();
  const candidates = [], completed = [], pending = [], linkedArchives = new Set();
  for (const id of ids) {
    const intent = states.get(`resumption-abort-continuation-${id}.intent.json`), receipt = states.get(`resumption-abort-continuation-${id}.json`);
    const draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const oldIntent = plan && states.get(`resumption-abort-${plan.abortId}.intent.json`), origin = oldIntent?.value;
    const oldReceipt = plan && states.get(`resumption-abort-${plan.abortId}.json`), oldResult = oldReceipt?.value;
    const archive = plan && states.get(`publish-continued-resumption-abort-finalization-${plan.abortId}.lock`);
    if (validResumptionAbortContinuationIntent(draft, id)) linkedArchives.add(plan.abortId);
    const valid = intent?.kind === "present" && validResumptionAbortContinuationIntent(draft, id) &&
      receipt?.kind === "present" && plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.abortIntentSha256 &&
      validResumptionAbortIntent(origin, plan.abortId) && id !== origin.plan.resumptionId && id !== origin.plan.reconciliationId &&
      origin.finalizationSha256 === plan.finalizationSha256 && origin.plan.directorySha256 === plan.directorySha256 &&
      origin.plan.maintenanceSha256 === plan.maintenanceSha256 && origin.plan.publicationSha256 === plan.publicationSha256 &&
      origin.plan.pointerSha256 === plan.pointerSha256 && (plan.sourceSha256 === null || plan.sourceSha256 === origin.plan.resumptionSha256) &&
      (plan.archivedSourceSha256 === null || plan.archivedSourceSha256 === origin.plan.resumptionSha256) &&
      cancelled.completed.some(item => item.operationId === plan.abortId) &&
      (plan.abortReceiptSha256 === null ? oldResult?.schemaVersion === 2 && oldResult.abortContinuationId === id && oldResult.abortContinuationIntentSha256 === intent.sha256 :
        oldResult?.schemaVersion === 1 && oldReceipt.sha256 === plan.abortReceiptSha256) &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.finalizationSha256 &&
      exact(result, ["schemaVersion", "operationId", "decision", "intentSha256", "abortReceiptSha256", "completedAt"]) && result.schemaVersion === 1 &&
      result.operationId === id && result.decision === "continue-local-resumption-abort" && result.intentSha256 === intent.sha256 &&
      result.abortReceiptSha256 === oldReceipt.sha256 && validDate(result.completedAt);
    if (valid) candidates.push({ operationId: id, abortId: plan.abortId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-resumption-abort-continuation" });
  }
  for (const candidate of candidates) {
    if (candidates.filter(item => item.abortId === candidate.abortId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-resumption-abort-continuation" });
    else completed.push(candidate);
  }
  for (const name of files) {
    const match = name.match(continuedResumeAbortArchiveName);
    if (match && !linkedArchives.has(match[1])) pending.push({ operationId: match[1], issue: "unlinked-resumption-abort-continuation-archive" });
  }
  return { completed, pending };
}
function reconciliationAborts(states, files, directorySha256, continued, preliminary = false) {
  const ids = [...new Set(files.flatMap(name => (name.match(abortName) || name.match(abortMaintenanceName) || name.match(abortRecoveryName))?.slice(1, 2) || []))].sort();
  const candidates = [], pending = [], completed = [], acknowledged = new Map();
  for (const id of ids) {
    const intent = states.get(`reconciliation-abort-${id}.intent.json`), receipt = states.get(`reconciliation-abort-${id}.json`);
    const maintenance = states.get(`publish-aborted-maintenance-${id}.lock`), recovery = states.get(`publish-aborted-recovery-${id}.lock`);
    const draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const oldIntent = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.intent.json`), origin = oldIntent?.value;
    const oldReceipt = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.json`);
    const oldArchive = plan && states.get(`publish-recovery-orphan-${plan.reconciliationId}.lock`);
    const valid = intent?.kind === "present" && receipt?.kind === "present" && validReconciliationAbortIntent(draft, id) &&
      plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.intentSha256 && origin?.schemaVersion === 2 &&
      validReconciliationIntent(origin, plan.reconciliationId) && origin.maintenanceSha256 === plan.maintenanceSha256 &&
      origin.plan.directorySha256 === plan.directorySha256 && origin.plan.publicationSha256 === plan.publicationSha256 &&
      origin.plan.pointerSha256 === plan.pointerSha256 && (!oldReceipt || oldReceipt.kind === "absent") &&
      (plan.sourceGuardSha256 === null || plan.sourceGuardSha256 === origin.plan.guardSha256) &&
      (plan.archivedGuardSha256 === null ? !oldArchive || oldArchive.kind === "absent" :
        oldArchive?.kind === "present" && validOwner(oldArchive.value) && oldArchive.sha256 === plan.archivedGuardSha256 && oldArchive.sha256 === origin.plan.guardSha256) &&
      maintenance?.kind === "present" && validOwner(maintenance.value) && maintenance.sha256 === plan.maintenanceSha256 &&
      (plan.sourceGuardSha256 === null ? !recovery || recovery.kind === "absent" :
        recovery?.kind === "present" && validOwner(recovery.value) && recovery.sha256 === plan.sourceGuardSha256) &&
      origin.plan.acknowledgedArchives.every(item => {
        const archive = states.get(`publish-orphan-${item.id}.lock`), record = states.get(`lock-recovery-${item.id}.json`);
        return archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === item.sha256 && (!record || record.kind === "absent");
      }) && validReconciliationAbortReceipt(result, id, intent.sha256, maintenance.sha256, plan.sourceGuardSha256) &&
      (result.schemaVersion === 1 || preliminary || continued?.completed.some(item => item.operationId === result.abortContinuationId &&
        item.abortId === id && states.get(`reconciliation-abort-continuation-${item.operationId}.intent.json`)?.sha256 === result.abortContinuationIntentSha256));
    if (valid) candidates.push({ operationId: id, reconciliationId: plan.reconciliationId, planSha256: draft.planSha256, origin });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-reconciliation-abort" });
  }
  // Never choose between two completed cancellations of the same source intent.
  for (const { origin, ...candidate } of candidates) {
    if (candidates.filter(item => item.reconciliationId === candidate.reconciliationId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-reconciliation-abort" });
    else {
      completed.push(candidate);
      for (const item of origin.plan.acknowledgedArchives) acknowledged.set(item.id, item.sha256);
    }
  }
  return { completed, pending, acknowledged };
}
function reconciliationAbortContinuations(states, files, directorySha256, cancelled) {
  const ids = [...new Set(files.flatMap(name => (name.match(abortContinuationName) || name.match(continuedAbortArchiveName))?.slice(1, 2) || []))].sort();
  const candidates = [], completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`reconciliation-abort-continuation-${id}.intent.json`), receipt = states.get(`reconciliation-abort-continuation-${id}.json`);
    const archive = states.get(`publish-continued-abort-finalization-${id}.lock`);
    const draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const oldIntent = plan && states.get(`reconciliation-abort-${plan.abortId}.intent.json`), origin = oldIntent?.value;
    const oldReceipt = plan && states.get(`reconciliation-abort-${plan.abortId}.json`), oldResult = oldReceipt?.value;
    const valid = intent?.kind === "present" && validReconciliationAbortContinuationIntent(draft, id) &&
      receipt?.kind === "present" && plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.abortIntentSha256 &&
      validReconciliationAbortIntent(origin, plan.abortId) && id !== origin.plan.reconciliationId &&
      origin.finalizationSha256 === plan.finalizationSha256 && origin.plan.directorySha256 === plan.directorySha256 &&
      origin.plan.sourceGuardSha256 === plan.initialRecoverySha256 && origin.plan.publicationSha256 === plan.publicationSha256 &&
      origin.plan.pointerSha256 === plan.pointerSha256 && cancelled.completed.some(item => item.operationId === plan.abortId) &&
      (plan.abortReceiptSha256 === null ? oldResult?.schemaVersion === 2 && oldResult.abortContinuationId === id &&
        oldResult.abortContinuationIntentSha256 === intent.sha256 : oldResult?.schemaVersion === 1 && oldReceipt.sha256 === plan.abortReceiptSha256) &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.finalizationSha256 &&
      exact(result, ["schemaVersion", "operationId", "decision", "intentSha256", "abortReceiptSha256", "completedAt"]) &&
      result.schemaVersion === 1 && result.operationId === id && result.decision === "continue-local-reconciliation-abort" &&
      result.intentSha256 === intent.sha256 && result.abortReceiptSha256 === oldReceipt.sha256 && validDate(result.completedAt);
    if (valid) candidates.push({ operationId: id, abortId: plan.abortId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-reconciliation-abort-continuation" });
  }
  for (const candidate of candidates) {
    if (candidates.filter(item => item.abortId === candidate.abortId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-reconciliation-abort-continuation" });
    else completed.push(candidate);
  }
  return { completed, pending };
}
function reconciliations(states, files, directorySha256, resumed, cancelled, resumeCancelled) {
  const ids = [...new Set(files.flatMap(name => {
    const match = name.match(guardArchiveName) || name.match(reconcileName);
    return match ? [match[1]] : [];
  }))].sort();
  const completed = [], pending = [], aborted = [], acknowledged = new Map(cancelled.acknowledged);
  for (const id of ids) {
    const intent = states.get(`recovery-reconciliation-${id}.intent.json`);
    const receipt = states.get(`recovery-reconciliation-${id}.json`);
    const guard = states.get(`publish-recovery-orphan-${id}.lock`);
    const draft = intent?.value, result = receipt?.value;
    const resumeIntent = result?.schemaVersion === 2 && states.get(`reconciliation-resume-${result.resumptionId}.intent.json`);
    const preserved = resumeCancelled.completed.find(item => item.reconciliationId === id && item.resumptionId === result?.resumptionId &&
      item.reconciliationReceiptSha256 !== null && item.reconciliationReceiptSha256 === receipt?.sha256);
    const valid = intent?.kind === "present" && receipt?.kind === "present" && guard?.kind === "present" && validOwner(guard.value) &&
      validReconciliationIntent(draft, id) &&
      validReconciliationReceipt(result, id, intent.sha256) && (result.schemaVersion === 1 ||
        ((resumed.completed.some(item => item.operationId === result.resumptionId) || preserved) && resumeIntent?.sha256 === result.resumptionIntentSha256 &&
          resumeIntent?.value?.plan?.reconciliationId === id)) &&
      draft.plan.directorySha256 === directorySha256 && guard.sha256 === draft.plan.guardSha256 && draft.plan.acknowledgedArchives.every(item => {
        const archive = states.get(`publish-orphan-${item.id}.lock`);
        return archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === item.sha256;
      });
    const cancellation = cancelled.completed.find(item => item.reconciliationId === id);
    if (cancellation) aborted.push({ operationId: id, abortId: cancellation.operationId, planSha256: draft.planSha256 });
    else if (!valid) pending.push({ operationId: id, issue: "incomplete-or-altered-reconciliation" });
    else {
      completed.push({ operationId: id, planSha256: draft.planSha256, ...(preserved ? { completionEvidence: "preserved-reconciliation-receipt", resumptionAbortId: preserved.operationId } : {}) });
      for (const item of draft.plan.acknowledgedArchives) acknowledged.set(item.id, item.sha256);
    }
  }
  return { completed, pending, aborted, acknowledged };
}
function linkedClosureReceipt(result, id, intentSha256, kind, states, closures) {
  if (!validClosureReceipt(result, id, intentSha256, kind)) return false;
  // The first internal pass validates bytes without resolving the forward link;
  // only the second pass, after closure journals are checked, enters the report.
  if (result.schemaVersion === 1 || !closures) return true;
  const intent = states.get(`closure-resumption-${result.closureResumptionId}.intent.json`);
  return closures.completed.some(item => item.operationId === result.closureResumptionId) &&
    intent?.sha256 === result.closureResumptionIntentSha256 && intent?.value?.plan?.closureId === id && intent.value.plan.closureKind === kind;
}
function maintenanceReviews(states, files, directorySha256, reconciled, closures) {
  const ids = [...new Set(files.flatMap(name => {
    const match = name.match(maintenanceArchiveName) || name.match(maintenanceReviewName);
    return match ? [match[1]] : [];
  }))].sort();
  const completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`maintenance-review-${id}.intent.json`), receipt = states.get(`maintenance-review-${id}.json`);
    const archive = states.get(`publish-maintenance-orphan-${id}.lock`), draft = intent?.value, result = receipt?.value;
    const plan = draft?.plan, origin = plan && states.get(`recovery-reconciliation-${plan.reconciliationId}.intent.json`);
    const valid = intent?.kind === "present" && receipt?.kind === "present" && archive?.kind === "present" && validOwner(archive.value) &&
      validClosureIntent(draft, id, "maintenance") && plan.directorySha256 === directorySha256 &&
      plan.maintenanceSha256 === archive.sha256 && origin?.sha256 === plan.intentSha256 && origin?.value?.schemaVersion === 2 &&
      origin.value.maintenanceSha256 === archive.sha256 && reconciled.completed.some(item => item.operationId === plan.reconciliationId) &&
      states.get(`recovery-reconciliation-${plan.reconciliationId}.json`)?.sha256 === plan.receiptSha256 &&
      states.get(`publish-recovery-orphan-${plan.reconciliationId}.lock`)?.sha256 === plan.archivedGuardSha256 &&
      linkedClosureReceipt(result, id, intent.sha256, "maintenance", states, closures);
    if (valid) completed.push({ operationId: id, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-maintenance-review" });
  }
  return { completed, pending };
}
function resumptionReviews(states, files, directorySha256, resumed, reconciled, closures) {
  const ids = [...new Set(files.flatMap(name => (name.match(resumptionGuardArchiveName) || name.match(resumptionReviewName))?.slice(1, 2) || []))].sort();
  const completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`resumption-review-${id}.intent.json`), receipt = states.get(`resumption-review-${id}.json`);
    const archive = states.get(`publish-resume-orphan-${id}.lock`), draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const resumeIntent = plan && states.get(`reconciliation-resume-${plan.resumptionId}.intent.json`);
    const resumeReceipt = plan && states.get(`reconciliation-resume-${plan.resumptionId}.json`);
    const origin = resumeIntent?.value;
    const valid = intent?.kind === "present" && receipt?.kind === "present" && archive?.kind === "present" && validOwner(archive.value) &&
      validClosureIntent(draft, id, "resumption") &&
      plan.directorySha256 === directorySha256 && archive.sha256 === plan.resumptionSha256 && origin?.schemaVersion === 2 &&
      resumeIntent?.sha256 === plan.resumptionIntentSha256 && origin.resumptionSha256 === archive.sha256 &&
      origin.plan.reconciliationId === plan.reconciliationId && origin.plan.maintenanceSha256 === plan.maintenanceSha256 &&
      origin.plan.directorySha256 === plan.directorySha256 && origin.plan.publicationSha256 === plan.publicationSha256 &&
      origin.plan.pointerSha256 === plan.pointerSha256 && resumeReceipt?.sha256 === plan.resumptionReceiptSha256 &&
      resumed.completed.some(item => item.operationId === plan.resumptionId) && reconciled.completed.some(item => item.operationId === plan.reconciliationId) &&
      states.get(`recovery-reconciliation-${plan.reconciliationId}.intent.json`)?.sha256 === plan.reconciliationIntentSha256 &&
      states.get(`recovery-reconciliation-${plan.reconciliationId}.json`)?.sha256 === plan.reconciliationReceiptSha256 &&
      states.get(`publish-recovery-orphan-${plan.reconciliationId}.lock`)?.sha256 === plan.archivedGuardSha256 &&
      linkedClosureReceipt(result, id, intent.sha256, "resumption", states, closures);
    if (valid) completed.push({ operationId: id, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-resumption-review" });
  }
  return { completed, pending };
}
function closureAborts(states, files, directorySha256, reconciled, resumed, continued, preliminary = false) {
  const ids = [...new Set(files.flatMap(name => (name.match(closureAbortName) || name.match(abortedClosureRecoveryName))?.slice(1, 2) || []))].sort();
  const candidates = [], completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`closure-abort-${id}.intent.json`), receipt = states.get(`closure-abort-${id}.json`);
    const recovery = states.get(`publish-aborted-closure-recovery-${id}.lock`), draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const names = plan && closureNames(plan.closureKind, plan.closureId);
    const oldIntent = names && states.get(names.intent), oldReceipt = names && states.get(names.receipt), oldArchive = names && states.get(names.archive);
    const origin = oldIntent?.value, oldPlan = origin?.plan, originalId = oldPlan?.reconciliationId;
    const originalIntent = states.get(`recovery-reconciliation-${originalId}.intent.json`), original = originalIntent?.value;
    const originalReceipt = states.get(`recovery-reconciliation-${originalId}.json`), originalArchive = states.get(`publish-recovery-orphan-${originalId}.lock`);
    const resumedIntent = states.get(`reconciliation-resume-${oldPlan?.resumptionId}.intent.json`), resumedReceipt = states.get(`reconciliation-resume-${oldPlan?.resumptionId}.json`);
    const sourceHash = plan?.closureKind === "maintenance" ? oldPlan?.maintenanceSha256 : oldPlan?.resumptionSha256;
    const valid = intent?.kind === "present" && receipt?.kind === "present" && validClosureAbortIntent(draft, id) &&
      plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.closureIntentSha256 && origin?.schemaVersion === 2 &&
      validClosureIntent(origin, plan.closureId, plan.closureKind) && origin.recoverySha256 === plan.recoverySha256 &&
      id !== originalId && id !== oldPlan.resumptionId && (!oldReceipt || oldReceipt.kind === "absent") &&
      [plan.sourceSha256, plan.archivedSourceSha256].every(value => value === null || value === sourceHash) &&
      (plan.archivedSourceSha256 === null ? !oldArchive || oldArchive.kind === "absent" :
        oldArchive?.kind === "present" && validOwner(oldArchive.value) && oldArchive.sha256 === plan.archivedSourceSha256) &&
      oldPlan.directorySha256 === plan.directorySha256 && oldPlan.publicationSha256 === plan.publicationSha256 && oldPlan.pointerSha256 === plan.pointerSha256 &&
      original?.schemaVersion === 2 && original.maintenanceSha256 === oldPlan.maintenanceSha256 &&
      original.plan.directorySha256 === plan.directorySha256 && original.plan.publicationSha256 === plan.publicationSha256 && original.plan.pointerSha256 === plan.pointerSha256 &&
      reconciled.completed.some(item => item.operationId === originalId) && originalArchive?.sha256 === oldPlan.archivedGuardSha256 &&
      (plan.closureKind === "maintenance" ? originalIntent.sha256 === oldPlan.intentSha256 && originalReceipt?.sha256 === oldPlan.receiptSha256 :
        plan.maintenanceSha256 === oldPlan.maintenanceSha256 && originalIntent.sha256 === oldPlan.reconciliationIntentSha256 && originalReceipt?.sha256 === oldPlan.reconciliationReceiptSha256 &&
        resumed.completed.some(item => item.operationId === oldPlan.resumptionId) && resumedIntent?.sha256 === oldPlan.resumptionIntentSha256 &&
        resumedIntent.value.schemaVersion === 2 && resumedIntent.value.resumptionSha256 === sourceHash && resumedReceipt?.sha256 === oldPlan.resumptionReceiptSha256) &&
      recovery?.kind === "present" && validOwner(recovery.value) && recovery.sha256 === plan.recoverySha256 &&
      validClosureAbortReceipt(result, id, intent.sha256, recovery.sha256) &&
      (result.schemaVersion === 1 || preliminary || continued?.completed.some(item => item.operationId === result.abortContinuationId && item.abortId === id &&
        states.get(`closure-abort-continuation-${item.operationId}.intent.json`)?.sha256 === result.abortContinuationIntentSha256));
    if (valid) candidates.push({ operationId: id, closureKind: plan.closureKind, closureId: plan.closureId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-closure-abort" });
  }
  for (const candidate of candidates) {
    if (candidates.filter(item => item.closureKind === candidate.closureKind && item.closureId === candidate.closureId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-closure-abort" });
    else completed.push(candidate);
  }
  return { completed, pending };
}
function closureAbortContinuations(states, files, directorySha256, cancelled) {
  const ids = [...new Set(files.flatMap(name => name.match(closureAbortContinuationName)?.slice(1, 2) || []))].sort();
  const candidates = [], completed = [], pending = [], linkedArchives = new Set();
  for (const id of ids) {
    const intent = states.get(`closure-abort-continuation-${id}.intent.json`), receipt = states.get(`closure-abort-continuation-${id}.json`);
    const draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const oldIntent = plan && states.get(`closure-abort-${plan.abortId}.intent.json`), origin = oldIntent?.value;
    const oldReceipt = plan && states.get(`closure-abort-${plan.abortId}.json`), oldResult = oldReceipt?.value;
    const archive = plan && states.get(`publish-continued-closure-abort-finalization-${plan.abortId}.lock`);
    const closure = plan && states.get(closureNames(plan.closureKind, plan.closureId).intent)?.value;
    if (validClosureAbortContinuationIntent(draft, id)) linkedArchives.add(plan.abortId);
    const valid = intent?.kind === "present" && validClosureAbortContinuationIntent(draft, id) && receipt?.kind === "present" &&
      plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.abortIntentSha256 && validClosureAbortIntent(origin, plan.abortId) &&
      id !== closure?.plan?.reconciliationId && id !== closure?.plan?.resumptionId && origin.plan.closureKind === plan.closureKind &&
      origin.plan.closureId === plan.closureId && origin.finalizationSha256 === plan.finalizationSha256 && origin.plan.directorySha256 === plan.directorySha256 &&
      origin.plan.maintenanceSha256 === plan.maintenanceSha256 && origin.plan.publicationSha256 === plan.publicationSha256 && origin.plan.pointerSha256 === plan.pointerSha256 &&
      [plan.sourceSha256, plan.archivedSourceSha256].every(value => value === null || value === origin.plan.recoverySha256) &&
      cancelled.completed.some(item => item.operationId === plan.abortId) &&
      (plan.abortReceiptSha256 === null ? oldResult?.schemaVersion === 2 && oldResult.abortContinuationId === id && oldResult.abortContinuationIntentSha256 === intent.sha256 :
        oldResult?.schemaVersion === 1 && oldReceipt.sha256 === plan.abortReceiptSha256) &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.finalizationSha256 &&
      exact(result, ["schemaVersion", "operationId", "decision", "intentSha256", "abortReceiptSha256", "completedAt"]) && result.schemaVersion === 1 &&
      result.operationId === id && result.decision === "continue-local-closure-abort" && result.intentSha256 === intent.sha256 &&
      result.abortReceiptSha256 === oldReceipt.sha256 && validDate(result.completedAt);
    if (valid) candidates.push({ operationId: id, abortId: plan.abortId, closureKind: plan.closureKind, closureId: plan.closureId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-closure-abort-continuation" });
  }
  for (const candidate of candidates) {
    if (candidates.filter(item => item.abortId === candidate.abortId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-closure-abort-continuation" });
    else completed.push(candidate);
  }
  for (const name of files) {
    const match = name.match(continuedClosureAbortArchiveName);
    if (match && !linkedArchives.has(match[1])) pending.push({ operationId: match[1], issue: "unlinked-closure-abort-continuation-archive" });
  }
  return { completed, pending };
}
function closureResumptions(states, files, directorySha256, maintenance, resumption) {
  const ids = [...new Set(files.flatMap(name => (name.match(closureResumptionName) || name.match(closureRecoveryArchiveName))?.slice(1, 2) || []))].sort();
  const completed = [], pending = [];
  for (const id of ids) {
    const intent = states.get(`closure-resumption-${id}.intent.json`), receipt = states.get(`closure-resumption-${id}.json`);
    const archive = states.get(`publish-closure-recovery-orphan-${id}.lock`), draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const names = plan && closureNames(plan.closureKind, plan.closureId);
    const oldIntent = names && states.get(names.intent), oldReceipt = names && states.get(names.receipt), origin = oldIntent?.value, oldPlan = origin?.plan;
    const historical = plan?.closureKind === "maintenance" ? maintenance : resumption;
    const sourceHash = plan?.closureKind === "maintenance" ? oldPlan?.maintenanceSha256 : oldPlan?.resumptionSha256;
    const valid = intent?.kind === "present" && receipt?.kind === "present" && validClosureResumptionIntent(draft, id) &&
      plan.directorySha256 === directorySha256 && oldIntent?.sha256 === plan.closureIntentSha256 && origin?.schemaVersion === 2 &&
      validClosureIntent(origin, plan.closureId, plan.closureKind) && origin.recoverySha256 === plan.recoverySha256 &&
      id !== oldPlan.reconciliationId && id !== oldPlan.resumptionId && oldPlan.directorySha256 === plan.directorySha256 &&
      oldPlan.publicationSha256 === plan.publicationSha256 && oldPlan.pointerSha256 === plan.pointerSha256 &&
      (plan.sourceSha256 === null || plan.sourceSha256 === sourceHash) && (plan.archivedSourceSha256 === null || plan.archivedSourceSha256 === sourceHash) &&
      (plan.closureKind === "maintenance" || oldPlan.maintenanceSha256 === plan.maintenanceSha256) &&
      historical.completed.some(item => item.operationId === plan.closureId && item.planSha256 === origin.planSha256) &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.recoverySha256 &&
      oldReceipt?.kind === "present" && validClosureReceipt(oldReceipt.value, plan.closureId, oldIntent.sha256, plan.closureKind) &&
      (plan.closureReceiptSha256 === null ? oldReceipt.value.schemaVersion === 2 && oldReceipt.value.closureResumptionId === id &&
        oldReceipt.value.closureResumptionIntentSha256 === intent.sha256 : oldReceipt.value.schemaVersion === 1 && oldReceipt.sha256 === plan.closureReceiptSha256) &&
      exact(result, ["schemaVersion", "operationId", "decision", "intentSha256", "closureReceiptSha256", "completedAt"]) && result.schemaVersion === 1 &&
      result.operationId === id && result.decision === "resume-local-closure" && result.intentSha256 === intent.sha256 &&
      result.closureReceiptSha256 === oldReceipt.sha256 && validDate(result.completedAt);
    if (valid) completed.push({ operationId: id, closureKind: plan.closureKind, closureId: plan.closureId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-closure-resumption" });
  }
  return { completed, pending };
}
function abortContinuationFinalizations(states, files, directorySha256, summaries) {
  const ids = [...new Set(files.flatMap(name => (name.match(abortFinalizationName) || name.match(completedAbortControlName))?.slice(1, 2) || []))].sort();
  const completed = [], pending = [], candidates = [];
  for (const id of ids) {
    const intent = states.get("abort-continuation-finalization-" + id + ".intent.json"), receipt = states.get("abort-continuation-finalization-" + id + ".json");
    const archive = states.get("publish-completed-abort-continuation-control-" + id + ".lock"), draft = intent?.value, result = receipt?.value, plan = draft?.plan;
    const names = plan && abortContinuationNames(plan.continuationKind, plan.continuationId, plan.abortId);
    const continuationIntent = names && states.get(names.intent), continuationReceipt = names && states.get(names.receipt), continuation = continuationIntent?.value;
    const abortIntent = names && states.get(names.abortIntent), abortReceipt = names && states.get(names.abortReceipt);
    const sourcePlan = abortIntent?.value?.plan, closure = plan?.continuationKind === "closure" && sourcePlan && states.get(closureNames(sourcePlan.closureKind, sourcePlan.closureId).intent)?.value;
    const excludedIds = [sourcePlan?.reconciliationId, sourcePlan?.resumptionId, sourcePlan?.closureId, closure?.plan?.reconciliationId, closure?.plan?.resumptionId];
    const valid = intent?.kind === "present" && validAbortContinuationFinalizationIntent(draft, id) && receipt?.kind === "present" &&
      plan.directorySha256 === directorySha256 && !excludedIds.includes(id) &&
      summaries[plan.continuationKind].completed.some(item => item.operationId === plan.continuationId && item.abortId === plan.abortId) &&
      continuationIntent?.sha256 === plan.continuationIntentSha256 && continuationReceipt?.sha256 === plan.continuationReceiptSha256 &&
      abortIntent?.sha256 === plan.abortIntentSha256 && abortReceipt?.sha256 === plan.abortReceiptSha256 &&
      sourcePlan.directorySha256 === plan.directorySha256 && sourcePlan.pointerSha256 === plan.pointerSha256 &&
      Object.entries(expectedAbortContinuationControls(plan.continuationKind, sourcePlan, continuation)).every(([name, sha256]) => plan.controlSha256[name] === sha256) &&
      (plan.continuationKind === "reconciliation" ? continuation.resumptionSha256 : continuation.plan.finalizationSha256) === plan.residualSha256 &&
      archive?.kind === "present" && validOwner(archive.value) && archive.sha256 === plan.residualSha256 &&
      exact(result, ["schemaVersion", "operationId", "decision", "intentSha256", "controlArchiveSha256", "completedAt"]) && result.schemaVersion === 1 &&
      result.operationId === id && result.decision === draft.decision && result.intentSha256 === intent.sha256 &&
      result.controlArchiveSha256 === archive.sha256 && validDate(result.completedAt);
    if (valid) candidates.push({ operationId: id, continuationKind: plan.continuationKind, continuationId: plan.continuationId, planSha256: draft.planSha256 });
    else pending.push({ operationId: id, issue: "incomplete-or-altered-abort-continuation-finalization" });
  }
  for (const candidate of candidates) {
    if (candidates.filter(item => item.continuationKind === candidate.continuationKind && item.continuationId === candidate.continuationId).length !== 1)
      pending.push({ operationId: candidate.operationId, issue: "ambiguous-abort-continuation-finalization" });
    else completed.push(candidate);
  }
  return { completed, pending };
}
export async function inspectRecoveryStatus(directory = join(root, "dist")) {
  const base = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    scope: "Observación local sin mutar publicaciones; no autoriza recuperación, publicación o lanzamiento",
    coordinationClear: false };
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Directorio inválido");
    const files = await evidenceNames(directory);
    const states = new Map(await Promise.all(files.map(async name => [name, await fileState(join(directory, name))])));
    const publication = ownership(states.get("publish.lock"));
    const recovery = ownership(states.get("publish-recovery.lock"));
    const maintenance = ownership(states.get("publish-maintenance.lock"));
    const resumption = ownership(states.get("publish-resume.lock"));
    const finalization = ownership(states.get("publish-finalization.lock"));
    const directorySha256 = await directoryDigest(directory);
    // Resolve current continuation receipts before projecting original resumptions.
    // The preliminary pass never enters the public diagnostic by itself.
    const continued = resumptionContinuations(states, files, directorySha256, resumptions(states, files, directorySha256));
    const resumedBase = resumptions(states, files, directorySha256, continued);
    const resumeAbortContinued = resumptionAbortContinuations(states, files, directorySha256,
      resumptionAborts(states, files, directorySha256, undefined, true));
    const resumeCancelled = resumptionAborts(states, files, directorySha256, resumeAbortContinued);
    const resumed = { completed: resumedBase.completed,
      pending: resumedBase.pending.filter(item => !resumeCancelled.completed.some(abort => abort.resumptionId === item.operationId)),
      aborted: resumeCancelled.completed.map(item => ({ operationId: item.resumptionId, abortId: item.operationId,
        planSha256: states.get(`reconciliation-resume-${item.resumptionId}.intent.json`).value.planSha256 })) };
    // A v2 cancellation receipt counts only with its complete continuation audit.
    const abortContinued = reconciliationAbortContinuations(states, files, directorySha256,
      reconciliationAborts(states, files, directorySha256, undefined, true));
    const cancelled = reconciliationAborts(states, files, directorySha256, abortContinued);
    const aborts = { completed: cancelled.completed, pending: cancelled.pending };
    const reconciled = reconciliations(states, files, directorySha256, resumed, cancelled, resumeCancelled);
    const closures = closureResumptions(states, files, directorySha256,
      maintenanceReviews(states, files, directorySha256, reconciled), resumptionReviews(states, files, directorySha256, resumed, reconciled));
    const closureAbortContinued = closureAbortContinuations(states, files, directorySha256,
      closureAborts(states, files, directorySha256, reconciled, resumed, undefined, true));
    const closedCancelled = closureAborts(states, files, directorySha256, reconciled, resumed, closureAbortContinued);
    const abortFinalized = abortContinuationFinalizations(states, files, directorySha256,
      { reconciliation: abortContinued, resumption: resumeAbortContinued, closure: closureAbortContinued });
    const reviewedClosures = (summary, kind) => ({ completed: summary.completed,
      pending: summary.pending.filter(item => !closedCancelled.completed.some(abort => abort.closureKind === kind && abort.closureId === item.operationId)),
      aborted: closedCancelled.completed.filter(item => item.closureKind === kind).map(item => ({ operationId: item.closureId,
        abortId: item.operationId, planSha256: states.get(closureNames(kind, item.closureId).intent).value.planSha256 })) });
    const reviewed = reviewedClosures(maintenanceReviews(states, files, directorySha256, reconciled, closures), "maintenance");
    const resumeReviewed = reviewedClosures(resumptionReviews(states, files, directorySha256, resumed, reconciled, closures), "resumption");
    const ids = [...new Set(files.flatMap(name => {
      const match = name.match(archiveName) || name.match(recordName);
      return match ? [match[1]] : [];
    }))].sort();
    const pending = []; let complete = 0, acknowledged = 0;
    for (const id of ids) {
      const archive = states.get(`publish-orphan-${id}.lock`);
      const record = states.get(`lock-recovery-${id}.json`);
      let issue;
      if (!archive || archive.kind === "absent") issue = "missing-archive";
      else if (!record || record.kind === "absent") issue = "missing-record";
      else if (archive.kind !== "present" || !validOwner(archive.value) || record.kind !== "present" ||
        !exact(record.value, ["owner", "reviewer", "decision", "createdAt"]) || record.value.decision !== "recover-local-lock" ||
        typeof record.value.reviewer !== "string" || !record.value.reviewer.trim() || record.value.reviewer.length > 100 ||
        !exact(record.value.owner, ["schemaVersion", "pid", "host", "nonce", "createdAt", "sha256", "active"]) ||
        record.value.owner.active !== false || typeof record.value.createdAt !== "string" ||
        !Number.isFinite(Date.parse(record.value.createdAt))) issue = "invalid-record";
      else if (record.value.owner.sha256 !== archive.sha256 ||
        ["schemaVersion", "pid", "host", "nonce", "createdAt"].some(field => record.value.owner[field] !== archive.value[field])) issue = "archive-mismatch";
      if (issue === "missing-record" && reconciled.acknowledged.get(id) === archive?.sha256) acknowledged++;
      else if (issue) pending.push({ id, issue }); else complete++;
    }
    // Detect concurrent creation/removal/content change before reporting a stable
    // snapshot. An external writer can still change files after this observation.
    const next = await evidenceNames(directory);
    const after = await Promise.all(files.map(name => fileState(join(directory, name))));
    if (files.join("\n") !== next.join("\n") || after.some((state, i) => token(state) !== token(states.get(files[i]))))
      return { ...base, status: "changed", publication, recovery, maintenance, resumption, finalization, archives: { checked: ids.length, complete, acknowledged, pending },
        reconciliations: { completed: reconciled.completed, pending: reconciled.pending, aborted: reconciled.aborted }, maintenanceReviews: reviewed, resumptions: resumed, resumptionReviews: resumeReviewed, closureResumptions: closures, reconciliationAborts: aborts, resumptionContinuations: continued, resumptionAborts: resumeCancelled, closureAborts: closedCancelled, reconciliationAbortContinuations: abortContinued, resumptionAbortContinuations: resumeAbortContinued, closureAbortContinuations: closureAbortContinued, abortContinuationFinalizations: abortFinalized };
    let status = "needs-review";
    if (finalization.state === "active") status = "finalizing";
    else if (finalization.state === "absent") {
      if (resumption.state === "active") status = "resuming";
      else if (resumption.state === "absent" && maintenance.state === "active") status = "reconciling";
      else if (resumption.state === "absent" && maintenance.state === "absent" && recovery.state === "active") status = "recovering";
      else if (resumption.state === "absent" && maintenance.state === "absent" && recovery.state === "absent" && !pending.length && !reconciled.pending.length && !reviewed.pending.length && !resumed.pending.length && !resumeReviewed.pending.length && !closures.pending.length && !cancelled.pending.length && !continued.pending.length && !resumeCancelled.pending.length && !closedCancelled.pending.length && !abortContinued.pending.length && !resumeAbortContinued.pending.length && !closureAbortContinued.pending.length && !abortFinalized.pending.length && publication.state === "active") status = "publishing";
      else if (resumption.state === "absent" && maintenance.state === "absent" && recovery.state === "absent" && !pending.length && !reconciled.pending.length && !reviewed.pending.length && !resumed.pending.length && !resumeReviewed.pending.length && !closures.pending.length && !cancelled.pending.length && !continued.pending.length && !resumeCancelled.pending.length && !closedCancelled.pending.length && !abortContinued.pending.length && !resumeAbortContinued.pending.length && !closureAbortContinued.pending.length && !abortFinalized.pending.length && publication.state === "absent") status = "ready";
    }
    return { ...base, status, coordinationClear: status === "ready", publication, recovery, maintenance, resumption, finalization,
      archives: { checked: ids.length, complete, acknowledged, pending }, reconciliations: { completed: reconciled.completed, pending: reconciled.pending, aborted: reconciled.aborted }, maintenanceReviews: reviewed, resumptions: resumed, resumptionReviews: resumeReviewed, closureResumptions: closures, reconciliationAborts: aborts, resumptionContinuations: continued, resumptionAborts: resumeCancelled, closureAborts: closedCancelled, reconciliationAbortContinuations: abortContinued, resumptionAbortContinuations: resumeAbortContinued, closureAbortContinuations: closureAbortContinued, abortContinuationFinalizations: abortFinalized };
  } catch { return { ...base, status: "invalid" }; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Runtime inválido");
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--strict" && !arg.startsWith("--directory=")) || args.includes("--directory=") ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg === "--strict").length > 1) throw new Error("Argumentos inválidos");
    const directory = args.find(arg => arg.startsWith("--directory="))?.slice(12);
    const report = await inspectRecoveryStatus(directory ? resolve(directory) : undefined);
    const output = resolve(root, "..", ".artifacts");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "web-recovery-status.json"), JSON.stringify(report, null, 2));
    console.log(`Coordinación de publicación: ${report.status}. Reporte: .artifacts/web-recovery-status.json`);
    if (report.status === "invalid" || (args.includes("--strict") && !report.coordinationClear)) process.exitCode = 1;
  } catch { console.error("No se completó la inspección local; revisa directorio y argumentos. No se muestran contenidos privados."); process.exitCode = 1; }
}
