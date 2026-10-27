import { readFile, writeFile } from "node:fs/promises";
const drill = JSON.parse(await readFile(new URL("web-preview-drill.json", import.meta.url), "utf8"));
const filename = drill.backup?.filename;
if (drill.status !== "verified-installed-preview" || !/^web-preview-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(filename)) throw new Error("Ensayo confirmado requerido");
const requests = [
  ["GET", "http://127.0.0.1:4500/", 200],
  ["GET", "http://127.0.0.1:4300/login", 200],
  ["GET", "http://127.0.0.1:3100/api/v1/health", 200],
  ["GET", "http://127.0.0.1:4500/solicitar", 503],
  ["POST", "http://127.0.0.1:3100/api/v1/web-lead-bridge/check", 503],
  ["GET", "http://127.0.0.1:4500/preview-recovery-drill.mjs", 404],
  ["GET", "http://127.0.0.1:4500/check-saved-backup.mjs", 404],
  ["GET", "http://127.0.0.1:4500/.artifacts/web-preview-drill.json", 404],
  ["GET", "http://127.0.0.1:4500/.backups/" + filename, 404],
];
const results = await Promise.allSettled(requests.map(async ([method, url, expected]) => {
  const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(5000),
    ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
  await response.body?.cancel();
  return { method, url, expected, status: response.status, passed: response.status === expected };
}));
const probes = results.map((result, i) => result.status === "fulfilled" ? result.value :
  { method: requests[i][0], url: requests[i][1], expected: requests[i][2], passed: false });
const passed = probes.filter(probe => probe.passed).length;
await writeFile(new URL("web-preview-drill-live.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(),
  scope: "HTTP local sin credenciales, captación, aceptación comercial o escritura de negocio", passed, total: probes.length, probes }, null, 2));
console.log(`Sondeos locales: ${passed}/${probes.length}.`);
if (passed !== probes.length) process.exitCode = 1;
