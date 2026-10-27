import { readFile, writeFile, mkdir, realpath, lstat, mkdtemp, rm, unlink } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { hash, releaseId, verifyRelease } from "./release.mjs";
import { inspectRecoveryStatus } from "./recovery-status.mjs";
import { inspectActiveRelease } from "./active-release.mjs";
import { rollbackRelease } from "./publish.mjs";
import { TEST_PILOT_MODE } from "./preview-context.mjs";
import { checkRestoredHttp } from "./preview-recovery-drill.mjs";
import { loadReviewedBackup } from "./check-saved-backup.mjs";

const configs = ["approval.json", "routes.json", "integrity.json", "budget-report.json", "content-audit.json", "redirect-routes.json", "search-catalog.json", "inquiry-business.json"];
function safeName(name, ids) {
  if (name === "current-release.json") return name;
  const parts = typeof name === "string" ? name.split("/") : [];
  if (parts[0] !== "releases" || !ids.includes(parts[1])) throw new Error("Archivo ajeno al piloto");
  const file = parts.slice(2).join("/");
  if (!/^[a-zA-Z0-9_./-]+$/.test(file) || parts.slice(2).some(part => !part || part === "." || part === "..") ||
      (!configs.includes(file) && !/\.(?:html|css|png|jpg|txt)$/.test(file))) throw new Error("Archivo no permitido");
  return name;
}
function decode(archive) {
  if (!archive || archive.schemaVersion !== 1 || archive.kind !== "local-test-db-pilot-versions" || !Array.isArray(archive.versions) ||
      archive.versions.length < 1 || archive.versions.length > 3 || new Set(archive.versions).size !== archive.versions.length ||
      !Array.isArray(archive.files) || archive.files.length > 10000) throw new Error("Respaldo de piloto inválido");
  archive.versions.forEach(releaseId);
  const files = new Map();
  const canonicalNames = new Set();
  let total = 0;
  for (const entry of archive.files) {
    const name = safeName(entry.name, archive.versions);
    if (canonicalNames.has(name.toLowerCase()) || typeof entry.data !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) throw new Error("Contenido inválido");
    const bytes = Buffer.from(entry.data, "base64"); total += bytes.length;
    if (total > 15000000 || hash(bytes) !== entry.sha256) throw new Error("Integridad de piloto inválida");
    canonicalNames.add(name.toLowerCase()); files.set(name, bytes);
  }
  const pointer = JSON.parse(files.get("current-release.json")?.toString("utf8") ?? "null");
  if (!pointer || Object.keys(pointer).sort().join(",") !== "integrity,release" || !archive.versions.includes(pointer.release)) throw new Error("Puntero inválido");
  const allowed = new Set(["current-release.json"]);
  for (const id of archive.versions) {
    const prefix = `releases/${id}/`;
    const raw = files.get(prefix + "integrity.json");
    if (!raw || raw.length > 1000000) throw new Error("Sello faltante");
    if (id === pointer.release && hash(raw) !== pointer.integrity) throw new Error("Sello y puntero distintos");
    const seal = JSON.parse(raw.toString("utf8"));
    if (seal.schemaVersion !== 1 || !seal.files || typeof seal.files !== "object" || Array.isArray(seal.files) ||
        !seal.files["routes.json"] || !seal.files["approval.json"]) throw new Error("Sello inválido");
    allowed.add(prefix + "integrity.json");
    for (const [name, sha256] of Object.entries(seal.files)) {
      const path = safeName(prefix + name, archive.versions); allowed.add(path);
      if (!files.has(path) || hash(files.get(path)) !== sha256) throw new Error("Sello no coincide");
    }
    const approval = JSON.parse(files.get(prefix + "approval.json").toString("utf8"));
    if (approval.previewMode !== TEST_PILOT_MODE || approval.commercialAccepted !== false || approval.verifiedReceipt !== null)
      throw new Error("Solo se admiten versiones técnicas sin recibo comercial");
    const routes = JSON.parse(files.get(prefix + "routes.json").toString("utf8"));
    if (!routes?.["/"] || !routes["/404"]) throw new Error("Rutas incompletas");
    for (const [route, name] of Object.entries(routes)) {
      const url = new URL(route, "http://127.0.0.1");
      if (url.origin !== "http://127.0.0.1" || url.pathname !== route || url.search || url.hash || !seal.files[name] || !/\.(?:html|css|png|jpg|txt)$/.test(name)) throw new Error("Ruta inválida");
    }
  }
  if ([...files.keys()].some(name => !allowed.has(name))) throw new Error("Contenido fuera del sello");
  return { files, pointer };
}
export async function backupTestPilot(directory, versions) {
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > 3 || new Set(versions).size !== versions.length || (await lstat(directory)).isSymbolicLink()) throw new Error("Directorio/versiones inválidos");
  if ((await inspectRecoveryStatus(directory)).status !== "ready") throw new Error("Coordinación requiere revisión");
  const base = await realpath(directory);
  const pointerRaw = await readFile(join(base, "current-release.json"));
  const files = [{ name: "current-release.json", sha256: hash(pointerRaw), data: pointerRaw.toString("base64") }];
  for (const id of versions) {
    releaseId(id);
    const selected = join(base, "releases", id);
    if ((await lstat(selected)).isSymbolicLink() || !(await realpath(selected)).startsWith(base + sep)) throw new Error("Versión fuera del piloto");
    const sealRaw = await readFile(join(selected, "integrity.json"));
    await verifyRelease(selected, hash(sealRaw));
    const seal = JSON.parse(sealRaw);
    for (const name of [...Object.keys(seal.files), "integrity.json"]) {
      safeName(`releases/${id}/${name}`, versions);
      const path = join(selected, name), entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink() || !(await realpath(path)).startsWith(base + sep) || entry.size > 15000000) throw new Error("Archivo no regular");
      const bytes = await readFile(path);
      files.push({ name: `releases/${id}/${name}`, sha256: hash(bytes), data: bytes.toString("base64") });
    }
  }
  const archive = { schemaVersion: 1, kind: "local-test-db-pilot-versions", generatedAt: new Date().toISOString(), versions, files };
  decode(archive);
  for (const entry of files) if (hash(await readFile(join(base, entry.name))) !== entry.sha256) throw new Error("Piloto cambió durante respaldo");
  if ((await inspectRecoveryStatus(directory)).status !== "ready") throw new Error("Coordinación cambió");
  return archive;
}
export async function restoreTestPilot(archive, destination) {
  const { files } = decode(archive);
  await mkdir(destination); // Destino exclusivo; nunca mezcla con una instalación.
  const base = await realpath(destination);
  for (const [name, bytes] of files) {
    const path = resolve(base, name);
    if (!path.startsWith(base + sep)) throw new Error("Destino fuera de copia");
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
  }
  for (const id of archive.versions) await verifyRelease(join(base, "releases", id), hash(files.get(`releases/${id}/integrity.json`)));
  await inspectActiveRelease(base);
  return files.size;
}
export async function rehearseTestPilot(backupDirectory, filename, expectedHash, rollbackId) {
  const saved = await loadReviewedBackup(backupDirectory, filename, expectedHash);
  const { files, pointer } = decode(saved.archive);
  if (!saved.archive.versions.includes(rollbackId) || rollbackId === pointer.release) throw new Error("Rollback de ensayo inválido");
  const temporary = await mkdtemp(join(tmpdir(), "rtt-test-pilot-recovery-"));
  const started = performance.now();
  try {
    const damaged = join(temporary, "damaged"), restored = join(temporary, "restored");
    await restoreTestPilot(saved.archive, damaged);
    const home = join(damaged, "releases", pointer.release, "index.html");
    const physical = await realpath(home), base = await realpath(damaged);
    if (!(physical.startsWith(base + sep)) || !(await lstat(home)).isFile() || (await lstat(home)).isSymbolicLink()) throw new Error("Fallo fuera de copia");
    await unlink(physical);
    let damageDetected = false;
    try { await inspectActiveRelease(damaged); } catch { damageDetected = true; }
    if (!damageDetected) throw new Error("Daño no detectado");
    const reread = await loadReviewedBackup(backupDirectory, filename, expectedHash);
    const count = await restoreTestPilot(reread.archive, restored);
    const checkHttp = async id => {
      const prefix = `releases/${id}/`;
      const decoded = new Map([...files].filter(([name]) => name.startsWith(prefix)).map(([name, value]) => [name.slice(prefix.length), value]));
      const routes = JSON.parse(decoded.get("routes.json"));
      const checks = await checkRestoredHttp(restored, decoded, routes, { previewMode: TEST_PILOT_MODE });
      if (checks.some(check => !check.passed)) throw new Error("HTTP de copia restaurada inválido");
      return { release: id, checks: checks.length, passed: checks.length };
    };
    const restoredHttp = await checkHttp(pointer.release);
    await rollbackRelease(rollbackId, { decision: "approve-local-rollback", reviewer: "Ensayo técnico con datos de prueba", integrity: hash(files.get(`releases/${rollbackId}/integrity.json`)) }, restored);
    const rolledBackHttp = await checkHttp(rollbackId);
    await loadReviewedBackup(backupDirectory, filename, expectedHash);
    return { status: "verified-test-pilot-recovery", files: count, damageDetected, restoredHttp, rolledBackHttp,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100, commercialAccepted: false, erpReceiptVerified: false };
  } finally {
    const physical = await realpath(temporary), base = await realpath(tmpdir());
    if (!physical.startsWith(base + sep) || !basename(physical).startsWith("rtt-test-pilot-recovery-") || (await lstat(temporary)).isSymbolicLink()) throw new Error("Limpieza fuera del temporal propio");
    await rm(physical, { recursive: true, force: true });
  }
}
