import { lstat, realpath, mkdtemp, readFile, unlink, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hash } from "./release.mjs";
import { backupPreview, restorePreview, verifyPreviewArchive } from "./preview-backup.mjs";
import { loadSavedBackup } from "./check-saved-backup.mjs";
import { inspectActiveRelease } from "./active-release.mjs";
import { inspectRecoveryStatus, evidenceNames, fileState } from "./recovery-status.mjs";
import { createPreviewServer } from "./server.mjs";

const scope = "Simulacro de la vista previa instalada sobre copias temporales y runtime actual. No interviene en dist, ERP/BD, captación ni versiones; no certifica aceptación comercial, hosting o recuperación ante pérdida del disco.";
const privateFiles = ["routes.json", "search-catalog.json", "inquiry-business.json", "redirect-routes.json", "budget-report.json", "content-audit.json"];
const elapsed = start => Math.round((performance.now() - start) * 100) / 100;
const contentDigest = files => hash(JSON.stringify([...files].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b, "en"))));

async function observeSource(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Fuente no regular");
  const recovery = await inspectRecoveryStatus(directory);
  const active = await inspectActiveRelease(directory);
  if (recovery.status !== "ready" || !recovery.coordinationClear || active.mode !== "unversioned-preview")
    throw new Error("Fuente requiere revisión o recuperación de versiones");
  const names = await evidenceNames(directory);
  const states = await Promise.all(names.map(async name => {
    const state = await fileState(join(directory, name));
    if (state.kind === "invalid") throw new Error("Evidencia inválida");
    return [name, state.kind, state.sha256 ?? null];
  }));
  return {
    coordination: recovery.status,
    mode: active.mode,
    directorySha256: hash(await realpath(directory)),
    evidenceSha256: hash(JSON.stringify(states)),
    contentSha256: contentDigest(verifyPreviewArchive(await backupPreview(directory))),
  };
}

async function checkRestoredFiles(files, directory) {
  const base = await realpath(directory);
  const checks = [];
  for (const [name, bytes] of files) {
    try {
      const path = join(base, name);
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink() || !(await realpath(path)).startsWith(base + sep))
        throw new Error("Archivo no regular");
      const restored = await readFile(path);
      checks.push({ name, bytes: restored.length, passed: restored.length === bytes.length && hash(restored) === hash(bytes) });
    } catch {
      checks.push({ name, passed: false });
    }
  }
  return checks;
}

function localRoute(path) {
  const url = new URL(path, "http://127.0.0.1");
  if (typeof path !== "string" || !path.startsWith("/") || url.origin !== "http://127.0.0.1" || url.pathname !== path || url.search || url.hash)
    throw new Error("Ruta local no canónica");
  return path;
}

