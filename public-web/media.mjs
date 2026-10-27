import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
export async function prepareMedia(products, directory) {
  const files = new Map();
  for (const product of products)
    for (const image of (product.images ?? []).flatMap((image) => [
      image,
      ...(image.variants ?? []),
    ])) {
      const base = await realpath(directory);
      const path = await realpath(join(directory, image.file));
      if (!path.startsWith(base + sep))
        throw new Error("Imagen fuera del directorio público seleccionado");
      const bytes = await readFile(path);
      if (
        bytes.length < 24 ||
        bytes.length > 250000 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.toString("ascii", 12, 16) !== "IHDR" ||
        bytes.readUInt32BE(16) !== image.width ||
        bytes.readUInt32BE(20) !== image.height ||
        createHash("sha256").update(bytes).digest("hex") !== image.sha256
      )
        throw new Error(
          "Imagen inválida: revisar formato, tamaño, dimensiones y hash",
        );
      files.set(`/media/${image.sha256}.png`, bytes);
    }
  return files;
}
