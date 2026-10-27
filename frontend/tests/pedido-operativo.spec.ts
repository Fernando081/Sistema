import { expect, test } from '@playwright/test';
import { installErpApiMock, login } from './helpers/erp-api.mock';

test('crea, reserva, surte, entrega y factura un pedido desde la interfaz', async ({ page }) => {
  await installErpApiMock(page);
  await login(page);
  await page.getByRole('button', { name: 'Nuevo pedido' }).click();
  await page.getByRole('combobox', { name: 'Cliente', exact: true }).click();
  await page.getByRole('option', { name: /Transportes del Golfo/ }).click();
  await page.getByLabel('Unidad / motor').click();
  await page.getByRole('option', { name: /T-14/ }).click();
  await page.getByLabel('Agregar producto').fill('FILTRO');
  await page.getByRole('option', { name: /FILTRO-ISX/ }).click();
  await expect(page.getByText('Disponible 12')).toBeVisible();
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await expect(page.getByRole('heading', { name: /Pedido 9001/ })).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar y apartar' }).click();
  await expect(page.getByText('Confirmado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar surtido' }).click();
  await expect(page.locator('.order-summary .badge', { hasText: 'Surtido' })).toBeVisible();
  await expect(page.getByText(/Principal · GENERAL/)).toBeVisible();

  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  const delivery=page.getByRole('dialog').last();
  await delivery.getByLabel('Nombre de quien recibe',{exact:true}).fill('Encargado de patio');
  await delivery.getByLabel('Si no hay firma ni foto, explica el motivo',{exact:true}).fill('Recepción de prueba en mostrador sin cámara');
  await delivery.getByRole('checkbox').check();
  await delivery.getByRole('button',{name:'Registrar entrega y conservar evidencias',exact:true}).click();
  await expect(delivery.getByRole('heading',{name:'Entrega registrada',exact:true})).toBeVisible();
  await expect(delivery.getByText('Encargado de patio',{exact:true})).toBeVisible();
  await delivery.getByRole('button',{name:'Cerrar',exact:true}).click();
  await expect(page.getByText('Entregado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Facturar pedido' }).click();
  await page.locator('mat-dialog-container').filter({ hasText: 'Se generará la venta con los datos fiscales' }).getByRole('button', { name: 'Generar factura' }).click();
  await expect(page.getByText('Facturado', { exact: true })).toBeVisible();
});
