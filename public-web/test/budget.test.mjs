import { test } from "node:test";
import assert from "node:assert/strict";
import { measureBudget } from "../budget.mjs";
test("presupuesto por ruta incluye CSS compartido y rechaza exceso antes de escribir", () => {
  const report = measureBudget(
    new Map([["/", "<h1>Inicio</h1>"]]),
    Buffer.from("body{}"),
  );
  assert.equal(report.routes[0].initialBytes, 21);
  assert.ok(report.routes[0].gzipBytes > 0);
  assert.ok(report.routes[0].brotliBytes > 0);
  assert.throws(
    () => measureBudget(new Map([["/", "a".repeat(50001)]]), Buffer.alloc(0)),
    /Presupuesto/,
  );
  assert.throws(
    () => measureBudget(new Map([["/", "a"]]), Buffer.alloc(20001)),
    /Presupuesto/,
  );
});
