import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, closureNames, validClosureAbortIntent, inspectRecoveryStatus, directoryDigest } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";
import { observeInterruptedClosure, closureOriginContextIntact, closureHistoryHash, closureAbortScope as scope } from "./closure-resumption.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Cierre parcial no elegible para cancelación o revisión/evidencia desactualizada");
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reason,reviewer" ||
    input.decision !== "abort-local-closure" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
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
export const closureAbortHistoryHash = (directory, id, excluded = []) => closureHistoryHash(directory,
  [`closure-abort-${id}.intent.json`, `closure-abort-${id}.json`, `publish-aborted-closure-recovery-${id}.lock`, ...excluded]);
export async function inspectClosureAbort(directory = join(root, "dist")) {
  try {
    const first = await observeInterruptedClosure(directory, false, "abort"), second = await observeInterruptedClosure(directory, false, "abort");
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareClosureAbort(directory = join(root, "dist")) {
  const result = await inspectClosureAbort(directory);
  if (!result.eligible) throw fail();
  return result;
}
export async function assertClosureAbortContext(directory, plan, id, recoveryPresent, archived, excluded = []) {
  const names = closureNames(plan.closureKind, plan.closureId), intent = await fileState(join(directory, names.intent));
  const source = await fileState(join(directory, names.source)), originalArchive = await fileState(join(directory, names.archive));
  const recovery = await fileState(join(directory, "publish-recovery.lock")), archive = await fileState(join(directory, `publish-aborted-closure-recovery-${id}.lock`));
  const publication = await fileState(join(directory, "publish.lock")), status = await inspectRecoveryStatus(directory);
  if (intent.sha256 !== plan.closureIntentSha256 || intent.value?.recoverySha256 !== plan.recoverySha256 ||
    (plan.sourceSha256 === null ? source.kind !== "absent" : ownership(source).state !== "inactive" || source.sha256 !== plan.sourceSha256) ||
    (plan.archivedSourceSha256 === null ? originalArchive.kind !== "absent" : ownership(originalArchive).state !== "inactive" || originalArchive.sha256 !== plan.archivedSourceSha256) ||
    (recoveryPresent ? ownership(recovery).state !== "inactive" || recovery.sha256 !== plan.recoverySha256 : recovery.kind !== "absent") ||
    (archived ? ownership(archive).state !== "inactive" || archive.sha256 !== plan.recoverySha256 : archive.kind !== "absent") ||
    (plan.closureKind === "maintenance" ? status.resumption?.state !== "absent" : status.maintenance?.state !== "inactive" || status.maintenance.sha256 !== plan.maintenanceSha256) ||
    !["absent", "inactive"].includes(ownership(publication).state) || (publication.sha256 || null) !== plan.publicationSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await closureAbortHistoryHash(directory, id, excluded) !== plan.historySha256) throw fail();
  await absent(join(directory, names.receipt));
  await closureOriginContextIntact(directory, intent.value, plan.closureKind, status);
}
const unchanged = assertClosureAbortContext;
export async function abortInterruptedClosure(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  if (["invalid", "changed"].includes((await inspectRecoveryStatus(directory)).status)) throw fail();
  const guardPath = join(directory, "publish-finalization.lock"), guard = await open(guardPath, "wx");
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const id = review.operationId, intentPath = join(directory, `closure-abort-${id}.intent.json`);
    const receiptPath = join(directory, `closure-abort-${id}.json`), archivePath = join(directory, `publish-aborted-closure-recovery-${id}.lock`);
    const previous = await fileState(intentPath);
    if (previous.kind !== "absent") {
      const status = await inspectRecoveryStatus(directory);
      if (["invalid", "changed"].includes(status.status) || !validClosureAbortIntent(previous.value, id) ||
        previous.value.reviewer !== review.reviewer || previous.value.reason !== review.reason || previous.value.planSha256 !== review.planSha256 ||
        !status.closureAborts.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
        (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
      await owned(); return { aborted: true, operationId: id, closureKind: previous.value.plan.closureKind, closureId: previous.value.plan.closureId, replayed: true };
    }
    await absent(receiptPath); await absent(archivePath);
    const observation = await observeInterruptedClosure(directory, true, "abort"), plan = observation.plan;
    if (!observation.eligible || observation.planSha256 !== review.planSha256) throw fail();
    const origin = (await fileState(join(directory, closureNames(plan.closureKind, plan.closureId).intent))).value;
    if ([plan.closureId, origin.plan.reconciliationId, origin.plan.resumptionId].includes(id)) throw fail();
    let recoveryPresent = true, archived = false;
    const stable = async () => { await unchanged(directory, plan, id, recoveryPresent, archived); await owned(); };
    await stable();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer, reason: review.reason,
      planSha256: review.planSha256, plan, finalizationSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const ownIntent = async () => { if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    const verified = async () => { await stable(); await ownIntent(); };
    await verified();
    await link(join(directory, "publish-recovery.lock"), archivePath); archived = true;
    await verified();
    await unlink(join(directory, "publish-recovery.lock")); recoveryPresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, outcome: "aborted", intentSha256: hash(intent),
      recoveryArchiveSha256: plan.recoverySha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory), summary = plan.closureKind === "maintenance" ? result.maintenanceReviews : result.resumptionReviews;
    if (!result.closureAborts?.completed.some(item => item.operationId === id) ||
      !summary?.aborted.some(item => item.operationId === plan.closureId && item.abortId === id) || summary.completed.some(item => item.operationId === plan.closureId)) throw fail();
    await verified();
    if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { aborted: true, operationId: id, closureKind: plan.closureKind, closureId: plan.closureId, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-closure-abort-status.json" : applying ? "web-closure-abort-result.json" : "web-closure-abort-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist"));
    const reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectClosureAbort(directory) : applying ?
      await abortInterruptedClosure(directory, (await fileState(resolve(reviewPath))).value) : await prepareClosureAbort(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Cancelación de cierre: ${result.stage}.` : applying ? "Cancelación registrada; revisa los bloqueos residuales por separado." : "Plan de cancelación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Never expose raw IO errors, reviewers, reasons or private paths. */ }
    console.error("No se completó la cancelación; conserva evidencia y consulta el diagnóstico. No se muestran valores privados.");
    process.exitCode = 1;
  }
}
