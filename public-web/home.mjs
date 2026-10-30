import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml, validateBusiness, businessFaqItems } from "./business.mjs";

// Portada WEB02.5: la papelería del mostrador. Todos los datos salen de business.json
// confirmado; los textos son los ya publicados. Las fotografías son de bancos abiertos
// (créditos en /creditos) y muestran el entorno, no productos ni el local.
const phone = (value) =>
  value.replace(/^\+52(\d{3})(\d{3})(\d{4})$/, "+52 $1 $2 $3");
const photo = (file, alt, width, height, extra = "") =>
  `<img src="/assets/photos/${file}" alt="${alt}" width="${width}" height="${height}" loading="lazy" decoding="async"${extra}>`;
const steps = [
  ["Número de parte", "Número de parte o referencia original.", "inyector.webp", "Inyector unitario diésel"],
  ["Marca y aplicación", "Marca y aplicación de la refacción.", "maza.webp", "Maza de rueda de tractocamión"],
  ["Fotografía o especificaciones", "Fotografía o especificaciones, si las tienes.", "matraca.webp", "Matraca y dados de herramienta"],
  ["Aplicaciones y restricciones", "Revisa las aplicaciones y restricciones antes de elegir una pieza.", "motor.webp", "Compartimento de motor diésel"],
  ["Confirmación", "Nuestro equipo debe confirmar compatibilidad, precio y disponibilidad.", "puente-laguna.webp", "Puente Tampico visto desde la laguna"],
];

