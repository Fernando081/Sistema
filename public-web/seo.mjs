import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { escapeHtml } from "./business.mjs";

export function validateSite(input) {
  if (
    !input ||
    Object.keys(input).length !== 2 ||
    typeof input.origin !== "string" ||
    typeof input.confirmed !== "boolean"
  )
    throw new Error("Configuración de dominio inválida");
  if (!input.origin) {
    if (input.confirmed) throw new Error("Dominio confirmado vacío");
    return { origin: "", confirmed: false };
  }
  const url = new URL(input.origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.includes(".") ||
    isIP(url.hostname) ||
    url.hostname.includes(":") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".localhost")
  )
    throw new Error(
      "Usa un origen HTTPS público sin credenciales, puerto o rutas",
    );
  return { origin: url.origin, confirmed: input.confirmed };
}
export async function loadSite() {
  return validateSite(
    JSON.parse(await readFile(new URL("./site.json", import.meta.url), "utf8")),
  );
}
export function publicSeoRoute(route) {
  return /^\/(?:|nosotros|contacto|catalogo(?:\/pagina\/[1-9]\d*)?|(?:marcas|categorias)(?:\/[a-f0-9]{64})?(?:\/pagina\/[1-9]\d*)?|productos\/[a-z0-9-]+)$/.test(
    route,
  );
}
export function applySeo(pages, input) {
  const site = validateSite(input);
  const result = new Map(pages);
  if (!site.confirmed) return { pages: result, sitemap: null };
  const urls = [];
  for (const [route, html] of pages) {
    if (!publicSeoRoute(route)) continue;
    const url = site.origin + route;
    urls.push(url);
    result.set(
      route,
      html.replace(
        "</head>",
        `<link rel="canonical" href="${escapeHtml(url)}"></head>`,
      ),
    );
  }
  const xml = (value) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char],
    );
  return {
    pages: result,
    sitemap: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${xml(url)}</loc></url>`).join("")}</urlset>`,
  };
}
