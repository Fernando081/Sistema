import { readFile } from "node:fs/promises";
import { navigationPages } from "./navigation.mjs";
import { productMetadata } from "./metadata.mjs";
import { productIdentity } from "./structured.mjs";
import { escapeHtml } from "./business.mjs";

function exact(value, fields, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !fields.includes(key) && !optional.includes(key),
    ) ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Contrato público: campos inesperados o faltantes");
}
function text(value, max = 2000) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error("Contrato público: texto inválido");
  return value.trim();
}
export function validateCatalog(input) {
  exact(input, ["schemaVersion", "products"]);
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.products) ||
    input.products.length > 1000
  )
    throw new Error("Contrato público: versión o tamaño inválido");
  const slugs = new Set();
  const products = input.products.map((item) => {
    exact(
      item,
      [
        "slug",
        "status",
        "approved",
        "code",
        "brand",
        "category",
        "title",
        "description",
        "applications",
        "references",
        "specifications",
      ],
      ["images", "alternatives"],
    );
    if (
      !["draft", "published", "retired"].includes(item.status) ||
      typeof item.approved !== "boolean"
    )
      throw new Error("Contrato público: aprobación inválida");
    if (
      typeof item.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
      item.slug.length > 160 ||
      slugs.has(item.slug)
    )
      throw new Error("Contrato público: slug inválido o duplicado");
    slugs.add(item.slug);
    const result = {
      slug: item.slug,
      status: item.status,
      approved: item.approved,
    };
    if (item.alternatives !== undefined) {
      if (
        !Array.isArray(item.alternatives) ||
        item.alternatives.length > 12 ||
        new Set(item.alternatives).size !== item.alternatives.length ||
        item.alternatives.some(
          (slug) =>
            typeof slug !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
            slug.length > 160 ||
            slug === item.slug,
        )
      )
        throw new Error("Alternativas inválidas");
      result.alternatives = [...item.alternatives];
    }
    for (const key of ["code", "brand", "category", "title", "description"])
      result[key] = text(item[key], key === "description" ? 4000 : 200);
    for (const key of ["applications", "references"]) {
      if (!Array.isArray(item[key]) || item[key].length > 100)
        throw new Error("Contrato público: lista inválida");
      result[key] = item[key].map((value) => text(value));
    }
    if (!Array.isArray(item.specifications) || item.specifications.length > 100)
      throw new Error("Contrato público: especificaciones inválidas");
    result.specifications = item.specifications.map((value) => {
      exact(value, ["name", "value", "unit"]);
      return {
        name: text(value.name, 100),
        value: text(value.value, 200),
        unit:
          typeof value.unit === "string" && value.unit.length <= 40
            ? value.unit
            : (() => {
                throw new Error("Unidad inválida");
              })(),
      };
    });
    if (item.images !== undefined) {
      if (!Array.isArray(item.images) || item.images.length > 8)
        throw new Error("Imágenes inválidas");
      const decodeImage = (image, variant = false) => {
        exact(
          image,
          ["file", "sha256", "alt", "width", "height", "authorized"],
          variant ? [] : ["variants"],
        );
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(image.file) ||
          !/^[a-f0-9]{64}$/.test(image.sha256) ||
          image.authorized !== true ||
          !Number.isInteger(image.width) ||
          !Number.isInteger(image.height) ||
          image.width < 1 ||
          image.height < 1 ||
          image.width > 4096 ||
          image.height > 4096
        )
          throw new Error("Imagen no autorizada o inválida");
        let variants;
        if (image.variants !== undefined) {
          if (!Array.isArray(image.variants) || image.variants.length > 3)
            throw new Error("Variantes inválidas");
          variants = image.variants.map((value) => decodeImage(value, true));
          if (
            new Set(variants.map((value) => value.width)).size !==
              variants.length ||
            variants.some(
              (value) =>
                value.width >= image.width ||
                Math.abs(
                  value.height / value.width - image.height / image.width,
                ) >
                  1 / value.width,
            )
          )
            throw new Error("Variantes inválidas");
        }
        return {
          file: image.file,
          sha256: image.sha256,
          alt: text(image.alt, 200),
          width: image.width,
          height: image.height,
          authorized: true,
          ...(variants ? { variants } : {}),
        };
      };
      result.images = item.images.map((image) => decodeImage(image));
    }
    return result;
  });
  const published = products.filter(
    (item) => item.status === "published" && item.approved,
  );
  const publicSlugs = new Set(published.map((item) => item.slug));
  for (const item of published)
    if (item.alternatives?.some((slug) => !publicSlugs.has(slug)))
      throw new Error("La alternativa debe estar publicada y aprobada");
  return published;
}
export async function loadCatalog() {
  return validateCatalog(
    JSON.parse(
      await readFile(new URL("./catalog.json", import.meta.url), "utf8"),
    ),
  );
}
export function catalogPages(products, shell, heading) {
  const pages = new Map();
  const list = (values) =>
    values.length
      ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
      : "<p>Información no incorporada a esta ficha.</p>";
  const gallery = (images) =>
    images
      .map((image, index) => {
        const id = `imagen-${index + 1}`;
        const src = `/media/${image.sha256}.png`;
        const responsive = image.variants?.length
          ? ` srcset="${[...image.variants, image]
              .sort((a, b) => a.width - b.width)
              .map((value) => `/media/${value.sha256}.png ${value.width}w`)
              .join(", ")}" sizes="(max-width: 800px) calc(100vw - 80px), 45vw"`
          : "";
        return `<figure id="miniatura-${index + 1}"><a class="image-trigger" href="#${id}" aria-label="Ampliar imagen: ${escapeHtml(image.alt)}"><img itemprop="image" class="public-product-image" src="${src}"${responsive} alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"></a><figcaption>Selecciona para ampliar.</figcaption></figure><section class="image-zoom" id="${id}" aria-label="Imagen ampliada: ${escapeHtml(image.alt)}"><a class="zoom-close" href="#miniatura-${index + 1}">Cerrar ampliación</a><img src="${src}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy"><a href="${src}">Abrir archivo a tamaño original</a></section>`;
      })
      .join("");
  for (const product of products) {
    const alternatives = (product.alternatives ?? [])
      .map((slug) => products.find((item) => item.slug === slug))
      .filter(Boolean);
    const url = "/productos/" + product.slug;
    const metadata = productMetadata(product);
    pages.set(
      url,
      shell(
        url,
        escapeHtml(metadata.title),
        `<section class="product-sheet">${productIdentity(product)
          .replace(
            "<article itemscope",
            '<article class="product-overview" itemscope',
          )
          .replace(
            "<h2>Identificación</h2>",
            `<div class="product-summary">${heading(escapeHtml(product.brand), escapeHtml(product.title), escapeHtml(product.description))}<h2>Identificación</h2>`,
          )}<form action="/cotizar" method="get" class="product-quote"><input type="hidden" name="producto" value="${product.slug}"><label for="product-quantity">Cantidad a consultar</label><input id="product-quantity" name="cantidad" type="number" min="1" max="9999" step="1" value="1" required><button class="button primary" type="submit">Preparar consulta</button></form><a class="text-link" href="/cotizar?producto=${product.slug}">Consultar cotización</a><p class="product-advice">Confirma aplicación, precio y disponibilidad con nuestro equipo antes de comprar.</p></div><div class="product-gallery" aria-label="Fotografías del producto">${product.images?.length ? gallery(product.images) : '<div class="image-frame"><p>Fotografías pendientes de publicación autorizada.</p></div>'}</div></article></section><nav class="product-sections" aria-label="Información del producto"><a href="#aplicaciones">Aplicaciones</a><a href="#referencias">Referencias cruzadas</a><a href="#especificaciones">Especificaciones</a></nav><section class="contact-grid"><article id="aplicaciones"><h2>Aplicaciones y restricciones</h2>${list(product.applications)}</article><article id="referencias"><h2>Referencias cruzadas revisadas</h2>${list(product.references)}<p>Una referencia cruzada no sustituye la comprobación de compatibilidad.</p></article></section><section class="product-specifications" id="especificaciones"><h2>Especificaciones técnicas</h2>${product.specifications.length ? `<table><caption>Características de ${escapeHtml(product.code)}</caption><tbody>${product.specifications.map((spec) => `<tr><th scope="row">${escapeHtml(spec.name)}</th><td>${escapeHtml(spec.value)} ${escapeHtml(spec.unit)}</td></tr>`).join("")}</tbody></table>` : "<p>Información no incorporada a esta ficha.</p>"}</section>` +
          (alternatives.length
            ? `<section class="brand-grid" aria-label="Alternativas revisadas">${alternatives.map((item) => `<article><h2><a class="text-link" href="/productos/${item.slug}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.brand)} · ${escapeHtml(item.code)}</p><p>Revisa las aplicaciones y restricciones de esta alternativa antes de elegirla.</p></article>`).join("")}</section>`
            : ""),
        metadata,
      ),
    );
  }
  for (const [route, html] of navigationPages(products, shell, heading))
    pages.set(route, html);
  return pages;
}
