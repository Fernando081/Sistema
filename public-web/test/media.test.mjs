import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { importMedia } from "../import-media.mjs";
import { chunk } from "../optimize-png.mjs";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { digest } from "../publish.mjs";
import { validateCatalog, catalogPages } from "../catalog.mjs";
import { prepareMedia } from "../media.mjs";
test("medios seleccionados: autorización, hash, dimensiones y HTML accesible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-media-test-"));
  try {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(directory, "fixture.png"), bytes);
    const image = {
      file: "fixture.png",
      sha256: digest(bytes),
      width: 1,
      height: 1,
      authorized: true,
      alt: "Fixture en temporal",
    };
    const product = {
      slug: "fixture",
      status: "published",
      approved: true,
      code: "TEST",
      brand: "Fixture",
      category: "Fixture",
      title: "Fixture",
      description: "Prueba temporal",
      applications: [],
      references: [],
      specifications: [],
      images: [image],
    };
    const products = validateCatalog({ schemaVersion: 1, products: [product] });
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 6;
    const full = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc(18))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    await writeFile(join(directory, "full.png"), full);
    const responsive = validateCatalog({
      schemaVersion: 1,
      products: [
        {
          ...product,
          images: [
            {
              ...image,
              file: "full.png",
              sha256: digest(full),
              width: 2,
              height: 2,
              variants: [image],
            },
          ],
        },
      ],
    });
    const responsiveHtml = catalogPages(
      responsive,
      (_path, _title, body) => body,
      () => "<h1>Fixture</h1>",
    ).get("/productos/fixture");
    assert.match(responsiveHtml, /srcset=/);
    assert.match(responsiveHtml, /sizes=/);
    const responsiveMedia = await prepareMedia(responsive, directory);
    assert.equal(responsiveMedia.size, 2);
    const responsiveDestination = join(directory, "responsive");
    await mkdir(responsiveDestination);
    const responsiveRaw = JSON.stringify({
      schemaVersion: 1,
      products: responsive,
    });
    assert.equal(
      (await importMedia(responsiveRaw, directory, responsiveDestination))
        .copied,
      2,
    );
    await writeFile(join(directory, "fixture.png"), "alterado");
    await assert.rejects(
      prepareMedia(responsive, directory),
      /Imagen inválida/,
    );
    await writeFile(join(directory, "fixture.png"), bytes);
    assert.throws(
      () =>
        validateCatalog({
          schemaVersion: 1,
          products: [{ ...product, images: [{ ...image, variants: [image] }] }],
        }),
      /Variantes/,
    );
    const files = await prepareMedia(products, directory);
    assert.deepEqual(files.get(`/media/${image.sha256}.png`), bytes);
    const destination = join(directory, "approved");
    await mkdir(destination);
    const raw = JSON.stringify({ schemaVersion: 1, products: [product] });
    assert.deepEqual(await importMedia(raw, directory, destination), {
      selected: 1,
      copied: 1,
      existing: 0,
    });
    assert.deepEqual(await importMedia(raw, directory, destination), {
      selected: 1,
      copied: 0,
      existing: 1,
    });
    await writeFile(join(destination, "fixture.png"), "otro");
    await assert.rejects(
      importMedia(raw, directory, destination),
      /no se sobrescribe/,
    );
    assert.equal(
      await readFile(join(destination, "fixture.png"), "utf8"),
      "otro",
    );
    const html = catalogPages(
      products,
      (_path, _title, body) => body,
      () => "<h1>Fixture</h1>",
    ).get("/productos/fixture");
    assert.match(html, /alt="Fixture en temporal"/);
    assert.match(html, /width="1" height="1"/);
    assert.throws(
      () =>
        validateCatalog({
          schemaVersion: 1,
          products: [{ ...product, images: [{ ...image, authorized: false }] }],
        }),
      /autorizada/,
    );
    assert.throws(
      () =>
        validateCatalog({
          schemaVersion: 1,
          products: [
            { ...product, images: [{ ...image, file: "../secret.png" }] },
          ],
        }),
      /inválida/,
    );
    await assert.rejects(
      prepareMedia([{ images: [{ ...image, width: 2 }] }], directory),
      /Imagen inválida/,
    );
    await writeFile(join(directory, "fixture.png"), "alterado");
    await assert.rejects(prepareMedia(products, directory), /Imagen inválida/);
  } finally {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + "\\") ||
      !basename(target).startsWith("rtt-media-test-")
    )
      throw new Error("Temporal fuera de alcance");
    await rm(target, { recursive: true, force: true });
  }
});
