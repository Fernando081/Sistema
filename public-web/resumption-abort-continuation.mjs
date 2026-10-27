import { link, unlink, open, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, validResumptionAbortIntent, validResumptionAbortReceipt, validResumptionAbortContinuationPlan,
  validResumptionAbortContinuationIntent, inspectRecoveryStatus, evidenceNames, planDigest } from "./recovery-status.mjs";
import { assertResumptionAbortContext } from "./resumption-abort.mjs";
import { resumptionHistoryHash } from "./resumption-continuation.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => new Error("Cancelación de reanudación interrumpida no elegible o revisión/evidencia desactualizada");
const scope = "Continuación local revisada de cancelación original de reanudación; conserva recibos, decisiones y operaciones independientes";
const claimName = id => `publish-continued-resumption-abort-finalization-${id}.lock`;
const ownNames = (abortId, id) => [claimName(abortId), `resumption-abort-continuation-${id}.intent.json`, `resumption-abort-continuation-${id}.json`];
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "continue-local-resumption-abort" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx");
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
const historyHash = (directory, abortId, id) => resumptionHistoryHash(directory,
  [`resumption-abort-${abortId}.json`, `publish-aborted-resume-${abortId}.lock`, ...ownNames(abortId, id)]);
async function observe(directory) {
  const status = await inspectRecoveryStatus(directory);
  const base = { schemaVersion: 1, scope, coordinationStatus: status.status, eligible: false };
  const blocked = stage => ({ ...base, status: "blocked-review", stage });
  if (["invalid", "changed"].includes(status.status)) return blocked(status.status);
  if (status.resumptionAbortContinuations.pending.length) return blocked("resumption-abort-continuation-needs-review");
  if (status.closureAbortContinuations.pending.length) return blocked("closure-abort-continuation-needs-review");
  if (status.abortContinuationFinalizations.pending.length) return blocked("abort-continuation-finalization-needs-review");
  if (status.finalization.state === "absent") return status.resumptionAborts.pending.length ? blocked("finalization-absent") :
    { ...base, status: "not-needed", stage: "finalization-absent" };
  if (status.finalization.state !== "inactive") return blocked(`finalization-${status.finalization.state}`);
  if (status.reconciliationAbortContinuations.pending.length || status.reconciliationAborts.pending.length || status.closureAborts.pending.length ||
    status.resumptionContinuations.pending.length || status.closureResumptions.pending.length || status.maintenanceReviews.pending.length ||
    status.resumptionReviews.pending.length) return blocked("other-operation-needs-review");
  const candidates = [];
  for (const { operationId: id } of [...status.resumptionAborts.completed, ...status.resumptionAborts.pending]) {
    const intent = await fileState(join(directory, `resumption-abort-${id}.intent.json`));
    if (validResumptionAbortIntent(intent.value, id) && intent.value.finalizationSha256 === status.finalization.sha256) candidates.push({ id, intent });
  }
  if (candidates.length !== 1) return blocked(candidates.length ? "ambiguous-intents" : "unlinked-finalization");
  const { id, intent } = candidates[0], original = intent.value, previous = original.plan;
  if (status.resumptionAborts.pending.some(item => item.operationId !== id) || status.resumptions.pending.some(item => item.operationId !== previous.resumptionId) ||
    status.reconciliations.pending.some(item => item.operationId !== previous.reconciliationId) ||
    status.resumptionAbortContinuations.completed.some(item => item.abortId === id)) return blocked("divergent-evidence");
  const source = await fileState(join(directory, "publish-resume.lock")), archive = await fileState(join(directory, `publish-aborted-resume-${id}.lock`));
  const receipt = await fileState(join(directory, `resumption-abort-${id}.json`));
  for (const state of [source, archive])
    if (state.kind !== "absent" && (ownership(state).state !== "inactive" || state.sha256 !== previous.resumptionSha256)) return blocked("divergent-evidence");
  if (receipt.kind !== "absent" && (receipt.kind !== "present" || receipt.value?.schemaVersion !== 1 ||
    !validResumptionAbortReceipt(receipt.value, id, intent.sha256, previous.resumptionSha256, previous.reconciliationReceiptSha256))) return blocked("divergent-evidence");
  const plan = { schemaVersion: 1, decision: "continue-local-resumption-abort", directorySha256: previous.directorySha256,
    abortId: id, abortIntentSha256: intent.sha256, finalizationSha256: status.finalization.sha256, stage: "",
    sourceSha256: source.sha256 || null, archivedSourceSha256: archive.sha256 || null, abortReceiptSha256: receipt.sha256 || null,
    maintenanceSha256: previous.maintenanceSha256, publicationSha256: previous.publicationSha256, pointerSha256: previous.pointerSha256,
    historySha256: await historyHash(directory, id) };
  for (const stage of ["intent-only", "source-archived", "source-removed", "completed-before-release"])
    if (validResumptionAbortContinuationPlan({ ...plan, stage })) { plan.stage = stage; break; }
  if (!plan.stage) return blocked("divergent-evidence");
  try { await assertResumptionAbortContext(directory, previous, id, source.kind === "present", archive.kind === "present"); }
  catch { return blocked("divergent-evidence"); }
  const origin = (await fileState(join(directory, `recovery-reconciliation-${previous.reconciliationId}.intent.json`))).value;
  const ackIds = origin.plan.acknowledgedArchives.map(item => item.id).sort();
  const acknowledged = receipt.kind === "present" && previous.reconciliationReceiptSha256 !== null;
  if (status.archives.pending.some(item => item.issue !== "missing-record") || (acknowledged ? status.archives.pending.length :
    JSON.stringify(status.archives.pending.map(item => item.id).sort()) !== JSON.stringify(ackIds))) return blocked("divergent-evidence");
  const extra = 3 + Number(archive.kind === "absent") + Number(receipt.kind === "absent");
  if ((await evidenceNames(directory)).length + extra > 605) return blocked("history-limit");
  return { ...base, status: "prepared-local", eligible: true, stage: plan.stage, planSha256: planDigest(plan), plan };
}
export async function inspectResumptionAbortContinuation(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareResumptionAbortContinuation(directory = join(root, "dist")) {
  const result = await inspectResumptionAbortContinuation(directory);
  if (!result.eligible) throw fail();
  return result;
}
async function unchanged(directory, plan, id, progress, claimed) {
  const intent = await fileState(join(directory, `resumption-abort-${plan.abortId}.intent.json`)), original = intent.value;
  if (!validResumptionAbortIntent(original, plan.abortId) || intent.sha256 !== plan.abortIntentSha256 || original.finalizationSha256 !== plan.finalizationSha256 ||
    original.plan.maintenanceSha256 !== plan.maintenanceSha256 || original.plan.directorySha256 !== plan.directorySha256 ||
    original.plan.publicationSha256 !== plan.publicationSha256 || original.plan.pointerSha256 !== plan.pointerSha256 ||
    id === original.plan.resumptionId || id === original.plan.reconciliationId ||
    await historyHash(directory, plan.abortId, id) !== plan.historySha256) throw fail();
  await assertResumptionAbortContext(directory, original.plan, plan.abortId, progress.sourcePresent, progress.archived, ownNames(plan.abortId, id));
  const guard = await fileState(join(directory, "publish-finalization.lock")), archive = await fileState(join(directory, claimName(plan.abortId)));
  if (ownership(guard).state !== "inactive" || guard.sha256 !== plan.finalizationSha256 ||
    (claimed ? ownership(archive).state !== "inactive" || archive.sha256 !== plan.finalizationSha256 : archive.kind !== "absent")) throw fail();
  const receipt = await fileState(join(directory, `resumption-abort-${plan.abortId}.json`));
  if (progress.abortReceiptSha256 === null ? receipt.kind !== "absent" : receipt.sha256 !== progress.abortReceiptSha256) throw fail();
}
export async function continueResumptionAbort(directory, input) {
  const review = reviewInput(input);
  directory = resolve(directory);
  const id = review.operationId, intentPath = join(directory, `resumption-abort-continuation-${id}.intent.json`), receiptPath = join(directory, `resumption-abort-continuation-${id}.json`);
  const previous = await fileState(intentPath);
  if (previous.kind !== "absent") {
    const status = await inspectRecoveryStatus(directory);
    if (["invalid", "changed"].includes(status.status) || !validResumptionAbortContinuationIntent(previous.value, id) ||
      previous.value.reviewer !== review.reviewer || previous.value.planSha256 !== review.planSha256 ||
      !status.resumptionAbortContinuations.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
      (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
    return { continued: true, operationId: id, abortId: previous.value.plan.abortId, replayed: true };
  }
  const observation = await prepareResumptionAbortContinuation(directory), plan = observation.plan;
  if (observation.planSha256 !== review.planSha256 || id === plan.abortId) throw fail();
  await absent(receiptPath);
  const guardPath = join(directory, "publish-finalization.lock"), archivePath = join(directory, claimName(plan.abortId));
  const progress = { sourcePresent: plan.sourceSha256 !== null, archived: plan.archivedSourceSha256 !== null, abortReceiptSha256: plan.abortReceiptSha256 };
  let claimed = false, mutation = false;
  const stable = () => unchanged(directory, plan, id, progress, claimed);
  try {
    await stable();
    // Atomic exclusive link to ONE destination per original abort. Reviewers
    // cannot bypass this claim by choosing different new operation IDs.
    // The original fixed gate remains present throughout all journal mutations.
    await link(guardPath, archivePath); claimed = true;
    await stable();
    const claimOwner = { schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() };
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer,
      planSha256: review.planSha256, plan, claimOwner, createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const verified = async () => { await stable(); if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    await verified();
    if (!progress.archived) { await link(join(directory, "publish-resume.lock"), join(directory, `publish-aborted-resume-${plan.abortId}.lock`)); progress.archived = true; }
    await verified();
    if (progress.sourcePresent) { await unlink(join(directory, "publish-resume.lock")); progress.sourcePresent = false; }
    await verified();
    if (progress.abortReceiptSha256 === null) {
      const original = (await fileState(join(directory, `resumption-abort-${plan.abortId}.intent.json`))).value;
      const receipt = JSON.stringify({ schemaVersion: 2, operationId: plan.abortId, decision: "abort-local-resumption", outcome: "aborted", intentSha256: plan.abortIntentSha256,
        resumptionArchiveSha256: original.plan.resumptionSha256, reconciliationReceiptSha256: original.plan.reconciliationReceiptSha256,
        abortContinuationId: id, abortContinuationIntentSha256: hash(intent), completedAt: new Date().toISOString() });
      await writeExclusive(join(directory, `resumption-abort-${plan.abortId}.json`), receipt); progress.abortReceiptSha256 = hash(receipt);
    }
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, intentSha256: hash(intent),
      abortReceiptSha256: progress.abortReceiptSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const result = await inspectRecoveryStatus(directory);
    if (!result.resumptionAbortContinuations?.completed.some(item => item.operationId === id) ||
      !result.resumptionAborts?.completed.some(item => item.operationId === plan.abortId)) throw fail();
    await verified(); if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    await unlink(guardPath);
    return { continued: true, operationId: id, abortId: plan.abortId, replayed: false };
  } finally {
    // A failed admission releases only its own intact claim. After attempting
    // the intent, failures keep claim + original gate for a separate review.
    if (claimed && !mutation) { await stable(); await unlink(archivePath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-resumption-abort-continuation-status.json" : applying ?
    "web-resumption-abort-continuation-result.json" : "web-resumption-abort-continuation-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 || args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist")), reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectResumptionAbortContinuation(directory) : applying ?
      await continueResumptionAbort(directory, (await fileState(resolve(reviewPath))).value) : await prepareResumptionAbortContinuation(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? `Cancelación de reanudación interrumpida: ${result.stage}.` : applying ? "Continuación registrada; revisa reconciliación y mantenimiento por separado." : "Plan de continuación de cancelación preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Never expose private review values, paths or raw IO errors. */ }
    console.error("No se completó la continuación de cancelación de reanudación; conserva evidencia y consulta el diagnóstico. No se muestran valores privados."); process.exitCode = 1;
  }
}
