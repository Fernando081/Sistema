import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
test("error de consulta ofrece recuperación accesible en móvil", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("http://127.0.0.1:4501/buscar?pagina=0");
  expect(response?.status()).toBe(400);
  await expect(
    page.getByRole("heading", { level: 1, name: "Solicitud inválida" }),
  ).toBeVisible();
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Volver al catálogo" }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
});
test("cotización contextual móvil sin JavaScript conserva pieza y cantidad", async ({
  browser,
}) => {
  const { pagesForCatalog, shell, heading } = await import("../build.mjs");
  const { inquiryHtml } = await import("../inquiry.mjs");
  const { loadBusiness } = await import("../business.mjs");
  const business = await loadBusiness();
  const products = [
    {
      slug: "consulta-ui",
      status: "published",
      approved: true,
      code: "OEM-CONSULTA",
      brand: "Marca revisada",
      category: "Familia",
      title: "Pieza consultada",
      description: "Fixture aislada",
      applications: [],
      references: [],
      specifications: [],
    },
  ];
  products.push({
    ...products[0],
    slug: "otra-pieza",
    code: "OEM-OTRA",
    title: "Otra pieza",
  });
  const pages = pagesForCatalog(products);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const body =
      url.pathname === "/cotizar"
        ? inquiryHtml(products, business, url.searchParams, shell, heading)
        : pages.get(url.pathname);
    if (body) await route.fulfill({ contentType: "text/html", body });
    else await route.continue();
  });
  await page.goto("http://127.0.0.1:4501/productos/consulta-ui");
  await page.getByRole("link", { name: "Consultar cotización" }).click();
  await page.getByLabel("Cantidad de piezas").fill("4");
  await page.getByRole("button", { name: "Actualizar consulta" }).click();
  await expect(page.locator(".inquiry-message")).toContainText("OEM-CONSULTA");
  await expect(page.locator(".inquiry-message")).toContainText("Cantidad: 4");
  await page
    .getByLabel("Otras piezas (opcional)")
    .fill("OEM-OTRA | 2\nOEM-CONSULTA | 1");
  await page.getByRole("button", { name: "Actualizar consulta" }).click();
  await expect(page.locator(".inquiry-message")).toContainText("OEM-OTRA");
  await expect(page.locator(".inquiry-message")).toContainText("Cantidad: 5");
  await expect(page.locator(".inquiry-message")).toContainText("Cantidad: 2");
  await expect(page.locator(".inquiry-summary")).toContainText("2 referencias");
  await expect(page.locator(".inquiry-summary")).toContainText("OEM-OTRA");
  await page.screenshot({
    path: ".artifacts/public-inquiry-summary-mobile.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("link", { name: "Preparar mensaje en WhatsApp" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Preparar correo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
  const accessibleContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const accessible = await accessibleContext.newPage();
  await accessible.route("**/cotizar?**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: inquiryHtml(
        products,
        business,
        new URL(route.request().url()).searchParams,
        shell,
        heading,
      )!,
    }),
  );
  await accessible.goto(
    "http://127.0.0.1:4501/cotizar?producto=consulta-ui&cantidad=4",
  );
  const results = await new AxeBuilder({ page: accessible }).analyze();
  expect(
    results.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await accessibleContext.close();
});
test("formulario de búsqueda GET funciona sin JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4501/buscar");
  await page.getByLabel("Número de parte o descripción").fill("OEM-PRUEBA");
  await page.getByRole("button", { name: "Buscar productos" }).click();
  await expect(page).toHaveURL(/buscar\?q=OEM-PRUEBA/);
  await expect(page.getByLabel("Número de parte o descripción")).toHaveValue(
    "OEM-PRUEBA",
  );
  await expect(
    page.getByText("No encontramos productos con esos criterios.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Consultar con nuestro equipo" }),
  ).toHaveAttribute("href", "/contacto");
  await page.getByRole("link", { name: "Limpiar búsqueda y filtros" }).click();
  await expect(page).toHaveURL(/\/buscar$/);
  await expect(page.getByLabel("Número de parte o descripción")).toHaveValue(
    "",
  );
  await context.close();
});
for (const width of [390, 1440]) {
  for (const route of [
    "/",
    "/catalogo",
    "/buscar",
    "/contacto",
    "/nosotros",
    "/marcas",
    "/categorias",
    "/diseno/ficha",
    "/diseno/categoria",
  ]) {
    test(`Web pública ${route} ${width}: sin JavaScript, accesibilidad y diseño`, async ({
      browser,
    }) => {
      const { pagesForCatalog } = await import("../build.mjs");
      const { validateCatalog } = await import("../catalog.mjs");
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        javaScriptEnabled: false,
      });
      const page = await context.newPage();
      try {
        const response = await page.goto(`http://127.0.0.1:4501${route}`);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.locator("main")).toBeVisible();
        if (route === "/contacto") {
          const delivery = page
            .locator(".business-faq details")
            .filter({ hasText: "¿Cómo puedo recibir mis refacciones?" });
          await delivery.locator("summary").click();
          await expect(delivery).toContainText("por cobrar");
          await expect(delivery).toHaveAttribute("open", "");
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        expect(overflow).toBe(false);
        await page.screenshot({
          path: `.artifacts/web021-${route.replaceAll("/", "_") || "inicio"}-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("navigation", { name: "Navegación principal" })
          .getByRole("link", { name: "Catálogo", exact: true })
          .click();
        await expect(page).toHaveURL(/\/catalogo$/);
        await expect(
          page.getByText("Todavía no hay productos publicados.", {
            exact: false,
          }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
      const contextAxe = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      const accessible = await contextAxe.newPage();
      try {
        await accessible.goto(`http://127.0.0.1:4501${route}`);
        const report = await new AxeBuilder({ page: accessible })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          report.violations.filter(
            (issue) =>
              issue.impact === "serious" || issue.impact === "critical",
          ),
        ).toEqual([]);
      } finally {
        await contextAxe.close();
      }
    });
  }
}

