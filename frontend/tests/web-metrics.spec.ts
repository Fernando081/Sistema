import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

function finance(empty = false) {
  const currency = (moneda: string) => ({ moneda, documentos: moneda === 'MXN' ? 2 : 1,
    importeDocumentado: moneda === 'MXN' ? '127.60' : '58.00',
    ventasNetasSinImpuestos: moneda === 'MXN' ? '80.00' : '50.00',
    notasCredito: moneda === 'MXN' ? '23.20' : '0.00', devoluciones: moneda === 'MXN' ? '11.60' : '0.00',
    cobrosRegistrados: moneda === 'MXN' ? '70.00' : '7.10', saldoRegistrado: moneda === 'MXN' ? '46.00' : '50.90',
    documentosNetoDesconocido: 0, documentosCobroDesconocido: 0, documentosSaldoDesconocido: 0,
    documentosSinPagos: moneda === 'MXN' ? 1 : 0, documentosSaldoNoConciliado: moneda === 'MXN' ? 1 : 0,
    cash: { baseMonetaria: 'registros-locales-MXN', reembolsosEfectivo: null, saldoAFavorGenerado: null, cobrosNetosRegistrados: null,
      documentosConCobroNeto: 0, documentosCobroNetoDesconocido: moneda === 'MXN' ? 2 : 1,
      documentosReembolsoDesconocido: moneda === 'MXN' ? 1 : 0, reembolsosSinGastoVinculado: 0, gastosNoConciliados: 0,
      documentosPagosNoConciliados: moneda === 'MXN' ? 1 : 0, documentosMonedaNoComparable: moneda === 'MXN' ? 0 : 1 },
    profit: { baseCosto: 'snapshot-local-MXN', costoVentaNeto: moneda === 'MXN' ? '48.00' : null,
      utilidadBruta: moneda === 'MXN' ? '32.00' : null, margenBrutoPct: moneda === 'MXN' ? '40.00' : null,
      documentosConRentabilidad: moneda === 'MXN' ? 2 : 0, documentosRentabilidadDesconocida: moneda === 'MXN' ? 0 : 1,
      documentosSinCostoValido: 0, documentosMonedaCostoNoComparable: moneda === 'MXN' ? 0 : 1, documentosDetalleNoConciliado: 0 } });
  return { currencies: empty ? [] : [currency('MXN'), currency('USD')],
    coverage: { documentosVinculados: empty ? 0 : 5, documentosFinancieros: empty ? 0 : 4,
      globalesExcluidas: empty ? 0 : 1, monedaDesconocida: empty ? 0 : 1, importesInconsistentes: 0,
      notasCanceladasExcluidas: empty ? 0 : 2, repsCanceladosExcluidos: empty ? 0 : 2,
      pagosRepCompatibilidadOmitidos: empty ? 0 : 4 } };
}

function report(empty = false) {
  return { source: 'crm-local', generatedAt: '2026-10-12T03:00:00Z',
    period: { desde: '2026-10-01', hasta: '2026-10-03', timezone: 'America/Mexico_City', days: 3 },
    totals: { recibidas: empty ? 0 : 6, oportunidades: empty ? 0 : 2, pendientes: empty ? 0 : 2,
      revisadasSinOportunidad: empty ? 0 : 1, descartadas: empty ? 0 : 1, abiertasCrm: 0,
      ganadasCrm: empty ? 0 : 1, perdidasCrm: empty ? 0 : 1, vigentes: empty ? 0 : 3,
      vencidas: empty ? 0 : 2, purgadas: empty ? 0 : 1, piezasVigentes: empty ? 0 : 3,
      piezasSnapshot: empty ? 0 : 2, sinPiezas: empty ? 0 : 1 },
    conversionPct: empty ? null : 33.33,
    commercial: { cotizacionesVinculadas: empty ? 0 : 2, solicitudesConCotizacion: empty ? 0 : 1,
      solicitudesConVenta: empty ? 0 : 1, documentosVentaVigentes: empty ? 0 : 3,
      documentosCancelados: empty ? 0 : 2, documentosInconsistentes: empty ? 0 : 4 },
    finance: finance(empty),
    references: empty ? [] : [{ code: 'OEM-A', brand: 'Timken', solicitudes: 3, cantidad: 11 },
      { code: 'OEM-B', brand: 'SKF', solicitudes: 2, cantidad: 5 }],
    daily: [{ fecha: '2026-10-01', recibidas: empty ? 0 : 2, oportunidades: 0 },
      { fecha: '2026-10-02', recibidas: empty ? 0 : 1, oportunidades: empty ? 0 : 1 },
      { fecha: '2026-10-03', recibidas: empty ? 0 : 3, oportunidades: empty ? 0 : 1 }],
    unmeasured: ['vistas', 'busquedas', 'clicsCotizacion', 'clicsWhatsApp', 'busquedasSinResultado', 'ventasSinVinculo', 'flujoIntegral'] };
}

