import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkLocalHttp(origin = "http://127.0.0.1:4500") {
  const base = new URL(origin);
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("Solo se permite el preview HTTP en 127.0.0.1");
  const checks = [];
  const cases = [
    ...[
      "/",
      "/catalogo",
      "/categorias",
      "/marcas",
      "/nosotros",
      "/contacto",
      "/buscar",
      "/consulta",
    ].map((path) => [path, "GET", 200, "text/html"]),
    ["/assets/site.css", "GET", 200, "text/css"],
    ["/robots.txt", "GET", 200, "text/plain"],
    ["/assets/logo-rtt.jpg", "GET", 200, "image/jpeg"],
    ["/consulta", "HEAD", 200, "text/html"],
    [
      "/consulta?parte=HTTP-CHECK&cantidad=0",
      "GET",
      200,
      "text/html",
      { alert: true },
    ],
    ["/consulta?parte=A&parte=B", "GET", 400, "text/html"],
    ["/buscar?page=0", "GET", 400, "text/html"],
    ["/cotizar", "GET", 404, "text/html"],
    [
      "/consulta/?parte=HTTP-CHECK&cantidad=2",
      "GET",
      308,
      "text/html",
      { location: "/consulta?parte=HTTP-CHECK&cantidad=2" },
    ],
    [
      "/buscar/?q=HTTP-CHECK",
      "GET",
      308,
      "text/html",
      { location: "/buscar?q=HTTP-CHECK" },
    ],
    ["/consulta", "POST", 405, "text/html", { allow: "GET, HEAD" }],
    ...[
      "/current-release.json",
      "/approval.json",
      "/search-catalog.json",
      "/inquiry-business.json",
      "/integrity.json",
      "/business.json",
      "/routes.json",
      "/.env",
      "/ruta-inexistente-prueba-http",
    ].map((path) => [path, "GET", 404, "text/html"]),
    ["/", "HEAD", 200, "text/html"],
  ];
  for (const [path, method, expected, type, rules = {}] of cases) {
    try {
      const response = await fetch(new URL(path, base), {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      const failures = [];
      if (response.status !== expected) failures.push("status");
      if (!response.headers.get("content-type")?.startsWith(type))
        failures.push("content-type");
      if (rules.location && response.headers.get("location") !== rules.location)
        failures.push("redirect-location");
      if (rules.allow && response.headers.get("allow") !== rules.allow)
        failures.push("allow");
      for (const [header, value] of Object.entries({
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      }))
        if (response.headers.get(header) !== value) failures.push(header);
      const csp = response.headers.get("content-security-policy") ?? "";
      if (
        ![
          "default-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
        ].every((rule) => csp.split(";").some((part) => part.trim() === rule))
      )
        failures.push("content-security-policy");
      let bytes = 0;
      const chunks = [];
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > (type === "image/jpeg" ? 350000 : 65536)) {
              failures.push("body-limit");
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const buffer = Buffer.concat(chunks);
      const body = type === "image/jpeg" ? "" : buffer.toString("utf8");
      if (
        type === "image/jpeg" &&
        (buffer.length < 3 ||
          buffer[0] !== 0xff ||
          buffer[1] !== 0xd8 ||
          buffer[2] !== 0xff)
      )
        failures.push("jpeg-signature");
      if (
        rules.alert &&
        (!body.includes('role="alert"') || /class="contact-actions"/.test(body))
      )
        failures.push("invalid-inquiry-actions");
      if (method === "HEAD" && bytes !== 0) failures.push("head-body");
      if (path === "/robots.txt" && !/^Disallow:\s*\/$/m.test(body))
        failures.push("robots-block");
      if (
        type === "text/html" &&
        method === "GET" &&
        expected !== 308 &&
        (!/<h1[\s>]/i.test(body) ||
          !body.includes("Refacciones y Tractorepuestos"))
      )
        failures.push("html-identity");
      checks.push({
        path,
        method,
        status: response.status,
        bytes,
        passed: failures.length === 0,
        failures,
      });
    } catch {
      checks.push({
        path,
        method,
        passed: false,
        failures: ["connection-or-timeout"],
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    origin: base.origin,
    status: checks.every((check) => check.passed) ? "passed-local" : "failed",
    checks,
    scope:
      "HTTP local; no certifica integridad de versión, fotos comerciales, accesibilidad visual, hosting ni aceptación",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Usa Node.js 24");
  if (process.argv.length !== 2) throw new Error("Argumento inválido");
  const report = await checkLocalHttp();
  const output = fileURLToPath(new URL("../.artifacts/", import.meta.url));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "web-http-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `HTTP web: ${report.status}; ${report.checks.filter((check) => check.passed).length}/${report.checks.length}. Reporte: .artifacts/web-http-check.json`,
  );
  if (report.status !== "passed-local") process.exitCode = 1;
}
