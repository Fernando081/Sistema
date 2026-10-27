import { readFile } from "node:fs/promises";
export function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}
function keys(value, allowed, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !allowed.includes(key) && !optional.includes(key),
    ) ||
    allowed.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(
      "Configuración pública inválida: campos inesperados o faltantes",
    );
}
function text(value, max = 1000) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error("Texto público inválido");
  return value.trim();
}
export function validateBusiness(input) {
  keys(input, ["contact", "story", "brands"]);
  const fields = [
    "phone",
    "whatsapp",
    "email",
    "address",
    "hours",
    "serviceArea",
  ];
  keys(input.contact, fields, ["maps"]);
  if (Object.hasOwn(input.contact, "maps")) fields.push("maps");
  const contact = {};
  for (const field of fields) {
    const record = input.contact[field];
    keys(record, ["confirmed", "value"]);
    if (typeof record.confirmed !== "boolean")
      throw new Error("Confirmación pública inválida");
    const value = text(record.value);
    if (
      field === "maps" &&
      value &&
      !/^https:\/\/maps\.app\.goo\.gl\/[a-zA-Z0-9]+$/.test(value)
    )
      throw new Error("Enlace Google Maps inválido");
    if (record.confirmed && !value)
      throw new Error("No confirmes un dato vacío");
    if (
      value &&
      ["phone", "whatsapp"].includes(field) &&
      !/^\+[1-9][0-9]{7,14}$/.test(value)
    )
      throw new Error("Teléfono público inválido: usa prefijo internacional");
    if (
      value &&
      field === "email" &&
      !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)
    )
      throw new Error("Correo público inválido");
    contact[field] = { confirmed: record.confirmed, value };
  }
  keys(input.story, ["confirmed", "paragraphs"]);
  if (
    typeof input.story.confirmed !== "boolean" ||
    !Array.isArray(input.story.paragraphs) ||
    input.story.paragraphs.length > 8
  )
    throw new Error("Historia pública inválida");
  const paragraphs = input.story.paragraphs.map((value) => text(value, 2000));
  if (
    paragraphs.some((value) => !value) ||
    (input.story.confirmed && !paragraphs.length)
  )
    throw new Error("Historia vacía");
  if (!Array.isArray(input.brands) || input.brands.length > 100)
    throw new Error("Marcas públicas inválidas");
  const brands = input.brands.map((record) => {
    keys(record, ["name", "confirmed"]);
    const name = text(record.name, 80);
    if (!name || typeof record.confirmed !== "boolean")
      throw new Error("Marca pública inválida");
    return { name, confirmed: record.confirmed };
  });
  if (
    new Set(brands.map((record) => record.name.toLocaleLowerCase("es")))
      .size !== brands.length
  )
    throw new Error("Marcas duplicadas");
  return {
    contact,
    story: { confirmed: input.story.confirmed, paragraphs },
    brands,
  };
}
export async function loadBusiness() {
  return validateBusiness(
    JSON.parse(
      await readFile(new URL("./business.json", import.meta.url), "utf8"),
    ),
  );
}
export function organizationMetadata(input) {
  const business = validateBusiness(input);
  const properties = { phone: "telephone", email: "email" };
  return `<article itemscope itemtype="https://schema.org/Organization"><meta itemprop="name" content="Refacciones y Tractorepuestos Tampico">${Object.entries(
    properties,
  )
    .filter(([field]) => business.contact[field].confirmed)
    .map(
      ([field, property]) =>
        `<meta itemprop="${property}" content="${escapeHtml(business.contact[field].value)}">`,
    )
    .join("")}`;
}
export function businessPages(input, shell, heading) {
  const business = validateBusiness(input);
  const show = (field) => business.contact[field].confirmed;
  const lines = (field) =>
    escapeHtml(business.contact[field].value).replaceAll("\n", "<br>");
  const contacts = [];
  if (show("phone"))
    contacts.push(
      `<a class="button primary" href="tel:${business.contact.phone.value}">Llamar al ${escapeHtml(business.contact.phone.value)}</a>`,
    );
  if (show("whatsapp"))
    contacts.push(
      `<a class="button primary" href="https://wa.me/${business.contact.whatsapp.value.slice(1)}" rel="noopener noreferrer">Abrir WhatsApp</a><a class="text-link" href="tel:${business.contact.whatsapp.value}">Móvil: ${escapeHtml(business.contact.whatsapp.value)}</a>`,
    );
  if (business.contact.maps?.confirmed)
    contacts.push(
      `<a class="text-link" href="${escapeHtml(business.contact.maps.value)}" rel="noopener noreferrer">Cómo llegar · Google Maps</a>`,
    );
  if (show("email"))
    contacts.push(
      `<a class="text-link" href="mailto:${encodeURIComponent(business.contact.email.value)}">${escapeHtml(business.contact.email.value)}</a>`,
    );
  const details = ["address", "hours", "serviceArea"]
    .filter(show)
    .map(
      (field) =>
        `<div><h3>${{ address: "Ubicación", hours: "Horarios", serviceArea: "Alcance de servicio" }[field]}</h3><p${field === "address" ? ' itemprop="address"' : field === "serviceArea" ? ' itemprop="areaServed"' : ""}>${lines(field)}</p></div>`,
    )
    .join("");
  const faq = `<section class="business-faq"><h2>Preguntas frecuentes</h2><details><summary>¿Qué información necesito para consultar una pieza?</summary><p>Ten a mano el número de parte, la marca y la aplicación o modelo. Nuestro equipo debe confirmar compatibilidad, precio y disponibilidad.</p><a class="text-link" href="/consulta">Consultar una pieza que no aparece en el catálogo</a></details>${show("serviceArea") ? `<details><summary>¿Cómo puedo recibir mis refacciones?</summary><p>${lines("serviceArea")}</p><p>Consulta con nuestro equipo las condiciones de entrega de tu pedido.</p></details>` : ""}${show("hours") ? `<details><summary>¿Cuáles son los horarios de atención?</summary><p>${lines("hours")}</p></details>` : ""}${show("address") ? `<details><summary>¿Dónde está el negocio?</summary><p>${lines("address")}</p>${business.contact.maps?.confirmed ? `<a class="text-link" href="${escapeHtml(business.contact.maps.value)}" rel="noopener noreferrer">Ver ubicación en Google Maps</a>` : ""}</details>` : ""}</section>`;
  const confirmedBrands = business.brands.filter((record) => record.confirmed);
  const story = business.story.confirmed
    ? business.story.paragraphs
        .map((value) => `<p>${escapeHtml(value)}</p>`)
        .join("")
    : "<p>Estamos preparando más información sobre nuestra historia familiar.</p>";
  return new Map([
    [
      "/nosotros",
      shell(
        "/nosotros",
        "Nosotros",
        heading(
          "Refacciones y Tractorepuestos Tampico",
          "Un negocio familiar.<br>Con enfoque en tu refacción.",
          "Compra y venta de refacciones para servicio pesado diésel.",
        ) +
          `<section class="contact-grid"><article><p class="eyebrow">Quiénes somos</p><h2>Refacciones y<br>Tractorepuestos.</h2><p>Somos un negocio familiar dedicado a la compra y venta de refacciones para servicio pesado diésel.</p>${story}</article><article><p class="eyebrow">Una consulta bien preparada</p><h2>La información<br>hace la diferencia.</h2><p>El número de parte, la marca y la aplicación ayudan a identificar la refacción que necesitas.</p><a class="text-link" href="/contacto">Información de contacto →</a></article></section>`,
      ),
    ],
    [
      "/marcas",
      shell(
        "/marcas",
        "Marcas",
        heading(
          "Identifica la refacción",
          "La marca también<br>cuenta.",
          "Consulta las marcas confirmadas para nuestro catálogo.",
        ) +
          (confirmedBrands.length
            ? `<section class="brand-grid" aria-label="Marcas del catálogo">${confirmedBrands.map((record) => `<article><h2>${escapeHtml(record.name)}</h2><a class="text-link" href="/catalogo">Consultar el catálogo →</a></article>`).join("")}</section><p class="brand-note">El listado identifica marcas del catálogo; no declara distribución autorizada ni certificaciones.</p>`
            : '<section class="empty"><span class="empty-symbol" aria-hidden="true">+</span><div><h2>Marcas en preparación</h2><p>Se incorporarán después de confirmar la información del catálogo.</p><a class="text-link" href="/catalogo">Ir al catálogo →</a></div></section>'),
      ),
    ],
    [
      "/contacto",
      shell(
        "/contacto",
        "Contacto",
        heading(
          "Hablemos de tu refacción",
          "El siguiente paso<br>empieza contigo.",
          "Ten a mano el número de parte y la información de la aplicación.",
        ) +
          `<section class="contact-grid">${organizationMetadata(business)}<p class="eyebrow">Refacciones y Tractorepuestos</p><h2>Tampico</h2>${contacts.length ? `<div class="contact-actions">${contacts.join("")}</div>` : !details ? "<p>Estamos preparando los canales de atención de esta página.</p>" : ""}${details}${!contacts.length && !details ? "<p>Próximamente podrás consultar teléfono, ubicación y horarios confirmados.</p>" : ""}</article><article><p class="eyebrow">Para identificar la pieza</p><h2>Información útil<br>para tu consulta.</h2><ul><li>Número de parte o referencia original.</li><li>Marca y aplicación de la refacción.</li><li>Fotografía o especificaciones, si las tienes.</li></ul><p>Revisa las aplicaciones y restricciones antes de elegir una pieza.</p><a class="text-link" href="/catalogo">Ver el catálogo →</a></article></section>${faq}`,
      ),
    ],
  ]);
}
