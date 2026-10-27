import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "./catalog.mjs";
import { build, pagesForCatalog, root } from "./build.mjs";
import { sealRelease, verifyRelease, releaseId } from "./release.mjs";
import { verifyErpReceipt, verifyErpReceiptHash } from "./erp-receipt.mjs";
import { acquirePublicationLock } from "./publication-lock.mjs";
import { validatePreviewMode, TEST_PILOT_MODE } from "./preview-context.mjs";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function publishCatalog(
  raw,
  approval,
  directory = join(root, "dist"),
  options = {},
) {
  validatePreviewMode(options.previewMode);
  if (options.previewMode === TEST_PILOT_MODE && Object.hasOwn(approval ?? {}, "erpReceipt"))
    throw new Error("El piloto de prueba no registra aprobación ERP comercial");
  if (
    !approval ||
    approval.sha256 !== digest(raw) ||
    typeof approval.reviewer !== "string" ||
    !approval.reviewer.trim() ||
    approval.reviewer.length > 100 ||
    approval.decision !== "approve-local-preview"
  )
    throw new Error("Aprobación local explícita y hash coincidente requeridos");
  const products = validateCatalog(JSON.parse(raw));
  if (
    process.env.PUBLIC_WEB_REQUIRE_ERP === "1" &&
    !Object.hasOwn(approval, "erpReceipt")
  )
    throw new Error("Esta operación exige recibo ERP");
  let verifiedReceipt = null;
  if (Object.hasOwn(approval, "erpReceipt"))
    verifiedReceipt = await verifyErpReceipt(
      raw,
      approval.erpReceipt,
      options.erp,
    );
  await mkdir(directory, { recursive: true });
  const releaseLock = await acquirePublicationLock(directory);
  try {
    const release = randomUUID();
    await build(
      join(directory, "releases", release),
      pagesForCatalog(products),
      products,
      options.mediaDirectory,
      { previewMode: options.previewMode },
    );
    await writeFile(
      join(directory, "releases", release, "approval.json"),
      JSON.stringify(
        {
          sha256: approval.sha256,
          reviewer: approval.reviewer.trim(),
          decision: approval.decision,
          createdAt: new Date().toISOString(),
          products: products.map((item) => item.slug),
          verifiedReceipt,
          ...(options.previewMode === TEST_PILOT_MODE ? { previewMode: TEST_PILOT_MODE, commercialAccepted: false } : {}),
        },
        null,
        2,
      ),
    );
    const integrity = await sealRelease(join(directory, "releases", release));
    if (Object.hasOwn(approval, "erpReceipt"))
      await verifyErpReceipt(raw, approval.erpReceipt, options.erp);
    const temporary = join(directory, `pointer-${release}.json`);
    await writeFile(temporary, JSON.stringify({ release, integrity }));
    await rename(temporary, join(directory, "current-release.json"));
    return release;
  } finally {
    await releaseLock();
  }
}
export async function rollbackRelease(
  release,
  approval,
  directory = join(root, "dist"),
  options = {},
) {
  releaseId(release);
  if (
    !approval ||
    approval.decision !== "approve-local-rollback" ||
    typeof approval.reviewer !== "string" ||
    !approval.reviewer.trim() ||
    approval.reviewer.length > 100
  )
    throw new Error("Aprobación explícita de rollback requerida");
  const releaseLock = await acquirePublicationLock(directory);
  try {
    await verifyRelease(
      join(directory, "releases", release),
      approval.integrity,
    );
    const recorded = JSON.parse(
      await readFile(
        join(directory, "releases", release, "approval.json"),
        "utf8",
      ),
    );
    if (process.env.PUBLIC_WEB_REQUIRE_ERP === "1" && !recorded.verifiedReceipt)
      throw new Error("Rollback exige recibo ERP de la versión");
    let verifiedReceipt = null;
    const checkReceipt = async () => {
      if (recorded.verifiedReceipt) {
        if (recorded.verifiedReceipt.sha256 !== recorded.sha256)
          throw new Error("Recibo y hash de versión distintos");
        verifiedReceipt = await verifyErpReceiptHash(
          recorded.sha256,
          recorded.verifiedReceipt,
          options.erp,
        );
      }
    };
    await checkReceipt();
    const event = randomUUID();
    await writeFile(
      join(directory, `rollback-${event}.json`),
      JSON.stringify({
        release,
        integrity: approval.integrity,
        reviewer: approval.reviewer.trim(),
        decision: approval.decision,
        createdAt: new Date().toISOString(),
        verifiedReceipt,
      }),
    );
    const temporary = join(directory, `pointer-${event}.json`);
    await checkReceipt();
    await writeFile(
      temporary,
      JSON.stringify({ release, integrity: approval.integrity }),
    );
    await rename(temporary, join(directory, "current-release.json"));
    return release;
  } finally {
    await releaseLock();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [manifest, approval] = process.argv.slice(2);
  if (manifest === "--rollback") {
    const file = process.argv[4];
    if (!file)
      throw new Error("Uso: publish.mjs --rollback UUID aprobacion.json");
    await rollbackRelease(approval, JSON.parse(await readFile(file, "utf8")));
    console.log("Rollback local completado");
    process.exit(0);
  }
  if (!manifest || !approval)
    throw new Error(
      "Uso: node public-web/publish.mjs manifiesto.json aprobacion.json",
    );
  const release = await publishCatalog(
    await readFile(manifest, "utf8"),
    JSON.parse(await readFile(approval, "utf8")),
  );
  console.log(`Versión local activada: ${release}. Sin despliegue público.`);
}
