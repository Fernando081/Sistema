import { loadCss } from "./css.mjs";
import { loadStaticAssets } from "./static-assets.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog, loadCatalog } from "./catalog.mjs";
import { validateBusiness, loadBusiness } from "./business.mjs";
import { validateSite, loadSite, applySeo } from "./seo.mjs";
import { root, pagesForCatalog } from "./build.mjs";
import { prepareMedia } from "./media.mjs";
import { loadRedirects } from "./redirects.mjs";
import { auditPages } from "./audit.mjs";
import { measureBudget } from "./budget.mjs";

export function readinessReport(input) {
  const products = validateCatalog(input.catalog);
  const business = validateBusiness(input.business);
  const site = validateSite(input.site);
  const checks = [
    {
      id: "WEB03.1-lote",
      passed: products.length > 0,
      detail: `${products.length} fichas publicables en archivo fuente; aprobación del contrato no prueba aceptación comercial`,
    },
    {
      id: "WEB03.1-fotos",
      passed:
        products.length > 0 &&
        products.every((product) => product.images?.length),
      detail: `${products.filter((product) => !product.images?.length).length} fichas publicables sin fotografía autorizada`,
    },
    {
      id: "WEB03.3-canales",
      passed:
        business.contact.whatsapp.confirmed || business.contact.email.confirmed,
      detail: "WhatsApp o correo confirmado para consulta contextual",
    },
    {
      id: "WEB04.1-dominio",
      passed: site.confirmed,
      detail:
        "Origen HTTPS confirmado en configuración; no verifica DNS ni propiedad",
    },
    {
      id: "WEB04.2-aceptacion",
      passed: false,
      detail:
        "Requiere revisión del lote comercial según docs/WEB_ACEPTACION_LOTE.md; no automatizada",
    },
    {
      id: "WEB04.1-operacion",
      passed: false,
      detail:
        "Requiere evidencia de hosting/HTTPS, protección de staging, caché/retiro y recuperación; no automatizada",
    },
    {
      id: "WEB04.3-validacion",
      passed: false,
      detail:
        "Requiere validación externa de dominio/SEO y decisión de lanzamiento; no automatizada",
    },
  ];
  return {
    schemaVersion: 1,
    status: "pending",
    scope:
      "Preparación local de archivos fuente; no certifica versión activa ni lanzamiento",
    publicProducts: products.length,
    checks,
    pending: checks.filter((check) => !check.passed).map((check) => check.id),
  };
}
export async function checkReadiness() {
  const products = await loadCatalog();
  const business = await loadBusiness();
  const site = await loadSite();
  const pages = applySeo(pagesForCatalog(products), site).pages;
  const media = await prepareMedia(products, join(root, "media-approved"));
  const audit = auditPages(pages, media, await loadRedirects(pages));
  const budget = measureBudget(
    pages,
    await loadCss(root),
  );
  const imageBudget = measureImageBudget(
    pages,
    await loadCss(root),
    new Map([
      ...media,
      ...(await loadStaticAssets(root)),
      [
        "/assets/logo-rtt.jpg",
        await readFile(join(root, "assets/logo-rtt.jpg")),
      ],
    ]),
  );
  return {
    ...readinessReport({
      catalog: { schemaVersion: 1, products },
      business,
      site,
    }),
    local: {
      auditErrors: audit.errors.length,
      auditWarnings: audit.warnings,
      maxInitialBytes: Math.max(
        ...budget.routes.map((route) => route.initialBytes),
      ),
      clientJavaScriptBytes: budget.clientJavaScriptBytes,
      maxInitialAssetBytes: Math.max(
        ...imageBudget.routes.map((route) => route.initialAssetBytes),
      ),
      imageBudgetScope: imageBudget.scope,
    },
    generatedAt: new Date().toISOString(),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Usa Node.js 24");
  if (process.argv.slice(2).some((arg) => arg !== "--strict"))
    throw new Error("Argumento inválido");
  const report = await checkReadiness();
  const directory = resolve(root, "..", ".artifacts");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "web-readiness.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Preparación web: ${report.status}; ${report.publicProducts} fichas; ${report.pending.length} pendientes. Reporte: .artifacts/web-readiness.json`,
  );
  for (const check of report.checks)
    console.log(
      `${check.passed ? "OK" : "PENDIENTE"} ${check.id}: ${check.detail}`,
    );
  if (process.argv.includes("--strict") && report.pending.length)
    process.exitCode = 1;
}
import { measureImageBudget } from "./image-budget.mjs";
