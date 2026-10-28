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
