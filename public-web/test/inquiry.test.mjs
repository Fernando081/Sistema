import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inquiryHtml } from "../inquiry.mjs";
import { build, pagesForCatalog } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
const product = {
  slug: "consulta-prueba",
  status: "published",
  approved: true,
  code: "OEM-123",
  brand: "Marca & prueba",
  category: "Familia",
  title: "Pieza <prueba>",
  description: "Fixture aislada",
  applications: [],
  references: [],
  specifications: [],
};
const business = JSON.parse(
  await readFile(new URL("../business.json", import.meta.url), "utf8"),
);
const render = (config, query) =>
  inquiryHtml(
    [product],
    config,
    new URLSearchParams(query),
    (_url, _title, body) => body,
    () => "",
  );
test("consulta conserva producto/cantidad y solo prepara canales confirmados", () => {
  const input = structuredClone(business);
  input.contact.whatsapp = { confirmed: false, value: "+521234567890" };
  let html = render(input, { producto: product.slug, cantidad: "3" });
  assert.match(html, /Cantidad: 3/);
  assert.match(html, /Pieza &lt;prueba&gt;/);
  assert.doesNotMatch(html, /wa\.me|521234567890/);
  input.contact.whatsapp.confirmed = true;
  html = render(input, { producto: product.slug, cantidad: "3" });
  assert.match(html, /https:\/\/wa\.me\/521234567890\?text=/);
  const target = html.match(/href="(https:\/\/wa\.me\/[^\"]+)"/)[1];
  assert.match(new URL(target).searchParams.get("text"), /OEM-123/);
  assert.match(new URL(target).searchParams.get("text"), /Cantidad: 3/);
  assert.match(html, /Tú decides enviarlo/);
  for (const cantidad of ["0", "-1", "1.5", "10000", "1e2"])
    assert.throws(() => render(input, { producto: product.slug, cantidad }));
  assert.throws(() =>
    render(input, "producto=consulta-prueba&cantidad=1&cantidad=2"),
  );
  assert.throws(() =>
    render(input, { producto: product.slug, email: "privado" }),
  );
  assert.equal(
    inquiryHtml(
      [],
      input,
      new URLSearchParams({ producto: product.slug }),
      () => "",
      () => "",
    ),
    null,
  );
});
test("consulta HTTP respeta versión publicable, 404 y archivos privados", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-inquiry-"));
  let server;
  try {
    await build(directory, pagesForCatalog([product]), [product]);
    server = await createPreviewServer(directory);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(
      `${base}/cotizar?producto=${product.slug}&cantidad=2`,
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Cantidad: 2/);
    assert.equal((await fetch(`${base}/cotizar?producto=privado`)).status, 404);
    assert.equal(
      (await fetch(`${base}/cotizar?producto=${product.slug}&cantidad=0`))
        .status,
      400,
    );
    assert.equal((await fetch(`${base}/inquiry-business.json`)).status, 404);
    assert.equal(
      (
        await fetch(`${base}/cotizar?producto=${product.slug}`, {
          method: "POST",
        })
      ).status,
      405,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
