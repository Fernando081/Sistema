import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { inspectPublicationLock } from "../../publication-lock.mjs";
import { prepareRecoveryReconciliation } from "../../recovery-reconciliation.mjs";
import { prepareRecoveryResumption } from "../../recovery-resumption.mjs";
import { prepareMaintenanceReview } from "../../maintenance-review.mjs";
import { prepareResumptionGuardReview } from "../../resumption-guard-review.mjs";
import { prepareReconciliationAbort } from "../../reconciliation-abort.mjs";
import { prepareResumptionAbort } from "../../resumption-abort.mjs";
import { prepareClosureAbort } from "../../closure-abort.mjs";
import { prepareReconciliationAbortContinuation } from "../../reconciliation-abort-continuation.mjs";
import { prepareResumptionAbortContinuation } from "../../resumption-abort-continuation.mjs";
import { prepareClosureAbortContinuation } from "../../closure-abort-continuation.mjs";

const lockModule = new URL("../../publication-lock.mjs", import.meta.url).href;
const reconcileModule = new URL("../../recovery-reconciliation.mjs", import.meta.url).href;
const resumeModule = new URL("../../recovery-resumption.mjs", import.meta.url).href;
export const closureModule = new URL("../../closure-resumption.mjs", import.meta.url).href;
export const stages = ["intent-only", "source-archived", "source-removed", "completed-before-release"];
export async function temporary(work) {
  const directory = await mkdtemp(join(tmpdir(), "rtt-closure-resume-test-"));
  try { await work(directory); } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("rtt-closure-resume-test-")) throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
}
export async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, (await readFile(join(directory, name))).toString("base64")])));
}
export async function pauseChild(code, args, work) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  let stderr = "", timer;
  child.stderr.on("data", bytes => { stderr += bytes.toString(); });
  const exit = once(child, "exit");
  try {
    await Promise.race([once(child, "message"), exit.then(([status]) => { throw new Error(`Fixture terminó ${status}: ${stderr}`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture no alcanzó etapa")), 10000); })]);
    clearTimeout(timer);
    await work(child, async () => { child.kill(); await exit; });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; }
  }
}
export async function interruptedReconciliation(directory, stage, publicationRemaining = false) {
  const publisher = spawn(process.execPath, ["--input-type=module", "-e",
    `const{acquirePublicationLock}=await import(${JSON.stringify(lockModule)});await acquirePublicationLock(process.argv[1]);`, directory], { stdio: "ignore", windowsHide: true });
  assert.equal((await once(publisher, "exit"))[0], 0);
  const owner = await inspectPublicationLock(directory);
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const rename=fs.rename;fs.rename=async(...a)=>{if(process.argv[3]==='remaining')await pause();await rename(...a);await pause();};
    syncBuiltinESMExports();const{recoverPublicationLock}=await import(${JSON.stringify(lockModule)});
    await recoverPublicationLock(process.argv[1],{decision:'recover-local-lock',reviewer:'Fixture',sha256:process.argv[2]});`,
    [directory, owner.sha256, publicationRemaining ? "remaining" : "archived"], async (_, stop) => stop());
  const originalPlan = await prepareRecoveryReconciliation(directory);
  const original = { operationId: randomUUID(), decision: "reconcile-local-recovery", reviewer: "Fixture original", planSha256: originalPlan.planSha256 };
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='intent-only')await pause();await link(...a);if(process.argv[3]==='guard-archived')await pause();};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='completed-before-release'&&a[0].endsWith('publish-maintenance.lock'))await pause();
      await unlink(...a);if(process.argv[3]==='guard-removed'&&a[0].endsWith('publish-recovery.lock'))await pause();};
    syncBuiltinESMExports();const{applyRecoveryReconciliation}=await import(${JSON.stringify(reconcileModule)});
    await applyRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`, [directory, JSON.stringify(original), stage], async (_, stop) => stop());
  return original;
}
export async function interruptedClosure(directory, kind, stage, publicationRemaining = false) {
  const original = await interruptedReconciliation(directory, kind === "maintenance" ? "completed-before-release" : "intent-only", publicationRemaining);
  let resume;
  if (kind === "resumption") {
    const proposal = await prepareRecoveryResumption(directory);
    resume = { operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture continuación", planSha256: proposal.planSha256 };
    await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
      const unlink=fs.unlink;fs.unlink=async(...a)=>{if(a[0].endsWith('publish-resume.lock')){process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});}await unlink(...a);};
      syncBuiltinESMExports();const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumeModule)});
      await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`, [directory, JSON.stringify(resume)], async (_, stop) => stop());
  }
  const proposal = kind === "maintenance" ? await prepareMaintenanceReview(directory) : await prepareResumptionGuardReview(directory);
  const close = { operationId: randomUUID(), decision: kind === "maintenance" ? "archive-completed-maintenance" : "archive-completed-resumption",
    reviewer: "Fixture cierre", planSha256: proposal.planSha256 };
  const module = new URL(kind === "maintenance" ? "../../maintenance-review.mjs" : "../../resumption-guard-review.mjs", import.meta.url).href;
  const source = kind === "maintenance" ? "publish-maintenance.lock" : "publish-resume.lock";
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='intent-only')await pause();await link(...a);if(process.argv[3]==='source-archived')await pause();};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='completed-before-release'&&a[0].endsWith('publish-recovery.lock'))await pause();
      await unlink(...a);if(process.argv[3]==='source-removed'&&a[0].endsWith(process.argv[4]))await pause();};
    syncBuiltinESMExports();const m=await import(${JSON.stringify(module)});await m[${JSON.stringify(kind === "maintenance" ? "finalizeMaintenance" : "finalizeResumptionGuard")}](process.argv[1],JSON.parse(process.argv[2]));`,
    [directory, JSON.stringify(close), stage, source], async (_, stop) => stop());
  return { original, resume, close };
}
export async function interruptedResumption(directory, stage, originalStage = "intent-only", publicationRemaining = false) {
  const original = await interruptedReconciliation(directory, originalStage, publicationRemaining);
  const proposal = await prepareRecoveryResumption(directory);
  const resume = { operationId: randomUUID(), decision: "resume-local-reconciliation", reviewer: "Fixture reanudación original", planSha256: proposal.planSha256 };
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='intent-only')await pause();await link(...a);if(process.argv[3]==='guard-archived')await pause();};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='completed-before-release'&&a[0].endsWith('publish-resume.lock'))await pause();
      await unlink(...a);if(process.argv[3]==='guard-removed'&&a[0].endsWith('publish-recovery.lock'))await pause();};
    const open=fs.open;fs.open=async(...a)=>{if(a[1]==='wx'&&a[0].includes('reconciliation-resume-')&&a[0].endsWith('.json')&&!a[0].endsWith('.intent.json')&&process.argv[3]==='reconciliation-completed')await pause();
      const h=await open(...a);if(a[1]==='wx'&&a[0].endsWith('.intent.json')&&process.argv[3]==='original-intent'){
        const close=h.close.bind(h);h.close=async()=>{await close();await pause();};}return h;};
    syncBuiltinESMExports();const{resumeRecoveryReconciliation}=await import(${JSON.stringify(resumeModule)});
    await resumeRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`, [directory, JSON.stringify(resume), stage], async (_, stop) => stop());
  return { original, resume };
}
export const abortStages = ["intent-only", "maintenance-archived", "sources-archived", "recovery-removed", "maintenance-removed", "completed-before-release"];
export async function interruptedReconciliationAbort(directory, stage, originalStage = "intent-only", publicationRemaining = false, beforeAbort = async () => {}) {
  const original = await interruptedReconciliation(directory, originalStage, publicationRemaining);
  await beforeAbort(directory);
  const proposal = await prepareReconciliationAbort(directory);
  const abort = { operationId: randomUUID(), decision: "abort-local-reconciliation", reviewer: "Fixture cancelación original",
    reason: "PRIVATE_REASON: revisión local interrumpida", planSha256: proposal.planSha256 };
  const module = new URL("../../reconciliation-abort.mjs", import.meta.url).href;
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='intent-only')await pause();await link(...a);
      if(process.argv[3]==='maintenance-archived'&&a[0].endsWith('publish-maintenance.lock'))await pause();
      if(process.argv[3]==='sources-archived'&&a[0].endsWith('publish-recovery.lock'))await pause();};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='completed-before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();await unlink(...a);
      if(process.argv[3]==='recovery-removed'&&a[0].endsWith('publish-recovery.lock'))await pause();
      if(process.argv[3]==='maintenance-removed'&&a[0].endsWith('publish-maintenance.lock'))await pause();};
    syncBuiltinESMExports();const{abortRecoveryReconciliation}=await import(${JSON.stringify(module)});
    await abortRecoveryReconciliation(process.argv[1],JSON.parse(process.argv[2]));`, [directory, JSON.stringify(abort), stage], async (_, stop) => stop());
  return { original, abort };
}
export async function interruptedResumptionAbort(directory, stage, resumeStage = "intent-only", publicationRemaining = false, beforeAbort = async () => {}) {
  const { original, resume } = await interruptedResumption(directory, resumeStage, "intent-only", publicationRemaining);
  await beforeAbort(directory);
  const proposal = await prepareResumptionAbort(directory);
  const abort = { operationId: randomUUID(), decision: "abort-local-resumption", reviewer: "Fixture cancelación original",
    reason: "PRIVATE_REASON: reanudación de prueba interrumpida", planSha256: proposal.planSha256 };
  const module = new URL("../../resumption-abort.mjs", import.meta.url).href;
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='intent-only')await pause();await link(...a);if(process.argv[3]==='source-archived')await pause();};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='completed-before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();
      await unlink(...a);if(process.argv[3]==='source-removed'&&a[0].endsWith('publish-resume.lock'))await pause();};
    syncBuiltinESMExports();const{abortRecoveryResumption}=await import(${JSON.stringify(module)});
    await abortRecoveryResumption(process.argv[1],JSON.parse(process.argv[2]));`, [directory, JSON.stringify(abort), stage], async (_, stop) => stop());
  return { original, resume, abort };
}
export async function interruptedClosureAbort(directory, kind, stage, closureStage = "intent-only", publicationRemaining = false, beforeAbort = async () => {}) {
  const { original, resume, close } = await interruptedClosure(directory, kind, closureStage, publicationRemaining);
  await beforeAbort(directory);
  const proposal = await prepareClosureAbort(directory);
  const abort = { operationId: randomUUID(), decision: "abort-local-closure", reviewer: "Fixture cancelación original",
    reason: "PRIVATE_REASON: cierre de prueba interrumpido", planSha256: proposal.planSha256 };
  const module = new URL("../../closure-abort.mjs", import.meta.url).href;
  await pauseChild(`import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    const pause=async()=>{process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});};
    const link=fs.link;fs.link=async(...a)=>{if(process.argv[3]==='intent-only')await pause();await link(...a);if(process.argv[3]==='source-archived')await pause();};
    const unlink=fs.unlink;fs.unlink=async(...a)=>{if(process.argv[3]==='completed-before-release'&&a[0].endsWith('publish-finalization.lock'))await pause();
      await unlink(...a);if(process.argv[3]==='source-removed'&&a[0].endsWith('publish-recovery.lock'))await pause();};
    syncBuiltinESMExports();const{abortInterruptedClosure}=await import(${JSON.stringify(module)});
    await abortInterruptedClosure(process.argv[1],JSON.parse(process.argv[2]));`, [directory, JSON.stringify(abort), stage], async (_, stop) => stop());
  return { original, resume, close, abort };
}

export async function residualAbortContinuation(directory, kind, options = {}, held = async (_, stop) => stop()) {
  const stage = options.priorReceipt ? "completed-before-release" : "intent-only";
  const remaining = options.publicationRemaining || false, beforeAbort = options.beforeAbort || (async () => {});
  const fixture = kind === "reconciliation" ? await interruptedReconciliationAbort(directory, stage, options.originalStage || "intent-only", remaining, beforeAbort) :
    kind === "resumption" ? await interruptedResumptionAbort(directory, stage, options.resumeStage || "intent-only", remaining, beforeAbort) :
      await interruptedClosureAbort(directory, options.closureKind || "maintenance", stage, options.closureStage || "source-archived", remaining, beforeAbort);
  const prepares = { reconciliation: prepareReconciliationAbortContinuation, resumption: prepareResumptionAbortContinuation, closure: prepareClosureAbortContinuation };
  const proposal = await prepares[kind](directory), continuation = { operationId: randomUUID(), decision: "continue-local-" + kind + "-abort",
    reviewer: "Fixture continuación original PRIVATE_REVIEWER", planSha256: proposal.planSha256 };
  const control = kind === "reconciliation" ? "publish-resume.lock" : "publish-finalization.lock";
  const module = new URL("../../" + kind + "-abort-continuation.mjs", import.meta.url).href;
  const apply = { reconciliation: "continueReconciliationAbort", resumption: "continueResumptionAbort", closure: "continueClosureAbort" }[kind];
  const result = { ...fixture, continuation, control };
  await pauseChild("import fs from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';" +
    "const unlink=fs.unlink;fs.unlink=async(...a)=>{if(a[0].endsWith(process.argv[3])){process.send('paused');setInterval(()=>{},1000);await new Promise(()=>{});}await unlink(...a);};" +
    "syncBuiltinESMExports();const m=await import(" + JSON.stringify(module) + ");await m[" + JSON.stringify(apply) + "](process.argv[1],JSON.parse(process.argv[2]));",
    [directory, JSON.stringify(continuation), control], async (_, stop) => held(result, stop));
  return result;
}
