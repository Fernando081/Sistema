import { escapeHtml, validateBusiness } from "./business.mjs";

export function inquiryPieces(products, product, quantity, extra) {
  if (
    extra.length > 1200 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(extra)
  )
    throw new Error(
      "La lista supera el límite o contiene caracteres inválidos.",
    );
  const rows = extra
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length > 9)
    throw new Error("Agrega hasta nueve líneas adicionales.");
  const selected = new Map([
    [product.slug, { product, quantity: Number(quantity) }],
  ]);
  for (const row of rows) {
    const fields = row.split("|").map((value) => value.trim());
    if (
      fields.length < 2 ||
      fields.length > 3 ||
      !fields[0] ||
      !/^[1-9]\d{0,3}$/.test(fields[1])
    )
      throw new Error(
        "Usa número de parte | cantidad | marca opcional, una pieza por línea.",
      );
    const matches = products.filter(
      (item) =>
        item.code.toLowerCase() === fields[0].toLowerCase() &&
        (!fields[2] || item.brand.toLowerCase() === fields[2].toLowerCase()),
    );
    if (matches.length !== 1)
      throw new Error(
        "Una pieza no aparece o coincide con varias marcas. Revisa su número original y agrega la marca exacta.",
      );
    const item = matches[0];
    const total = Number(fields[1]) + (selected.get(item.slug)?.quantity ?? 0);
    if (total > 9999)
      throw new Error("La cantidad acumulada de una pieza supera 9999.");
    selected.set(item.slug, { product: item, quantity: total });
  }
  return [...selected.values()];
}

export function inquiryHtml(
  products,
  input,
  params,
  shell,
  heading,
  options = {},
) {
  const business = validateBusiness(input);
  for (const key of params.keys())
    if (
      !["producto", "cantidad", "piezas"].includes(key) ||
      params.getAll(key).length !== 1
    )
      throw new Error("Parámetros de consulta inválidos");
  const slug = params.get("producto");
  const product = products.find((item) => item.slug === slug);
  if (!product) return null;
  const quantity = params.get("cantidad") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(quantity)) throw new Error("Cantidad inválida");
  const extra = params.get("piezas") ?? "";
  let pieces = [],
    error = "";
  try {
    pieces = inquiryPieces(products, product, quantity, extra);
  } catch (failure) {
    error = failure.message;
  }
  const message = error
    ? ""
    : `Hola, quisiera consultar una cotización.\n${pieces.map((item) => `Producto: ${item.product.title}\nNúmero de parte: ${item.product.code}\nMarca: ${item.product.brand}\nCantidad: ${item.quantity}`).join("\n\n")}\nPor favor, confirmar aplicación, disponibilidad y precio.`;
  const actions = [];
  if (!error && options.intakeEnabled === true)
    actions.push(
      `<a class="button primary" href="/solicitar?${escapeHtml(params.toString())}">Continuar al formulario de solicitud</a>`,
    );
  const receiptMessage =
    options.intakeEnabled === true && !error
      ? "Todavía no se ha enviado ni guardado una solicitud. Completa y envía el formulario si deseas registrarla; abrir WhatsApp o correo solo prepara un mensaje."
      : "No se guarda una solicitud en el sitio ni en el CRM.";
  const compactLink = encodeURIComponent(message).length <= 6000;
  if (!error && compactLink && business.contact.whatsapp.confirmed)
    actions.push(
      `<a class="button primary" href="https://wa.me/${business.contact.whatsapp.value.slice(1)}?text=${escapeHtml(encodeURIComponent(message))}" rel="noopener noreferrer">Preparar mensaje en WhatsApp</a>`,
    );
  if (!error && compactLink && business.contact.email.confirmed)
    actions.push(
      `<a class="button secondary" href="mailto:${encodeURIComponent(business.contact.email.value)}?subject=${encodeURIComponent("Consulta de cotización")}&amp;body=${escapeHtml(encodeURIComponent(message))}">Preparar correo</a>`,
    );
  return shell(
    "/cotizar",
    "Consultar cotización",
    heading(
      "Consulta de producto",
      "Consultar cotización",
      "Revisa la pieza y cantidad antes de elegir un canal.",
    ) +
      `<section class="contact-grid"><article><h2>${escapeHtml(product.title)}</h2><p>Número de parte: <strong>${escapeHtml(product.code)}</strong></p><p>Marca: ${escapeHtml(product.brand)}</p><form action="/cotizar" method="get"><input type="hidden" name="producto" value="${escapeHtml(product.slug)}"><label for="cantidad">Cantidad de piezas</label><input id="cantidad" name="cantidad" type="number" min="1" max="9999" step="1" required value="${quantity}"><label for="piezas">Otras piezas (opcional)</label><p id="ayuda-piezas">Hasta nueve líneas: número de parte | cantidad | marca opcional. Usa números originales del catálogo. Las piezas repetidas suman cantidades.</p><textarea id="piezas" name="piezas" rows="4" maxlength="1200" aria-describedby="ayuda-piezas">${escapeHtml(extra.slice(0, 1200))}</textarea><button class="button primary" type="submit">Actualizar consulta</button></form><p><a class="text-link" href="/productos/${product.slug}">Revisar aplicaciones y ficha</a></p></article><article><h2>${error ? "Revisa la lista" : "Mensaje preparado"}</h2>${error ? `<p role="alert">${escapeHtml(error)}</p>` : `<div class="inquiry-summary"><h3>Resumen de piezas</h3><table><caption>${pieces.length} referencias en esta consulta</caption><thead><tr><th scope="col">Producto y número de parte</th><th scope="col">Marca</th><th scope="col" aria-label="Cantidad">Cant.</th></tr></thead><tbody>${pieces.map((item) => `<tr><th scope="row"><a href="/productos/${item.product.slug}">${escapeHtml(item.product.title)}</a><br>${escapeHtml(item.product.code)}</th><td>${escapeHtml(item.product.brand)}</td><td>${item.quantity}</td></tr>`).join("")}</tbody></table></div><h3>Texto para enviar</h3><pre class="inquiry-message">${escapeHtml(message)}</pre>`}${!error && !compactLink ? "<p>El mensaje es demasiado largo para preparar un enlace. Copia el texto o divide la consulta en menos piezas.</p>" : ""}${actions.length ? `<div class="contact-actions">${actions.join("")}</div><p>Abrir el canal prepara el mensaje. Tú decides enviarlo.</p>` : error ? "<p>Corrige la lista y actualiza la consulta para preparar el mensaje. No se ha enviado ninguna solicitud.</p>" : !compactLink ? "" : "<p>Los canales de cotización están pendientes de confirmación. Puedes copiar este mensaje; todavía no se ha enviado ninguna solicitud.</p>"}<p>Esto no confirma precio, existencia ni compatibilidad. ${receiptMessage}</p></article></section>`,
  );
}
