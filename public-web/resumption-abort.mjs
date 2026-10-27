import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validResumptionAbortIntent, inspectRecoveryStatus, directoryDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";
import { observeIncompleteResumption, resumptionContextMatches, acknowledgedResumptionArchives,
  resumptionHistoryHash, resumptionAbortScope as scope } from "./resumption-continuation.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Reanudación parcial no elegible para cancelación o revisión/evidencia desactualizada");
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reason,reviewer" ||
    input.decision !== "abort-local-resumption" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
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
export const resumptionAbortHistoryHash = (directory, id, excluded = []) => resumptionHistoryHash(directory,
  [`resumption-abort-${id}.intent.json`, `resumption-abort-${id}.json`, `publish-aborted-resume-${id}.lock`, ...excluded]);
const historyHash = resumptionAbortHistoryHash;
export async function inspectResumptionAbort(directory = join(root, "dist")) {
  try {
    const first = await observeIncompleteResumption(directory, false, "abort"), second = await observeIncompleteResumption(directory, false, "abort");
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareResumptionAbort(directory = join(root, "dist")) {
  const result = await inspectResumptionAbort(directory);
  if (!result.eligible) throw fail();
  return result;
}
export async function assertResumptionAbortContext(directory, plan, id, sourcePresent, archived, excluded = []) {
  const resumedIntent = await fileState(join(directory, `reconciliation-resume-${plan.resumptionId}.intent.json`));
  const originalIntent = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.intent.json`));
  const originalReceipt = await fileState(join(directory, `recovery-reconciliation-${plan.reconciliationId}.json`));
  const originalSource = await fileState(join(directory, "publish-recovery.lock"));
  const originalArchive = await fileState(join(directory, `publish-recovery-orphan-${plan.reconciliationId}.lock`));
  const maintenance = await fileState(join(directory, "publish-maintenance.lock")), publication = await fileState(join(directory, "publish.lock"));
  const source = await fileState(join(directory, "publish-resume.lock")), archive = await fileState(join(directory, `publish-aborted-resume-${id}.lock`));
  if (resumedIntent.sha256 !== plan.resumptionIntentSha256 || originalIntent.sha256 !== plan.reconciliationIntentSha256 ||
    !resumptionContextMatches(resumedIntent.value, originalIntent.value, plan) || ownership(maintenance).state !== "inactive" || maintenance.sha256 !== plan.maintenanceSha256 ||
    (sourcePresent ? ownership(source).state !== "inactive" || source.sha256 !== plan.resumptionSha256 : source.kind !== "absent") ||
    (archived ? ownership(archive).state !== "inactive" || archive.sha256 !== plan.resumptionSha256 : archive.kind !== "absent") ||
    (plan.sourceGuardSha256 === null ? originalSource.kind !== "absent" : ownership(originalSource).state !== "inactive" || originalSource.sha256 !== plan.sourceGuardSha256) ||
    (plan.archivedGuardSha256 === null ? originalArchive.kind !== "absent" : ownership(originalArchive).state !== "inactive" || originalArchive.sha256 !== plan.archivedGuardSha256) ||
    (plan.reconciliationReceiptSha256 === null ? originalReceipt.kind !== "absent" : originalReceipt.kind !== "present" || originalReceipt.sha256 !== plan.reconciliationReceiptSha256) ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await historyHash(directory, id, excluded) !== plan.historySha256) throw fail();
  await absent(join(directory, `reconciliation-resume-${plan.resumptionId}.json`));
  await acknowledgedResumptionArchives(directory, originalIntent.value);
}
const unchanged = assertResumptionAbortContext;
export async function abortRecoveryResumption(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  if (["invalid", "changed"].includes((await inspectRecoveryStatus(directory)).status)) throw fail();
  const guardPath = join(directory, "publish-finalization.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const id = review.operationId, intentPath = join(directory, `resumption-abort-${id}.intent.json`);
    const receiptPath = join(directory, `resumption-abort-${id}.json`), archivePath = join(directory, `publish-aborted-resume-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || !validResumptionAbortIntent(previous.value, id) ||
        previous.value.reviewer !== review.reviewer || previous.value.reason !== review.reason || previous.value.planSha256 !== review.planSha256 ||
        !status.resumptionAborts.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned(); return { aborted: true, operationId: id, resumptionId: previous.value.plan.resumptionId, replayed: true };
    }
    await absent(receiptPath); await absent(archivePath);
    const observation = await observeIncompleteResumption(directory, true, "abort"), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256 || id === plan.resumptionId || id === plan.reconciliationId) throw fail();
    let sourcePresent = true, archived = false;
    const stable = async () => { await unchanged(directory, plan, id, sourcePresent, archived); await owned(); };
    await stable();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer, reason: review.reason,
      planSha256: review.planSha256, plan, finalizationSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const ownIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    const verified = async () => { await stable(); await ownIntent(); };
    await verified();
    await link(join(directory, "publish-resume.lock"), archivePath); archived = true;
    await verified();
    await unlink(join(directory, "publish-resume.lock")); sourcePresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, outcome: "aborted", intentSha256: hash(intent),
      resumptionArchiveSha256: plan.resumptionSha256, reconciliationReceiptSha256: plan.reconciliationReceiptSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory);
    if (!result.resumptionAborts?.completed.some(item => item.operationId === id) ||
      !result.resumptions?.aborted.some(item => item.operationId === plan.resumptionId && item.abortId === id) ||
      (plan.reconciliationReceiptSha256 === null ? !result.reconciliations?.pending.some(item => item.operationId === plan.reconciliationId) :
        !result.reconciliations?.completed.some(item => item.operationId === plan.reconciliationId && item.resumptionAbortId === id))) throw fail();
    await verified();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { aborted: true, operationId: id, resumptionId: plan.resumptionId, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-resumption-abort-status.json" : applying ? "web-resumption-abort-result.json" : "web-resumption-abort-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectResumptionAbort(directory) : applying ?
      await abortRecoveryResumption(directory, (await fileState(resolve(reviewPath))).value) : await prepareResumptionAbort(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Cancelación de reanudación: ${result.stage}.` : applying ? "Cancelación registrada; revisa reconciliación y mantenimiento por separado." : "Plan de cancelación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Do not expose raw IO errors, reviewers, reasons or private paths. */ }
    console.error("No se completó la cancelación; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