for (const width of [320, 768]) {
  test(`Reflujo y teclado ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/nosotros", "/diseno/ficha", "/contacto"]) {
      await page.goto(route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al contenido" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    for (const link of await nav.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("ficha con alternativa revisada: enlace y accesibilidad móvil con fixture aislada", async ({
  page,
}) => {
  const { pagesForCatalog } = await import("../build.mjs");
  const { validateCatalog } = await import("../catalog.mjs");
  const base = {
    status: "published",
    approved: true,
    code: "TEST",
    brand: "Fixture interna",
    category: "Fixture",
    title: "Fixture interna",
    description: "Solo prueba interceptada, sin publicación operativa",
    applications: [],
    references: [],
    specifications: [],
  };
  const products = validateCatalog({
    schemaVersion: 1,
    products: [
      {
        ...base,
        slug: "fixture-origin",
        alternatives: ["fixture-alternative"],
      },
      { ...base, slug: "fixture-alternative", title: "Alternativa interna" },
    ],
  });
  const html = pagesForCatalog(products);
  await page.route("**/productos/fixture-*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html.get(new URL(route.request().url()).pathname)!,
    }),
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/productos/fixture-origin");
  await expect(page.getByLabel("Cantidad a consultar")).toHaveValue("1");
  await expect(
    page.getByRole("button", { name: "Preparar consulta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Información del producto" }),
  ).toBeVisible();
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({
    path: ".artifacts/public-product-mobile.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("region", { name: "Alternativas revisadas" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    report.violations.filter(
      (issue) => issue.impact === "serious" || issue.impact === "critical",
    ),
  ).toEqual([]);
  await page
    .getByRole("link", { name: "Alternativa interna", exact: true })
    .click();
  await expect(page).toHaveURL(/\/productos\/fixture-alternative$/);
});

for (const width of [390, 1440])
  test(`Ampliación PNG sin JavaScript ${width}`, async ({ browser }) => {
    const { pagesForCatalog } = await import("../build.mjs");
    const { validateCatalog } = await import("../catalog.mjs");
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 900 });
    const bytes = await page.screenshot({
      clip: { x: 0, y: 0, width: 800, height: 800 },
    });
    const small = await page.screenshot({
      clip: { x: 0, y: 0, width: 400, height: 400 },
    });
    const smallHash = createHash("sha256").update(small).digest("hex");
    await page.setViewportSize({ width, height: 900 });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const products = validateCatalog({
      schemaVersion: 1,
      products: [
        {
          slug: "fixture-zoom",
          status: "published",
          approved: true,
          code: "TEST",
          brand: "Fixture",
          category: "Fixture",
          title: "Prueba ampliación",
          description: "Fixture aislada",
          applications: [],
          references: [],
          specifications: [],
          images: [
            {
              file: "fixture.png",
              sha256: hash,
              width: 800,
              height: 800,
              authorized: true,
              alt: "Imagen aislada",
              variants: [
                {
                  file: "small.png",
                  sha256: smallHash,
                  width: 400,
                  height: 400,
                  authorized: true,
                  alt: "Imagen aislada",
                },
              ],
            },
          ],
        },
      ],
    });
    const html = pagesForCatalog(products);
    await page.route("**/productos/fixture-zoom", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: html.get("/productos/fixture-zoom")!,
      }),
    );
    await page.route(`**/media/${hash}.png`, (route) =>
      route.fulfill({ contentType: "image/png", body: bytes }),
    );
    await page.route(`**/media/${smallHash}.png`, (route) =>
      route.fulfill({ contentType: "image/png", body: small }),
    );
    await page.route("**/catalogo", (route) =>
      route.fulfill({ contentType: "text/html", body: html.get("/catalogo")! }),
    );
    await page.goto("http://127.0.0.1:4501/catalogo");
    await page.locator(".product-thumbnail img").scrollIntoViewIfNeeded();
    await expect(page.locator(".product-thumbnail img")).toHaveJSProperty(
      "complete",
      true,
    );
    expect(
      await page
        .locator(".product-thumbnail img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(400);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.artifacts/public-thumbnail-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Prueba ampliación", exact: true })
      .click();
    await page.goto("http://127.0.0.1:4501/productos/fixture-zoom");
    const photo = page.locator(".public-product-image");
    await expect(photo).toHaveJSProperty("complete", true);
    expect(
      await photo.evaluate((img: HTMLImageElement) => img.currentSrc),
    ).toContain(width === 390 ? smallHash : hash);
    await page
      .getByRole("link", { name: "Ampliar imagen: Imagen aislada" })
      .click();
    const zoom = page.getByRole("region", {
      name: "Imagen ampliada: Imagen aislada",
    });
    await expect(zoom).toBeVisible();
    expect(
      await zoom
        .getByRole("img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth === 800,
        ),
    ).toBe(true);
    await zoom.getByRole("link", { name: "Cerrar ampliación" }).click();
    await expect(zoom).toBeHidden();
    await context.close();
  });
test("navegación paginada de catálogo y marca sin JavaScript", async ({
  browser,
}) => {
  const { validateCatalog } = await import("../catalog.mjs");
  const { pagesForCatalog } = await import("../build.mjs");
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const products = validateCatalog({
    schemaVersion: 1,
    products: Array.from({ length: 13 }, (_, index) => ({
      slug: `navigation-${index}`,
      status: "published",
      approved: true,
      code: `OEM-${index}`,
      brand: "Marca navegable",
      category: "Familia revisada",
      title: `Ficha ${index}`,
      description: "Fixture aislada",
      applications: [],
      references: [],
      specifications: [],
    })),
  });
  const html = pagesForCatalog(products);
  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = html.get(pathname);
    if (body) await route.fulfill({ contentType: "text/html", body });
    else await route.continue();
  });
  await page.goto("http://127.0.0.1:4501/catalogo");
  await expect(
    page.locator("section[aria-label='Resultados'] article"),
  ).toHaveCount(12);
  await page.getByRole("link", { name: "Página siguiente" }).click();
  await expect(
    page.locator("section[aria-label='Resultados'] article"),
  ).toHaveCount(1);
  await page
    .locator("section[aria-label='Resultados']")
    .getByRole("link", { name: "Marca navegable" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Marca navegable" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Página siguiente" }).click();
  await page.locator("section[aria-label='Resultados'] h2 a").click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await context.close();
});

test("consulta de pieza no publicada conserva datos y no envía automáticamente", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/consulta");
    await page
      .getByLabel("Número de parte", { exact: true })
      .fill("OEM-INDICADO");
    await page.getByLabel("Marca (opcional)").fill("Marca indicada");
    await page.getByLabel("Cantidad solicitada").fill("3");
    await page.getByRole("button", { name: "Preparar consulta" }).click();
    await expect(page.locator(".inquiry-message")).toContainText(
      "OEM-INDICADO",
    );
    await expect(page.locator(".inquiry-message")).toContainText("Cantidad: 3");
    await expect(
      page.getByRole("link", { name: "Preparar mensaje en WhatsApp" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".artifacts/public-free-inquiry-mobile.png",
      fullPage: true,
    });
    await page.goto("/consulta/?parte=OEM-INDICADO&cantidad=3");
    await expect(page).toHaveURL(/\/consulta\?parte=OEM-INDICADO&cantidad=3$/);
  } finally {
    await context.close();
  }
  const accessible = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const pageAxe = await accessible.newPage();
    await pageAxe.goto("/consulta?parte=OEM-INDICADO&cantidad=3");
    const report = await new AxeBuilder({ page: pageAxe }).analyze();
    expect(
      report.violations.filter(
        (issue) => issue.impact === "serious" || issue.impact === "critical",
      ),
    ).toEqual([]);
  } finally {
    await accessible.close();
  }
});
