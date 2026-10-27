import { readFile } from "node:fs/promises";
const path = (value) =>
  typeof value === "string" &&
  /^\/(?:productos\/[a-z0-9]+(?:-[a-z0-9]+)*|(?:marcas|categorias)\/[a-f0-9]{64})$/.test(
    value,
  );
export function validateRedirects(input, pages) {
  if (
    !input ||
    Object.keys(input).length !== 2 ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.entries) ||
    input.entries.length > 1000
  )
    throw new Error("Contrato de redirecciones inválido");
  const sources = new Set();
  for (const entry of input.entries) {
    if (
      !entry ||
      Object.keys(entry).length !== 2 ||
      !path(entry.from) ||
      !path(entry.to) ||
      entry.from.split("/")[1] !== entry.to.split("/")[1] ||
      entry.from === entry.to ||
      sources.has(entry.from) ||
      pages.has(entry.from) ||
      !pages.has(entry.to)
    )
      throw new Error(
        "Redirección inválida: origen ocupado, destino ausente o ruta no permitida",
      );
    sources.add(entry.from);
  }
  return {
    schemaVersion: 1,
    entries: input.entries.map(({ from, to }) => ({ from, to })),
  };
}
export async function loadRedirects(pages) {
  return validateRedirects(
    JSON.parse(
      await readFile(new URL("./redirects.json", import.meta.url), "utf8"),
    ),
    pages,
  );
}
