import { validateLead, leadFingerprint } from "./lead-contract.mjs";
import { leadFromForm } from "./lead-form.mjs";

const failure = (status) =>
  Object.assign(new Error("Solicitud no procesada"), { status });

// Trusted configuration only. Expiry means no confirmation, not a rollback:
// the receiver may still commit, so callers must preserve the same request ID.
async function receiveWithDeadline(config, lead, fingerprint, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => config.receive(lead, fingerprint)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure(503)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(req, allowForm) {
  const form =
    allowForm &&
    /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(
      req.headers["content-type"] || "",
    );
  if (
    req.headers["content-encoding"] ||
    (!form &&
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        req.headers["content-type"] || "",
      ))
  )
    throw failure(415);
  if (Number(req.headers["content-length"] || 0) > 16384) throw failure(413);
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data);
      req.off("end", end);
      req.off("error", error);
      req.off("aborted", aborted);
    };
    const fail = (status) => {
      cleanup();
      req.pause();
      reject(failure(status));
    };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > 16384) fail(413);
      else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const error = () => fail(400);
    const aborted = () => fail(400);
    const timer = setTimeout(() => fail(408), 5000);
    req.on("data", data);
    req.on("end", end);
    req.on("error", error);
    req.on("aborted", aborted);
  });
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return form ? leadFromForm(text) : JSON.parse(text);
  } catch {
    throw failure(400);
  }
}

// Only explicit server-side configuration enables intake. No environment switch
// or client-supplied privacy policy can enable it.
export async function receiveLeadHttp(req, res, config) {
  let status = 503;
  let input;
  try {
    const timeoutMs =
      config?.storageTimeoutMs === undefined ? 5000 : config.storageTimeoutMs;
    if (
      !config ||
      config.privacyApproved !== true ||
      !config.privacyVersion ||
      typeof config.receive !== "function" ||
      !Buffer.isBuffer(config.key) ||
      config.key.length < 32 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 5000
    )
      throw failure(503);
    const origin = new URL(config.origin);
    if (
      origin.origin !== config.origin ||
      origin.username ||
      origin.password ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw failure(503);
    if (
      req.headers.origin !== config.origin ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw failure(403);
    input = await readJson(req, typeof config.renderResult === "function");
    let lead, fingerprint;
    try {
      lead = validateLead(input, config.catalog, config.privacyVersion);
      fingerprint = leadFingerprint(
        input,
        config.catalog,
        config.privacyVersion,
        config.key,
      );
    } catch {
      throw failure(400);
    }
    try {
      await receiveWithDeadline(config, lead, fingerprint, timeoutMs);
    } catch {
      throw failure(503);
    }
    status = 202;
  } catch (error) {
    status = error.status || 503;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "close");
  if (
    req.headers["content-type"]?.startsWith(
      "application/x-www-form-urlencoded",
    ) &&
    typeof config?.renderResult === "function"
  ) {
    try {
      const rendered = config.renderResult(input, status);
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.writeHead(status);
      res.end(rendered);
      return;
    } catch {
      status = 503;
    }
  }
  res.writeHead(status);
  res.end(
    JSON.stringify(status === 202 ? { received: true } : { received: false }),
  );
}
