import { escapeHtml } from "./business.mjs";
import { productThumbnail } from "./product-thumbnail.mjs";
const normalize = (value) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const code = (value) => normalize(value).replace(/[-\s]/g, "");
export function searchCatalog(products, params) {
  for (const key of params.keys())
    if (
      !["q", "marca", "categoria", "pagina"].includes(key) ||
      params.getAll(key).length !== 1
    )
      throw new Error("Parámetros inválidos");
  const q = (params.get("q") ?? "").trim();
  const brand = params.get("marca") ?? "";
  const category = params.get("categoria") ?? "";
  const page = params.get("pagina") ?? "1";
  if (
    q.length > 100 ||
    brand.length > 200 ||
    category.length > 200 ||
    /[\u0000-\u001f]/.test(q + brand + category) ||
    !/^[1-9]\d{0,3}$/.test(page)
  )
    throw new Error("Consulta inválida");
  const tokens = normalize(q).split(/\s+/).filter(Boolean);
  const results = products
    .filter(
      (item) =>
        (!brand || item.brand === brand) &&
        (!category || item.category === category),
    )
    .map((item) => {
      if (!q) return { item, rank: 0, reason: "Ficha publicada" };
      if (item.code.toLowerCase() === q.toLowerCase())
        return { item, rank: 4, reason: "Número de parte exacto" };
      if (code(q) && code(item.code) === code(q))
        return {
          item,
          rank: 3,
          reason: "Número de parte sin guiones o espacios",
        };
      if (
        code(q) &&
        item.references.some((reference) => code(reference) === code(q))
      )
        return {
          item,
          rank: 2,
          reason: "Referencia coincidente; revisar aplicación",
        };
      const text = normalize(
        [
          item.code,
          item.title,
          item.description,
          item.brand,
          item.category,
          ...item.references,
          ...item.applications,
        ].join(" "),
      );
      return tokens.every((token) => text.includes(token))
        ? { item, rank: 1, reason: "Coincidencia de texto; revisar ficha" }
        : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        a.item.code.localeCompare(b.item.code, "es") ||
        a.item.slug.localeCompare(b.item.slug),
    );
  const totalPages = Math.max(1, Math.ceil(results.length / 12));
  if (Number(page) > totalPages) throw new Error("Página fuera de rango");
  return {
    q,
    brand,
    category,
    page: Number(page),
    total: results.length,
    totalPages,
    results: results.slice((Number(page) - 1) * 12, Number(page) * 12),
  };
}
export function searchForm(q = "", brand = "", category = "", products = []) {
  const suggestions = (field, id, selected) => {
    const values = [...new Set(products.map((item) => item[field]))]
      .filter(
        (value) =>
          !selected ||
          value
            .toLocaleLowerCase("es")
            .includes(selected.toLocaleLowerCase("es")),
      )
      .sort((a, b) => a.localeCompare(b, "es"))
      .slice(0, 40);
    return `<datalist id="${id}">${values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}</datalist>`;
  };
  return `<form action="/buscar" method="get" class="contact-grid" role="search"><div><label for="busqueda">Número de parte o descripción</label><input id="busqueda" name="q" maxlength="100" value="${escapeHtml(q)}"><p>Busca por número original, referencia cruzada o descripción.</p><a class="text-link" href="/buscar">Limpiar búsqueda y filtros</a></div><div><label for="marca">Marca exacta (opcional)</label><input id="marca" name="marca" list="marcas-publicadas" maxlength="200" value="${escapeHtml(brand)}">${suggestions("brand", "marcas-publicadas", brand)}<label for="categoria">Categoría exacta (opcional)</label><input id="categoria" name="categoria" list="categorias-publicadas" maxlength="200" value="${escapeHtml(category)}">${suggestions("category", "categorias-publicadas", category)}<p>Elige una sugerencia o escribe el nombre completo. Se muestran hasta 40 sugerencias por filtro.</p><button class="button primary" type="submit">Buscar productos</button></div></form>`;
}
export function searchHtml(products, params, shell, heading) {
  const result = searchCatalog(products, params);
  const link = (page, label) => {
    const query = new URLSearchParams({
      q: result.q,
      marca: result.brand,
      categoria: result.category,
      pagina: String(page),
    });
    return `<a class="text-link" href="/buscar?${escapeHtml(query.toString())}">${label}</a>`;
  };
  return shell(
    "/buscar",
    "Buscar productos",
    heading(
      "Catálogo publicado",
      "Buscar productos",
      `${result.total} resultados · Página ${result.page} de ${result.totalPages}`,
    ) +
      searchForm(result.q, result.brand, result.category, products) +
      `<p>Una coincidencia de búsqueda no garantiza equivalencia ni compatibilidad.</p><section class="brand-grid" aria-label="Resultados">${result.results.map(({ item, reason }) => `<article class="product-card"><h2><a class="text-link" href="/productos/${item.slug}">${productThumbnail(item)}<span>${escapeHtml(item.title)}</span></a></h2><p>${escapeHtml(item.code)} · ${escapeHtml(item.brand)}</p><p>${reason}</p></article>`).join("") || '<div><p>No encontramos productos con esos criterios. Revisa el número de parte o cambia los filtros.</p><a class="text-link" href="/contacto">Consultar con nuestro equipo</a><p>Ten a mano el número de parte, marca y aplicación. Esta búsqueda no envía una solicitud.</p></div>'}</section><nav class="actions" aria-label="Paginación">${result.page > 1 ? link(result.page - 1, "Página anterior") : ""}${result.page < result.totalPages ? link(result.page + 1, "Página siguiente") : ""}</nav>`,
  );
}
