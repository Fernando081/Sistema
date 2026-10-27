import { open, link, unlink, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileState, ownership, inspectRecoveryStatus, evidenceNames, directoryDigest, planDigest, closureNames,
  abortContinuationNames, expectedAbortContinuationControls, validAbortContinuationFinalizationPlan, validAbortContinuationFinalizationIntent } from "./recovery-status.mjs";
import { pointerHash } from "./recovery-reconciliation.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = raw => createHash("sha256").update(raw).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const controls = ["publish.lock", "publish-recovery.lock", "publish-maintenance.lock", "publish-resume.lock", "publish-finalization.lock"];
const kinds = ["reconciliation", "resumption", "closure"];
const fail = () => new Error("Continuación no completada o control residual/revisión/evidencia no elegibles");
const scope = "Cierre local revisado del control residual de una continuación de cancelación ya completada; conserva recibos y decisiones independientes";
const ownNames = id => ["abort-continuation-finalization-" + id + ".intent.json", "abort-continuation-finalization-" + id + ".json",
  "publish-completed-abort-continuation-control-" + id + ".lock"];
function reviewInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "decision,operationId,planSha256,reviewer" ||
    input.decision !== "finalize-completed-abort-continuation" || typeof input.operationId !== "string" || !uuid.test(input.operationId) ||
    typeof input.reviewer !== "string" || !input.reviewer.trim() || input.reviewer.length > 100 || /[\u0000-\u001f\u007f]/.test(input.reviewer) ||
    typeof input.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.planSha256)) throw fail();
  return { ...input, reviewer: input.reviewer.trim() };
}
async function absent(path) { if ((await fileState(path)).kind !== "absent") throw fail(); }
async function writeExclusive(path, raw) {
  const file = await open(path, "wx"); try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
async function historyHash(directory, id) {
  const skip = new Set([...controls, ...ownNames(id)]), entries = [];
  for (const name of (await evidenceNames(directory)).filter(name => !skip.has(name))) {
    const state = await fileState(join(directory, name));
    if (state.kind !== "present" || state.value === undefined) throw fail();
    entries.push([name, state.sha256]);
  }
  return hash(JSON.stringify(entries));
}
async function evidence(directory, kind, id, status, workerArchive) {
  const base = abortContinuationNames(kind, id);
  const intent = await fileState(join(directory, base.intent)), receipt = await fileState(join(directory, base.receipt));
  const names = abortContinuationNames(kind, id, intent.value?.plan?.abortId);
  const abortIntent = await fileState(join(directory, names.abortIntent)), abortReceipt = await fileState(join(directory, names.abortReceipt));
  if (!status[names.summary].completed.some(item => item.operationId === id && item.abortId === intent.value?.plan?.abortId) ||
    [intent, receipt, abortIntent, abortReceipt].some(state => state.kind !== "present")) throw fail();
  const continuation = intent.value, previous = abortIntent.value.plan;
  const fixed = expectedAbortContinuationControls(kind, previous, continuation);
  const worker = kind === "reconciliation" ? ownership(await fileState(join(directory, workerArchive || names.residualControl))) :
    ownership({ kind: "present", value: continuation.claimOwner });
  const original = kind === "closure" ? (await fileState(join(directory, closureNames(previous.closureKind, previous.closureId).intent))).value : null;
  const acknowledgedIds = kind === "resumption" && previous.reconciliationReceiptSha256 === null ?
    (await fileState(join(directory, "recovery-reconciliation-" + previous.reconciliationId + ".intent.json"))).value.plan.acknowledgedArchives.map(item => item.id).sort() : [];
  return { names, intent, receipt, abortIntent, abortReceipt, continuation, previous, fixed, worker,
    acknowledgedIds,
    excludedIds: [id, continuation.plan.abortId, previous.reconciliationId, previous.resumptionId, previous.closureId,
      original?.plan?.reconciliationId, original?.plan?.resumptionId] };
}
function independentPending(status, selected, origin, acknowledgedIds) {
  const arrays = ["maintenanceReviews", "resumptionReviews", "closureResumptions", "reconciliationAborts", "resumptionContinuations",
    "resumptionAborts", "closureAborts", "reconciliationAbortContinuations", "resumptionAbortContinuations", "closureAbortContinuations", "resumptions"];
  if (arrays.some(key => status[key].pending.length)) return false;
  const allowed = selected === "resumption" && origin.reconciliationReceiptSha256 === null ? origin.reconciliationId : null;
  return allowed ? status.reconciliations.pending.length === 1 && status.reconciliations.pending[0].operationId === allowed &&
    status.archives.pending.every(item => item.issue === "missing-record") &&
    JSON.stringify(status.archives.pending.map(item => item.id).sort()) === JSON.stringify(acknowledgedIds) :
    !status.reconciliations.pending.length && !status.archives.pending.length;
}
async function observe(directory, ownGuard) {
  const status = await inspectRecoveryStatus(directory), base = { schemaVersion: 1, scope, coordinationStatus: status.status, eligible: false };
  const blocked = stage => ({ ...base, status: "blocked-review", stage });
  if (["invalid", "changed"].includes(status.status)) return blocked(status.status);
  if (status.abortContinuationFinalizations.pending.length) return blocked("finalization-needs-review");
  const candidates = [];
  for (const kind of kinds) for (const { operationId: id } of status[abortContinuationNames(kind, "").summary].completed) {
    const names = abortContinuationNames(kind, id), state = await fileState(join(directory, names.residualControl));
    const intent = await fileState(join(directory, names.intent));
    const expected = kind === "reconciliation" ? intent.value.resumptionSha256 : intent.value.plan.finalizationSha256;
    if (state.sha256 === expected && state.kind === "present") candidates.push({ kind, id });
  }
  if (candidates.length !== 1) return candidates.length ? blocked("ambiguous-continuations") :
    controls.some(name => name !== "publish.lock" && status[{ "publish-recovery.lock": "recovery", "publish-maintenance.lock": "maintenance",
      "publish-resume.lock": "resumption", "publish-finalization.lock": "finalization" }[name]]?.state !== "absent") ?
      blocked("unlinked-control") : { ...base, status: "not-needed", stage: "residual-control-absent" };
  const { kind, id } = candidates[0], selected = await evidence(directory, kind, id, status);
  if (status.abortContinuationFinalizations.completed.some(item => item.continuationKind === kind && item.continuationId === id)) return blocked("already-finalized-control-present");
  if (selected.worker.state !== "inactive") return blocked("continuation-worker-" + selected.worker.state);
  if (!independentPending(status, kind, selected.previous, selected.acknowledgedIds)) return blocked("other-operation-needs-review");
  const controlSha256 = {};
  for (const name of controls) {
    const state = await fileState(join(directory, name)), expected = selected.fixed[name];
    if (ownGuard && name === selected.names.coordinationControl) {
      if (state.sha256 !== ownGuard.sha256 || ownGuard.name !== name) return blocked("coordination-owner-changed");
      controlSha256[name] = null;
    } else {
      if (expected === null ? state.kind !== "absent" : ownership(state).state !== "inactive" || state.sha256 !== expected)
        return blocked("divergent-controls");
      controlSha256[name] = state.sha256 || null;
    }
  }
  const directorySha256 = await directoryDigest(directory), pointerSha256 = await pointerHash(directory);
  if (directorySha256 !== selected.previous.directorySha256 || pointerSha256 !== selected.previous.pointerSha256) return blocked("divergent-context");
  const plan = { schemaVersion: 1, decision: "finalize-completed-abort-continuation", directorySha256, continuationKind: kind, continuationId: id,
    continuationIntentSha256: selected.intent.sha256, continuationReceiptSha256: selected.receipt.sha256,
    abortId: selected.continuation.plan.abortId, abortIntentSha256: selected.abortIntent.sha256, abortReceiptSha256: selected.abortReceipt.sha256,
    residualControl: selected.names.residualControl, residualSha256: selected.fixed[selected.names.residualControl],
    coordinationControl: selected.names.coordinationControl, controlSha256, pointerSha256, historySha256: await historyHash(directory) };
  if (!validAbortContinuationFinalizationPlan(plan)) throw fail();
  if ((await evidenceNames(directory)).length + 3 > 605) return blocked("history-limit");
  return { ...base, status: "prepared-local", stage: "completed-before-release", eligible: true, planSha256: planDigest(plan), plan };
}
export async function inspectAbortContinuationFinalization(directory = join(root, "dist")) {
  try {
    const first = await observe(directory), second = await observe(directory);
    if (JSON.stringify(first) !== JSON.stringify(second)) return { schemaVersion: 1, status: "blocked-review", stage: "changed", eligible: false, scope };
    return second;
  } catch { return { schemaVersion: 1, status: "blocked-review", stage: "invalid", eligible: false, scope }; }
}
export async function prepareAbortContinuationFinalization(directory = join(root, "dist")) {
  const result = await inspectAbortContinuationFinalization(directory); if (!result.eligible) throw fail(); return result;
}
async function stable(directory, plan, id, raw, sourcePresent, archived) {
  const status = await inspectRecoveryStatus(directory), selected = await evidence(directory, plan.continuationKind, plan.continuationId, status,
    sourcePresent ? undefined : ownNames(id)[2]);
  if (["invalid", "changed"].includes(status.status) || selected.worker.state !== "inactive" || selected.excludedIds.includes(id) ||
    selected.intent.sha256 !== plan.continuationIntentSha256 || selected.receipt.sha256 !== plan.continuationReceiptSha256 ||
    selected.abortIntent.sha256 !== plan.abortIntentSha256 || selected.abortReceipt.sha256 !== plan.abortReceiptSha256 ||
    await directoryDigest(directory) !== plan.directorySha256 || await pointerHash(directory) !== plan.pointerSha256 ||
    await historyHash(directory, id) !== plan.historySha256) throw fail();
  for (const name of controls) {
    const state = await fileState(join(directory, name));
    if (name === plan.coordinationControl) { if (state.sha256 !== hash(raw)) throw fail(); }
    else {
      const expected = name === plan.residualControl && !sourcePresent ? null : plan.controlSha256[name];
      if (expected === null ? state.kind !== "absent" : ownership(state).state !== "inactive" || state.sha256 !== expected) throw fail();
    }
  }
  const archive = await fileState(join(directory, ownNames(id)[2]));
  if (archived ? ownership(archive).state !== "inactive" || archive.sha256 !== plan.residualSha256 : archive.kind !== "absent") throw fail();
}
export async function finalizeAbortContinuation(directory, input) {
  const review = reviewInput(input); directory = resolve(directory);
  const id = review.operationId, [intentName, receiptName, archiveName] = ownNames(id), intentPath = join(directory, intentName), receiptPath = join(directory, receiptName);
  const previous = await fileState(intentPath);
  if (previous.kind !== "absent") {
    const status = await inspectRecoveryStatus(directory);
    if (["invalid", "changed"].includes(status.status) || !validAbortContinuationFinalizationIntent(previous.value, id) ||
      previous.value.reviewer !== review.reviewer || previous.value.planSha256 !== review.planSha256 ||
      !status.abortContinuationFinalizations.completed.some(item => item.operationId === id && item.planSha256 === review.planSha256) ||
      (await fileState(intentPath)).sha256 !== previous.sha256) throw fail();
    return { finalized: true, operationId: id, continuationKind: previous.value.plan.continuationKind, continuationId: previous.value.plan.continuationId, replayed: true };
  }
  const proposal = await prepareAbortContinuationFinalization(directory), plan = proposal.plan;
  if (proposal.planSha256 !== review.planSha256) throw fail();
  await absent(receiptPath); await absent(join(directory, archiveName));
  const guardPath = join(directory, plan.coordinationControl);
  const raw = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() });
  const guard = await open(guardPath, "wx");
  const owned = async () => { if ((await fileState(guardPath)).sha256 !== hash(raw)) throw fail(); };
  let mutation = false, completed = false, sourcePresent = true, archived = false;
  try {
    await guard.writeFile(raw); await guard.sync(); await owned();
    const observation = await observe(directory, { name: plan.coordinationControl, sha256: hash(raw) });
    if (!observation.eligible || observation.planSha256 !== review.planSha256) throw fail();
    const verifiedContext = () => stable(directory, plan, id, raw, sourcePresent, archived);
    await verifiedContext();
    const intent = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, reviewer: review.reviewer, planSha256: review.planSha256,
      plan, coordinationSha256: hash(raw), createdAt: new Date().toISOString() });
    mutation = true; await writeExclusive(intentPath, intent);
    const verified = async () => { await verifiedContext(); if ((await fileState(intentPath)).sha256 !== hash(intent)) throw fail(); };
    await verified();
    await link(join(directory, plan.residualControl), join(directory, archiveName)); archived = true;
    await verified();
    await unlink(join(directory, plan.residualControl)); sourcePresent = false;
    await verified();
    const receipt = JSON.stringify({ schemaVersion: 1, operationId: id, decision: review.decision, intentSha256: hash(intent),
      controlArchiveSha256: plan.residualSha256, completedAt: new Date().toISOString() });
    await writeExclusive(receiptPath, receipt);
    const status = await inspectRecoveryStatus(directory);
    if (!status.abortContinuationFinalizations.completed.some(item => item.operationId === id)) throw fail();
    await verified(); if ((await fileState(receiptPath)).sha256 !== hash(receipt)) throw fail();
    completed = true;
    return { finalized: true, operationId: id, continuationKind: plan.continuationKind, continuationId: plan.continuationId, replayed: false };
  } finally {
    await guard.close();
    if (!mutation || completed) { await owned(); await unlink(guardPath); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), applying = args.includes("--apply"), inspecting = args.includes("--inspect");
  const output = resolve(root, "..", ".artifacts"), name = inspecting ? "web-abort-continuation-finalization-status.json" : applying ?
    "web-abort-continuation-finalization-result.json" : "web-abort-continuation-finalization-plan.json";
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24 || args.filter(arg => ["--inspect", "--plan", "--apply"].includes(arg)).length !== 1 ||
      args.some(arg => !["--inspect", "--plan", "--apply"].includes(arg) && !arg.startsWith("--directory=") && !arg.startsWith("--review=")) ||
      args.filter(arg => arg.startsWith("--directory=")).length > 1 || args.filter(arg => arg.startsWith("--review=")).length > 1 ||
      args.includes("--directory=") || args.includes("--review=")) throw fail();
    const directory = resolve(args.find(arg => arg.startsWith("--directory="))?.slice(12) || join(root, "dist")), reviewPath = args.find(arg => arg.startsWith("--review="))?.slice(9);
    if (applying !== !!reviewPath) throw fail();
    const result = inspecting ? await inspectAbortContinuationFinalization(directory) : applying ?
      await finalizeAbortContinuation(directory, (await fileState(resolve(reviewPath))).value) : await prepareAbortContinuationFinalization(directory);
    await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify(result, null, 2));
    console.log(inspecting ? "Control residual de continuación: " + result.stage + "." : applying ? "Cierre registrado; revisa las operaciones independientes." : "Plan de cierre preparado; no aplicado.");
    if (inspecting && ["invalid", "changed"].includes(result.stage)) process.exitCode = 1;
  } catch {
    try { await mkdir(output, { recursive: true }); await writeFile(join(output, name), JSON.stringify({ status: "not-completed", resultConfirmed: false, scope }, null, 2)); }
    catch { /* Private review values, paths and raw IO errors are never printed. */ }
    console.error("No se completó el cierre de control residual; conserva evidencia y consulta el diagnóstico. No se muestran valores privados."); process.exitCode = 1;
  }
}
