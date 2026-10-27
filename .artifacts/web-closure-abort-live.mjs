import { writeFile } from "node:fs/promises";
const requests = [
  ["GET", "http://127.0.0.1:4500/", 200],
  ["GET", "http://127.0.0.1:4300/login", 200],
  ["GET", "http://127.0.0.1:3100/api/v1/health", 200],
  ["GET", "http://127.0.0.1:4500/solicitar", 503],
  ["POST", "http://127.0.0.1:3100/api/v1/web-lead-bridge/check", 503],
  ["GET", "http://127.0.0.1:4500/closure-abort.mjs", 404],
  ["GET", "http://127.0.0.1:4500/.artifacts/web-closure-abort-status.json", 404],
  ["GET", "http://127.0.0.1:4500/publish-aborted-closure-recovery-00000000-0000-4000-8000-000000000000.lock", 404],
  ["GET", "http://127.0.0.1:4500/closure-abort-00000000-0000-4000-8000-000000000000.intent.json", 404]
];
const settled = await Promise.allSettled(requests.map(async ([method, url, expected]) => {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(8000),
    ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
  await response.body?.cancel(); return { method, url, expected, status: response.status, passed: response.status === expected };
}));
const probes = settled.map((result, index) => result.status === "fulfilled" ? result.value :
  { method: requests[index][0], url: requests[index][1], expected: requests[index][2], status: null, passed: false });
const passed = probes.filter(probe => probe.passed).length;
await writeFile(new URL("web-closure-abort-live.json", import.meta.url), JSON.stringify({ schemaVersion: 1,
  createdAt: new Date().toISOString(), nodeVersion: process.versions.node, scope: "HTTP local; sin escritura de negocio, credenciales o aceptación comercial",
  passed, total: probes.length, probes }, null, 2));
console.log(`Sondeos locales: ${passed}/${probes.length}.`);
if (passed !== probes.length) process.exitCode = 1;
