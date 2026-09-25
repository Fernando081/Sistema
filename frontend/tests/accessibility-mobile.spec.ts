import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('login y pedidos no tienen infracciones WCAG A/AA de impacto crítico o serio', async ({ page }) => {
  await installErpApiMock(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  const loginResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(loginResults.violations.filter((item) => ['critical', 'serious'].includes(item.impact || ''))).toEqual([]);
  await login(page);
  await page.waitForTimeout(100);
  const orderResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(orderResults.violations.filter((item) => ['critical', 'serious'].includes(item.impact || ''))).toEqual([]);
});

test.use({ viewport: { width: 390, height: 844 } });
test('la operación móvil permite abrir navegación y pedidos sin desbordamiento horizontal', async ({ page }) => {
  await installErpApiMock(page);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Pedidos de venta' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByLabel('Navegación principal')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
