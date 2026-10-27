import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const preparation = JSON.parse(await readFile(join(root, ".artifacts/web-test-pilot.json"), "utf8"));
if (preparation.status !== "prepared-test-pilot") throw new Error("Preparación verificada requerida");
const { products } = JSON.parse(await readFile(join(root, `.runtime/web-test-pilot-${preparation.runId}/catalog-test.json`), "utf8"));
const browser = await chromium.launch({ headless: true });
const checks = [];
const verify = (condition, name) => { checks.push({ name, passed: !!condition }); if (!condition) throw new Error("Verificación no aprobada: " + name); };
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
    const page = await context.newPage();
    const origin = "http://127.0.0.1:4600";
    const response = await page.goto(origin + "/catalogo");
    verify(response.status() === 200 && response.headers()["x-robots-tag"] === "noindex, nofollow", `catalog-http-${width}`);
    verify(await page.locator(".preview-bar").textContent() === "Piloto técnico · Datos de prueba · Sin oferta comercial", `test-context-${width}`);
    for (const product of products) verify(await page.locator(`a[href="/productos/${product.slug}"]`).count() >= 1, `catalog-link-${product.slug}-${width}`);
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `catalog-reflow-${width}`);
    await page.screenshot({ path: join(root, `.artifacts/web-test-pilot-catalog-${width}.png`), fullPage: true });
    for (const product of products) {
      const response = await page.goto(origin + "/productos/" + product.slug);
      verify(response.status() === 200, `product-http-${product.slug}-${width}`);
      verify((await page.locator("main").textContent()).includes(product.code), `original-code-${product.slug}-${width}`);
      verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `product-reflow-${product.slug}-${width}`);
      const images = page.locator('main img.public-product-image[src^="/media/"]');
      if (product.images?.length) {
        verify(await images.count() > 0 && await images.evaluateAll(items => items.every(item => item.complete && item.naturalWidth > 0)), `product-image-${product.slug}-${width}`);
        await page.screenshot({ path: join(root, `.artifacts/web-test-pilot-product-${product.slug}-${width}.png`), fullPage: true });
        const gallery = page.locator('a[href^="#imagen-"]');
        if (await gallery.count()) {
          await gallery.first().click();
          verify(await page.locator('.image-zoom:target').isVisible(), `image-zoom-${product.slug}-${width}`);
          await page.locator('.image-zoom:target .zoom-close').click();
          verify(await page.locator('.image-zoom:target').count() === 0, `image-zoom-close-${product.slug}-${width}`);
        }
      } else verify((await page.locator("main").textContent()).includes("Fotografías pendientes"), `missing-image-${product.slug}-${width}`);
      await page.goto(origin + "/buscar?q=" + encodeURIComponent(product.code));
      verify(await page.locator(`a[href="/productos/${product.slug}"]`).count() > 0, `exact-search-${product.slug}-${width}`);
    }
    verify(await page.locator('script').count() === 0, `no-client-scripts-${width}`);
    await context.close();
    const inspection = await browser.newContext({ viewport: { width, height: 900 } });
    const inspectedPage = await inspection.newPage();
    for (const path of ['/catalogo', ...products.filter(product => product.images?.length).map(product => '/productos/' + product.slug)]) {
      await inspectedPage.goto(origin + path);
      let timer;
      try {
        const audit = await Promise.race([new AxeBuilder({ page: inspectedPage }).analyze(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Accessibility timeout')), 30000); })]);
        verify(!audit.violations.some(item => ["serious", "critical"].includes(item.impact)), `axe-${path}-${width}`);
      } finally { clearTimeout(timer); }
    }
    await inspection.close();
  }
} finally {
  await browser.close();
  const report = { generatedAt: new Date().toISOString(), runId: preparation.runId, origin: "http://127.0.0.1:4600",
    javaScriptClientEnabled: false, commercialAccepted: false, passed: checks.filter(item => item.passed).length, total: checks.length, checks };
  await writeFile(join(root, ".artifacts/web-test-pilot-ui.json"), JSON.stringify(report, null, 2));
  console.log(`UI del piloto de prueba: ${report.passed}/${report.total}.`);
  if (report.passed !== report.total) process.exitCode = 1;
}
