import { escapeHtml } from "./business.mjs";

export function productIdentity(product) {
  return `<article itemscope itemtype="https://schema.org/Product"><meta itemprop="name" content="${escapeHtml(product.title)}"><meta itemprop="description" content="${escapeHtml(product.description)}"><h2>Identificación</h2><p>Número de parte: <strong itemprop="productID">${escapeHtml(product.code)}</strong></p><p>Marca: <span itemprop="brand" itemscope itemtype="https://schema.org/Brand"><span itemprop="name">${escapeHtml(product.brand)}</span></span></p><p>Categoría: <span itemprop="category">${escapeHtml(product.category)}</span></p>`;
}