export function homeBody(input) {
  const business = validateBusiness(input);
  const contact = business.contact;
  const show = (field) => contact[field]?.confirmed;
  const lines = (field) => escapeHtml(contact[field].value).replaceAll("\n", "<br>");
  const hours = show("hours") ? contact.hours.value.split("\n") : [];
  const facts = hours
    .filter((line) => !/cerrado/i.test(line))
    .map((line) => line.split(": "))
    .filter((parts) => parts.length === 2)
    .map(
      ([days, time]) =>
        `<li><strong>${escapeHtml(time.replace(/(\d+):(\d+) ([ap])\.m\./g, (_, hour, minute, half) => `${(Number(hour) % 12) + (half === "p" ? 12 : 0)}:${minute}`))}</strong><span>${escapeHtml(days)}</span></li>`,
    );
  if (show("address")) {
    const [street, colony] = contact.address.value.split("\n");
    const number = street.match(/#\S+$/)?.[0];
    if (number)
      facts.push(
        `<li><strong>${escapeHtml(number)}</strong><span>${escapeHtml(street.replace(` ${number}`, ""))}<br>${escapeHtml(colony.split(",")[0])}</span></li>`,
      );
  }
  if (show("serviceArea") && /toda la República/.test(contact.serviceArea.value))
    facts.push(
      `<li><strong>Toda la República</strong><span>Envíos por paquetería por cobrar</span></li>`,
    );
  const channel = (label, href, value, rel = "") =>
    `<li><a href="${href}"${rel}>${label}</a><span>${value}</span></li>`;
  const byPhone = [
    show("phone") && channel("Teléfono", `tel:${contact.phone.value}`, phone(escapeHtml(contact.phone.value))),
    show("whatsapp") && channel("WhatsApp", `https://wa.me/${contact.whatsapp.value.slice(1)}`, phone(escapeHtml(contact.whatsapp.value)), ' rel="noopener noreferrer"'),
  ].filter(Boolean);
  const byText = show("email")
    ? [channel("Correo", `mailto:${encodeURIComponent(contact.email.value)}`, escapeHtml(contact.email.value))]
    : [];
  const atCounter = show("address")
    ? [
        `<li><span>Mostrador</span><span>${lines("address")}</span></li>`,
        contact.maps?.confirmed
          ? channel("Cómo llegar", escapeHtml(contact.maps.value), "Google Maps", ' rel="noopener noreferrer"')
          : "",
      ]
    : [];
  const group = (title, items) =>
    items.length ? `<div class="sheet-group"><h3>${title}</h3><ul>${items.join("")}</ul></div>` : "";
  const whatsapp = show("whatsapp")
    ? `<a class="button whatsapp" href="https://wa.me/${contact.whatsapp.value.slice(1)}" rel="noopener noreferrer" data-tag-whatsapp data-number="${contact.whatsapp.value.slice(1)}" hidden>Abrir WhatsApp con tu consulta</a>`
    : "";
  return `<section class="hero"><img class="hero-photo" src="/assets/photos/puente-tampico-1600.webp" srcset="/assets/photos/puente-tampico-960.webp 960w, /assets/photos/puente-tampico-1600.webp 1600w" sizes="100vw" alt="Puente Tampico al atardecer" width="1600" height="900" fetchpriority="high" decoding="async" data-drift><div class="hero-copy"><h1>La pieza correcta.</h1><p>Refacciones y Tractorepuestos Tampico. Compra y venta de refacciones para servicio pesado diésel.</p></div><nav class="folders" aria-label="Secciones del sitio"><a class="folder" href="/catalogo"><span class="tab"><span>Catálogo</span></span><span class="folder-note">Cada refacción, con su información.</span></a><a class="folder" href="/categorias"><span class="tab"><span>Categorías</span></span><span class="folder-note">Explora por familia.</span></a><a class="folder" href="/marcas"><span class="tab"><span>Marcas</span></span><span class="folder-note">Marcas confirmadas para nuestro catálogo.</span></a><a class="folder" href="/nosotros"><span class="tab"><span>Nosotros</span></span><span class="folder-note">Un negocio familiar.</span></a><div class="folder folder-front"><span class="tab"><span>Consulta</span></span><p>Ten a mano el número de parte y la información de la aplicación.</p><div class="actions"><a class="button primary" href="#consulta">Preparar una consulta</a><a class="text-link" href="/catalogo">Explorar el catálogo</a></div></div></nav></section>
<section class="intro" aria-labelledby="familia-titulo"><div class="intro-head" data-reveal><h2 id="familia-titulo">Un negocio familiar.</h2><p>Somos un negocio familiar dedicado a la compra y venta de refacciones para servicio pesado diésel.</p></div>${facts.length ? `<ul class="facts" data-reveal>${facts.join("")}</ul>` : ""}</section>
<section class="steps" aria-labelledby="pasos-titulo"><div class="steps-head" data-reveal><h2 id="pasos-titulo">Información para tu consulta</h2><div class="steps-controls" data-steps-controls hidden><button type="button" data-steps="-1" aria-label="Paso anterior"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2.5"/></svg></button><button type="button" data-steps="1" aria-label="Paso siguiente"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5"/></svg></button></div></div><div class="steps-bar" aria-hidden="true"><span data-steps-progress></span></div><ol class="steps-row" data-steps-row tabindex="0" aria-labelledby="pasos-titulo">${steps.map(([title, text, file, caption]) => `<li data-reveal><h3>${title}</h3><p>${text}</p><figure>${photo(file, "", 720, 900)}<figcaption>${caption}. Fotografía de referencia.</figcaption></figure></li>`).join("")}</ol></section>
<section class="channels" aria-labelledby="canales-titulo"><div class="sheet" data-reveal><h2 id="canales-titulo">Canales de atención</h2><p>Refacciones y Tractorepuestos Tampico</p>${group("Llamada y WhatsApp", byPhone)}${group("Por escrito", byText)}${group("En mostrador", atCounter)}${hours.length ? `<p class="sheet-hours">${hours.map(escapeHtml).join("<br>")}</p>` : ""}</div></section>
<section class="faq" aria-labelledby="preguntas-titulo"><div class="faq-text" data-reveal><h2 id="preguntas-titulo">Preguntas frecuentes</h2>${show("address") ? `<ul class="faq-facts"><li>${lines("address")}</li></ul>` : ""}${businessFaqItems(business)}<div class="actions"><a class="button primary" href="/contacto">Información de contacto</a></div></div><figure class="faq-media">${photo("carga-diesel.webp", "Tractocamión cargando diésel al anochecer", 900, 1200)}${photo("puerto-tampico.webp", "Puente Tampico y el puerto sobre el río", 720, 720)}<figcaption>Fotografías de referencia.</figcaption></figure></section>
<section class="coupon-wrap" id="consulta" aria-labelledby="consulta-titulo"><form class="coupon" action="/consulta" method="get" data-tag data-reveal><div class="coupon-stub"><h2 id="consulta-titulo">Consultar una pieza</h2><p>Indica la referencia tal como la conoces. Nuestro equipo debe verificarla; no es una ficha aprobada.</p><output class="tag-preview" data-tag-preview for="inicio-parte inicio-marca inicio-aplicacion inicio-cantidad" aria-live="polite">Completa los datos para preparar tu mensaje.</output></div><div class="coupon-fields"><div class="field"><label for="inicio-parte">Número de parte</label><input id="inicio-parte" name="parte" type="text" maxlength="100" required autocomplete="off"></div><div class="field"><label for="inicio-marca">Marca (opcional)</label><input id="inicio-marca" name="marca" type="text" maxlength="100" autocomplete="off"></div><div class="field-row"><div class="field"><label for="inicio-aplicacion">Aplicación o modelo (opcional)</label><input id="inicio-aplicacion" name="aplicacion" type="text" maxlength="200" autocomplete="off"></div><div class="field"><label for="inicio-cantidad">Cantidad</label><input id="inicio-cantidad" name="cantidad" type="number" min="1" max="9999" step="1" value="1" required></div></div><p class="coupon-note">No incluyas datos personales ni números de serie en estos campos. Tú decides enviarlo.</p><button class="button" type="submit">Preparar consulta</button>${whatsapp}</div></form></section>`;
}

export function footerHtml(input) {
  const business = validateBusiness(input);
  const contact = business.contact;
  const links = [];
  if (contact.phone.confirmed) links.push(`<a href="tel:${contact.phone.value}">Llamar</a>`);
  if (contact.whatsapp.confirmed)
    links.push(`<a href="https://wa.me/${contact.whatsapp.value.slice(1)}" rel="noopener noreferrer">WhatsApp</a>`);
  if (contact.email.confirmed)
    links.push(`<a href="mailto:${encodeURIComponent(contact.email.value)}">Correo</a>`);
  if (contact.maps?.confirmed)
    links.push(`<a href="${escapeHtml(contact.maps.value)}" rel="noopener noreferrer">Cómo llegar</a>`);
  return `<footer class="site-footer"><div><h2>Una conversación directa.</h2><a class="button primary" href="/consulta">Consultar una pieza</a></div><nav aria-label="Enlaces del pie de página"><a href="/catalogo">Catálogo</a><a href="/contacto">Contacto</a>${links.join("")}</nav><div class="footer-legal"><p>Un negocio familiar para el servicio pesado diésel.</p><a href="/creditos">Créditos de fotografías y tipografía</a></div><p class="footer-name" aria-hidden="true">Tractorepuestos</p></footer>`;
}

export async function creditsBody(root, heading) {
  const credits = JSON.parse(await readFile(join(root, "assets/credits.json"), "utf8"));
  const item = (title, lines) =>
    `<li><h2>${escapeHtml(title)}</h2>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</li>`;
  return (
    heading(
      "Créditos",
      "Fotografías<br>y tipografía.",
      "Las fotografías del sitio provienen de bancos abiertos y muestran el entorno del servicio pesado; no son productos, inventario ni instalaciones del negocio.",
    ) +
    `<ul class="credits">${credits.photos
      .map((record) =>
        item(record.title, [
          `Autor: ${record.creator}. Licencia: ${record.license} (${record.licenseUrl}).`,
          `Fuente: ${record.page}, vía ${record.via}.`,
          record.changes,
        ]),
      )
      .join("")}${credits.fonts
      .map((record) => item(record.family, [`Licencia: ${record.license}.`, `Fuente: ${record.source}.`]))
      .join("")}</ul>`
  );
}
