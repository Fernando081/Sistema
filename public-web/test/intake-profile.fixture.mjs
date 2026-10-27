import { createHash } from "node:crypto";
export function profileFixture(origin = "http://127.0.0.1:4500", bridgeOrigin = "http://127.0.0.1:3100", keyId = "fixture-3", version = "fixture-v1") {
  const text = "Aviso fixture aislado. No es una política operativa ni aprobación comercial.";
  return { schemaVersion: 1, enabled: true, mode: "local", origin, bridgeOrigin, keyId,
    privacy: { approved: true, version, text, textSha256: createHash("sha256").update(text).digest("hex"),
      reviewer: "Revisor fixture", reviewedAt: "2026-01-01T00:00:00.000Z" },
    retention: { approved: true, inboxDays: 90, crmPolicy: "Política CRM fixture declarada",
      metadataPolicy: "Política metadatos fixture declarada", backupPolicy: "Política respaldos fixture declarada",
      reviewer: "Revisor fixture", reviewedAt: "2026-01-01T00:00:00.000Z" } };
}
