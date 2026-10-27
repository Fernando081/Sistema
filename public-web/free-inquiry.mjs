import { escapeHtml, validateBusiness } from "./business.mjs";
export function freeInquiryHtml(input, params, shell, heading) {
  const business = validateBusiness(input);
  const fields = { parte: 100, marca: 100, aplicacion: 200, cantidad: 4 };
  for (const key of params.keys())
    if (!Object.hasOwn(fields, key) || params.getAll(key).length !== 1)
      throw new Error("Parámetros inválidos");
  const values = Object.fromEntries(
    Object.keys(fields).map((key) => [
      key,
      (params.get(key) ?? (key === "cantidad" ? "1" : "")).trim(),
    ]),
  );
  const submitted = params.size > 0;
  const error =
    submitted &&
    (!values.parte ||
      Object.entries(fields).some(
        ([key, max]) =>
          values[key].length > max || /[\u0000-\u001f]/.test(values[key]),
      ) ||
      !/^[1-9]\d{0,3}$/.test(values.cantidad))
      ? "Revisa el número de parte, la cantidad (1 a 9999) y el tamaño de los campos."
      : "";
  const message =
    submitted && !error
      ? `Hola, quisiera consultar una refacción.\nNúmero de parte indicado: ${values.parte}\nMarca indicada: ${values.marca || "Por confirmar"}\nAplicación indicada: ${values.aplicacion || "Por confirmar"}\nCantidad: ${values.cantidad}\nPor favor, confirmar identificación, compatibilidad, disponibilidad y precio.`
      : "";
  const actions = [];
  if (message && business.contact.whatsapp.confirmed)
    actions.push(
      `<a class="button primary" href="https://wa.me/${business.contact.whatsapp.value.slice(1)}?text=${escapeHtml(encodeURIComponent(message))}" rel="noopener noreferrer">Preparar mensaje en WhatsApp</a>`,
    );
  if (message && business.contact.email.confirmed)
    actions.push(
      `<a class="button secondary" href="mailto:${encodeURIComponent(business.contact.email.value)}?subject=Consulta%20de%20refacci%C3%B3n&amp;body=${escapeHtml(encodeURIComponent(message))}">Preparar correo</a>`,
    );
  return shell(
    "/consulta",
    "Consultar una pieza",
    heading(
      "Atención de refacciones",
      "Consultar una pieza",
      "También puedes preguntar por piezas que todavía no aparecen en el catálogo.",
    ) +
      `<section class="contact-grid"><article><h2>Datos de la pieza</h2><p>Indica la referencia tal como la conoces. Nuestro equipo debe verificarla; no es una ficha aprobada.</p><form action="/consulta" method="get">${Object.entries(
        fields,
      )
        .map(
          ([key, max]) =>
            `<label for="consulta-${key}">${{ parte: "Número de parte", marca: "Marca (opcional)", aplicacion: "Aplicación o modelo (opcional)", cantidad: "Cantidad solicitada" }[key]}</label><input id="consulta-${key}" name="${key}" ${key === "cantidad" ? 'type="number" min="1" max="9999" step="1"' : `type="text" maxlength="${max}"`} ${["parte", "cantidad"].includes(key) ? "required" : ""} value="${escapeHtml(values[key].slice(0, max))}">`,
        )
        .join(
          "",
        )}<p>No incluyas datos personales ni números de serie en estos campos.</p><button class="button primary" type="submit">Preparar consulta</button></form></article><article><h2>${error ? "Revisa los datos" : message ? "Mensaje preparado" : "Antes de enviar"}</h2>${error ? `<p role="alert">${error}</p>` : message ? `<pre class="inquiry-message">${escapeHtml(message)}</pre>${actions.length ? `<div class="contact-actions">${actions.join("")}</div>` : "<p>Los canales están pendientes de confirmación; puedes copiar el mensaje.</p>"}` : "<p>Completa los datos para preparar tu mensaje.</p>"}<p>Tú decides enviarlo. No se guarda una solicitud en el sitio ni en el CRM; esto no confirma precio, existencia o compatibilidad.</p><a class="text-link" href="/buscar">Buscar en el catálogo</a></article></section>`,
  );
}
