import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseId, verifyRelease } from "./release.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
export async function inspectActiveRelease(directory = join(root, "dist")) {
  const pointerFile = join(directory, "current-release.json");
  let raw;
  try {
    raw = await readFile(pointerFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      status: "pending",
      mode: "unversioned-preview",
      integrityVerified: false,
    };
  }
  const pointer = JSON.parse(raw);
  const release = releaseId(pointer.release);
  const base = await realpath(join(directory, "releases"));
  const selected = await realpath(join(directory, "releases", release));
  if (!selected.startsWith(base + sep))
    throw new Error("Versión fuera del directorio de publicaciones");
  await verifyRelease(selected, pointer.integrity);
  const manifest = JSON.parse(
    await readFile(join(selected, "integrity.json"), "utf8"),
  );
  const routes = JSON.parse(
    await readFile(join(selected, "routes.json"), "utf8"),
  );
  if (
    !routes ||
    Array.isArray(routes) ||
    typeof routes !== "object" ||
    !Object.keys(routes).length
  )
    throw new Error("Rutas de versión inválidas");
  for (const [route, file] of Object.entries(routes)) {
    if (
      !route.startsWith("/") ||
      typeof file !== "string" ||
      !Object.hasOwn(manifest.files, file)
    )
      throw new Error("Ruta pública sin sello de integridad");
  }
  const approval = JSON.parse(
    await readFile(join(selected, "approval.json"), "utf8"),
  );
  if ((await readFile(pointerFile, "utf8")) !== raw)
    throw new Error(
      "La versión activa cambió durante la inspección; repite la comprobación",
    );
  return {
    status: "verified-local",
    mode: "versioned-preview",
    release,
    integrityVerified: true,
    routes: Object.keys(routes).length,
    sealedFiles: Object.keys(manifest.files).length,
    erpReceiptPresent: Object.hasOwn(approval, "erpReceipt"),
    erpReceiptFreshnessVerified: false,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Usa Node.js 24");
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--strict"))
    throw new Error("Argumento inválido");
  let report;
  try {
    report = await inspectActiveRelease();
  } catch {
    report = { status: "invalid", integrityVerified: false };
    process.exitCode = 1;
  }
  report.generatedAt = new Date().toISOString();
  report.scope =
    "Inspección local puntual; no certifica hosting, aceptación comercial ni vigencia de aprobación ERP";
  const output = resolve(root, "..", ".artifacts");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "web-active-release.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Versión activa: ${report.status}. Reporte: .artifacts/web-active-release.json`,
  );
  if (args.includes("--strict") && report.status !== "verified-local")
    process.exitCode = 1;
}
