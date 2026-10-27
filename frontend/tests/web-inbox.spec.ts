import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';
for (const theme of ['light', 'dark']) {
  test(`Puente privado: error y transición sin secretos ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    await page.route('**/api/v1/crm/solicitudes-web**', route => route.fulfill({ json: [] }));
    let failed = true;
    await page.route('**/api/v1/crm/solicitudes-web/puente', route => {
      if (failed) { failed = false; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { enabled: false, configured: true, mode: 'v2', activeKeyId: 'fixture-2',
        previous: { keyId: 'fixture-1', from: '2026-10-10T12:00:00Z', until: '2026-10-10T13:00:00Z', accepting: false } } });
    });
    await login(page, '/crm');
    await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('.bridge-check');
    await panel.getByText('Estado del puente de recepción', { exact: true }).click();
    await panel.getByRole('button').click();
    await expect(panel.getByRole('alert')).toContainText('No se pudo comprobar');
    await expect(page.locator('.app-notification')).toHaveCount(0);
    await panel.getByRole('button').click();
    await expect(panel).toContainText('Receptor backend: Cerrado');
    await expect(panel).toContainText('ID de firma activa: fixture-2');
    await expect(panel).toContainText('Fuera del intervalo');
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.artifacts/web-bridge-${theme}.png`, fullPage: true });
  });
}
for (const theme of ['light', 'dark']) {
  test(`Resolución conservadora: decisión incierta, reintento e historial ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const status = { requestId: id, estado: 'Pendiente', version: 1, contenido: 'Vigente', idOportunidad: null,
      createdAt: '2026-10-10T12:00:00Z', expiresAt: '2027-01-08T12:00:00Z' };
    const decisions: Record<string, unknown>[] = [];
    const bodies: Record<string, unknown>[] = [];
    let failHistory = false;
    let historyCalls = 0;
    let releaseInitialHistory: (() => void) | undefined;
    const initialHistory = new Promise<void>(resolve => { releaseInitialHistory = resolve; });
    await page.route('**/api/v1/crm/solicitudes-web**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        expect(path).toBe('/api/v1/crm/solicitudes-web/' + id + '/resolver');
        const body = route.request().postDataJSON(); bodies.push(body);
        expect(body).toMatchObject({ motivo: 'Clave', expectedVersion: 1, originalVerificado: true });
        expect(body.operationId).toMatch(/^[a-f0-9-]{36}$/);
        if (bodies.length === 1) {
          status.version = 2;
          decisions.push({ ...body, requestId: id, decision: 'ConservarOriginal', version: 2,
            idAutor: 1, contenido: 'Vigente', idOportunidad: null, createdAt: status.createdAt });
          return route.fulfill({ status: 503, json: {} }); // Commit succeeded, receipt failed.
        }
        expect(body).toEqual(bodies[0]);
        return route.fulfill({ status: 201, json: decisions[0] });
      }
      if (path.endsWith('/estado')) return route.fulfill({ json: status });
      if (path.endsWith('/resoluciones')) {
        if (++historyCalls === 1) {
          await initialHistory;
          return route.fulfill({ json: [] }); // Old read must not replace the post-decision history.
        }
        return route.fulfill(failHistory ? { status: 503, json: {} } : { json: decisions });
      }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm');
    await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const receipt = page.locator('.receipt-check');
    await receipt.getByLabel('Identificador de solicitud', { exact: true }).fill(id);
    await receipt.getByRole('button', { name: 'Consultar estado' }).click();
    const panel = page.locator('.resolution-panel');
    const save = panel.getByRole('button', { name: 'Guardar decisión: conservar original' });
    await expect(save).toBeDisabled();
    await panel.getByLabel('Motivo de la revisión').selectOption('Clave');
    await panel.getByRole('checkbox', { name: /Comprobé el estado/ }).check();
    await save.click();
    await expect(panel.getByRole('alert')).toContainText('pudo haberse registrado');
    await expect(page.locator('.app-notification')).toHaveCount(0);
    await expect(receipt.getByLabel('Identificador de solicitud', { exact: true })).toBeDisabled();
    await expect(panel.getByLabel('Motivo de la revisión')).toBeDisabled();
    await panel.getByRole('button', { name: 'Reintentar la misma decisión' }).click();
    await expect(panel).toContainText('Decisión registrada');
    await expect(panel.locator('li')).toContainText('Conservar original · Clave');
    const oldHistoryResponse = page.waitForResponse(response => response.url().endsWith('/resoluciones'));
    releaseInitialHistory?.();
    await oldHistoryResponse;
    await expect(panel.locator('li')).toHaveCount(1);
    await expect(save).toBeDisabled();
    expect(bodies.length).toBe(2);
    failHistory = true;
    await receipt.getByRole('button', { name: 'Consultar estado' }).click();
    await expect(panel.getByRole('alert')).toContainText('historial');
    failHistory = false;
    await panel.getByRole('button', { name: 'Reintentar historial' }).click();
    await expect(panel.locator('li')).toHaveCount(1);
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.artifacts/web-resolution-${theme}.png`, fullPage: true });
    await receipt.getByRole('button', { name: 'Limpiar consulta' }).click();
    await expect(panel).toHaveCount(0);
  });
}
test('Ficha muestra piezas originales de consulta web', async ({ page }) => {
  await installErpApiMock(page);
  await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
  const opportunity = { idOportunidad: 12, empresa: 'Ficha fixture', tipoCliente: 'Otro', etapa: 'Prospecto', montoEstimado: 0, version: 1 };
  await page.route('**/api/v1/crm/oportunidades**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/consulta-web')) return route.fulfill({ json: { requestId: 'fixture', piezas: [{ code: 'OEM-ORIGINAL', quantity: 4, brand: 'Marca fixture' }] } });
    if (path.endsWith('/seguimientos')) return route.fulfill({ json: { data: [], total: 0 } });
    if (path.endsWith('/unidades')) return route.fulfill({ json: [] });
    return route.fulfill({ json: path.endsWith('/12') ? opportunity : { data: [opportunity], total: 1 } });
  });
  await login(page, '/crm');
  await page.getByRole('button', { name: 'Ficha fixture', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consulta web original' })).toBeVisible();
  await expect(page.getByText('OEM-ORIGINAL', { exact: true })).toBeVisible();
  await expect(page.getByText('Cantidad: 4', { exact: false })).toBeVisible();
});
for (const theme of ['light', 'dark']) {
  test(`Bandeja web: error, revisión y vacío ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let failed = true; let reviewed = false;
    await page.route('**/api/v1/crm/solicitudes-web**', async route => {
      if (route.request().method() === 'PATCH') {
        expect(route.request().postDataJSON()).toEqual({ estado: 'Revisada', expectedVersion: 1 });
        reviewed = true;
        return route.fulfill({ json: { version: 2 } });
      }
      if (failed) { failed = false; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: reviewed ? [] : [{ requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        estado: 'Pendiente', version: 1, createdAt: '2026-10-08T12:00:00Z',
        payload: { contact: { name: 'Contacto fixture', channel: 'email', value: 'fixture@example.com' },
          items: [{ code: 'OEM-PRUEBA', quantity: 3, brand: 'Marca fixture' }] } }] });
    });
    await login(page, '/crm');
    await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    await expect(page.locator('app-crm-solicitudes-web').getByRole('alert')).toContainText('No se pudo cargar');
    await page.getByRole('button', { name: 'Actualizar bandeja' }).click();
    await expect(page.getByText('OEM-PRUEBA', { exact: true })).toBeVisible();
    await expect(page.getByText('Cantidad: 3', { exact: false })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.artifacts/web-inbox-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Marcar revisada: Contacto fixture' }).click();
    await expect(page.getByText('No hay solicitudes vigentes en esta página.')).toBeVisible();
    await expect(page.locator('app-crm-solicitudes-web').getByRole('status')).toContainText('no crea una oportunidad');
  });
}
test('Conversión conserva vínculo y retira acciones de modificación', async ({ page }) => {
  await installErpApiMock(page);
  await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [
    { idUser: 2, username: 'Vendedor fixture', role: 'user', isActive: true },
    { idUser: 3, username: 'Usuario inactivo', role: 'user', isActive: false },
  ] }));
  let converted = false; let calls = 0;
  await page.route('**/api/v1/crm/solicitudes-web**', async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ expectedVersion: 1, idResponsable: 2 });
      calls++; converted = true;
      return route.fulfill({ json: { idOportunidad: 12 } });
    }
    return route.fulfill({ json: [{ requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      estado: converted ? 'Revisada' : 'Pendiente', version: converted ? 2 : 1,
      idOportunidad: converted ? 12 : null, createdAt: '2026-10-08T12:00:00Z',
      payload: { contact: { name: 'Fixture conversión', channel: 'email', value: 'fixture@example.com' },
        items: [{ code: 'PIEZA-1', quantity: 4 }] } }] });
  });
  await login(page, '/crm');
  await page.getByRole('tab', { name: 'Solicitudes web' }).click();
  await expect(page.getByRole('option', { name: 'Usuario inactivo' })).toHaveCount(0);
  await page.getByLabel('Responsable de las nuevas oportunidades').selectOption({ label: 'Vendedor fixture' });
  await page.getByRole('button', { name: 'Crear oportunidad: Fixture conversión' }).click();
  await expect(page.getByText('Oportunidad CRM #12')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear oportunidad: Fixture conversión' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Buscar oportunidad en CRM' })).toHaveAttribute('href', /q=Fixture/);
  expect(calls).toBe(1);
  await page.getByRole('link', { name: 'Buscar oportunidad en CRM' }).click();
  await expect(page.getByRole('tab', { name: 'Solicitudes web' })).toHaveAttribute('aria-selected', 'false');
});

for (const theme of ['light', 'dark']) {
  test(`Comprobación privada de recepción: estados y errores ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const receipt = { requestId: id, estado: 'Pendiente', version: 1,
      createdAt: '2026-10-10T12:00:00Z', expiresAt: '2027-01-08T12:00:00Z',
      contenido: 'Vigente', idOportunidad: null as number | null };
    let mode = 'missing'; let lookups = 0; let writes = 0;
    let release: (() => void) | undefined;
    await page.route('**/api/v1/crm/solicitudes-web**', async route => {
      if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 500, json: {} }); }
      if (!new URL(route.request().url()).pathname.endsWith('/estado')) return route.fulfill({ json: [] });
      lookups++;
      expect(route.request().url()).toContain('/' + id + '/estado');
      if (mode === 'missing') return route.fulfill({ status: 404, json: {} });
      if (mode === 'failed') return route.fulfill({ status: 503, json: {} });
      if (mode === 'pending') await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ json: receipt });
    });
    try {
      await login(page, '/crm');
      await page.getByRole('tab', { name: 'Solicitudes web' }).click();
      const panel = page.locator('.receipt-check');
      const input = panel.getByLabel('Identificador de solicitud');
      const consult = panel.getByRole('button', { name: 'Consultar estado' });
      await input.fill('fixture@example.com');
      await consult.click();
      await expect(panel.getByRole('alert')).toContainText('UUID completo');
      expect(lookups).toBe(0);
      await input.fill(id.toUpperCase());
      await input.press('Enter');
      await expect(panel.getByRole('alert')).toContainText('Puede haber un envío en curso');
      await expect(input).toHaveValue(id);
      mode = 'failed';
      await consult.click();
      await expect(panel.getByRole('alert')).toContainText('No se pudo comprobar');
      await expect(page.locator('.app-notification')).toHaveCount(0);
      await expect(input).toHaveValue(id);
      mode = 'pending';
      await consult.click();
      await expect(panel.getByRole('status')).toContainText('Comprobando');
      await expect(input).toBeDisabled();
      await expect(consult).toBeDisabled();
      await expect(panel.getByRole('button', { name: 'Limpiar consulta' })).toBeDisabled();
      release?.();
      await expect(panel.getByRole('status')).toContainText('Registro encontrado');
      await expect(panel.getByRole('status')).toContainText('Contenido de la bandeja: Vigente');
      mode = 'success'; receipt.contenido = 'Vencido'; receipt.expiresAt = '2026-10-09T12:00:00Z';
      await consult.click();
      await expect(panel.getByRole('status')).toContainText('Contenido de la bandeja: Vencido');
      await expect(panel.getByRole('status')).toContainText('no restaura sus datos');
      receipt.contenido = 'Purgado'; receipt.idOportunidad = 12; receipt.estado = 'Revisada';
      await consult.click();
      await expect(panel.getByRole('status')).toContainText('Contenido de la bandeja: Purgado');
      await expect(panel.getByRole('status')).toContainText('Oportunidad vinculada en CRM: #12');
      expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `../.artifacts/web-receipt-${theme}.png`, fullPage: true });
      await input.fill('otro-identificador');
      await expect(panel.getByRole('status')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Limpiar consulta' }).click();
      await expect(input).toHaveValue('');
      await expect(panel.getByRole('alert')).toHaveCount(0);
      expect(lookups).toBe(5);
      expect(writes).toBe(0);
      expect(new URL(page.url()).search).toBe('');
    } finally { release?.(); }
  });
}
