import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Minificado conservador: comentarios y espacios. No toca cadenas porque la hoja no
// usa espacios significativos dentro de comillas (se valida abajo).
export function minifyCss(source) {
  if ((source.match(/"[^"\n]*"|'[^'\n]*'/g) ?? []).some((text) => /\s{2}/.test(text)))
    throw new Error("CSS público: cadena con espacios múltiples; no se puede minificar con seguridad");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,>])\s*/g, "$1")
    .replace(/:\s+/g, ":")
    .replace(/([\s:,(])0\.(\d)/g, "$1.$2")
    .replace(/;}/g, "}")
    .trim();
}

export async function loadCss(root) {
  return Buffer.from(
    minifyCss(await readFile(join(root, "assets/site.css"), "utf8")),
  );
}
