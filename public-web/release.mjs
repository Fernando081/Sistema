import { readFile, writeFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function releaseId(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
  )
    throw new Error("Identificador de versión inválido");
  return value;
}
async function safeFile(directory, file) {
  if (
    typeof file !== "string" ||
    !/^[a-zA-Z0-9_./-]+$/.test(file) ||
    file.split("/").some((part) => !part || part === "." || part === "..") ||
    file.startsWith("/")
  )
    throw new Error("Ruta de versión inválida");
  const base = await realpath(directory);
  const target = await realpath(resolve(directory, file));
  if (!target.startsWith(base + sep))
    throw new Error("Archivo fuera de versión");
  return readFile(target);
}
export async function sealRelease(directory) {
  const routes = JSON.parse(
    await readFile(join(directory, "routes.json"), "utf8"),
  );
  const files = {};
  try {
    files["content-audit.json"] = hash(
      await safeFile(directory, "content-audit.json"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    files["redirect-routes.json"] = hash(
      await safeFile(directory, "redirect-routes.json"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    files["inquiry-business.json"] = hash(
      await safeFile(directory, "inquiry-business.json"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    files["search-catalog.json"] = hash(
      await safeFile(directory, "search-catalog.json"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const file of new Set([
    ...Object.values(routes),
    "routes.json",
    "approval.json",
    "budget-report.json",
  ]))
    files[file] = hash(await safeFile(directory, file));
  const raw = JSON.stringify({ schemaVersion: 1, files });
  await writeFile(join(directory, "integrity.json"), raw);
  return hash(raw);
}
export async function verifyRelease(directory, expected) {
  const raw = await readFile(join(directory, "integrity.json"), "utf8");
  if (typeof expected !== "string" || hash(raw) !== expected)
    throw new Error("Integridad de versión inválida");
  const manifest = JSON.parse(raw);
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.files ||
    !manifest.files["routes.json"] ||
    !manifest.files["approval.json"]
  )
    throw new Error("Versión incompleta");
  for (const [file, digest] of Object.entries(manifest.files))
    if (hash(await safeFile(directory, file)) !== digest)
      throw new Error("Archivo de versión alterado");
  return expected;
}
