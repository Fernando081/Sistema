import { createHash } from "node:crypto";
import { escapeHtml } from "./business.mjs";
import { productThumbnail } from "./product-thumbnail.mjs";

export const pageSize = 12;
export function groupRoute(kind, name) {
  return `/${kind}/${createHash("sha256").update(name).digest("hex")}`;
}
export function navigationPages(products, shell, heading) {
  const pages = new Map();
  if (!products.length) return pages;
  const sorted = [...products].sort(
    (a, b) =>
      a.code.localeCompare(b.code, "es") || a.slug.localeCompare(b.slug),
  );
  function paginate(route, title, items, render) {
    const total = Math.ceil(items.length / pageSize);
    for (let index = 0; index < total; index++) {
      const current = index + 1;
      const url = current === 1 ? route : `${route}/pagina/${current}`;
      const link = (number, label) =>
        `<a class="text-link" href="${number === 1 ? route : `${route}/pagina/${number}`}">${label}</a>`;
      pages.set(
        url,
        shell(
          url,
          escapeHtml(title),
          heading(
            "Catálogo revisado",
            escapeHtml(title),
            `${items.length} resultados · Página ${current} de ${total}`,
          ) +
            `<p><a class="text-link" href="/catalogo">Catálogo</a> · <a class="text-link" href="/marcas">Marcas</a> · <a class="text-link" href="/categorias">Categorías</a></p><section class="brand-grid" aria-label="Resultados">${items
              .slice(index * pageSize, current * pageSize)
              .map(render)
              .join(
                "",
              )}</section><nav class="actions" aria-label="Paginación">${current > 1 ? link(current - 1, "Página anterior") : ""}<span aria-current="page">Página ${current} de ${total}</span>${current < total ? link(current + 1, "Página siguiente") : ""}</nav>`,
        ),
      );
    }
  }
  const card = (product) =>
    `<article class="product-card"><h2><a class="text-link" href="/productos/${product.slug}">${productThumbnail(product)}<span>${escapeHtml(product.title)}</span></a></h2><p>Número de parte: <strong>${escapeHtml(product.code)}</strong></p><p><a href="${groupRoute("marcas", product.brand)}">${escapeHtml(product.brand)}</a> · <a href="${groupRoute("categorias", product.category)}">${escapeHtml(product.category)}</a></p></article>`;
  paginate("/catalogo", "Catálogo", sorted, card);
  for (const [kind, field, title] of [
    ["marcas", "brand", "Marcas"],
    ["categorias", "category", "Categorías"],
  ]) {
    const groups = new Map();
    for (const product of sorted) {
      if (!groups.has(product[field])) groups.set(product[field], []);
      groups.get(product[field]).push(product);
    }
    const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, "es"));
    paginate(
      `/${kind}`,
      title,
      names,
      (name) =>
        `<article><h2><a class="text-link" href="${groupRoute(kind, name)}">${escapeHtml(name)}</a></h2><p>${groups.get(name).length} productos publicados</p></article>`,
    );
    for (const name of names)
      paginate(groupRoute(kind, name), name, groups.get(name), card);
  }
  return pages;
}
