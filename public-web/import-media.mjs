import { readFile, writeFile, realpath, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCatalog } from "./catalog.mjs";
import { prepareMedia } from "./media.mjs";
export async function importMedia(raw, source, destination) {
  const products = validateCatalog(JSON.parse(raw));
  const base = await realpath(destination);
  const files = await prepareMedia(products, source);
  const selected = new Map();
  for (const product of products)
    for (const image of (product.images ?? []).flatMap((image) => [
      image,
      ...(image.variants ?? []),
    ])) {
      const bytes = files.get(`/media/${image.sha256}.png`);
      if (selected.has(image.file) && !selected.get(image.file).equals(bytes))
        throw new Error("Nombre de archivo con hashes distintos");
      selected.set(image.file, bytes);
    }
  const pending = [];
  for (const [name, bytes] of selected) {
    const target = join(base, name);
    try {
      const actual = await realpath(target);
      if (!actual.startsWith(base + sep))
        throw new Error("Destino fuera de medios aprobados");
      if (!(await readFile(actual)).equals(bytes))
        throw new Error("Destino existente distinto; no se sobrescribe");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      pending.push([target, bytes]);
    }
  }
  const created = [];
  try {
    for (const [target, bytes] of pending) {
      await writeFile(target, bytes, { flag: "wx" });
      created.push(target);
    }
  } catch (error) {
    for (const target of created) await unlink(target);
    throw error;
  }
  return {
    selected: selected.size,
    copied: created.length,
    existing: selected.size - created.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [manifest, source, destination] = process.argv.slice(2);
  if (!manifest || !source || !destination)
    throw new Error(
      "Indica manifiesto, directorio fuente y directorio destino",
    );
  console.log(
    await importMedia(await readFile(manifest, "utf8"), source, destination),
  );
}
