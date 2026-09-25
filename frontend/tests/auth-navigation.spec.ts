import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test.beforeEach(async ({ page }) => installErpApiMock(page));

test('protege rutas privadas, inicia sesión y cierra la sesión', async ({ page }) => {
  await page.goto('/pedidos');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fpedidos/);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Pedidos de venta' })).toBeVisible();
  await expect(page.getByLabel('Navegación principal')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('la búsqueda global conserva cliente, VIN y ESN', async ({ page }) => {
  await login(page, '/crm');
  const search = page.getByLabel('Búsqueda global');
  await search.fill('ISX-7788');
  await expect(page.getByText('T-14 · ISX-7788')).toBeVisible();
  await expect(page.getByRole('button', { name: /Transportes del Golfo XAXX010101000/ })).toBeVisible();
});
