import { randomUUID } from "node:crypto";
import { escapeHtml } from "./business.mjs";
import { validateCatalog } from "./catalog.mjs";
export function leadFormHtml(config, input, status, shell, heading) {
  if (status === 202)
    return shell(
      "/solicitar",
      "Solicitud recibida",
      heading(
        "Atención comercial",
        "Solicitud recibida",
        "Tu solicitud quedó registrada; aún deben confirmarse identificación, compatibilidad, disponibilidad y precio.",
      ) + '<p><a href="/catalogo">Volver al catálogo</a></p>',
    );
  const value = (key, max) => escapeHtml(String(key ?? "").slice(0, max));
  const products = validateCatalog(
    config.catalog ?? { schemaVersion: 1, products: [] },
  );
  const pieceFields = (item, index) => {
    const suffix = index === 0 ? "" : String(index + 1);
    if (item.kind === "catalog") {
      const product = products.find((product) => product.slug === item.slug);
      return `<fieldset><legend>Pieza ${index + 1}</legend><input type="hidden" name="slug${suffix}" value="${value(item.slug, 160)}">${product ? `<p>Ficha seleccionada: <a href="/productos/${value(product.slug, 160)}">${value(product.title, 200)}</a></p><label for="lead-code${suffix}">Número de parte</label><input id="lead-code${suffix}" readonly value="${value(product.code, 200)}"><label for="lead-brand${suffix}">Marca</label><input id="lead-brand${suffix}" readonly value="${value(product.brand, 200)}">` : '<p role="alert">Esta ficha ya no está disponible. La solicitud no se recibirá mientras incluya esta pieza; revisa la selección en el catálogo.</p>'}<label for="lead-quantity${suffix}">Cantidad</label><input id="lead-quantity${suffix}" name="quantity${suffix}" type="number" min="1" max="9999" step="1" required value="${value(item.quantity, 16)}"></fieldset>`;
    }
    return `<fieldset><legend>Pieza ${index + 1}</legend>${[
      ["code", "Número de parte", 100],
      ["brand", "Marca (opcional)", 100],
      ["application", "Aplicación (opcional)", 200],
    ]
      .map(
        ([key, label, max]) =>
          `<label for="lead-${key}${suffix}">${label}</label><input id="lead-${key}${suffix}" name="${key}${suffix}" maxlength="${max}" ${key === "code" && index === 0 ? "required" : ""} value="${value(item[key], max)}">`,
      )
      .join("")}
    <label for="lead-quantity${suffix}">Cantidad</label><input id="lead-quantity${suffix}" name="quantity${suffix}" type="number" min="1" max="9999" step="1" ${index === 0 ? "required" : ""} placeholder="1" value="${value(item.quantity ?? (index === 0 ? 1 : ""), 16)}"></fieldset>`;
  };
  const pieces = Array.from({ length: 10 }, (_, index) => {
    const item = input?.items?.[index] || {};
    const fields = pieceFields(item, index);
    return index === 0
      ? fields
      : `<details class="lead-piece" ${Object.keys(item).length ? "open" : ""}><summary>Pieza ${index + 1} (${item.kind === "catalog" ? "ficha seleccionada" : "opcional"})</summary>${fields}</details>`;
  }).join("");
  const id = /^[a-f0-9-]{36}$/i.test(input?.requestId || "")
    ? input.requestId
    : randomUUID();
  return shell(
    "/solicitar",
    "Enviar solicitud",
    heading(
      "Atención comercial",
      "Enviar solicitud",
      "Revisa hasta diez piezas y el medio por el que deseas que te contacten.",
    ) +
      `<section class="contact-grid lead-layout"><article>${status ? `<p role="alert">No pudimos confirmar la recepción. ${status === 400 ? "Revisa el contacto y las piezas: cada referencia necesita número de parte y cantidad entre 1 y 9999; no repitas una misma pieza." : "El envío pudo haber quedado registrado. Reintenta esta misma solicitud sin cambiar las piezas ni el contacto."}</p>` : ""}
    <form class="lead-form" action="/solicitudes" method="post"><input type="hidden" name="requestId" value="${value(id, 36)}"><input type="hidden" name="privacyVersion" value="${value(config.privacyVersion, 80)}">
    <label for="lead-name">Nombre de contacto</label><input id="lead-name" name="name" autocomplete="name" required maxlength="120" value="${value(input?.contact?.name, 120)}">
    <label for="lead-channel">Medio de contacto</label><select id="lead-channel" name="channel">${["email", "phone", "whatsapp"].map((channel) => `<option value="${channel}" ${input?.contact?.channel === channel ? "selected" : ""}>${{ email: "Correo", phone: "Teléfono", whatsapp: "WhatsApp" }[channel]}</option>`).join("")}</select>
    <label for="lead-value">Correo o teléfono internacional</label><input id="lead-value" name="value" required maxlength="254" value="${value(input?.contact?.value, 254)}"><p>Para teléfono o WhatsApp utiliza +52 y el número de diez dígitos.</p>
    <h2>Piezas a consultar</h2>${input?.items?.some((item) => item.kind === "catalog") ? "<p>Las fichas seleccionadas conservan su número de parte y marca del catálogo. Puedes ajustar cantidades y agregar referencias libres. Para cambiar las fichas, vuelve a la consulta antes de ingresar tu contacto. No se confirma compatibilidad, precio ni existencia.</p>" : ""}<p>Abre los apartados opcionales para agregar más piezas. Deja vacíos los que no necesites; una cantidad vacía en una referencia adicional equivale a 1. Para retirar una referencia adicional, vacía todos sus campos. No repitas la misma referencia, marca y aplicación; ajusta su cantidad.</p>${pieces}
    <p>No incluyas datos fiscales, VIN o ESN en estos campos.</p><label><input type="checkbox" name="privacyAccepted" value="yes" required> He leído y acepto el aviso de privacidad mostrado.</label>
    <button class="button primary" type="submit">Enviar solicitud</button></form></article>
    <article><h2>Aviso de privacidad</h2><p class="lead-privacy">${value(config.privacyText, 10000)}</p><p>No se envía ningún mensaje por WhatsApp o correo automáticamente.</p></article></section>`,
  );
}
export function leadFromForm(text) {
  const params = new URLSearchParams(text);
  const fields = [
    "requestId",
    "privacyVersion",
    "name",
    "channel",
    "value",
    "code",
    "brand",
    "application",
    "quantity",
    "privacyAccepted",
    "slug",
  ];
  for (let index = 2; index <= 10; index++)
    for (const key of ["code", "brand", "application", "quantity", "slug"])
      fields.push(key + index);
  for (const key of params.keys())
    if (!fields.includes(key) || params.getAll(key).length !== 1)
      throw new Error("Formulario inválido");
  const items = [];
  for (let index = 1; index <= 10; index++) {
    const suffix = index === 1 ? "" : String(index);
    const code = params.get("code" + suffix) || "";
    const brand = params.get("brand" + suffix) || "";
    const application = params.get("application" + suffix) || "";
    const quantity = params.get("quantity" + suffix) || "";
    if (params.has("slug" + suffix)) {
      if (
        ["code", "brand", "application"].some((key) => params.has(key + suffix))
      )
        throw new Error("Identidad de ficha ambigua");
      items.push({
        kind: "catalog",
        slug: params.get("slug" + suffix),
        quantity: /^[1-9]\d{0,3}$/.test(quantity) ? Number(quantity) : quantity,
      });
      continue;
    }
    // Optional rows are omitted only when ALL fields are empty. Partial rows
    // reach contract validation, so a typo cannot silently drop a requested part.
    if (index !== 1 && !code && !brand && !application && !quantity) continue;
    const effectiveQuantity = index !== 1 && quantity === "" ? "1" : quantity;
    items.push({
      kind: "reference",
      code,
      brand,
      application,
      quantity: /^[1-9]\d{0,3}$/.test(effectiveQuantity)
        ? Number(effectiveQuantity)
        : effectiveQuantity,
    });
  }
  return {
    schemaVersion: 1,
    requestId: params.get("requestId"),
    contact: {
      name: params.get("name"),
      channel: params.get("channel"),
      value: params.get("value"),
    },
    items,
    privacy: {
      accepted: params.get("privacyAccepted") === "yes",
      version: params.get("privacyVersion"),
    },
  };
}
