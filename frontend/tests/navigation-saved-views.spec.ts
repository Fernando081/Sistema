import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// U02.1 · Navegación rápida: Ctrl K encuentra pantallas (sin acentos), se recorre con flechas y recuerda recientes.
test('Ctrl K: pantallas por nombre, flechas, Enter y recientes', async ({ page }) => {
  await installErpApiMock(page);
  await page.route('**/api/v1/cotizacion?*', (route) => route.fulfill({ json: { data: [], total: 0, page: 1, totalPages: 0 } }));
  await login(page, '/pedidos');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('searchbox', { name: 'Búsqueda global y navegación rápida' });
  await expect(search).toBeFocused();
  await search.fill('cotizacion');
  const results = page.getByRole('listbox', { name: 'Resultados de búsqueda' });
  await expect(results.getByRole('heading', { name: 'Pantallas' })).toBeVisible();
  await expect(results.getByRole('button', { name: /Cotizaciones/ })).toBeVisible();
  await expect(results.getByRole('button', { name: /Nueva cotización/ })).toBeVisible();
  // Una letra basta para pantallas; la búsqueda de productos sigue pidiendo 2 caracteres.
  await search.fill('c');
  await expect(results.getByText('Escribe al menos 2 caracteres', { exact: false })).toHaveCount(0);
  await search.fill('historial cotiz');
  await search.press('ArrowDown');
  await expect(results.getByRole('button', { name: /Cotizaciones/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/cotizacion/historial');
  await expect(search).toHaveValue('');
  // Recientes: con el campo vacío aparecen las últimas pantallas visitadas.
  await search.focus();
  await expect(results.getByRole('heading', { name: 'Recientes' })).toBeVisible();
  await expect(results.getByRole('button', { name: /Cotizaciones/ })).toBeVisible();
  await expect(results.getByRole('button', { name: /Pedidos y backorders/ })).toBeVisible();
  await search.press('Escape');
  await expect(results).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('.topbar').analyze();
  expect(axe.violations).toEqual([]);
});

test('Ctrl K no ofrece pantallas de administrador a un operador', async ({ page }) => {
  await installErpApiMock(page);
  const operador = { idUser: 2, username: 'operador-e2e', role: 'user', isActive: true };
  await page.route('**/api/v1/auth/browser-state', (route) => route.fulfill({ json: { profile: operador, expiresAt: Math.floor(Date.now() / 1000) + 3600 } }));
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ status: 201, json: { profile: operador, expiresAt: Math.floor(Date.now() / 1000) + 3600 } }));
  await login(page, '/pedidos');
  const search = page.getByRole('searchbox', { name: 'Búsqueda global y navegación rápida' });
  await search.fill('contabilidad');
  const results = page.getByRole('listbox', { name: 'Resultados de búsqueda' });
  await expect(results.getByRole('button', { name: /Contabilidad/ })).toHaveCount(0);
  await search.fill('cobranza');
  await expect(results.getByRole('button', { name: /Cobranza/ })).toBeVisible();
});

// U02.2 · Vistas guardadas: guardar filtros actuales, abrirlos de nuevo y eliminarlos.
test('vistas guardadas en facturas: guardar, aplicar y eliminar', async ({ page }) => {
  await installErpApiMock(page);
  const vistas: Array<{ idVista: number; ruta: string; nombre: string; consulta: string; updatedAt: string }> = [];
  const saved: unknown[] = [];
  await page.route('**/api/v1/vistas-guardadas**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: vistas });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { ruta: string; nombre: string; consulta: string };
      saved.push(body);
      const consulta = new URLSearchParams(body.consulta); consulta.delete('page');
      const vista = { idVista: vistas.length + 1, ruta: body.ruta, nombre: body.nombre, consulta: consulta.toString(), updatedAt: new Date().toISOString() };
      vistas.push(vista);
      return route.fulfill({ status: 201, json: vista });
    }
    const id = Number(new URL(request.url()).pathname.split('/').pop());
    vistas.splice(vistas.findIndex((v) => v.idVista === id), 1);
    return route.fulfill({ json: { message: 'Vista eliminada' } });
  });
  const facturaQueries: URLSearchParams[] = [];
  await page.route('**/api/v1/factura/pagina?*', (route) => {
    facturaQueries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { data: [], total: 0, page: 1, totalPages: 0 } });
  });
  await page.route('**/api/v1/factura?*', (route) => {
    facturaQueries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { data: [], total: 0, page: 1, totalPages: 0 } });
  });
  await login(page, '/facturas');
  await page.goto('/facturas?estado=Pendiente&tipo=I&page=2&order=asc');
  const menuButton = page.getByRole('button', { name: 'Vistas guardadas de este listado' });
  await menuButton.click();
  await expect(page.getByText('Aún no tienes vistas en este listado.')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Guardar filtros actuales…' }).click();
  await page.getByRole('dialog').getByLabel('Nombre de la vista').fill('Pendientes de ingreso');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toEqual({ ruta: '/facturas', nombre: 'Pendientes de ingreso', consulta: 'order=asc&tipo=I&estado=Pendiente' });
  // La vista activa se refleja en el botón.
  await expect(menuButton).toContainText('Pendientes de ingreso');
  await page.goto('/facturas');
  await expect(menuButton).toContainText('Vistas');
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Pendientes de ingreso' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('estado')).toBe('Pendiente');
  expect(new URL(page.url()).searchParams.get('tipo')).toBe('I');
  expect(new URL(page.url()).searchParams.get('page')).toBeNull();
  await expect(menuButton).toContainText('Pendientes de ingreso');
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Eliminar «Pendientes de ingreso»' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect.poll(() => vistas.length).toBe(0);
  await expect(menuButton).toContainText('Vistas');
});
