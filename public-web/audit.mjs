export function auditPages(
  pages,
  media = new Map(),
  redirects = { entries: [] },
) {
  const errors = [];
  const warnings = [];
  const productTitles = new Map();
  for (const [route, html] of pages) {
    const titles = [...html.matchAll(/<title>([^]*?)<\/title>/g)];
    if (titles.length !== 1 || !titles[0][1].trim())
      errors.push(`${route}: título ausente o repetido`);
    if ((html.match(/<h1(?:\s[^>]*|)>/g) ?? []).length !== 1)
      errors.push(`${route}: requiere un H1`);
    if (
      (html.match(/<meta name="description" content="[^"]+">/g) ?? [])
        .length !== 1
    )
      errors.push(`${route}: descripción ausente o repetida`);
    if (!html.includes('<meta name="robots" content="noindex,nofollow">'))
      errors.push(`${route}: preview sin noindex`);
    if (route.startsWith("/productos/") && titles.length === 1) {
      const other = productTitles.get(titles[0][1]);
      if (other)
        warnings.push(`${route}: título comercial duplicado con ${other}`);
      else productTitles.set(titles[0][1], route);
    }
    for (const [, raw] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      const href = raw.replaceAll("&amp;", "&");
      if (
        /^(?:https:\/\/wa\.me\/|mailto:|tel:)/.test(href) ||
        /^https:\/\/maps\.app\.goo\.gl\/[a-zA-Z0-9]+$/.test(href)
      )
        continue;
      if (
        (!href.startsWith("/") && !href.startsWith("#")) ||
        href.startsWith("//")
      ) {
        errors.push(`${route}: enlace no admitido ${raw}`);
        continue;
      }
      const url = new URL(href, `http://preview.invalid${route}`);
      const target = url.pathname;
      const alias = redirects.entries.some((entry) => entry.from === target);
      const inquiry =
        target === "/cotizar" &&
        pages.has(`/productos/${url.searchParams.get("producto")}`);
      if (!pages.has(target) && !media.has(target) && !alias && !inquiry)
        errors.push(`${route}: enlace roto ${raw}`);
      if (url.hash && pages.has(target)) {
        const id = url.hash.slice(1);
        if (!pages.get(target).includes(`id="${id}"`))
          errors.push(`${route}: ancla ausente ${raw}`);
      }
    }
  }
  const report = {
    schemaVersion: 1,
    pages: pages.size,
    errors,
    warnings,
    scope:
      "Reglas locales del HTML generado; no validador general HTML/Schema.org ni prueba de indexación",
  };
  if (errors.length)
    throw new Error(`Auditoría pública fallida: ${errors.join("; ")}`);
  return report;
}
