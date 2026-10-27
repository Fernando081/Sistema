import {
  open,
  readFile,
  access,
  lstat,
  unlink,
  rename,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const digest = (value) => createHash("sha256").update(value).digest("hex");
function localOwner() {
  return { schemaVersion: 1, pid: process.pid, host: hostname(),
    nonce: randomUUID(), createdAt: new Date().toISOString() };
}
async function noMaintenance(directory) {
  await assertNoResumption(directory);
  try { await access(join(directory, "publish-maintenance.lock")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("Reconciliación de publicación en curso");
}
export async function assertNoResumption(directory) {
  await assertNoFinalization(directory);
  try { await access(join(directory, "publish-resume.lock")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("Reanudación de publicación en curso");
}
export async function assertNoFinalization(directory) {
  try { await lstat(join(directory, "publish-finalization.lock")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("Revisión de cierre en curso");
}
async function noRecovery(directory) {
  try {
    await access(join(directory, "publish-recovery.lock"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("Recuperación de publicación en curso");
}
export async function acquirePublicationLock(directory) {
  await noMaintenance(directory);
  await noRecovery(directory);
  const file = join(directory, "publish.lock");
  const handle = await open(file, "wx");
  const owner = localOwner();
  const raw = JSON.stringify(owner);
  try {
    await handle.writeFile(raw);
    await handle.sync();
    await noMaintenance(directory);
    await noRecovery(directory);
  } catch (error) {
    await handle.close();
    if ((await readFile(file, "utf8")) === raw) await unlink(file);
    throw error;
  }
  return async () => {
    await handle.close();
    if ((await readFile(file, "utf8")) !== raw)
      throw new Error("Cambió el propietario del bloqueo");
    await unlink(file);
  };
}
export async function inspectPublicationLock(directory) {
  const raw = await readFile(join(directory, "publish.lock"), "utf8");
  let owner;
  try {
    owner = JSON.parse(raw);
  } catch {
    throw new Error("Bloqueo antiguo o incompleto; revisión manual necesaria");
  }
  if (
    owner?.schemaVersion !== 1 ||
    Object.keys(owner).some(
      (key) =>
        !["schemaVersion", "pid", "host", "nonce", "createdAt"].includes(key),
    ) ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.host !== "string" ||
    !/^[a-f0-9-]{36}$/.test(owner.nonce) ||
    !Number.isFinite(Date.parse(owner.createdAt))
  )
    throw new Error("Metadata de bloqueo inválida");
  if (owner.host !== hostname())
    throw new Error("Bloqueo de otro equipo; no se recupera");
  let active = true;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") active = false;
    else
      throw new Error("No se puede determinar si el propietario está activo");
  }
  return { ...owner, sha256: digest(raw), active };
}
export async function recoverPublicationLock(directory, approval) {
  if (
    !approval ||
    approval.decision !== "recover-local-lock" ||
    typeof approval.reviewer !== "string" ||
    !approval.reviewer.trim() ||
    approval.reviewer.length > 100 ||
    !/^[a-f0-9]{64}$/.test(approval.sha256)
  )
    throw new Error("Revisión explícita y hash del bloqueo requeridos");
  await noMaintenance(directory);
  const guardPath = join(directory, "publish-recovery.lock");
  const guard = await open(guardPath, "wx");
  const guardRaw = JSON.stringify(localOwner());
  try {
    // Identify interrupted recovery as well as publication. Empty legacy guards
    // remain blocked and require inspection; no automatic recovery is added.
    await guard.writeFile(guardRaw);
    await guard.sync();
    await noMaintenance(directory);
    const owner = await inspectPublicationLock(directory);
    if (owner.sha256 !== approval.sha256)
      throw new Error("Bloqueo cambió desde revisión");
    if (owner.active) throw new Error("No se retira un bloqueo activo");
    const id = randomUUID();
    await rename(
      join(directory, "publish.lock"),
      join(directory, `publish-orphan-${id}.lock`),
    );
    await writeFile(
      join(directory, `lock-recovery-${id}.json`),
      JSON.stringify({
        owner,
        reviewer: approval.reviewer.trim(),
        decision: approval.decision,
        createdAt: new Date().toISOString(),
      }),
      { flag: "wx" },
    );
    return { recovered: true, id };
  } finally {
    await guard.close();
    if ((await readFile(guardPath, "utf8")) !== guardRaw)
      throw new Error("Cambió el propietario del bloqueo de recuperación");
    await unlink(guardPath);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [action, directory, file] = process.argv.slice(2);
  if (action === "--inspect" && directory)
    console.log(await inspectPublicationLock(directory));
  else if (action === "--recover" && directory && file)
    console.log(
      await recoverPublicationLock(
        directory,
        JSON.parse(await readFile(file, "utf8")),
      ),
    );
  else
    throw new Error(
      "Uso: --inspect directorio o --recover directorio revisión.json",
    );
}
