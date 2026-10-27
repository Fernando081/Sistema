import { inflateSync, deflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function chunk(type, data) {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  output.write(type, 4, "ascii");
  data.copy(output, 8);
  output.writeUInt32BE(crc(output.subarray(4, -4)), output.length - 4);
  return output;
}
export function optimizePng(bytes) {
  if (
    bytes.length > 8000000 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("PNG inválido");
  const chunks = [];
  let offset = 8;
  let ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG truncado");
    const length = bytes.readUInt32BE(offset),
      end = offset + length + 12;
    if (end > bytes.length) throw new Error("PNG truncado");
    const type = bytes.toString("ascii", offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    if (
      crc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new Error("CRC PNG inválido");
    if (
      !chunks.length &&
      (type !== "IHDR" ||
        length !== 13 ||
        !data.readUInt32BE(0) ||
        !data.readUInt32BE(4) ||
        data.readUInt32BE(0) > 4096 ||
        data.readUInt32BE(4) > 4096)
    )
      throw new Error("Dimensiones PNG inválidas");
    if (["acTL", "fcTL", "fdAT"].includes(type))
      throw new Error("PNG animado no admitido");
    if (type === "IDAT") compressed.push(data);
    chunks.push({ type, data });
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length || !compressed.length)
    throw new Error("PNG incompleto");
  const original = Buffer.concat(compressed);
  const decoded = inflateSync(original, { maxOutputLength: 134217728 });
  const recompressed = deflateSync(decoded, { level: 9 });
  const selected =
    recompressed.length < original.length ? recompressed : original;
  const output = [bytes.subarray(0, 8)];
  let emitted = false;
  for (const item of chunks) {
    if (["tEXt", "zTXt", "iTXt", "eXIf", "tIME"].includes(item.type)) continue;
    if (item.type === "IDAT") {
      if (!emitted) output.push(chunk("IDAT", selected));
      emitted = true;
    } else output.push(chunk(item.type, item.data));
  }
  return Buffer.concat(output);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target || resolve(source) === resolve(target))
    throw new Error("Indica origen y destino diferentes");
  const original = await readFile(source);
  const optimized = optimizePng(original);
  await writeFile(target, optimized, { flag: "wx" });
  console.log(
    `PNG preparado: ${original.length} → ${optimized.length} bytes. Revisar y aprobar el archivo nuevo.`,
  );
}
