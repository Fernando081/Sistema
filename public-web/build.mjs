import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { businessPages, loadBusiness } from "./business.mjs";
import { measureBudget } from "./budget.mjs";
import { loadCss } from "./css.mjs";
import { loadCatalog, catalogPages } from "./catalog.mjs";
import { prepareMedia } from "./media.mjs";
import { searchHtml } from "./search.mjs";
import { metadataDescription, breadcrumbHtml } from "./metadata.mjs";
import { loadSite, applySeo } from "./seo.mjs";
import { loadRedirects, validateRedirects } from "./redirects.mjs";
import { auditPages } from "./audit.mjs";
import { freeInquiryHtml } from "./free-inquiry.mjs";
import { measureImageBudget } from "./image-budget.mjs";
import { previewContextHtml, validatePreviewMode, TEST_PILOT_MODE } from "./preview-context.mjs";
import { homeBody, footerHtml, creditsBody } from "./home.mjs";
import { loadStaticAssets } from "./static-assets.mjs";
export const root = fileURLToPath(new URL(".", import.meta.url));
export const brand = "Refacciones y Tractorepuestos Tampico";
const mark =
  '<img class="brand-logo" src="/assets/logo-rtt-160.webp" alt="" width="160" height="160" decoding="async">';
const links = [
  ["/catalogo", "Catálogo"],
  ["/buscar", "Buscar"],
  ["/categorias", "Categorías"],
  ["/marcas", "Marcas"],
  ["/nosotros", "Nosotros"],
  ["/contacto", "Contacto"],
];
// WEB02.5: el pie y la portada leen los datos confirmados de business.json.
const business = await loadBusiness();
const footer = footerHtml(business);
// Cada carpeta interior lleva una fotografía de referencia (decorativa, créditos en /creditos).
const headingPhotos = {
  "/catalogo": "inyector",
  "/buscar": "matraca",
  "/categorias": "maza",
  "/marcas": "motor",
  "/nosotros": "puerto-tampico",
  "/contacto": "puente-laguna",
  "/consulta": "carga-diesel",
};
const withHeadingPhoto = (path, body) =>
  path.startsWith("/productos/")
    ? body
    : body.replace(
        '<section class="page-heading">',
        `<section class="page-heading has-photo"><img class="heading-photo" src="/assets/photos/${headingPhotos["/" + path.split("/")[1]] ?? "puente-laguna"}.webp" alt="" width="720" height="900" decoding="async">`,
      );
