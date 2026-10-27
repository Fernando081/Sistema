import { createHmac } from "node:crypto";
import { validateCatalog } from "./catalog.mjs";

function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Solicitud web: contrato inválido");
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Solicitud web: texto inválido");
  return value.trim();
}

// Foundation only: no HTTP endpoint, storage, client lookup or external delivery.
export function validateLead(input, catalog, privacyVersion) {
  exact(input, ["schemaVersion", "requestId", "contact", "items", "privacy"]);
  if (
    input.schemaVersion !== 1 ||
    typeof input.requestId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.requestId,
    )
  )
    throw new Error("Solicitud web: identificador inválido");
  const policy = text(privacyVersion, 80);
  exact(input.privacy, ["accepted", "version"]);
  if (input.privacy.accepted !== true || input.privacy.version !== policy)
    throw new Error("Solicitud web: aviso pendiente de aceptación");
  exact(input.contact, ["name", "channel", "value"]);
  const name = text(input.contact.name, 120);
  const channel = input.contact.channel;
  let value = text(input.contact.value, 254);
  if (channel === "email") {
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value))
      throw new Error("Solicitud web: contacto inválido");
    const at = value.lastIndexOf("@");
    value = value.slice(0, at) + value.slice(at).toLowerCase();
  } else if (channel === "phone" || channel === "whatsapp") {
    if (!/^\+[1-9][0-9]{7,14}$/.test(value))
      throw new Error("Solicitud web: contacto inválido");
  } else throw new Error("Solicitud web: canal inválido");
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 10
  )
    throw new Error("Solicitud web: tamaño inválido");
  const products = validateCatalog(catalog);
  const identities = new Set();
  const items = input.items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 9999
    )
      throw new Error("Solicitud web: cantidad inválida");
    let normalized;
    if (item.kind === "catalog") {
      exact(item, ["kind", "slug", "quantity"]);
      const product = products.find((product) => product.slug === item.slug);
      if (!product) throw new Error("Solicitud web: pieza no publicable");
      normalized = {
        kind: "catalog",
        slug: product.slug,
        code: product.code,
        brand: product.brand,
        quantity: item.quantity,
      };
    } else if (item.kind === "reference") {
      exact(item, ["kind", "code", "brand", "application", "quantity"]);
      const optional = (value, max) => (value === "" ? "" : text(value, max));
      normalized = {
        kind: "reference",
        code: text(item.code, 100),
        brand: optional(item.brand, 100),
        application: optional(item.application, 200),
        quantity: item.quantity,
      };
    } else throw new Error("Solicitud web: tipo de pieza inválido");
    const identity =
      normalized.kind === "catalog"
        ? `catalog:${normalized.slug}`
        : JSON.stringify([
            "reference",
            normalized.code,
            normalized.brand,
            normalized.application,
          ]);
    if (identities.has(identity))
      throw new Error("Solicitud web: pieza duplicada");
    identities.add(identity);
    return normalized;
  });
  return {
    schemaVersion: 1,
    requestId: input.requestId.toLowerCase(),
    origin: "public-web",
    contact: { name, channel, value },
    items,
    privacy: { accepted: true, version: policy },
  };
}

// Same request ID + same fingerprint is a retry. Same ID + different fingerprint
// must be rejected by the future transactional store. Never log this payload.
export function leadFingerprint(input, catalog, privacyVersion, key) {
  if (!Buffer.isBuffer(key) || key.length < 32)
    throw new Error("Solicitud web: clave privada inválida");
  const lead = validateLead(input, catalog, privacyVersion);
  const { requestId, ...payload } = lead;
  return createHmac("sha256", key)
    .update(JSON.stringify(payload))
    .digest("hex");
}
