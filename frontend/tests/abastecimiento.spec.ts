import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('registra una solicitud de abastecimiento con origen y costo', async ({ page }) => {
  await installErpApiMock(page);
  await login(page, '/abastecimiento');
  await page.getByRole('button', { name: 'Nueva solicitud' }).click();
  await page.getByLabel('Motivo').fill('Cubrir demanda de filtros ISX');
  await page.getByLabel('Producto').click();
  await page.getByRole('option', { name: /FILTRO-ISX/ }).click();
  await page.getByLabel('Cantidad').fill('6');
  await page.getByLabel('Costo estimado').fill('500');
  await page.getByRole('button', { name: 'Guardar solicitud' }).click();
  await expect(page.getByText('Cubrir demanda de filtros ISX')).toBeVisible();
  await expect(page.getByText(/SC-301 · Borrador/)).toBeVisible();
});
