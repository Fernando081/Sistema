import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Archivos estáticos propios del diseño WEB02.5. Lista explícita: el servidor no
// sirve el directorio assets/ completo. Fotografías de bancos abiertos con créditos en
// assets/credits.json; nunca representan productos, inventario ni el local.
const types = {
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
export const staticAssets = [
  "/assets/site.js",
  "/assets/logo-rtt-160.webp",
  "/assets/fonts/zilla-slab-400.woff2",
  "/assets/fonts/zilla-slab-600.woff2",
  "/assets/photos/puente-tampico-1600.webp",
  "/assets/photos/puente-tampico-960.webp",
  "/assets/photos/puente-laguna.webp",
  "/assets/photos/puerto-tampico.webp",
  "/assets/photos/carga-diesel.webp",
  "/assets/photos/inyector.webp",
  "/assets/photos/maza.webp",
  "/assets/photos/matraca.webp",
  "/assets/photos/motor.webp",
];
export const staticLimits = Object.freeze({
  clientJavaScriptBytes: 8000,
  photoBytes: 200000,
  totalBytes: 700000,
});
export function staticType(url) {
  return types[url.slice(url.lastIndexOf("."))];
}
export async function loadStaticAssets(root) {
  const assets = new Map();
  let total = 0;
  for (const url of staticAssets) {
    const bytes = await readFile(join(root, url.slice(1)));
    const type = staticType(url);
    if (!type) throw new Error(`Tipo de archivo estático no admitido: ${url}`);
    if (url.endsWith(".js") && bytes.length > staticLimits.clientJavaScriptBytes)
      throw new Error("Presupuesto de JavaScript cliente superado");
    if (url.includes("/photos/") && bytes.length > staticLimits.photoBytes)
      throw new Error(`Fotografía mayor al presupuesto: ${url}`);
    total += bytes.length;
    assets.set(url, bytes);
  }
  if (total > staticLimits.totalBytes)
    throw new Error("Presupuesto de archivos estáticos superado");
  return assets;
}
