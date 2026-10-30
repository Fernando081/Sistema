import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { businessPages } from "../business.mjs";
const base = JSON.parse(
  await readFile(new URL("../business.json", import.meta.url), "utf8"),
);
const render = (input) =>
  businessPages(
    input,
    (_url, _title, body) => body,
    () => "",
  ).get("/contacto");
test("Organization solo incluye identidad del negocio y contactos confirmados", () => {
  const input = structuredClone(base);
  input.contact.phone = { value: "+521234567890", confirmed: false };
  input.contact.email = { value: "fixture@empresa.example", confirmed: false };
  input.contact.address = {
    value: 'Dirección "revisada" <fixture>',
    confirmed: false,
  };
  input.contact.serviceArea = { value: "Zona de prueba", confirmed: false };
  let html = render(input);
  assert.match(html, /itemtype="https:\/\/schema.org\/Organization"/);
  assert.match(
    html,
    /itemprop="name" content="Refacciones y Tractorepuestos Tampico"/,
  );
  assert.doesNotMatch(
    html,
    /521234567890|fixture@|Dirección|Zona de prueba|itemprop="telephone"|itemprop="address"/,
  );
  for (const field of ["phone", "email", "address", "serviceArea"])
    input.contact[field].confirmed = true;
  html = render(input);
  assert.match(html, /itemprop="telephone" content="\+521234567890"/);
  assert.match(html, /itemprop="email" content="fixture@empresa.example"/);
  assert.match(
    html,
    /itemprop="address">Dirección &quot;revisada&quot; &lt;fixture&gt;/,
  );
  assert.match(html, /itemprop="areaServed">Zona de prueba/);
  assert.doesNotMatch(
    html,
    /itemprop="(?:legalName|taxID|logo|sameAs|aggregateRating|openingHours)"|<script(?! src="\/assets\/site\.js" defer><\/script>)/,
  );
});
