import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { optimizePng, chunk } from "../optimize-png.mjs";
test("PNG conserva pixels comprimidos y elimina metadata antes de aprobar", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const source = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from("Comentario\0privado")),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const result = optimizePng(source);
  assert.ok(result.length < source.length);
  assert.equal(result.includes(Buffer.from("privado")), false);
  let offset = 8;
  const idat = [];
  while (offset < result.length) {
    const length = result.readUInt32BE(offset);
    if (result.toString("ascii", offset + 4, offset + 8) === "IDAT")
      idat.push(result.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.deepEqual(
    inflateSync(Buffer.concat(idat)),
    Buffer.from([0, 255, 0, 0, 255]),
  );
  assert.deepEqual(optimizePng(result), result);
  const broken = Buffer.from(source);
  broken[30] ^= 1;
  assert.throws(() => optimizePng(broken), /CRC/);
  assert.throws(() => optimizePng(source.subarray(0, -1)), /truncado/);
  assert.throws(
    () => optimizePng(Buffer.concat([source, Buffer.from("extra")])),
    /incompleto/,
  );
});
