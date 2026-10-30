import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { minifyCss, loadCss } from "../css.mjs";
import { limits } from "../budget.mjs";

test("minificado conserva selectores, cadenas y consultas de medios", () => {
  assert.equal(
    minifyCss(
      '/* nota */\n.a > b ,\n.c:hover {\n  margin: 0.5rem 0;\n  content: "✦";\n}\n@media (max-width: 850px) {\n  .a { opacity: 0.25; }\n}\n',
    ),
    '.a>b,.c:hover{margin:.5rem 0;content:"✦"}@media (max-width:850px){.a{opacity:.25}}',
  );
  assert.throws(() => minifyCss('.a{content:"a  b"}'), /espacios múltiples/);
});

test("la hoja pública minificada cabe en el presupuesto y respeta movimiento reducido", async () => {
  const css = (await loadCss(fileURLToPath(new URL("..", import.meta.url)))).toString();
  assert.ok(css.length <= limits.cssBytes);
  assert.doesNotMatch(css, /\/\*/);
  const motion = css.indexOf("@media (prefers-reduced-motion:no-preference)");
  assert.ok(motion > 0);
  // Las animaciones con nombre sólo se aplican dentro del bloque de movimiento permitido.
  for (const match of css.matchAll(/animation:[a-z]/g))
    assert.ok(match.index > motion, "animación fuera de prefers-reduced-motion");
});
