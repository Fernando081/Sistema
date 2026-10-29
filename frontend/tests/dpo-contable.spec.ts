import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// F03 · Pestaña "Días de pago (DPO)" en Contabilidad: KPIs, advertencias y conciliaciones.
test('contabilidad: DPO con diferencia de mayor contra auxiliar explicada', async ({ page }) => {
  await installErpApiMock(page);
  const empty = { data: [], total: 0, page: 1, totalPages: 0 };
  const map: Record<string, unknown> = {
    'contabilidad/cuentas': [], 'contabilidad/polizas': empty, 'contabilidad/balanza': [],
    'contabilidad/estado-resultados': { fechaInicio: '', fechaFin: '', ingresos: 0, gastos: 0, utilidadNeta: 0, detalle: [] },
    'contabilidad/balance-general': { fecha: '', activos: 0, pasivos: 0, capitalBase: 0, resultadoAcumulado: 0, capital: 0, diferencia: 0, detalle: [] },
    'tesoreria/cuentas': [], 'tesoreria/movimientos': [], 'tesoreria/importaciones': [], 'tesoreria/conciliaciones': [], 'tesoreria/cierres': [],
    'contabilidad/periodos': [], 'contabilidad/centros-costo': [], 'contabilidad/presupuestos': [],
    'contabilidad/flujo-efectivo': { fechaInicio: '', fechaFin: '', saldoInicial: 0, ingresos: 0, egresos: 0, flujoNeto: 0, saldoFinal: 0, detalle: [] },
    'contabilidad/dpo': {
      periodo: { inicio: '2026-01-01', fin: '2026-10-28', dias: 301 },
      proveedores: { saldoInicial: 0, saldoFinal: 674091, saldoMedio: 617625.29, compras: 687943, pagos: 13852, otrosAbonos: 0 },
      costoVentas: 338934.33, dpoCosto: 548.5, dpoCompras: 270.2,
      conciliacionProveedores: { aplica: true, motivo: null, mayor: 674091, auxiliar: 78650, diferencia: 595441,
        partidas: [{ concepto: 'Facturas de proveedor por pagar', importe: 0 }, { concepto: 'Compras anteriores por pagar', importe: 78650 }],
        diferenciaExplicada: true, causas: ['9 compra(s) anteriores ya liquidadas sin pago registrado en contabilidad (de contado) suman 595441.00: su póliza abonó Proveedores y nunca se cargó el pago.'] },
      conciliacionInventario: { saldoInicial: 0, entradas: 687943, salidas: 338934.33, saldoFinal: 349008.67, costoVentas: 338934.33, diferenciaSalidasCosto: 0 },
      movimientos: [], plazoEfectivoOperativo: null,
      advertencias: ['El saldo contable de Proveedores difiere del auxiliar por 595441.00; el DPO usa el saldo contable y no es confiable hasta corregirlo.'],
    },
  };
  let dpoParams: URLSearchParams | null = null;
  await page.route('**/api/v1/finanzas/**', (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^.*\/api\/v1\/finanzas\//, '');
    if (key === 'contabilidad/dpo') dpoParams = url.searchParams;
    return key in map ? route.fulfill({ json: map[key] }) : route.fallback();
  });
  await login(page, '/contabilidad');
  await page.getByRole('tab', { name: 'Días de pago (DPO)' }).click();
  expect(dpoParams!.get('fechaInicio')).toMatch(/^\d{4}-01-01$/);
  await expect(page.getByText('DPO sobre costo de ventas')).toBeVisible();
  await expect(page.getByText('548.5 días')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'no es confiable' })).toBeVisible();
  await expect(page.getByText('La diferencia queda explicada por completo.')).toBeVisible();
  await expect(page.getByText('9 compra(s) anteriores ya liquidadas', { exact: false })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('.dpo').analyze();
  expect(axe.violations).toEqual([]);
});

