import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { build, pagesForCatalog, root } from "./build.mjs";
import { validateCatalog } from "./catalog.mjs";
import { createPreviewServer } from "./server.mjs";
import { loadBusiness } from "./business.mjs";

if (Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("Usa Node.js 24");
if (process.argv.length > 2)
  throw new Error("No admite destinos o parámetros externos");
const directory = await mkdtemp(join(tmpdir(), "rtt-web-http-"));
let server;
try {
  const products = validateCatalog({
    schemaVersion: 1,
    products: Array.from({ length: 1000 }, (_, index) => ({
      slug: `fixture-${index}`,
      status: "published",
      approved: true,
      code: `PRUEBA-${index}`,
      brand: "Marca de prueba",
      category: "Familia de prueba",
      title: `Ficha de prueba ${index}`,
      description: "Fixture aislada para medición HTTP, no producto comercial",
      applications: ["Solo medición"],
      references: [],
      specifications: [],
    })),
  });
  await build(
    directory,
    pagesForCatalog(products),
    products,
    join(root, "media-approved"),
    {
      site: { origin: "", confirmed: false },
      redirects: { schemaVersion: 1, entries: [] },
    },
  );
  const business = await loadBusiness();
  for (const contact of Object.values(business.contact)) {
    contact.confirmed = false;
    contact.value = "";
  }
  await writeFile(
    join(directory, "inquiry-business.json"),
    JSON.stringify(business),
  );
  server = await createPreviewServer(directory);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let index = 0; index < 2; index++)
    assert.equal(
      (
        await fetch(`${base}/buscar?q=PRUEBA-${index}`, {
          signal: AbortSignal.timeout(10000),
        })
      ).status,
      200,
    );
  const samples = [];
  let cursor = 0;
  const cpuStart = process.cpuUsage();
  const rssStart = process.memoryUsage().rss;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < 40) {
        const index = cursor++;
        const kind = index % 2 === 0 ? "buscar" : "cotizar";
        const query =
          kind === "buscar"
            ? new URLSearchParams({ q: `PRUEBA-${index}` })
            : new URLSearchParams({
                producto: `fixture-${index}`,
                cantidad: "2",
                piezas: `PRUEBA-${index + 1} | 3\nPRUEBA-${index + 2} | 4`,
              });
        const requestStart = performance.now();
        const response = await fetch(`${base}/${kind}?${query}`, {
          signal: AbortSignal.timeout(10000),
        });
        const html = await response.text();
        assert.equal(response.status, 200, `HTTP ${kind}`);
        assert.match(html, new RegExp(`PRUEBA-${index}(?:[^0-9]|$)`));
        assert.match(html, /noindex,nofollow/);
        if (kind === "cotizar") {
          for (const quantity of [2, 3, 4])
            assert.match(html, new RegExp(`Cantidad: ${quantity}`));
          assert.doesNotMatch(html, /href="https:\/\/wa\.me|href="mailto:/);
        }
        samples.push({
          kind,
          milliseconds: performance.now() - requestStart,
          bytes: Buffer.byteLength(html),
        });
      }
    }),
  );
  const elapsed = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  const summarize = (kind) => {
    const subset = samples.filter((sample) => sample.kind === kind);
    const times = subset
      .map((sample) => sample.milliseconds)
      .sort((a, b) => a - b);
    return {
      requests: subset.length,
      p50Ms: times[Math.ceil(times.length * 0.5) - 1],
      p95Ms: times[Math.ceil(times.length * 0.95) - 1],
      maxMs: times.at(-1),
      maxHtmlBytes: Math.max(...subset.map((sample) => sample.bytes)),
    };
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: process.versions.node,
    scope:
      "Fixtures y loopback; cliente/servidor en mismo proceso. No SLA, carga prolongada, datos comerciales, navegador o hosting distribuido",
    products: products.length,
    requests: samples.length,
    concurrency: 4,
    warmupRequests: 2,
    quota: "Defaults 60/min por conexión, sin elevar límites",
    elapsedMs: elapsed,
    processCpuMs: (cpu.user + cpu.system) / 1000,
    rssBeforeBytes: rssStart,
    rssAfterBytes: process.memoryUsage().rss,
    scenarios: { buscar: summarize("buscar"), cotizar: summarize("cotizar") },
    passed: true,
  };
  const artifacts = resolve(root, "..", ".artifacts");
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    join(artifacts, "web-http-performance.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  const base = resolve(tmpdir());
  const target = resolve(directory);
  if (
    !target.startsWith(base + sep) ||
    !target.slice(base.length + 1).startsWith("rtt-web-http-")
  )
    throw new Error("Directorio temporal fuera del alcance");
  await rm(target, { recursive: true, force: true });
}
