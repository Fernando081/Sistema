import { open, realpath, lstat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "./release.mjs";
import { verifyPreviewRecovery } from "./preview-backup.mjs";

// Load only the exact saved bytes selected by an independently recorded hash.
// Archive structure and restored runtime are checked by the caller.
export async function loadReviewedBackup(directory, filename, expectedHash) {
  if (
    !/^(?:web-preview|web-test-pilot)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(
      filename,
    ) ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  )
    throw new Error("Nombre o hash de respaldo inválido");
  const base = await realpath(directory);
  const path = join(base, filename);
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 22000000)
    throw new Error("Respaldo no regular o demasiado grande");
  const target = await realpath(path);
  if (!target.startsWith(base + sep))
    throw new Error("Respaldo fuera del directorio");
  let handle;
  let raw;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino)
      throw new Error("El respaldo cambió durante la lectura");
    const buffer = Buffer.alloc(22000001);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    raw = buffer.subarray(0, length);
    if (length > 22000000 || hash(raw) !== expectedHash)
      throw new Error("Hash del respaldo no coincide");
  } finally {
    await handle?.close();
  }
  return {
    archive: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
    archiveBytes: raw.length,
  };
}
export async function loadSavedBackup(directory, filename, expectedHash) {
  if (!/^web-preview-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(filename))
    throw new Error("Nombre de respaldo inválido");
  return loadReviewedBackup(directory, filename, expectedHash);
}
export async function checkSavedBackup(directory, filename, expectedHash) {
  const { archive, archiveBytes } = await loadSavedBackup(directory, filename, expectedHash);
  return {
    ...(await verifyPreviewRecovery(archive)),
    backup: filename,
    archiveSha256: expectedHash,
    archiveBytes,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Usa Node.js 24");
  const args = process.argv.slice(2);
  const file = args.find((arg) => arg.startsWith("--file="))?.slice(7);
  const digest = args.find((arg) => arg.startsWith("--sha256="))?.slice(9);
  if (args.length !== 2 || !file || !digest)
    throw new Error("Indica --file=nombre y --sha256=hash registrado");
  const root = fileURLToPath(new URL("../", import.meta.url));
  let report = {
    status: "failed",
    generatedAt: new Date().toISOString(),
    scope:
      "Respaldo local guardado; no activa versiones ni restaura ERP. Conservar hash original por separado.",
  };
  try {
    report = {
      ...report,
      ...(await checkSavedBackup(join(root, ".backups"), file, digest)),
    };
  } catch {
    process.exitCode = 1;
  }
  await mkdir(join(root, ".artifacts"), { recursive: true });
  await writeFile(
    join(root, ".artifacts/web-saved-backup-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Respaldo guardado: ${report.status}. Reporte: .artifacts/web-saved-backup-check.json`,
  );
}