export async function checkRestoredHttp(directory, files, routes, options = {}) {
  const server = await createPreviewServer(directory, options);
  let listening = false;
  try {
    const ready = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await ready;
    listening = true;
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cases = Object.entries(routes).map(([path, name]) => ({
      path,
      method: "GET",
      expected: path === "/404" ? 404 : 200,
      // Estos dos cuerpos se generan con el runtime a partir del respaldo.
      bytes: ["/buscar", "/consulta"].includes(path) ? null : files.get(name),
    }));
    cases.push({ path: "/", method: "HEAD", expected: 200 });
    if (Object.hasOwn(routes, "/buscar")) cases.push({ path: "/buscar?q=RTT-RECOVERY-DRILL", method: "GET", expected: 200 });
    cases.push(...[...privateFiles, "current-release.json", "approval.json", "integrity.json", ".env", "preview-recovery-drill.mjs", `__rtt_drill__/${randomUUID()}`].map(name => ({ path: "/" + name, method: "GET", expected: 404 })));
    cases.push({ path: "/solicitar", method: "GET", expected: 503 });
    const deadline = AbortSignal.timeout(30000);
    const checks = [];
    for (const item of cases) {
      const failures = [];
      try {
        const url = new URL(item.path, origin);
        if (url.origin !== origin) throw new Error("URL externa rechazada");
        const response = await fetch(url, { method: item.method, redirect: "manual", signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]) });
        if (response.status !== item.expected) failures.push("status");
        for (const [header, value] of Object.entries({ "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store", "referrer-policy": "no-referrer" }))
          if (response.headers.get(header) !== value) failures.push(header);
        const csp = response.headers.get("content-security-policy") ?? "";
        if (!["default-src 'none'", "frame-ancestors 'none'", "form-action 'self'"].every(rule => csp.split(";").some(part => part.trim() === rule))) failures.push("content-security-policy");
        const type = item.path.endsWith(".css") ? "text/css" : item.path.endsWith(".jpg") ? "image/jpeg" : item.path.endsWith(".png") ? "image/png" : item.path.endsWith(".xml") ? "application/xml" : item.path.endsWith(".txt") ? "text/plain" : item.path.endsWith(".js") ? "text/javascript" : item.path.endsWith(".webp") ? "image/webp" : item.path.endsWith(".woff2") ? "font/woff2" : "text/html";
        if (!response.headers.get("content-type")?.startsWith(type)) failures.push("content-type");
        const chunks = [];
        let size = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > (item.bytes?.length ?? 65536)) {
                failures.push("body-limit");
                await reader.cancel();
                break;
              }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
        }
        if (item.method === "HEAD" && size !== 0) failures.push("head-body");
        if (item.bytes && hash(Buffer.concat(chunks)) !== hash(item.bytes)) failures.push("body-integrity");
        checks.push({ path: item.path, method: item.method, status: response.status, bytes: size, passed: !failures.length, failures });
      } catch {
        checks.push({ path: item.path, method: item.method, passed: false, failures: ["connection-or-timeout"] });
      }
    }
    return checks;
  } finally {
    if (listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
}

export async function runPreviewRecoveryDrill({ sourceDirectory, backupDirectory, filename, expectedHash }) {
  const started = performance.now();
  const report = {
    schemaVersion: 1, drillId: randomUUID(), generatedAt: new Date().toISOString(),
    status: "not-completed", stage: "backup-selection", scope,
    nodeVersion: process.versions.node, commercialAccepted: false, versionedRecoveryVerified: false,
    sourceUnchanged: false, temporaryCopiesRemoved: false,
  };
  let temporary;
  try {
    const { archive, archiveBytes } = await loadSavedBackup(backupDirectory, filename, expectedHash);
    const files = verifyPreviewArchive(archive);
    const routes = JSON.parse(files.get("routes.json").toString("utf8"));
    for (const path of Object.keys(routes)) localRoute(path); // Validar antes de borrar siquiera una copia.
    const date = typeof archive.generatedAt === "string" ? Date.parse(archive.generatedAt) : NaN;
    const generatedAt = Number.isFinite(date) && new Date(date).toISOString() === archive.generatedAt ? archive.generatedAt : null;
    report.backup = { filename, sha256: expectedHash, bytes: archiveBytes, generatedAt, files: files.size, contentSha256: contentDigest(files) };
    report.stage = "source-review";
    report.sourceBefore = await observeSource(sourceDirectory);
    if (report.sourceBefore.contentSha256 !== report.backup.contentSha256)
      throw new Error("El respaldo no corresponde a la vista previa actual");
    temporary = await mkdtemp(join(tmpdir(), "rtt-preview-drill-"));
    const damaged = join(temporary, "damaged");
    const restored = join(temporary, "restored");
    report.stage = "failure-on-isolated-copy";
    await restorePreview(archive, damaged);
    const base = await realpath(damaged);
    const originalTarget = join(damaged, routes["/"]);
    const entry = await lstat(originalTarget);
    const target = await realpath(originalTarget);
    if (!target.startsWith(base + sep) || !entry.isFile() || entry.isSymbolicLink() || base === await realpath(sourceDirectory))
      throw new Error("Destino de simulación inválido");
    await unlink(target); // Solo el archivo regular dentro de nuestra copia recién creada.
    const failures = (await checkRestoredFiles(files, damaged)).filter(check => !check.passed);
    if (failures.length !== 1 || failures[0].name !== routes["/"])
      throw new Error("Fallo simulado no confirmado");
    report.scenario = { kind: "missing-home-file-on-isolated-copy", failureDetected: true, missingFiles: failures.length };
    report.stage = "restore-from-saved-backup";
    const recoveryStarted = performance.now();
    // Leer otra vez los bytes guardados: no reconstruir el sitio desde las fuentes.
    const saved = await loadSavedBackup(backupDirectory, filename, expectedHash);
    await restorePreview(saved.archive, restored);
    report.restoreMs = elapsed(recoveryStarted);
    report.fileChecks = await checkRestoredFiles(files, restored);
    if (report.fileChecks.some(check => !check.passed)) throw new Error("Integridad restaurada no confirmada");
    report.stage = "restored-http";
    report.httpChecks = await checkRestoredHttp(restored, files, routes);
    report.restoreAndHttpMs = elapsed(recoveryStarted);
    if (report.httpChecks.some(check => !check.passed)) throw new Error("HTTP restaurado no confirmado");
    report.stage = "source-and-backup-recheck";
    await loadSavedBackup(backupDirectory, filename, expectedHash);
    report.sourceAfter = await observeSource(sourceDirectory);
    report.sourceUnchanged = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    if (!report.sourceUnchanged) throw new Error("Fuente cambió durante el simulacro");
    report.status = "verified-installed-preview";
    report.stage = "completed";
  } catch {
    report.status = "not-completed"; // Sin errores crudos, cuerpos, contactos o rutas privadas.
  } finally {
    if (temporary) {
      try {
        const target = await realpath(temporary);
        const base = await realpath(tmpdir());
        const entry = await lstat(temporary);
        if (!target.startsWith(base + sep) || !basename(target).startsWith("rtt-preview-drill-") || entry.isSymbolicLink())
          throw new Error("Limpieza fuera del temporal propio");
        await rm(target, { recursive: true, force: true });
        report.temporaryCopiesRemoved = true;
      } catch {
        report.status = "not-completed";
        report.stage = "temporary-cleanup";
      }
    }
    report.totalMs = elapsed(started);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const output = join(root, ".artifacts");
    await mkdir(output, { recursive: true });
    let report = { schemaVersion: 1, drillId: randomUUID(), generatedAt: new Date().toISOString(), status: "not-completed", stage: "arguments", scope };
    // Sustituir el resultado anterior incluso si argumentos/entorno son inválidos.
    await writeFile(join(output, "web-preview-drill.json"), JSON.stringify(report, null, 2));
    const args = process.argv.slice(2);
    if (Number(process.versions.node.split(".")[0]) === 24 && args.length === 2 &&
        args.filter(arg => arg.startsWith("--file=")).length === 1 && args.filter(arg => arg.startsWith("--sha256=")).length === 1) {
      report = await runPreviewRecoveryDrill({ sourceDirectory: join(root, "public-web/dist"), backupDirectory: join(root, ".backups"),
        filename: args.find(arg => arg.startsWith("--file=")).slice(7), expectedHash: args.find(arg => arg.startsWith("--sha256=")).slice(9) });
    }
    await writeFile(join(output, `web-preview-drill-${report.drillId}.json`), JSON.stringify(report, null, 2), { flag: "wx" });
    await writeFile(join(output, "web-preview-drill.json"), JSON.stringify(report, null, 2));
    if (report.status !== "verified-installed-preview") process.exitCode = 1;
    console.log(`Simulacro de preview: ${report.status}. Reporte: .artifacts/web-preview-drill.json`);
  } catch {
    process.exitCode = 1;
    console.log("Simulacro de preview: resultado no confirmado; no se pudo conservar el reporte actual.");
  }
}
