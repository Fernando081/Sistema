import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLeadBridge } from "./lead-bridge.mjs";
import { createBridgePreflight } from "./lead-preflight.mjs";

const invalid = () => new Error("Perfil de captura inválido o incompleto");
const root = dirname(fileURLToPath(import.meta.url));
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw invalid();
}
function text(value, max) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid();
}
function localOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== value || url.username || url.password ||
      !Number.isInteger(Number(url.port)) || Number(url.port) < 1024 || Number(url.port) > 65535) throw invalid();
  } catch { throw invalid(); }
}
function reviewed(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value && time <= Date.now();
}
export function validateIntakeProfile(input) {
  exact(input, ["schemaVersion", "enabled", "mode", "origin", "bridgeOrigin", "keyId", "privacy", "retention"]);
  if (input.schemaVersion !== 1 || typeof input.enabled !== "boolean" || input.mode !== "local") throw invalid();
  localOrigin(input.origin); localOrigin(input.bridgeOrigin);
  if (input.origin === input.bridgeOrigin) throw invalid();
  text(input.keyId, 48);
  exact(input.privacy, ["approved", "version", "text", "textSha256", "reviewer", "reviewedAt"]);
  exact(input.retention, ["approved", "inboxDays", "crmPolicy", "metadataPolicy", "backupPolicy", "reviewer", "reviewedAt"]);
  if (typeof input.privacy.approved !== "boolean" || typeof input.retention.approved !== "boolean" || input.retention.inboxDays !== 90) throw invalid();
  for (const [field, max] of [["version", 80], ["text", 10000], ["textSha256", 64], ["reviewer", 120], ["reviewedAt", 24]]) text(input.privacy[field], max);
  for (const [field, max] of [["crmPolicy", 2000], ["metadataPolicy", 2000], ["backupPolicy", 2000], ["reviewer", 120], ["reviewedAt", 24]]) text(input.retention[field], max);
  if (input.enabled && (input.privacy.approved !== true || input.retention.approved !== true ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(input.keyId) || input.keyId === "legacy" ||
    !input.privacy.version.trim() || input.privacy.version !== input.privacy.version.trim() || !input.privacy.text.trim() ||
    input.privacy.textSha256 !== createHash("sha256").update(input.privacy.text).digest("hex") ||
    !input.privacy.reviewer.trim() || !reviewed(input.privacy.reviewedAt) || !input.retention.reviewer.trim() || !reviewed(input.retention.reviewedAt) ||
    ["crmPolicy", "metadataPolicy", "backupPolicy"].some(field => !input.retention[field].trim()))) throw invalid();
  return structuredClone(input); // File object cannot mutate the validated runtime snapshot.
}
export async function loadIntakeProfile(path = join(root, "capture-profile.json")) {
  let handle;
  try {
    handle = await open(path, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536) throw invalid();
    // Bounded read even if a local file grows between stat and read.
    const buffer = Buffer.alloc(65537);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > 65536) throw invalid();
    return validateIntakeProfile(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes))));
  } catch { throw invalid(); }
  finally { await handle?.close(); }
}
function key(value) {
  if (typeof value !== "string" || !value || value.length > 4096) throw invalid();
  const result = Buffer.from(value, "base64");
  if (result.length < 32 || result.toString("base64") !== value) throw invalid();
  return result;
}
function runtime(profile, env) {
  if (!profile.enabled) return undefined; // No reads of secrets or requests for closed profile.
  const signing = key(env.PUBLIC_WEB_BRIDGE_KEY), fingerprint = key(env.PUBLIC_WEB_FINGERPRINT_KEY);
  if (signing.equals(fingerprint)) throw invalid();
  return { intake: { privacyApproved: true, privacyVersion: profile.privacy.version,
    privacyText: profile.privacy.text, origin: profile.origin, key: fingerprint, storageTimeoutMs: 5000,
    receive: createLeadBridge(profile.bridgeOrigin, signing, { keyId: profile.keyId }) },
    check: createBridgePreflight(profile.bridgeOrigin, signing, fingerprint, profile.keyId) };
}
// Live handshake checks keys/policy only; it is not a database health or launch certificate.
export async function prepareIntakeProfile(input, env = process.env) {
  const profile = validateIntakeProfile(input);
  const config = runtime(profile, env);
  if (!config) return undefined;
  try { await config.check(profile.privacy.version); } catch { throw new Error("Perfil de captura: puente no confirmado; no iniciar recepción"); }
  return config.intake;
}
export async function checkIntakeProfile(input, env = process.env, online = false) {
  const profile = validateIntakeProfile(input);
  const config = runtime(profile, env);
  if (online && config) {
    try { await config.check(profile.privacy.version); } catch { throw new Error("Perfil de captura: puente no confirmado; no iniciar recepción"); }
  }
  return { schemaVersion: 1, status: !config ? "closed" : online ? "checked-local" : "prepared-local",
    scope: "Configuración local; no certifica aprobación, disponibilidad de BD ni lanzamiento",
    captureStarted: false, backendChecked: !!config && online, privacyDeclared: profile.privacy.approved,
    retentionDeclared: profile.retention.approved, credentialsChecked: !!config };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24) throw invalid();
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--online" && !arg.startsWith("--profile=")) || args.filter(arg => arg.startsWith("--profile=")).length > 1 ||
      args.filter(arg => arg === "--online").length > 1 || args.includes("--profile=")) throw invalid();
    const file = args.find(arg => arg.startsWith("--profile="))?.slice(10);
    console.log(JSON.stringify(await checkIntakeProfile(await loadIntakeProfile(file), process.env, args.includes("--online")), null, 2));
  } catch {
    console.error("Perfil de captura: comprobación fallida. Revisa perfil, aprobaciones declaradas y configuración privada; no se muestran valores.");
    process.exitCode = 1;
  }
}
