import { createHmac } from "node:crypto";
export const bridgePath = "/api/v1/web-lead-bridge";
export function createLeadBridge(origin, key, options = {}) {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !Buffer.isBuffer(key) ||
    key.length < 32 ||
    !options || typeof options !== 'object' || Array.isArray(options) ||
    Object.keys(options).some(name => name !== 'keyId') ||
    (Object.hasOwn(options, 'keyId') &&
      (typeof options.keyId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(options.keyId) || options.keyId === 'legacy'))
  )
    throw new Error("Puente local: configuración inválida");
  const secret = Buffer.from(key);
  const keyId = options.keyId;
  return async (lead, fingerprint) => {
    const body = JSON.stringify({ lead, fingerprint });
    if (Buffer.byteLength(body) > 16384)
      throw new Error("Puente local: tamaño inválido");
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(keyId ? `web-lead-v2\n${keyId}\n${timestamp}\n${body}` : `web-lead-v1\n${timestamp}\n${body}`)
      .digest("hex");
    const response = await fetch(origin + bridgePath, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        "X-Web-Timestamp": timestamp,
        "X-Web-Signature": signature,
        ...(keyId ? { "X-Web-Key-Id": keyId } : {}),
      },
      body,
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("application/json")
    )
      throw new Error("Puente local: recepción no confirmada");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 4096) throw new Error("Puente local: respuesta inválida");
      chunks.push(chunk);
    }
    const receipt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (receipt.received !== true || receipt.requestId !== lead.requestId)
      throw new Error("Puente local: recepción no confirmada");
    return { received: true };
  };
}