// F02a · Propuesta de ajuste de Proveedores: borrador con contrapartida elegida, sin contabilizar.
test('contabilidad: propuesta de ajuste de Proveedores en borrador (F02a)', async ({ page }) => {
  await installErpApiMock(page);
  const empty = { data: [], total: 0, page: 1, totalPages: 0 };
  const cuenta = (idCuenta: number, codigo: string, nombre: string, tipo: string) => ({ idCuenta, codigo, nombre, tipo, naturaleza: 'D', aceptaMovimientos: true, activa: true });
  const compras = [
    { idCompra: 1, fecha: '2025-11-24', proveedor: 'Proveedor Norte', total: 22500, abonoProveedores: 22500, folioPoliza: 107 },
    { idCompra: 19, fecha: '2026-03-13', proveedor: 'Proveedor Sur', total: 10000, abonoProveedores: 10000, folioPoliza: 122 },
  ];
  let ajuste: Record<string, unknown> = { compras, total: 32500, ajustes: [] };
  const posts: Record<string, unknown>[] = [];
  const map: Record<string, unknown> = {
    'contabilidad/cuentas': [cuenta(1, '1100', 'Caja', 'Activo'), cuenta(2, '1110', 'Bancos', 'Activo'), cuenta(3, '2100', 'Proveedores', 'Pasivo')],
    'contabilidad/polizas': empty, 'contabilidad/balanza': [],
    'contabilidad/estado-resultados': { fechaInicio: '', fechaFin: '', ingresos: 0, gastos: 0, utilidadNeta: 0, detalle: [] },
    'contabilidad/balance-general': { fecha: '', activos: 0, pasivos: 0, capitalBase: 0, resultadoAcumulado: 0, capital: 0, diferencia: 0, detalle: [] },
    'tesoreria/cuentas': [], 'tesoreria/movimientos': [], 'tesoreria/importaciones': [], 'tesoreria/conciliaciones': [], 'tesoreria/cierres': [],
    'contabilidad/periodos': [], 'contabilidad/centros-costo': [], 'contabilidad/presupuestos': [],
    'contabilidad/flujo-efectivo': { fechaInicio: '', fechaFin: '', saldoInicial: 0, ingresos: 0, egresos: 0, flujoNeto: 0, saldoFinal: 0, detalle: [] },
    'contabilidad/dpo': {
      periodo: { inicio: '2026-01-01', fin: '2026-10-28', dias: 301 },
      proveedores: { saldoInicial: 0, saldoFinal: 111150, saldoMedio: 100000, compras: 120000, pagos: 0, otrosAbonos: 0 },
      costoVentas: 50000, dpoCosto: 600, dpoCompras: 250,
      conciliacionProveedores: { aplica: true, motivo: null, mayor: 111150, auxiliar: 78650, diferencia: 32500, partidas: [], diferenciaExplicada: true, causas: [] },
      conciliacionInventario: { saldoInicial: 0, entradas: 0, salidas: 0, saldoFinal: 0, costoVentas: 0, diferenciaSalidasCosto: 0 },
      movimientos: [], plazoEfectivoOperativo: null, advertencias: [],
    },
  };
  await page.route('**/api/v1/finanzas/**', (route) => {
    const key = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1\/finanzas\//, '');
    if (key === 'contabilidad/dpo/ajuste-proveedores') {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        ajuste = { compras: [], total: 0, ajustes: [{ idPoliza: 50, folio: 321, fecha: '2026-10-28', estado: 'Borrador', total: 32500, compras: [1, 19] }] };
        return route.fulfill({ status: 201, json: { idPoliza: 50, folio: 321, estado: 'Borrador', compras: 2, total: 32500 } });
      }
      return route.fulfill({ json: ajuste });
    }
    return key in map ? route.fulfill({ json: map[key] }) : route.fallback();
  });
  await login(page, '/contabilidad');
  await page.getByRole('tab', { name: 'Días de pago (DPO)' }).click();
  const panel = page.getByRole('region', { name: 'Propuesta de ajuste de Proveedores' });
  await expect(panel.getByRole('heading', { name: 'Propuesta de ajuste para tu contador (F02)' })).toBeVisible();
  await expect(panel.getByRole('row', { name: /Proveedor Sur/ })).toContainText('$10,000.00');
  await expect(panel.getByRole('row', { name: /Total/ })).toContainText('$32,500.00');
  const crear = panel.getByRole('button', { name: 'Crear póliza en borrador' });
  await expect(crear).toBeDisabled();
  await panel.locator('mat-form-field', { hasText: 'Cuenta de contrapartida' }).click();
  await expect(page.getByRole('option', { name: /2100/ })).toHaveCount(0);
  await page.getByRole('option', { name: '1100 · Caja' }).click();
  await panel.getByLabel('Motivo o instrucción del contador').fill('Pagos de contado con caja chica');
  await expect(crear).toBeDisabled();
  await panel.getByLabel('Revisé con mi contador la cuenta de contrapartida y la fecha.').check();
  await crear.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1100 Caja');
  await expect(dialog).toContainText('no cambia saldos hasta que se contabilice');
  await dialog.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(page.getByText('Póliza 321 creada en borrador', { exact: false })).toBeVisible();
  expect(posts).toEqual([{ fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), idCuentaContrapartida: 1, motivo: 'Pagos de contado con caja chica', compras: [1, 19], confirmacion: true }]);
  await expect(panel).toContainText('No hay compras de contado pendientes de ajuste.');
  await expect(panel).toContainText('Póliza 321');
  await expect(panel).toContainText('En borrador: contabilízala en Pólizas cuando tu contador la apruebe');
  const axe = await new AxeBuilder({ page }).include('.dpo-ajuste').analyze();
  expect(axe.violations).toEqual([]);
});
