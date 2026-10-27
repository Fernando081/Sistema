import { escapeHtml } from "./business.mjs";
import { groupRoute } from "./navigation.mjs";

export function productMetadata(product) {
  const identity = `${product.code} · ${product.brand}`;
  return {
    title: `${product.title} · ${identity}`,
    description: `${identity}. ${product.description}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320),
    breadcrumbs: [
      { url: "/catalogo", title: "Catálogo" },
      {
        url: groupRoute("categorias", product.category),
        title: product.category,
      },
    ],
  };
}
export function metadataDescription(value) {
  return escapeHtml(
    value ??
      "Refacciones para servicio pesado diésel. Un negocio familiar: Refacciones y Tractorepuestos Tampico.",
  );
}
export function breadcrumbHtml(title, breadcrumbs = []) {
  for (const item of breadcrumbs)
    if (!/^\/(catalogo|categorias\/[a-f0-9]{64})$/.test(item.url))
      throw new Error("Ruta de navegación inválida");
  return `<nav class="breadcrumbs" aria-label="Ruta de navegación"><a href="/">Inicio</a>${breadcrumbs.map((item) => `<span aria-hidden="true">/</span><a href="${item.url}">${escapeHtml(item.title)}</a>`).join("")}<span aria-hidden="true">/</span><span aria-current="page">${title}</span></nav>`;
}