for (const theme of ['light', 'dark']) {
  test(`Cobros netos web: efectivo, saldo a favor y accesibilidad ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page); await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (!new URL(route.request().url()).pathname.endsWith('/metricas')) return route.fulfill({ json: [] });
      calls++; const payload = report(); payload.finance.currencies[0].cobrosRegistrados = '81.60';
      Object.assign(payload.finance.currencies[0].cash, { reembolsosEfectivo: '27.07', saldoAFavorGenerado: '7.73',
        cobrosNetosRegistrados: '54.53', documentosConCobroNeto: 2, documentosCobroNetoDesconocido: 0,
        documentosReembolsoDesconocido: 0, documentosPagosNoConciliados: 0 });
      return route.fulfill({ json: payload });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByRole('button', { name: 'Consultar medición' }).click();
    await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
    await panel.getByText('Cobros netos y reembolsos en MXN', { exact: true }).click();
    await panel.getByText('Cobros netos y reembolsos en USD', { exact: true }).click();
    const mxn = panel.getByRole('region', { name: 'Cobros netos en MXN' });
    const usd = panel.getByRole('region', { name: 'Cobros netos en USD' });
    await expect(mxn.locator('dd')).toHaveText(['27.07 MXN', '54.53 MXN', '7.73 MXN']);
    await expect(usd.locator('dd')).toHaveText(['Por conciliar', 'Por conciliar', 'Por conciliar']);
    await expect(mxn).toContainText('sin salida de efectivo'); await expect(mxn).toContainText('no el saldo disponible actual');
    await expect(usd).toContainText('Moneda no comparable: 1');
    await mxn.evaluate(element => element.scrollIntoView({ block: 'start' }));
    expect((await new AxeBuilder({ page }).include('app-crm-web-metrics').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mxn.screenshot({ path: `../.artifacts/web-cash-${theme}.png` }); expect(calls).toBe(1);
  });

  test(`Cobros netos web: desconocidos, cero, cifras grandes y limpieza ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page); await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (!new URL(route.request().url()).pathname.endsWith('/metricas')) return route.fulfill({ json: [] });
      calls++; const payload = report(); const cash = payload.finance.currencies[0].cash;
      if (calls === 1) Object.assign(cash, { reembolsosSinGastoVinculado: 1, gastosNoConciliados: 1 });
      if (calls === 2) Object.assign(cash, { reembolsosEfectivo: '0.00', saldoAFavorGenerado: '11.60',
        cobrosNetosRegistrados: '0.00', documentosConCobroNeto: 2, documentosCobroNetoDesconocido: 0 });
      if (calls === 3) Object.assign(cash, { reembolsosEfectivo: '10000000000000054.52', saldoAFavorGenerado: '0.00',
        cobrosNetosRegistrados: '-10000000000000054.52', documentosConCobroNeto: 2, documentosCobroNetoDesconocido: 0 });
      if (calls === 4) for (const currency of payload.finance.currencies) Reflect.deleteProperty(currency, 'cash');
      return route.fulfill({ json: payload });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics'); await panel.getByText('Medición de solicitudes', { exact: true }).click();
    for (let step = 1; step <= 4; step++) {
      await panel.getByRole('button', { name: 'Consultar medición' }).click();
      await expect(panel.locator('.finance')).toBeVisible();
      await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
      if (step === 4) { await expect(panel.locator('.cash')).toHaveCount(0); break; }
      await panel.getByText('Cobros netos y reembolsos en MXN', { exact: true }).click();
      const cashPanel = panel.getByRole('region', { name: 'Cobros netos en MXN' });
      if (step === 1) { await expect(cashPanel.locator('dd')).toHaveText(['Por conciliar','Por conciliar','Por conciliar']);
        await expect(cashPanel).toContainText('Reembolsos sin gasto vinculado: 1'); await expect(cashPanel).toContainText('Gastos no conciliados: 1'); }
      if (step === 2) await expect(cashPanel.locator('dd')).toHaveText(['0.00 MXN','0.00 MXN','11.60 MXN']);
      if (step === 3) await expect(cashPanel.locator('dd')).toHaveText(['10,000,000,000,000,054.52 MXN','-10,000,000,000,000,054.52 MXN','0.00 MXN']);
      await panel.getByLabel('Recibidas desde').fill(`2026-10-0${step}`);
      await expect(panel.locator('.cash')).toHaveCount(0);
    }
    expect(calls).toBe(4);
  });

  test(`Rentabilidad web: costo original, margen y moneda no comparable ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/metricas')) { calls++; return route.fulfill({ json: report() }); }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByLabel('Recibidas hasta').fill('2026-10-03');
    await panel.getByRole('button', { name: 'Consultar medición' }).click();
    await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
    await panel.getByText('Rentabilidad de las ventas en MXN', { exact: true }).click();
    await panel.getByText('Rentabilidad de las ventas en USD', { exact: true }).click();
    const mxn = panel.getByRole('region', { name: 'Rentabilidad en MXN' });
    const usd = panel.getByRole('region', { name: 'Rentabilidad en USD' });
    await expect(mxn).toContainText('48.00 MXN'); await expect(mxn).toContainText('32.00 MXN'); await expect(mxn).toContainText('40.00 %');
    await expect(mxn).toContainText('Documentos con rentabilidad comprobada: 2');
    await expect(usd.locator('dd').filter({ hasText: 'Por conciliar' })).toHaveCount(3);
    await expect(usd).toContainText('Moneda/costo no comparables: 1');
    await expect(mxn).toContainText('ni representa utilidad contable final');
    await mxn.evaluate(element => element.scrollIntoView({ block: 'start' }));
    expect((await new AxeBuilder({ page }).include('app-crm-web-metrics').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mxn.screenshot({ path: `../.artifacts/web-profit-${theme}.png` });
    expect(calls).toBe(1);
  });

  test(`Rentabilidad web: pérdida, cero, desconocido y limpieza ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/metricas')) {
        calls++; const payload = report(); const profit = payload.finance.currencies[0].profit;
        if (calls === 1) Object.assign(profit, { costoVentaNeto: '128.00', utilidadBruta: '-48.00', margenBrutoPct: '-60.00' });
        if (calls === 2) { payload.finance.currencies[0].ventasNetasSinImpuestos = '0.00';
          Object.assign(profit, { costoVentaNeto: '0.00', utilidadBruta: '0.00', margenBrutoPct: null }); }
        if (calls === 3) Object.assign(profit, { costoVentaNeto: null, utilidadBruta: null, margenBrutoPct: null,
          documentosConRentabilidad: 1, documentosRentabilidadDesconocida: 1, documentosSinCostoValido: 1 });
        if (calls === 4) Object.assign(profit, { costoVentaNeto: '10000000000000127.59',
          utilidadBruta: '-10000000000000047.59', margenBrutoPct: '-12500000000000059.49' });
        return route.fulfill({ json: payload });
      }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByLabel('Recibidas hasta').fill('2026-10-03');
    const show = async () => {
      await panel.getByRole('button', { name: 'Consultar medición' }).click();
      await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
      await panel.getByText('Rentabilidad de las ventas en MXN', { exact: true }).click();
      return panel.getByRole('region', { name: 'Rentabilidad en MXN' });
    };
    let mxn = await show();
    await expect(mxn).toContainText('Utilidad bruta (pérdida)'); await expect(mxn).toContainText('-48.00 MXN'); await expect(mxn).toContainText('-60.00 %');
    mxn = await show(); await expect(mxn).toContainText('Sin ventas netas positivas');
    await expect(mxn.locator('dd').filter({ hasText: '0.00 MXN' })).toHaveCount(2);
    mxn = await show(); await expect(mxn.locator('dd').filter({ hasText: 'Por conciliar' })).toHaveCount(3);
    await expect(mxn).toContainText('Sin costo válido: 1');
    mxn = await show(); await expect(mxn).toContainText('10,000,000,000,000,127.59 MXN');
    await expect(mxn).toContainText('-12,500,000,000,000,059.49 %');
    expect((await new AxeBuilder({ page }).include('app-crm-web-metrics').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.getByLabel('Recibidas desde').fill('2026-10-02'); await expect(panel.locator('.profit')).toHaveCount(0);
    expect(calls).toBe(4);
  });

  test(`Medición financiera: monedas, cobros, cobertura y accesibilidad ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/metricas')) { calls++; return route.fulfill({ json: report() }); }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByLabel('Recibidas hasta').fill('2026-10-03');
    await panel.getByRole('button', { name: 'Consultar medición' }).click();
    await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
    const mxn = panel.getByRole('region', { name: 'Importes en MXN' });
    const usd = panel.getByRole('region', { name: 'Importes en USD' });
    await expect(mxn).toContainText('127.60 MXN'); await expect(mxn).toContainText('80.00 MXN');
    await expect(mxn).toContainText('70.00 MXN'); await expect(mxn).toContainText('46.00 MXN');
    await expect(usd).toContainText('7.10 USD'); await expect(usd).toContainText('50.90 USD');
    await expect(panel.locator('.finance')).toContainText('Facturas globales excluidas: 1');
    await expect(panel.locator('.finance')).toContainText('Moneda desconocida, sin desglose: 1');
    await expect(panel.locator('.finance')).toContainText('Copias de pago REP omitidas: 4');
    await expect(panel.locator('.finance')).toContainText('no la fecha de la venta o del pago');
    await expect(panel.locator('.finance')).toContainText('Cobros y saldos no son utilidad');
    await panel.locator('.finance').evaluate(element => element.scrollIntoView({ block: 'start' }));
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.artifacts/web-financial-${theme}.png`, fullPage: true });
    expect(calls).toBe(1); // Expanding financial detail reuses the same snapshot.
  });

  test(`Medición financiera: centavos grandes, desconocido y vacío ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    const unknown = report();
    unknown.finance.currencies[0].importeDocumentado = '10000000000000127.59';
    // HTTP JSON contract intentionally uses null for an uncomputable amount.
    const payload = JSON.parse(JSON.stringify(unknown));
    Object.assign(payload.finance.currencies[1], { ventasNetasSinImpuestos: null, cobrosRegistrados: null,
      saldoRegistrado: null, documentosNetoDesconocido: 1, documentosCobroDesconocido: 1, documentosSaldoDesconocido: 1 });
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/metricas')) {
        calls++; return route.fulfill({ json: calls === 1 ? payload : report(true) });
      }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByLabel('Recibidas hasta').fill('2026-10-03');
    await panel.getByRole('button', { name: 'Consultar medición' }).click();
    await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Importes en MXN' })).toContainText('10,000,000,000,000,127.59 MXN');
    const usd = panel.getByRole('region', { name: 'Importes en USD' });
    await expect(usd.locator('dl').first().locator('dd').filter({ hasText: 'Por conciliar' })).toHaveCount(3);
    await expect(usd).toContainText('venta neta 1, cobro 1, saldo 1');
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.getByLabel('Recibidas desde').fill('2026-10-02');
    await expect(panel.locator('.finance')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Consultar medición' }).click();
    await panel.getByText('Importes y cobros por moneda', { exact: true }).click();
    await expect(panel.locator('.finance')).toContainText('No hay documentos con moneda identificada');
    await expect(panel.locator('.currency')).toHaveCount(0); expect(calls).toBe(2);
  });

  test(`Medición web: periodo, cohortes, referencias y accesibilidad ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0;
    await page.route('**/api/v1/crm/solicitudes-web**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/metricas')) {
        const params = new URL(route.request().url()).searchParams;
        expect(route.request().method()).toBe('GET');
        expect(params.get('desde')).toBe('2026-10-01'); expect(params.get('hasta')).toBe('2026-10-03');
        calls++; return route.fulfill({ json: report() });
      }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    expect(calls).toBe(0); // No tracking or automatic collection on opening CRM.
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByLabel('Recibidas desde').fill('2026-10-01');
    await panel.getByLabel('Recibidas hasta').fill('2026-10-03');
    await panel.getByRole('button', { name: 'Consultar medición' }).click();
    await expect(panel.locator('dl[aria-label="Resumen de solicitudes"]')).toContainText('33.33 %');
    await expect(panel.locator('dl[aria-label="Resumen de solicitudes"]').locator('div').nth(0)).toContainText('6');
    await expect(panel.locator('dl[aria-label="Trazabilidad comercial"]')).toContainText('Documentos de venta vigentes3');
    await expect(panel).toContainText('Documentos inconsistentes, excluidos: 4');
    await expect(panel.locator('.references li').first()).toContainText('OEM-A');
    await expect(panel.locator('.references li').first()).toContainText('3 solicitudes · 11 unidades solicitadas');
    await expect(panel).toContainText('no confirma una venta');
    await expect(panel).toContainText('Si son de prueba, los resultados también lo son');
    await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `../.artifacts/web-metrics-${theme}-overview.png`, fullPage: true });
    await panel.getByText('Tendencia diaria del periodo', { exact: true }).click();
    await expect(panel.locator('.daily li')).toHaveCount(3);
    await panel.getByText('Vigencia del contenido', { exact: true }).click();
    await expect(panel).toContainText('Vencidas sin purgar: 2');
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.artifacts/web-metrics-${theme}.png`, fullPage: true });
    await panel.getByLabel('Recibidas desde').fill('2026-10-02');
    await expect(panel.locator('dl')).toHaveCount(0); // Never leave results attributed to edited dates.
    expect(calls).toBe(1);
  });

  test(`Medición web: validación, fallo, carga bloqueada y vacío ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'dark' ? 390 : 1280, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
    let calls = 0, release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/crm/solicitudes-web**', async route => {
      if (new URL(route.request().url()).pathname.endsWith('/metricas')) {
        calls++;
        if (calls === 1) { await pending; return route.fulfill({ status: 503, json: {} }); }
        return route.fulfill({ json: report(true) });
      }
      return route.fulfill({ json: [] });
    });
    await login(page, '/crm'); await page.getByRole('tab', { name: 'Solicitudes web' }).click();
    const panel = page.locator('app-crm-web-metrics');
    await panel.getByText('Medición de solicitudes', { exact: true }).click();
    await panel.getByLabel('Recibidas desde').fill('2026-10-04');
    await panel.getByLabel('Recibidas hasta').fill('2026-10-03');
    await panel.getByRole('button').click();
    await expect(panel.getByRole('alert')).toContainText('en orden'); expect(calls).toBe(0);
    await panel.getByLabel('Recibidas desde').fill('2025-01-01'); await panel.getByRole('button').click();
    await expect(panel.getByRole('alert')).toContainText('366 días'); expect(calls).toBe(0);
    await panel.getByLabel('Recibidas desde').fill('2026-10-01'); await panel.getByRole('button').click();
    await expect(panel.getByRole('status')).toContainText('Calculando');
    await expect(panel.getByLabel('Recibidas desde')).toBeDisabled(); await expect(panel.getByRole('button')).toBeDisabled();
    release?.(); await expect(panel.getByRole('alert')).toContainText('Conservamos tus fechas');
    await expect(panel.getByLabel('Recibidas desde')).toHaveValue('2026-10-01');
    await expect(page.locator('.app-notification')).toHaveCount(0);
    await panel.getByRole('button').click();
    await expect(panel.getByRole('status')).toContainText('No hay solicitudes recibidas');
    await expect(panel.locator('dl[aria-label="Resumen de solicitudes"]')).toContainText('Sin datos');
    await expect(panel).toContainText('No hay referencias disponibles'); expect(calls).toBe(2);
    expect((await new AxeBuilder({ page }).include('app-crm-solicitudes-web').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
