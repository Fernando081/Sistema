export const imageBudgetLimits = Object.freeze({ initialAssetBytes: 750000 });

// HTML generado por este proyecto; no es un parser general de páginas externas.
export function measureImageBudget(pages, css, assets) {
  const routes = [...pages].map(([route, html]) => {
    const urls = new Set();
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
      if (/\bloading="lazy"/.test(tag)) continue;
      const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
      if (!src) throw new Error(`Imagen sin fuente: ${route}`);
      urls.add(src);
      const srcset = tag.match(/\bsrcset="([^"]+)"/)?.[1];
      if (srcset)
        for (const candidate of srcset.split(","))
          urls.add(candidate.trim().split(/\s+/)[0]);
    }
    let imageBytes = 0;
    for (const url of urls) {
      const bytes = assets.get(url);
      if (!Buffer.isBuffer(bytes))
        throw new Error(`Imagen inicial ausente del build: ${route} ${url}`);
      imageBytes += bytes.length;
    }
    const initialAssetBytes = Buffer.byteLength(html) + css.length + imageBytes;
    if (initialAssetBytes > imageBudgetLimits.initialAssetBytes)
      throw new Error(
        `Presupuesto de imágenes y carga inicial superado: ${route} (${initialAssetBytes} bytes)`,
      );
    return { route, imageBytes, initialAssetBytes, imageAssets: [...urls] };
  });
  return {
    limits: imageBudgetLimits,
    scope:
      "HTML+CSS sin comprimir y unión de fuentes de imágenes no lazy, incluyendo candidatos srcset; sin caché. No mide velocidad ni imágenes lazy que el navegador pueda cargar al iniciar.",
    routes,
  };
}
