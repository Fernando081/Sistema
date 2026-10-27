import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
for (const width of [390, 1440])
  test(`solicitud multipieza ${width} sin JavaScript conserva datos tras timeout y confirma por POST`, async ({
    browser,
  }) => {
    const { build } = await import("../build.mjs");
    const { createPreviewServer } = await import("../server.mjs");
    const directory = await mkdtemp(join(tmpdir(), "rtt-form-ui-"));
    const received = [];
    let releaseReceipt;
    const config = {
      privacyApproved: true,
      privacyVersion: "fixture-v1",
      privacyText:
        "Aviso fixture para prueba aislada; no es un aviso operativo.",
      origin: "http://127.0.0.1",
      key: Buffer.alloc(32, 1),
      storageTimeoutMs: 100,
      receive: async (lead) => {
        if (!canReceive)
          return new Promise((resolve) => {
            releaseReceipt = resolve;
          });
        received.push(lead);
      },
    };
    let canReceive = false;
    let server, context, qaContext;
    try {
      await build(directory);
      server = await createPreviewServer(directory, { intake: config });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      config.origin = `http://127.0.0.1:${server.address().port}`;
      context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(config.origin + "/solicitar");
      await page.getByLabel("Nombre de contacto").fill("Contacto fixture");
      await page
        .getByLabel("Correo o teléfono internacional")
        .fill("fixture@example.com");
      await page
        .getByRole("group", { name: "Pieza 1", exact: true })
        .getByLabel("Número de parte", { exact: true })
        .fill("OEM-INDICADO");
      await page
        .getByRole("group", { name: "Pieza 1", exact: true })
        .getByLabel("Cantidad", { exact: true })
        .fill("3");
      await page.getByText("Pieza 2 (opcional)", { exact: true }).click();
      const second = page.getByRole("group", { name: "Pieza 2", exact: true });
      await second
        .getByLabel("Número de parte", { exact: true })
        .fill("OTRA-PIEZA");
      await second.getByLabel("Cantidad", { exact: true }).fill("4");
      const requestId = await page.locator('[name="requestId"]').inputValue();
      await page.getByRole("checkbox").check();
      const [failed] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().endsWith("/solicitudes"),
        ),
        page.getByRole("button", { name: "Enviar solicitud" }).click(),
      ]);
      expect(failed.status()).toBe(503);
      await expect(page.getByRole("alert")).toContainText(
        "No pudimos confirmar",
      );
      await expect(page.getByRole("alert")).toContainText(
        "El envío pudo haber quedado registrado",
      );
      releaseReceipt?.();
      await expect(
        second.getByLabel("Número de parte", { exact: true }),
      ).toHaveValue("OTRA-PIEZA");
      await expect(second.getByLabel("Cantidad", { exact: true })).toHaveValue(
        "4",
      );
      await expect(page.locator('[name="requestId"]')).toHaveValue(requestId);
      expect(received.length).toBe(0);
      canReceive = true;
      await page.getByRole("checkbox").check();
      const [submitted] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().endsWith("/solicitudes"),
        ),
        page.getByRole("button", { name: "Enviar solicitud" }).click(),
      ]);
      expect(
        submitted.status(),
        JSON.stringify({
          origin: (await submitted.request().allHeaders()).origin,
          type: (await submitted.request().allHeaders())["content-type"],
        }),
      ).toBe(202);
      await expect(
        page.getByRole("heading", { name: "Solicitud recibida" }),
      ).toBeVisible();
      expect(new URL(page.url()).search).toBe("");
      expect(received.length).toBe(1);
      expect(received[0].items[0].quantity).toBe(3);
      expect(received[0].items[1].quantity).toBe(4);
      expect(received[0].requestId).toBe(requestId);
      expect(received[0].items).toHaveLength(2);
      qaContext = await browser.newContext({
        viewport: { width, height: 844 },
      });
      const qa = await qaContext.newPage();
      await qa.goto(config.origin + "/solicitar");
      const disclosure = qa.getByText("Pieza 2 (opcional)", { exact: true });
      await disclosure.focus();
      await qa.keyboard.press("Enter");
      await expect(qa.locator("#lead-code2")).toBeVisible();
      expect((await new AxeBuilder({ page: qa }).analyze()).violations).toEqual(
        [],
      );
      expect(
        await qa.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 1440) {
        const notice = await qa
          .getByRole("heading", { name: "Aviso de privacidad" })
          .locator("..")
          .boundingBox();
        expect(notice?.height).toBeLessThan(500);
      }
      // Axe keyboard checks may leave the skip link focused; focus the piece field
      // for a representative capture of the opened native disclosure.
      await qa.locator("#lead-code2").focus();
      await qa.evaluate(() => window.scrollTo(0, 0));
      await qa.screenshot({
        path: `.artifacts/public-lead-form-${width === 390 ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
      await qa.close();
    } finally {
      releaseReceipt?.();
      if (qaContext) await qaContext.close();
      if (context) await context.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
