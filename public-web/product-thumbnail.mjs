export function productThumbnail(product) {
  const image = product.images?.[0];
  if (!image)
    return '<span class="product-thumbnail product-thumbnail-empty" aria-hidden="true">Fotografía pendiente</span>';
  const selected =
    [...(image.variants ?? []), image]
      .sort((a, b) => a.width - b.width)
      .find((candidate) => candidate.width >= 320) ?? image;
  return `<span class="product-thumbnail"><img src="/media/${selected.sha256}.png" alt="" width="${selected.width}" height="${selected.height}" loading="lazy" decoding="async"></span>`;
}
