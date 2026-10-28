import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// O01.2b · Envío por correo desde Salida de documentos: elegir modo, ver estados del envío y conciliar un Incierto.
const correo = (extra = {}) => ({ modo: 'smtp', habilitado: true, servidor: 'smtp.local:2525', tls: 'STARTTLS obligatorio', autenticacion: true, remitente: 'erp@refacciones.test',
  dominiosPermitidos: [], maxIntentos: 4, problemas: [], destinatarioPermitido: true, disponible: true, ...extra });
const base = { creadaEn: '2026-10-28T18:00:00Z', ambiente: 'mock', bytes: 7520, pdfSha256: 'a'.repeat(64), autor: 'admin-e2e', cerradaEn: null, motivo: null,
  destinatario: 'cliente@example.invalid', asunto: 'Documento F7', respuestaSmtp: null, proximoIntento: null, ultimoError: null };

test('salida de documentos: enviar por correo y conciliar un envío incierto', async ({ page }) => {
  await installErpApiMock(page);
  let historial = [
    { ...base, id: '11111111-1111-4111-8111-111111111111', modo: 'Correo', estado: 'Incierto', envioEstado: 'Incierto', intentos: 1, maxIntentos: 4, ultimoError: 'Sin respuesta final del servidor' },
    { ...base, id: '22222222-2222-4222-8222-222222222222', modo: 'Correo', estado: 'Reintento', envioEstado: 'Reintento', intentos: 1, maxIntentos: 4, proximoIntento: '2026-10-28T18:05:00Z', ultimoError: '451 Intenta más tarde' },
    { ...base, id: '33333333-3333-4333-8333-333333333333', modo: 'Local', estado: 'Preparado', envioEstado: null, intentos: null, maxIntentos: null },
  ];
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/v1/venta/7/preparar-correo', (route) => route.fulfill({ json: { idFactura: 7, folio: 'F7', destinatario: 'cliente@example.invalid', asunto: 'Documento F7', ambiente: 'mock', evaluacionSha256: 'b'.repeat(64), modo: 'Local', correo: correo() } }));
  await page.route('**/api/v1/venta/7/correos?*', (route) => route.fulfill({ json: { data: historial, total: historial.length, page: 1, correo: correo() } }));
  await page.route('**/api/v1/venta/7/enviar-correo', (route) => { posts.push({ url: 'preparar', body: route.request().postDataJSON() }); return route.fulfill({ status: 201, json: { id: '44444444-4444-4444-8444-444444444444', modo: 'Correo' } }); });
  await page.route('**/api/v1/venta/7/correos/*/conciliar', (route) => {
    posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    historial = historial.map((h) => h.estado === 'Incierto' ? { ...h, estado: 'Reintento', envioEstado: 'Reintento' } : h);
    return route.fulfill({ status: 201, json: { id: historial[0].id, accion: 'Reintentar' } });
  });
  await login(page, '/facturas/correos?factura=7');
  await expect(page.getByText('Envío por correo activo', { exact: false })).toBeVisible();
  // Estados del envío en el historial
  await expect(page.getByRole('heading', { name: /^Incierto · Correo/ })).toBeVisible();
  await expect(page.getByText('No se sabe si el servidor recibió el correo', { exact: false })).toBeVisible();
  await expect(page.getByText('Intentos 1 de 4', { exact: false }).first()).toBeVisible();
  // Local se simula; Correo no
  await expect(page.getByRole('button', { name: 'Simular procesamiento' })).toHaveCount(1);
  // Enviar por correo
  await page.getByRole('button', { name: 'Revisar destinatario y documento' }).click();
  await page.getByRole('button', { name: 'Enviar por correo' }).click();
  await expect(page.getByRole('dialog')).toContainText('correo REAL a cliente@example.invalid');
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar por correo' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body).toEqual(expect.objectContaining({ modo: 'Correo', confirmacion: true, evaluacionSha256: 'b'.repeat(64) }));
  await expect(page.getByRole('status').filter({ hasText: 'Correo en cola de envío' })).toBeVisible();
  // Conciliar exige motivo
  const reintentar = page.getByRole('button', { name: 'Reintentar envío' });
  await expect(reintentar).toBeDisabled();
  await page.getByLabel('Motivo para cancelar o conciliar una solicitud').fill('El cliente no lo recibió');
  await reintentar.click();
  await expect(page.getByRole('dialog')).toContainText('recibirá el correo dos veces');
  await page.getByRole('dialog').getByRole('button', { name: 'Reintentar envío' }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].url).toContain('/correos/11111111-1111-4111-8111-111111111111/conciliar');
  expect(posts[1].body).toEqual(expect.objectContaining({ accion: 'Reintentar', motivo: 'El cliente no lo recibió', confirmacion: true }));
  const axe = await new AxeBuilder({ page }).include('.campaign-page').analyze();
  expect(axe.violations).toEqual([]);
});

test('salida de documentos: sin configuración sólo permite local y explica el motivo', async ({ page }) => {
  await installErpApiMock(page);
  const off = { ...correo(), modo: 'desactivado', habilitado: false, disponible: false, servidor: null, remitente: null, problemas: [] };
  await page.route('**/api/v1/venta/7/preparar-correo', (route) => route.fulfill({ json: { idFactura: 7, folio: 'F7', destinatario: 'cliente@example.invalid', asunto: 'Documento F7', ambiente: 'mock', evaluacionSha256: 'b'.repeat(64), modo: 'Local', correo: off } }));
  await page.route('**/api/v1/venta/7/correos?*', (route) => route.fulfill({ json: { data: [], total: 0, page: 1, correo: off } }));
  await login(page, '/facturas/correos?factura=7');
  await expect(page.getByText('Envío externo desactivado.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar destinatario y documento' }).click();
  await expect(page.getByRole('button', { name: 'Preparar solicitud local' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar por correo' })).toHaveCount(0);
});
