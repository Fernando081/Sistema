import { limits } from "./budget.mjs";

export function dynamicResponse(html, css) {
  const body = Buffer.from(html);
  if (
    css.length > limits.cssBytes ||
    body.length + css.length > limits.initialBytes
  ) {
    const error = new Error("Respuesta pública supera presupuesto inicial");
    error.code = "PUBLIC_RESPONSE_BUDGET";
    throw error;
  }
  return body;
}
