import { createHash } from "node:crypto";
export async function verifyErpReceipt(raw, receipt, options = {}) {
  return verifyErpReceiptHash(
    createHash("sha256").update(raw).digest("hex"),
    receipt,
    options,
  );
}
export async function verifyErpReceiptHash(sha256, receipt, options = {}) {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error("Hash ERP inválido");
  const batch = receipt?.scope === "batch";
  if (
    !receipt ||
    (receipt.scope !== undefined &&
      !["batch", "product"].includes(receipt.scope)) ||
    (!batch &&
      (!Number.isSafeInteger(receipt.productId) || receipt.productId < 1)) ||
    !Number.isSafeInteger(receipt.receiptId) ||
    receipt.receiptId < 1
  )
    throw new Error("Recibo ERP inválido");
  const base = new URL(
    options.baseUrl ??
      process.env.PUBLIC_WEB_ERP_URL ??
      "http://127.0.0.1:3100/api/v1/",
  );
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/api/v1/"
  )
    throw new Error("Solo se permite ERP local 127.0.0.1 con base /api/v1/");
  const token = options.token ?? process.env.PUBLIC_WEB_ERP_TOKEN;
  if (typeof token !== "string" || !token.trim())
    throw new Error("Se requiere sesión ERP en variable de entorno");
  const request = options.fetchImpl ?? fetch;
  const response = await request(
    new URL(
      batch
        ? `web-catalog/admin/products/batch/approvals/${receipt.receiptId}`
        : `web-catalog/admin/products/${receipt.productId}/approvals/${receipt.receiptId}`,
      base,
    ),
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw new Error("ERP no confirmó el recibo; no se activa versión");
  const status = await response.json();
  if (
    status.active !== true ||
    status.revoked !== false ||
    (!batch && status.productId !== receipt.productId) ||
    status.receiptId !== receipt.receiptId ||
    status.sha256 !== sha256 ||
    (batch
      ? status.scope !== "batch" ||
        !Number.isInteger(status.productCount) ||
        status.productCount < 1 ||
        status.productCount > 25
      : !Number.isSafeInteger(status.version) || status.version < 1)
  )
    throw new Error("Recibo ERP no vigente o manifiesto distinto");
  return {
    scope: batch ? "batch" : "product",
    productId: status.productId,
    receiptId: status.receiptId,
    version: status.version,
    sha256,
  };
}
