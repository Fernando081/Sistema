import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { hash } from "./release.mjs";
import { createPreviewServer } from "./server.mjs";

const privateFiles = [
  "routes.json",
  "search-catalog.json",
  "inquiry-business.json",
  "redirect-routes.json",
  "budget-report.json",
  "content-audit.json",
];
function safeName(name) {
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_./-]+$/.test(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..") ||
    (!privateFiles.includes(name) &&
      !/\.(?:html|css|png|jpg|txt|xml)$/.test(name))
  )
    throw new Error("Archivo de respaldo no permitido");
  return name;
}
export function verifyPreviewArchive(input) {
  if (
    !input ||
    input.schemaVersion !== 1 ||
    input.kind !== "local-unversioned-preview" ||
    !Array.isArray(input.files) ||
    input.files.length > 10000
  )
    throw new Error("Respaldo inválido");
  const decoded = new Map();
  let total = 0;
  for (const entry of input.files) {
    const name = safeName(entry.name);
    if (
      decoded.has(name) ||
      typeof entry.data !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        entry.data,
      )
    )
      throw new Error("Contenido de respaldo inválido");
    const bytes = Buffer.from(entry.data, "base64");
    total += bytes.length;
    if (total > 15000000 || hash(bytes) !== entry.sha256)
      throw new Error("Integridad o tamaño de respaldo inválido");
    decoded.set(name, bytes);
  }
  for (const name of privateFiles)
    if (!decoded.has(name)) throw new Error("Respaldo incompleto");
  const routes = JSON.parse(decoded.get("routes.json").toString("utf8"));
  if (
    !routes ||
    typeof routes !== "object" ||
    Array.isArray(routes) ||
    !routes["/"] ||
    !routes["/404"]
  )
    throw new Error("Rutas de respaldo inválidas");
  const allowed = new Set(privateFiles);
  for (const [route, name] of Object.entries(routes)) {
    if (!route.startsWith("/") || !decoded.has(safeName(name)))
      throw new Error("Ruta de respaldo incompleta");
    allowed.add(name);
  }
  if ([...decoded.keys()].some((name) => !allowed.has(name)))
    throw new Error("Archivo fuera del manifiesto");
  return decoded;
}
export async function backupPreview(directory) {
  try {
    await readFile(join(directory, "current-release.json"));
    throw new Error(
      "Usa recuperación de versiones para una publicación activa; este respaldo es de preview sin versión",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const base = await realpath(directory);
  const routesRaw = await readFile(join(base, "routes.json"), "utf8");
  const routes = JSON.parse(routesRaw);
  const names = new Set([...Object.values(routes), ...privateFiles]);
  const files = [];
  for (const name of names) {
    safeName(name);
    const target = await realpath(join(base, name));
    if (!target.startsWith(base + sep))
      throw new Error("Archivo fuera del preview");
    const bytes = await readFile(target);
    files.push({ name, sha256: hash(bytes), data: bytes.toString("base64") });
  }
  const archive = {
    schemaVersion: 1,
    kind: "local-unversioned-preview",
    generatedAt: new Date().toISOString(),
    files,
  };
  verifyPreviewArchive(archive);
  for (const entry of files)
    if (hash(await readFile(join(base, entry.name))) !== entry.sha256)
      throw new Error("El preview cambió durante el respaldo; repite");
  return archive;
}
export async function restorePreview(archive, destination) {
  const files = verifyPreviewArchive(archive);
  await mkdir(destination); // Exclusivo: nunca mezclar ni sobrescribir un directorio existente.
  for (const [name, bytes] of files) {
    const target = resolve(destination, name);
    if (!target.startsWith(resolve(destination) + sep))
      throw new Error("Destino fuera de restauración");
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
  return files.size;
}
export async function verifyPreviewRecovery(archive) {
  const temporary = await mkdtemp(join(tmpdir(), "rtt-preview-recovery-"));
  let server;
  try {
    const selected = join(temporary, "restored");
    const count = await restorePreview(archive, selected);
    for (const [name, bytes] of verifyPreviewArchive(archive))
      if (hash(await readFile(join(selected, name))) !== hash(bytes))
        throw new Error("Restauración alterada");
    server = await createPreviewServer(selected);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [path, status] of [
      ["/", 200],
      ["/buscar", 200],
      ["/assets/logo-rtt.jpg", 200],
      ["/inquiry-business.json", 404],
    ]) {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
      if (
        response.status !== status ||
        response.headers.get("x-robots-tag") !== "noindex, nofollow"
      )
        throw new Error("HTTP de recuperación inválido");
      await response.arrayBuffer();
    }
    return { status: "verified-local", files: count, httpChecks: 4 };
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    const target = resolve(temporary);
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith("rtt-preview-recovery-")
    )
      await rm(target, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (
    Number(process.versions.node.split(".")[0]) !== 24 ||
    process.argv.length !== 2
  )
    throw new Error("Usa Node.js 24 sin argumentos");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const backups = join(root, ".backups");
  const reports = join(root, ".artifacts");
  await mkdir(backups, { recursive: true });
  await mkdir(reports, { recursive: true });
  let report = {
    status: "failed",
    generatedAt: new Date().toISOString(),
    scope:
      "Preview local y runtime actual; no respalda ERP, fuentes, credenciales ni publicaciones activas. Sin activación ni certificación de hosting.",
  };
  try {
    const archive = await backupPreview(join(root, "public-web", "dist"));
    const filename = `web-preview-${randomUUID()}.json`;
    const raw = JSON.stringify(archive);
    await writeFile(join(backups, filename), raw, { flag: "wx" });
    const restored = JSON.parse(
      await readFile(join(backups, filename), "utf8"),
    );
    report = {
      ...report,
      ...(await verifyPreviewRecovery(restored)),
      backup: filename,
      archiveSha256: hash(raw),
      archiveBytes: Buffer.byteLength(raw),
    };
  } catch {
    process.exitCode = 1;
  }
  await writeFile(
    join(reports, "web-preview-recovery.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Recuperación de preview: ${report.status}. Reporte: .artifacts/web-preview-recovery.json`,
  );
}