export function shell(path, title, body, metadata = {}) {
  body = withHeadingPhoto(path, body);
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | ${brand}</title><meta name="description" content="${metadataDescription(metadata.description)}"><link rel="preload" href="/assets/fonts/zilla-slab-600.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/site.css"><script src="/assets/site.js" defer></script></head><body><a class="skip" href="#contenido">Saltar al contenido</a><div class="preview-bar" role="region" aria-label="Estado de la vista previa">Vista previa de diseño · Catálogo en preparación</div><header class="site-header"><a class="brand" href="/">${mark}<span>Refacciones y Tractorepuestos<strong>Tampico</strong></span></a><nav aria-label="Navegación principal">${links.map(([url, label]) => `<a href="${url}"${path === url ? ' aria-current="page"' : ""}>${label}</a>`).join("")}<a class="nav-action" href="/consulta"${path === "/consulta" ? ' aria-current="page"' : ""}>Consultar una pieza</a></nav></header><main id="contenido" tabindex="-1">${path === "/" ? "" : breadcrumbHtml(title, metadata.breadcrumbs)}${body}</main>${footer}</body></html>`;
}
// WEB02.5: el primer argumento (antetítulo) ya no se muestra; se conserva la firma.
export const heading = (_eyebrow, title, description) =>
  `<section class="page-heading"><h1>${title}</h1><p class="lead">${description}</p></section>`;
export const pages = new Map([
  ["/", shell("/", "Refacciones para servicio pesado diésel", homeBody(business))],
  ["/creditos", shell("/creditos", "Créditos", await creditsBody(fileURLToPath(new URL(".", import.meta.url)), heading))],
  [
    "/catalogo",
    shell(
      "/catalogo",
      "Catálogo",
      heading(
        "Consulta por número de parte",
        "Cada refacción,<br>con su información.",
        "Marca, aplicación y referencias en una ficha clara.",
      ) +
        `<section class="empty"><span class="empty-symbol" aria-hidden="true">↗</span><div><h2>Estamos preparando el catálogo</h2><p>Los productos aparecerán aquí cuando sus fichas hayan sido revisadas. Todavía no hay productos publicados.</p><a class="text-link" href="/contacto">Consultar los canales de atención →</a></div></section>`,
    ),
  ],
  [
    "/categorias",
    shell(
      "/categorias",
      "Categorías",
      heading(
        "Explora por familia",
        "Un catálogo<br>bien organizado.",
        "Las categorías ayudarán a encontrar cada refacción con mayor facilidad.",
      ) +
        `<section class="empty"><span class="empty-symbol" aria-hidden="true">+</span><div><h2>Categorías en preparación</h2><p>Se mostrarán las categorías que tengan productos revisados para el catálogo público.</p><a class="text-link" href="/catalogo">Ir al catálogo →</a></div></section>`,
    ),
  ],
  [
    "/diseno/ficha",
    shell(
      "/diseno/ficha",
      "Diseño de ficha",
      heading(
        "Prototipo de estructura · Sin producto publicado",
        "Una ficha.<br>Todos los detalles.",
        "Vista de diseño para revisar la jerarquía; no representa un producto real.",
      ) +
        `<section class="product-layout"><div class="image-frame"><span aria-hidden="true">+</span><p>Fotografía real autorizada</p></div><article><h2>Nombre comercial<br>de la refacción</h2><p>Marca del producto</p><p class="part-label">Número de parte original</p><p>La descripción revisada ocupará este espacio. No se muestran precios ni disponibilidad sin confirmación.</p><a class="button primary" href="/contacto">Información para solicitar atención</a></article></section><section class="details-grid"><article><h2>Aplicación</h2><p>Fabricante, modelo, motor y restricciones verificadas.</p></article><article><h2>Referencias cruzadas</h2><p>OEM, alternos y equivalencias elegidas tras revisión.</p></article><article><h2>Especificaciones</h2><p>Características, valores y unidades comprobadas.</p></article></section>`,
    ),
  ],
  [
    "/diseno/categoria",
    shell(
      "/diseno/categoria",
      "Diseño de categoría",
      heading(
        "Prototipo de estructura · Sin categoría publicada",
        "Encuentra tu pieza.<br>Con criterio.",
        "Vista de diseño sin productos de ejemplo ni inventario ficticio.",
      ) +
        `<section class="empty"><span class="empty-symbol" aria-hidden="true">≡</span><div><h2>Familia del catálogo</h2><p>Aquí se mostrarán las fichas revisadas de la categoría, con fotografías y números de parte.</p><a class="text-link" href="/catalogo">Volver al catálogo →</a></div></section>`,
    ),
  ],
  [
    "/404",
    shell(
      "/404",
      "Página no encontrada",
      heading(
        "Página no encontrada",
        "Volvamos<br>al camino correcto.",
        "La dirección que buscas no existe en esta vista previa.",
      ) +
        `<section class="empty"><a class="button primary" href="/">Volver al inicio</a></section>`,
    ),
  ],
]);
for (const [route, html] of businessPages(await loadBusiness(), shell, heading))
  pages.set(route, html);
pages.set(
  "/consulta",
  freeInquiryHtml(await loadBusiness(), new URLSearchParams(), shell, heading),
);
const basePages = new Map(pages);
export function pagesForCatalog(products) {
  return new Map([
    ...basePages,
    ...catalogPages(products, shell, heading),
    ["/buscar", searchHtml(products, new URLSearchParams(), shell, heading)],
  ]);
}
const loadedProducts = await loadCatalog();
pages.set(
  "/buscar",
  searchHtml(loadedProducts, new URLSearchParams(), shell, heading),
);
for (const [route, html] of catalogPages(loadedProducts, shell, heading))
  pages.set(route, html);
export async function build(
  output = join(root, "dist"),
  selectedPages = pages,
  products = loadedProducts,
  mediaDirectory = join(root, "media-approved"),
  options = {},
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Usa Node.js 24");
  const css = await loadCss(root);
  const logo = await readFile(join(root, "assets/logo-rtt.jpg"));
  if (logo.length > 350000 || logo[0] !== 0xff || logo[1] !== 0xd8)
    throw new Error("Logo JPEG inválido o mayor a 350 kB");
  const business = await loadBusiness();
  validatePreviewMode(options.previewMode);
  if (options.previewMode === TEST_PILOT_MODE && options.site?.confirmed)
    throw new Error("El piloto de prueba no admite dominio confirmado");
  selectedPages = new Map(selectedPages);
  selectedPages.set(
    "/buscar",
    searchHtml(products, new URLSearchParams(), shell, heading),
  );
  selectedPages = new Map([...selectedPages].map(([route, html]) => [route, previewContextHtml(html, options.previewMode)]));
  const seo = applySeo(selectedPages, options.previewMode === TEST_PILOT_MODE ? { origin: "", confirmed: false } : options.site ?? (await loadSite()));
  selectedPages = seo.pages;
  const redirects = options.redirects
    ? validateRedirects(options.redirects, selectedPages)
    : await loadRedirects(selectedPages);
  const report = measureBudget(selectedPages, css);
  const media = await prepareMedia(products, mediaDirectory);
  const statics = await loadStaticAssets(root);
  report.clientJavaScriptBytes = statics.get("/assets/site.js").length;
  report.imageBudget = measureImageBudget(
    selectedPages,
    css,
    new Map([...media, ...statics, ["/assets/logo-rtt.jpg", logo]]),
  );
  const audit = auditPages(selectedPages, media, redirects);
  if (
    [...media.values()].reduce((sum, bytes) => sum + bytes.length, 0) > 8000000
  )
    throw new Error("Presupuesto total de imágenes superado (8 MB)");
  await mkdir(join(output, "assets"), { recursive: true });
  await writeFile(
    join(output, "content-audit.json"),
    JSON.stringify(audit, null, 2),
  );
  await writeFile(
    join(output, "redirect-routes.json"),
    JSON.stringify(redirects),
  );
  await writeFile(
    join(output, "inquiry-business.json"),
    JSON.stringify(business),
  );
  await writeFile(
    join(output, "search-catalog.json"),
    JSON.stringify({ schemaVersion: 1, products }),
  );
  const routes = {};
  if (seo.sitemap) {
    await writeFile(join(output, "sitemap.xml"), seo.sitemap);
    routes["/sitemap.xml"] = "sitemap.xml";
  }
  for (const [url, html] of selectedPages) {
    const file = url === "/" ? "index.html" : url.slice(1) + "/index.html";
    await mkdir(resolve(output, file, ".."), { recursive: true });
    await writeFile(join(output, file), html);
    routes[url] = file;
  }
  await writeFile(join(output, "assets/site.css"), css);
  await writeFile(join(output, "assets/logo-rtt.jpg"), logo);
  if (media.size) await mkdir(join(output, "media"), { recursive: true });
  for (const [url, bytes] of media) {
    await writeFile(join(output, url.slice(1)), bytes);
    routes[url] = url.slice(1);
  }
  await writeFile(
    join(output, "budget-report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(join(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
  routes["/assets/site.css"] = "assets/site.css";
  routes["/assets/logo-rtt.jpg"] = "assets/logo-rtt.jpg";
  for (const [url, bytes] of statics) {
    await mkdir(resolve(output, url.slice(1), ".."), { recursive: true });
    await writeFile(join(output, url.slice(1)), bytes);
    routes[url] = url.slice(1);
  }
  routes["/robots.txt"] = "robots.txt";
  await writeFile(join(output, "routes.json"), JSON.stringify(routes, null, 2));
  const htmlBytes = Math.max(
    ...[...selectedPages.values()].map((html) => Buffer.byteLength(html)),
  );
  if (htmlBytes + css.length > 50000)
    throw new Error(
      "Presupuesto público inicial superado (50 kB HTML+CSS sin comprimir)",
    );
  console.log(
    `Web pública: ${selectedPages.size} páginas; máximo HTML+CSS ${htmlBytes + css.length} bytes; JavaScript cliente ${report.clientJavaScriptBytes} bytes.`,
  );
  return routes;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await build();
