import { test } from "node:test";
import assert from "node:assert/strict";
import { measureImageBudget } from "../image-budget.mjs";

test("incluye logo una vez y candidatos responsivos; excluye ampliación lazy", () => {
  const html =
    '<img src="/logo.jpg"><img src="/logo.jpg"><img src="/large.png" srcset="/small.png 200w, /large.png 400w"><img src="/zoom.png" loading="lazy">';
  const assets = new Map([
    ["/logo.jpg", Buffer.alloc(100)],
    ["/small.png", Buffer.alloc(50)],
    ["/large.png", Buffer.alloc(200)],
  ]);
  const report = measureImageBudget(
    new Map([["/", html]]),
    Buffer.alloc(20),
    assets,
  );
  assert.equal(report.routes[0].imageBytes, 350);
  assert.equal(
    report.routes[0].initialAssetBytes,
    Buffer.byteLength(html) + 370,
  );
  assert.equal(report.routes[0].imageAssets.length, 3);
});
test("rechaza asset faltante y exceso aunque HTML y CSS sean pequeños", () => {
  const pages = new Map([["/", '<img src="/logo.jpg">']]);
  assert.throws(
    () => measureImageBudget(pages, Buffer.alloc(0), new Map()),
    /ausente/,
  );
  assert.throws(
    () =>
      measureImageBudget(
        pages,
        Buffer.alloc(0),
        new Map([["/logo.jpg", Buffer.alloc(750000)]]),
      ),
    /Presupuesto/,
  );
});
