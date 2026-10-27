import { shell, heading } from "./build.mjs";
import { previewContextHtml } from "./preview-context.mjs";
export function errorHtml(status, { budget = false, retryAfter, previewMode } = {}) {
  const messages = {
    400: [
      "Solicitud inválida",
      "Revisa los filtros, cantidades y formato de la consulta.",
    ],
    405: [
      "Método no permitido",
      "Esta página admite consultas de lectura. Vuelve al catálogo para continuar.",
    ],
    414: [
      "Consulta demasiado larga",
      "Reduce las piezas o el texto de búsqueda antes de volver a intentar.",
    ],
    429: [
      "Demasiadas consultas",
      "Espera antes de volver a intentar. El catálogo sigue disponible.",
    ],
    503: [
      "Consulta no disponible",
      budget
        ? "Reduce las piezas o los criterios e intenta de nuevo."
        : "El servicio está ocupado. Espera antes de volver a intentar.",
    ],
    500: [
      "No pudimos completar la consulta",
      "Vuelve al catálogo e intenta más tarde.",
    ],
  };
  const [title, description] = messages[status] ?? messages[500];
  const wait =
    Number.isSafeInteger(retryAfter) && retryAfter > 0
      ? `<p>Tiempo de espera indicado: ${retryAfter} segundos.</p>`
      : "";
  return previewContextHtml(shell(
    "/error",
    title,
    heading("Continuemos con tu consulta", title, description) +
      `<section class="empty"><div>${wait}<p>No se ha enviado ninguna solicitud de cotización.</p><div class="actions"><a class="button primary" href="/catalogo">Volver al catálogo</a><a class="button secondary" href="/buscar">Nueva búsqueda</a></div></div></section>`,
  ), previewMode);
}
export function sendError(req, res, status, options = {}) {
  const body = Buffer.from(errorHtml(status, options));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", body.length);
  res.writeHead(status);
  res.end(req.method === "HEAD" ? undefined : body);
}
