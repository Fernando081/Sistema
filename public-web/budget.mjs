import { gzipSync, brotliCompressSync } from "node:zlib";

export const limits = Object.freeze({
  initialBytes: 50000,
  // CSS ya minificado por css.mjs (WEB02.4). WEB02.5 sube a 28 000 por la papelería
  // (carpetas, hoja, cupón) y las fuentes propias; HTML+CSS sigue bajo 50 000.
  cssBytes: 28000,
  compressedBytes: 15000,
});
export function measureBudget(pages, css) {
  const routes = [...pages].map(([route, html]) => {
    const buffer = Buffer.from(html);
    return {
      route,
      htmlBytes: buffer.length,
      initialBytes: buffer.length + css.length,
      gzipBytes: gzipSync(buffer).length + gzipSync(css).length,
      brotliBytes:
        brotliCompressSync(buffer).length + brotliCompressSync(css).length,
    };
  });
  if (
    css.length > limits.cssBytes ||
    routes.some(
      (row) =>
        row.initialBytes > limits.initialBytes ||
        row.gzipBytes > limits.compressedBytes ||
        row.brotliBytes > limits.compressedBytes,
    )
  )
    throw new Error(
      "Presupuesto público superado: revisar HTML/CSS y reporte de límites",
    );
  return { limits, cssBytes: css.length, clientJavaScriptBytes: 0, routes };
}
