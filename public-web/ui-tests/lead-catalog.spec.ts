import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

for (const width of [390, 1440])
  test(`catálogo a solicitud mixta ${width}: selección, fallo y reintento sin JavaScript`, async ({
    browser,
  }) => {
    const { build, pagesForCatalog } = await import("../build.mjs");
    const { createPreviewServer } = await import("../server.mjs");
    const directory = await mkdtemp(join(tmpdir(), "rtt-catalog-ui-"));
    const products = ["a", "b"].map((suffix) => ({
      slug: "pieza-" + suffix,
      code: "OEM-" + suffix.toUpperCase(),
      brand: "Marca fixture",
      category: "Familia fixture",
      title: "Pieza fixture " + suffix,
      description: "Producto aislado de pruebas",
      status: "published",
      approved: true,
      applications: [],
      references: [],
      specifications: [],
    }));
    const received = [];
    let canReceive = false;
    const config = {
      privacyApproved: true,
      privacyVersion: "fixture-v1",
      privacyText:
        "Aviso fixture para prueba aislada; no es un aviso operativo.",
      key: Buffer.alloc(32, 1),
      origin: "http://127.0.0.1",
      receive: async (lead) => {
        if (!canReceive) throw new Error("Fallo fixture");
        received.push(lead);
      },
    };
    let server, context, qaContext;
    const query = "producto=pieza-a&cantidad=2&piezas=OEM-B%20%7C%204";
    try {
      await build(directory, pagesForCatalog(products), products);
      server = await createPreviewServer(directory, { intake: config });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      config.origin = `http://127.0.0.1:${server.address().port}`;
      context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(config.origin + "/cotizar?" + query);
      await page
        .getByRole("link", { name: "Continuar al formulario de solicitud" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Enviar solicitud" }),
      ).toBeVisible();
      const first = page.getByRole("group", { name: "Pieza 1", exact: true });
      const second = page.getByRole("group", { name: "Pieza 2", exact: true });
      await expect(
        first.getByLabel("Número de parte", { exact: true }),
      ).toHaveValue("OEM-A");
      await expect(
        first.getByLabel("Número de parte", { exact: true }),
      ).toHaveAttribute("readonly", "");
      await expect(second.getByLabel("Cantidad", { exact: true })).toHaveValue(
        "4",
      );
      await page.getByText("Pieza 3 (opcional)", { exact: true }).click();
      const third = page.getByRole("group", { name: "Pieza 3", exact: true });
      await third
        .getByLabel("Número de parte", { exact: true })
        .fill("REFERENCIA-LIBRE");
      await third.getByLabel("Cantidad", { exact: true }).fill("5");
      await page.getByLabel("Nombre de contacto").fill("Contacto fixture");
      await page
        .getByLabel("Correo o teléfono internacional")
        .fill("fixture@example.com");
      const id = await page.locator('[name="requestId"]').inputValue();
      await page.getByRole("checkbox").check();
      const submit = async () => {
        const [response] = await Promise.all([
          page.waitForResponse((response) =>
            response.url().endsWith("/solicitudes"),
          ),
          page.getByRole("button", { name: "Enviar solicitud" }).click(),
        ]);
        return response.status();
      };
      expect(await submit()).toBe(503);
      await expect(page.getByRole("alert")).toContainText(
        "No pudimos confirmar",
      );
      await expect(page.locator('[name="slug"]')).toHaveValue("pieza-a");
      await expect(page.locator('[name="slug2"]')).toHaveValue("pieza-b");
      await expect(
        third.getByLabel("Número de parte", { exact: true }),
      ).toHaveValue("REFERENCIA-LIBRE");
      await expect(page.locator('[name="requestId"]')).toHaveValue(id);
      expect(new URL(page.url()).search).toBe("");
      canReceive = true;
      await page.getByRole("checkbox").check();
      expect(await submit()).toBe(202);
      await expect(
        page.getByRole("heading", { name: "Solicitud recibida" }),
      ).toBeVisible();
      expect(received).toHaveLength(1);
      expect(received[0].requestId).toBe(id);
      expect(
        received[0].items.map(({ code, quantity, kind }) => [
          code,
          quantity,
          kind,
        ]),
      ).toEqual([
        ["OEM-A", 2, "catalog"],
        ["OEM-B", 4, "catalog"],
        ["REFERENCIA-LIBRE", 5, "reference"],
      ]);
      qaContext = await browser.newContext({
        viewport: { width, height: 844 },
      });
      const qa = await qaContext.newPage();
      await qa.goto(config.origin + "/solicitar?" + query);
      expect((await new AxeBuilder({ page: qa }).analyze()).violations).toEqual(
        [],
      );
      expect(
        await qa.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await qa.locator("#lead-code").focus();
      await qa.evaluate(() => window.scrollTo(0, 0));
      await qa.screenshot({
        path: `.artifacts/public-lead-catalog-${width}.png`,
        fullPage: true,
      });
    } finally {
      if (qaContext) await qaContext.close();
      if (context) await context.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
