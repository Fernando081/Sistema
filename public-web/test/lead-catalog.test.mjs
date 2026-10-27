import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { build, pagesForCatalog } from "../build.mjs";
import { createPreviewServer } from "../server.mjs";
import { validateCatalog } from "../catalog.mjs";
import { leadSelection } from "../lead-selection.mjs";
import { leadFromForm } from "../lead-form.mjs";
import { validateLead } from "../lead-contract.mjs";

const product = (slug, code) => ({
  slug,
  code,
  status: "published",
  approved: true,
  brand: "Marca fixture",
  category: "Familia fixture",
  title: "Pieza " + code,
  description: "Contenido fixture aislado",
  applications: [],
  references: [],
  specifications: [],
});
const products = [product("pieza-a", "OEM-A"), product("pieza-b", "OEM-B")];
const catalog = { schemaVersion: 1, products };
const params = () =>
  new URLSearchParams({
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    privacyVersion: "fixture-v1",
    privacyAccepted: "yes",
    name: "Fixture",
    channel: "email",
    value: "fixture@example.com",
    slug: "pieza-a",
    quantity: "2",
    code2: "INDICADA",
    brand2: "",
    application2: "",
    quantity2: "3",
  });

test("selección GET conserva fichas/cantidades autorizadas y rechaza contactos, ambigüedad o repetición", () => {
  const approved = validateCatalog(catalog);
  const selection = leadSelection(
    approved,
    new URLSearchParams({
      producto: "pieza-a",
      cantidad: "2",
      piezas: "OEM-B | 3\nOEM-A | 4",
    }),
  );
  assert.deepEqual(selection.items, [
    { kind: "catalog", slug: "pieza-a", quantity: 6 },
    { kind: "catalog", slug: "pieza-b", quantity: 3 },
  ]);
  assert.deepEqual(leadSelection(approved, new URLSearchParams()), {
    items: [],
  });
  assert.equal(
    leadSelection(approved, new URLSearchParams("producto=privado")),
    null,
  );
  for (const query of [
    "producto=pieza-a&email=privado",
    "producto=pieza-a&cantidad=1&cantidad=2",
    "producto=pieza-a&cantidad=0",
    "producto=pieza-a&piezas=NO-EXISTE+%7C+2",
  ])
    assert.throws(() => leadSelection(approved, new URLSearchParams(query)));
  const withdrawn = validateCatalog({
    schemaVersion: 1,
    products: [{ ...products[0], status: "retired" }],
  });
  assert.equal(
    leadSelection(withdrawn, new URLSearchParams("producto=pieza-a")),
    null,
  );
});

test("POST mixto deriva identidad del catálogo y no acepta identidad falsificada ni ficha retirada", () => {
  const data = params();
  const normalized = validateLead(
    leadFromForm(data.toString()),
    catalog,
    "fixture-v1",
  );
  assert.equal(normalized.items[0].code, "OEM-A");
  assert.equal(normalized.items[0].brand, "Marca fixture");
  assert.equal(normalized.items[1].kind, "reference");
  data.set("code", "FALSO");
  assert.throws(() => leadFromForm(data.toString()));
  data.delete("code");
  data.set("slug", "no-publicado");
  assert.throws(() =>
    validateLead(leadFromForm(data.toString()), catalog, "fixture-v1"),
  );
  data.set("slug", "pieza-a");
  assert.throws(() =>
    validateLead(
      leadFromForm(data.toString()),
      { schemaVersion: 1, products: [] },
      "fixture-v1",
    ),
  );
});

test("HTTP enlaza selección solo con recepción habilitada y revalida catálogo en POST/reintento", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-catalog-form-"));
  let server;
  const received = [];
  const intake = {
    privacyApproved: false,
    privacyVersion: "fixture-v1",
    privacyText: "Aviso fixture aislado",
    key: Buffer.alloc(32, 1),
    origin: "http://127.0.0.1",
    receive: async (lead) => received.push(lead),
  };
  try {
    await build(directory, pagesForCatalog(products), products);
    server = await createPreviewServer(directory, { intake });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    intake.origin = base;
    assert.equal(
      (await fetch(base + "/solicitar?producto=pieza-a")).status,
      503,
    );
    assert.ok(
      !(
        await (await fetch(base + "/cotizar?producto=pieza-a")).text()
      ).includes("Continuar al formulario"),
    );
    intake.privacyApproved = true;
    const inquiry = await (
      await fetch(base + "/cotizar?producto=pieza-a&cantidad=2")
    ).text();
    assert.ok(inquiry.includes("Continuar al formulario"));
    assert.ok(inquiry.includes("Todavía no se ha enviado"));
    const form = await fetch(
      base + "/solicitar?producto=pieza-a&cantidad=2&piezas=OEM-B%20%7C%203",
    );
    assert.equal(form.status, 200);
    const html = await form.text();
    assert.ok(html.includes('name="slug" value="pieza-a"'));
    assert.ok(html.includes('name="slug2" value="pieza-b"'));
    assert.ok(html.includes('readonly value="OEM-A"'));
    assert.equal(
      (await fetch(base + "/solicitar?producto=pieza-a&name=privado")).status,
      400,
    );
    assert.equal(
      (await fetch(base + "/solicitar?producto=pieza-a&cantidad=1&cantidad=2"))
        .status,
      400,
    );
    assert.equal(
      (await fetch(base + "/solicitar?producto=privado")).status,
      404,
    );
    const data = params();
    const post = () =>
      fetch(base + "/solicitudes", {
        method: "POST",
        headers: {
          Origin: base,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: data.toString(),
      });
    assert.equal((await post()).status, 202);
    assert.deepEqual(
      received[0].items.map((item) => item.code),
      ["OEM-A", "INDICADA"],
    );
    data.set("code", "FALSO");
    assert.equal((await post()).status, 400);
    data.delete("code");
    intake.receive = async () => {
      throw new Error("Fallo fixture");
    };
    const failed = await post();
    assert.equal(failed.status, 503);
    const failedHtml = await failed.text();
    assert.ok(failedHtml.includes(data.get("requestId")));
    assert.ok(failedHtml.includes('name="slug" value="pieza-a"'));
    assert.ok(failedHtml.includes('value="INDICADA"'));
    // Withdrawal between rendering and submitting never becomes a free reference.
    await writeFile(
      join(directory, "search-catalog.json"),
      JSON.stringify({
        schemaVersion: 1,
        products: [{ ...products[0], status: "retired" }, products[1]],
      }),
    );
    assert.equal(
      (await fetch(base + "/solicitar?producto=pieza-a")).status,
      404,
    );
    const removed = await post();
    assert.equal(removed.status, 400);
    assert.ok(
      (await removed.text()).includes("Esta ficha ya no está disponible"),
    );
    assert.equal(received.length, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("GET del formulario condicionado comparte cuota antes de resolver la selección", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rtt-form-quota-"));
  let server;
  try {
    await build(directory);
    server = await createPreviewServer(directory, {
      requestLimits: { requests: 1 },
      intake: {
        privacyApproved: true,
        privacyVersion: "fixture-v1",
        privacyText: "Aviso fixture",
        key: Buffer.alloc(32, 1),
        receive: async () => {},
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + "/solicitar")).status, 200);
    const rejected = await fetch(base + "/solicitar");
    assert.equal(rejected.status, 429);
    assert.ok(Number(rejected.headers.get("Retry-After")) >= 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
