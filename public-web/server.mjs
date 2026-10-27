import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { root, shell as baseShell, heading } from "./build.mjs";
import { validateCatalog } from "./catalog.mjs";
import { searchHtml } from "./search.mjs";
import { inquiryHtml } from "./inquiry.mjs";
import { freeInquiryHtml } from "./free-inquiry.mjs";
import { validateRedirects } from "./redirects.mjs";
import { createRequestLimits } from "./request-limits.mjs";
import { dynamicResponse } from "./response-budget.mjs";
import { sendError as baseSendError } from "./error-pages.mjs";
import { previewContextHtml, validatePreviewMode, TEST_PILOT_MODE } from "./preview-context.mjs";
import { receiveLeadHttp } from "./lead-intake.mjs";
import { leadFormHtml } from "./lead-form.mjs";
import { leadSelection } from "./lead-selection.mjs";
import { loadIntakeProfile, prepareIntakeProfile } from "./intake-profile.mjs";
export async function createPreviewServer(
  directory = join(root, "dist"),
  options = {},
) {
  validatePreviewMode(options.previewMode);
  if (options.previewMode === TEST_PILOT_MODE && options.intake)
    throw new Error("El piloto de prueba mantiene captación cerrada");
  const shell = (...args) => previewContextHtml(baseShell(...args), options.previewMode);
  const sendError = (req, res, status, rules = {}) => baseSendError(req, res, status, { ...rules, previewMode: options.previewMode });
  const limitRequest = createRequestLimits(options.requestLimits);
  async function snapshot() {
    let selected = directory;
    try {
      const pointer = JSON.parse(
        await readFile(join(directory, "current-release.json"), "utf8"),
      );
      if (
        typeof pointer.release !== "string" ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(pointer.release)
      )
        throw new Error("Versión inválida");
      selected = join(directory, "releases", pointer.release);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const manifest = JSON.parse(
      await readFile(join(selected, "routes.json"), "utf8"),
    );
    let redirects = { schemaVersion: 1, entries: [] };
    try {
      redirects = validateRedirects(
        JSON.parse(
          await readFile(join(selected, "redirect-routes.json"), "utf8"),
        ),
        new Map(Object.keys(manifest).map((route) => [route, true])),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return {
      selected,
      redirects,
      manifest,
      notFound: await readFile(join(selected, manifest["/404"])),
    };
  }
  await snapshot();
  return createServer(async (req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const formEnabled =
      options.intake?.privacyApproved === true &&
      typeof options.intake.privacyText === "string" &&
      options.intake.privacyText.trim() &&
      options.intake.privacyText.length <= 10000 &&
      typeof options.intake.receive === "function" &&
      Buffer.isBuffer(options.intake.key) &&
      options.intake.key.length >= 32 &&
      typeof options.intake.privacyVersion === "string" &&
      options.intake.privacyVersion;
    if (
      ["GET", "HEAD"].includes(req.method) &&
      req.url?.split("?")[0] === "/solicitar"
    ) {
      if (!formEnabled) {
        sendError(req, res, 503);
        return;
      }
      const result = limitRequest(req.socket.remoteAddress ?? "unknown");
      if (result.status !== 200) {
        res.setHeader("Retry-After", result.retryAfter);
        sendError(req, res, result.status, { retryAfter: result.retryAfter });
        return;
      }
      let config, input, selected;
      try {
        if (Buffer.byteLength(req.url) > 8192) {
          sendError(req, res, 414);
          return;
        }
        ({ selected } = await snapshot());
        const catalog = JSON.parse(
          await readFile(join(selected, "search-catalog.json"), "utf8"),
        );
        validateCatalog(catalog);
        config = { ...options.intake, catalog };
      } catch {
        sendError(req, res, 503);
        return;
      }
      try {
        input = leadSelection(
          validateCatalog(config.catalog),
          new URL(req.url, "http://localhost").searchParams,
        );
        if (input === null) {
          sendError(req, res, 404);
          return;
        }
      } catch {
        sendError(req, res, 400);
        return;
      }
      try {
        res.setHeader("Referrer-Policy", "same-origin");
        const body = dynamicResponse(
          leadFormHtml(config, input, null, shell, heading),
          await readFile(join(selected, "assets/site.css")),
        );
        res.setHeader("Content-Length", body.length);
        res.writeHead(200);
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        sendError(req, res, 503);
      }
      return;
    }
    if (req.method === "POST" && req.url === "/solicitudes") {
      const result = limitRequest(req.socket.remoteAddress ?? "unknown");
      if (result.status !== 200) {
        res.setHeader("Retry-After", result.retryAfter);
        sendError(req, res, result.status, { retryAfter: result.retryAfter });
        return;
      }
      let intake;
      if (options.intake) {
        try {
          const { selected } = await snapshot();
          intake = {
            ...options.intake,
            catalog: JSON.parse(
              await readFile(join(selected, "search-catalog.json"), "utf8"),
            ),
          };
          if (formEnabled) {
            const css = await readFile(join(selected, "assets/site.css"));
            intake.renderResult = (input, status) =>
              dynamicResponse(
                leadFormHtml(intake, input, status, shell, heading),
                css,
              );
          }
        } catch {
          intake = undefined;
        }
      }
      await receiveLeadHttp(req, res, intake);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      sendError(req, res, 405);
      return;
    }
    try {
      if (Buffer.byteLength(req.url ?? "") > 8192) {
        sendError(req, res, 414);
        return;
      }
      if (!req.url?.startsWith("/") || req.url.startsWith("//"))
        throw new Error("URL inválida");
      const requestUrl = new URL(req.url, "http://localhost");
      const pathname = requestUrl.pathname;
      if (
        ["/buscar", "/cotizar", "/consulta"].includes(
          pathname.replace(/\/$/, ""),
        )
      ) {
        const result = limitRequest(req.socket.remoteAddress ?? "unknown");
        if (result.status !== 200) {
          res.setHeader("Retry-After", result.retryAfter);
          sendError(req, res, result.status, { retryAfter: result.retryAfter });
          return;
        }
      }
      const { selected, manifest, notFound, redirects } = await snapshot();
      if (
        ["/buscar/", "/cotizar/", "/consulta/"].includes(pathname) &&
        (pathname !== "/consulta/" || Object.hasOwn(manifest, "/consulta")) &&
        Object.hasOwn(manifest, "/buscar")
      ) {
        res.writeHead(308, {
          Location: pathname.slice(0, -1) + requestUrl.search,
        });
        res.end();
        return;
      }
      const redirect = redirects.entries.find(
        (entry) => entry.from === pathname.replace(/\/$/, ""),
      );
      if (pathname === "/consulta" && Object.hasOwn(manifest, "/consulta")) {
        const business = JSON.parse(
          await readFile(join(selected, "inquiry-business.json"), "utf8"),
        );
        const body = dynamicResponse(
          freeInquiryHtml(business, requestUrl.searchParams, shell, heading),
          await readFile(join(selected, "assets/site.css")),
        );
        res.setHeader("Content-Length", body.length);
        res.writeHead(200);
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      if (redirect) {
        res.writeHead(308, { Location: redirect.to });
        res.end();
        return;
      }
      if (pathname === "/cotizar" && Object.hasOwn(manifest, "/buscar")) {
        const products = validateCatalog(
          JSON.parse(
            await readFile(join(selected, "search-catalog.json"), "utf8"),
          ),
        );
        const business = JSON.parse(
          await readFile(join(selected, "inquiry-business.json"), "utf8"),
        );
        const html = inquiryHtml(
          products,
          business,
          requestUrl.searchParams,
          shell,
          heading,
          { intakeEnabled: Boolean(formEnabled) },
        );
        const body =
          html === null
            ? notFound
            : dynamicResponse(
                html,
                await readFile(join(selected, "assets/site.css")),
              );
        res.setHeader("Content-Length", body.length);
        res.writeHead(html === null ? 404 : 200);
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      if (pathname === "/buscar" && Object.hasOwn(manifest, "/buscar")) {
        const products = validateCatalog(
          JSON.parse(
            await readFile(join(selected, "search-catalog.json"), "utf8"),
          ),
        );
        const body = dynamicResponse(
          searchHtml(products, requestUrl.searchParams, shell, heading),
          await readFile(join(selected, "assets/site.css")),
        );
        res.setHeader("Content-Length", body.length);
        res.writeHead(200);
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
      if (normalized in manifest && pathname !== normalized) {
        res.writeHead(308, { Location: normalized });
        res.end();
        return;
      }
      const filename = Object.hasOwn(manifest, normalized)
        ? manifest[normalized]
        : null;
      const status = !filename || normalized === "/404" ? 404 : 200;
      const body = filename
        ? await readFile(join(selected, filename))
        : notFound;
      if (normalized === "/assets/site.css")
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      if (normalized === "/assets/logo-rtt.jpg")
        res.setHeader("Content-Type", "image/jpeg");
      if (normalized === "/robots.txt")
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      if (normalized === "/sitemap.xml")
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
      if (
        filename &&
        normalized.startsWith("/media/") &&
        normalized.endsWith(".png")
      )
        res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", body.length);
      res.writeHead(status);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (error.code === "PUBLIC_RESPONSE_BUDGET") {
        sendError(req, res, 503, { budget: true });
        return;
      }
      sendError(
        req,
        res,
        typeof error.code === "string" && error.code.startsWith("E")
          ? 500
          : 400,
      );
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Usa Node.js 24");
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !arg.startsWith("--capture-profile=") || arg === "--capture-profile="))
    throw new Error("Opciones de preview inválidas");
  let intake, profile;
  if (args.length) {
    profile = await loadIntakeProfile(args[0].slice(18));
  }
  const profilePort = profile ? Number(new URL(profile.origin).port) : undefined;
  if (profilePort && process.env.PUBLIC_WEB_PORT && Number(process.env.PUBLIC_WEB_PORT) !== profilePort)
    throw new Error("Puerto y origen del perfil no coinciden");
  const port = profilePort ?? Number(process.env.PUBLIC_WEB_PORT ?? 4500);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Puerto inválido");
  if (profile) intake = await prepareIntakeProfile(profile);
  const server = await createPreviewServer(undefined, { intake });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Vista previa local: http://127.0.0.1:${port}; captura ${intake ? "local declarada" : "cerrada"}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
