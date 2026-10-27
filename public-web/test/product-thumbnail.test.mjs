import { test } from "node:test";
import assert from "node:assert/strict";
import { productThumbnail } from "../product-thumbnail.mjs";
test("miniatura elige variante suficiente sin usar archivo privado y conserva fallback", () => {
  const image = {
    sha256: "a".repeat(64),
    width: 800,
    height: 800,
    variants: [
      { sha256: "b".repeat(64), width: 400, height: 400 },
      { sha256: "c".repeat(64), width: 100, height: 100 },
    ],
  };
  const html = productThumbnail({ images: [image] });
  assert.match(html, new RegExp(`/media/${"b".repeat(64)}.png`));
  assert.match(html, /loading="lazy"/);
  assert.match(html, /width="400" height="400"/);
  assert.match(
    productThumbnail({ images: [{ ...image, variants: [] }] }),
    new RegExp(image.sha256),
  );
  assert.match(productThumbnail({}), /Fotografía pendiente/);
});
