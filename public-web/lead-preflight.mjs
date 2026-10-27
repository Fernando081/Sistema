import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createLeadBridge, bridgePath } from "./lead-bridge.mjs";

// Authentication only. Never sends a contact or inserts an artificial lead.
export function createBridgePreflight(origin, signingKey, fingerprintKey, keyId) {
  createLeadBridge(origin, signingKey, { keyId }); // Same loopback/destination rules.
  if (!Buffer.isBuffer(fingerprintKey) || fingerprintKey.length < 32 || signingKey.equals(fingerprintKey))
    throw new Error("Comprobación del puente: configuración inválida");
  const signer = Buffer.from(signingKey), stable = Buffer.from(fingerprintKey);
  return async (privacyVersion) => {
    if (typeof privacyVersion !== "string" || !privacyVersion.trim() || privacyVersion.length > 80)
      throw new Error("Comprobación del puente: configuración inválida");
    const nonce = randomBytes(32).toString("hex");
    const timestamp = String(Date.now());
    const body = JSON.stringify({ schemaVersion: 1, nonce, privacyVersion,
      fingerprintProof: createHmac("sha256", stable).update(`web-lead-fingerprint-check-v1\n${nonce}\n${privacyVersion}`).digest("hex") });
    const response = await fetch(origin + bridgePath + "/check", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", "X-Web-Key-Id": keyId, "X-Web-Timestamp": timestamp,
        "X-Web-Signature": createHmac("sha256", signer).update(`web-lead-check-v2\n${keyId}\n${timestamp}\n${body}`).digest("hex") }, body,
    });
    const invalid = () => new Error("Comprobación del puente: no confirmada");
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json") ||
      response.headers.get("cache-control") !== "no-store" || response.headers.get("x-web-timestamp") !== timestamp)
      throw invalid();
    const signature = response.headers.get("x-web-signature");
    if (!/^[a-f0-9]{64}$/.test(signature || "")) throw invalid();
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 4096) throw invalid(); // for-await closes the stream on early exit.
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const expected = createHmac("sha256", signer).update(`web-lead-check-response-v2\n${keyId}\n${timestamp}\n${raw}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw invalid();
    let receipt;
    try { receipt = JSON.parse(raw); } catch { throw invalid(); }
    if (!receipt || Object.keys(receipt).sort().join(",") !== "checked,inboxDays,nonce,privacyVersion" ||
      receipt.checked !== true || receipt.nonce !== nonce || receipt.privacyVersion !== privacyVersion || receipt.inboxDays !== 90)
      throw invalid();
    return { checked: true };
  };
}
