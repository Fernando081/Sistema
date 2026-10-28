import { expect, Page, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock, login } from './helpers/erp-api.mock';

// U01: capturas de referencia del sistema visual (claro/oscuro, escritorio/móvil)
// con API simulada. UI_SHOT_PREFIX=ui01-before|ui01-after guarda PNG en ../.artifacts/local (no se versiona, H02-c).
const prefix = process.env.UI_SHOT_PREFIX;
const days = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

async function mockDashboard(page: Page) {
  await page.route('**/api/v1/dashboard**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    const now = new Date().toISOString();
    const body = endpoint.endsWith('/scheduled-jobs')
      ? [{ name: 'operational_alerts', overdue: false, lastSuccessAt: now, lastRun: { status: 'success' }, recentRuns: [] }]
      : endpoint.endsWith('/refresh-status')
        ? { checkedAt: now, expectedAt: now, lastSuccessAt: now, overdue: false, freshness: 'current', lastRun: { status: 'success' }, recentRuns: [] }
        : endpoint.endsWith('/ventas')
          ? [{ ingresos_brutos: 1284500, ingresos_netos: 1107328.4, ticket_promedio: 3820, margen_utilidad_bruta: 31.4, descuento_promedio_otorgado: 4.2,
              ventas_por_categoria: [{ categoria: 'Filtración', ventas: 382000 }, { categoria: 'Motor', ventas: 296500 }, { categoria: 'Frenos', ventas: 184200 }, { categoria: 'Eléctrico', ventas: 121300 }],
              comportamiento_hora_dia: days.flatMap((_dia, d) => [9, 11, 13, 16, 18].map((hora, h) => ({ dia: (d + 1) % 7, hora, ventas: 4000 + ((d * 7 + h * 13) % 9) * 2100 }))) }]
          : endpoint.endsWith('/inventario')
            ? [{ valor_total_inventario: 2380450, tasa_rotacion_inventario: 4.6, indice_quiebre_stock: 3.1, dias_inventario: 79, mercancia_lento_movimiento: [], merma_shrinkage: 0, shrinkage_historico_json: [], retorno_inversion_inventario: 2.18, gmroi_dias_historial: 90, costo_aterrizado: null }]
            : endpoint.endsWith('/clientes')
              ? [{ tasa_retencion_clientes: 72.5, cuentas_por_cobrar: [], valor_tiempo_vida: 48200, dias_cuentas_por_pagar: 27.4 }]
              : endpoint.endsWith('/operaciones')
                ? [{ tasa_conversion_cotizaciones: 38.2, tasa_devoluciones: 1.2, tasa_de_devoluciones_historico: [], rentabilidad_proveedor_marca: [{ proveedor: 'Diesel Parts', marca: 'Fleetguard', rentabilidad: 182300 }, { proveedor: 'Motores del Golfo', marca: 'Cummins', rentabilidad: 141800 }, { proveedor: 'Frenos MX', marca: 'Meritor', rentabilidad: 96400 }], tasa_cumplimiento: 94.8, indice_ventas_cruzadas: 1.7 }]
                : { ventasHoy: 48620.5, ventasMes: 1284500, porCobrar: 483636.4, porPagar: 77640, conteoBajos: 7,
                  grafica: [21400, 33800, 29150, 41200, 38900, 52300, 48620].map((value, index) => ({ name: `${20 + index}/10`, value })),
                  listaBajos: [], topProductos: [{ name: 'Filtro combustible ISX', value: 126 }, { name: 'Balero Timken 32210', value: 70 }, { name: 'Banda Gates K060', value: 54 }, { name: 'Engrane Fuller 4302', value: 43 }, { name: 'Aceite Delo 15W40', value: 41 }] };
    await route.fulfill({ json: body });
  });
  await page.route('**/api/v1/crm/resumen', route => route.fulfill({ json: { abiertas: 14, montoAbierto: 386400, vencidas: 3, ganadas: 9, perdidas: 2, ventasPerdidas30Dias: 5 } }));
}


const item = (idProducto: number, codigo: string, descripcion: string, cantidad: number, valorUnitario: number) => {
  const importe = Math.round(cantidad * valorUnitario * 100) / 100;
  return { idProducto, codigo, descripcion, unidadDescripcion: 'Pieza', claveProdServ: '25174200', claveUnidad: 'H87', objetoImpuesto: '02',
    cantidad, valorUnitario, importe, descuento: 0, baseIva: importe, tasaIva: 0.16, importeIva: Math.round(importe * 16) / 100, baseRetIsr: 0, tasaRetIsr: 0, importeRetIsr: 0 };
};
const saleDraft = { savedAt: new Date().toISOString(), idCliente: 1, config: { idUsoCFDI: 3, idFormaPago: 3, idMetodoPago: 1 },
  carrito: [item(101, 'FS1040', 'Filtro de combustible ISX Fleetguard', 2, 742.5), item(102, '32210-TIM', 'Balero cónico Timken 32210', 4, 618), item(103, 'K060-GTS', 'Banda poly-V Gates K060', 1, 1290)] };

async function mockSale(page: Page) {
  await page.route('**/api/v1/catalogos/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const rows: Record<string, unknown[]> = {
      'uso-cfdi': [{ IdUsoCFDI: 1, Clave: 'G01', Nombre: 'Adquisición de mercancías' }, { IdUsoCFDI: 3, Clave: 'G03', Nombre: 'Gastos en general' }],
      'forma-pago': [{ IdFormaPago: 1, Clave: '01', Nombre: 'Efectivo' }, { IdFormaPago: 3, Clave: '03', Nombre: 'Transferencia electrónica' }],
      'metodo-pago': [{ IdMetodoDePago: 1, Clave: 'PUE', Nombre: 'Pago en una sola exhibición' }],
      'regimen-fiscal': [{ IdRegimenFiscal: 1, Clave: '601', Nombre: 'General de Ley Personas Morales' }],
    };
    await route.fulfill({ json: rows[name ?? ''] ?? [] });
  });
}


const clients = ['Transportes del Golfo', 'Autotransportes Huasteca', 'Fletes Pánuco', 'Logística Altamira', 'Maquinaria Tamaulipas', 'Grúas del Puerto'];
async function mockLists(page: Page) {
  await page.route('**/api/v1/venta?*', route => route.fulfill({ json: { data: clients.map((name, index) => ({
    id_factura: 200 + index, serie: index === 4 ? 'NC' : 'F', folio: 1840 + index, nombre_receptor: name, rfc_receptor: `TGO${910101 + index}AB${index}`,
    total: String([18450.8, 7320, 126900.45, 2150, 3480.6, 54210][index]), estatus: ['Pagada', 'Pendiente', 'Pagada', 'Pendiente', 'Cancelada', 'Pagada'][index],
    estado_fiscal: ['Timbrado', 'Timbrado', 'Timbrado', 'Borrador', 'Cancelado', 'Procesando'][index], fecha_emision: `2026-10-${20 + index}T17:00:00Z` })), total: 128, page: 1, totalPages: 13 } }));
  await page.route('**/api/v1/cotizacion?*', route => route.fulfill({ json: { data: clients.map((name, index) => ({
    id_cotizacion: 300 + index, folio: 712 + index, nombre_receptor: name, rfc_receptor: `TGO${910101 + index}AB${index}`,
    total: String([9840, 31200.5, 4875, 188400, 12650, 2390][index]), estatus: ['Vigente', 'Convertida', 'Pendiente', 'Vigente', 'Rechazada', 'Vigente'][index],
    fecha_emision: `2026-10-${20 + index}`, id_pedido: index === 1 ? 91 : null })), total: 64, page: 1, totalPages: 11 } }));
}


async function mockFinance(page: Page) {
  const ok = (body: unknown) => ({ json: body });
  await page.route('**/api/v1/fiscal/configuracion', route => route.fulfill(ok({ environment: 'mock', provider: 'Simulación local', ready: true, missing: [], issuerConfigured: true, productionEnabled: false })));
  await page.route('**/api/v1/pago/rep', route => route.fulfill(ok([
    { id_rep: 58, id_cliente: 1, fecha_pago: '2026-10-24', fecha_emision: '2026-10-24', forma_pago: 'Transferencia', moneda: 'MXN', monto_total: 42850.5, estado: 'Activo', uuid: null, cliente_nombre: 'Transportes del Golfo', estado_fiscal: 'Timbrado', tiene_xml_fiscal: true, tiene_acuse: false, error_fiscal: null },
    { id_rep: 57, id_cliente: 2, fecha_pago: '2026-10-22', fecha_emision: '2026-10-22', forma_pago: 'Cheque', moneda: 'MXN', monto_total: 18200, estado: 'Activo', uuid: null, cliente_nombre: 'Fletes Pánuco', estado_fiscal: 'Borrador', tiene_xml_fiscal: false, tiene_acuse: false, error_fiscal: null },
    { id_rep: 55, id_cliente: 3, fecha_pago: '2026-10-18', fecha_emision: '2026-10-18', forma_pago: 'Efectivo', moneda: 'MXN', monto_total: 6400, estado: 'Cancelado', uuid: null, cliente_nombre: 'Logística Altamira', estado_fiscal: 'Cancelado', tiene_xml_fiscal: true, tiene_acuse: true, error_fiscal: null },
  ])));
  await page.route('**/api/v1/pago/pendientes-ppd/1', route => route.fulfill(ok([
    { id_factura: 210, id_cliente: 1, serie: 'F', folio: 1790, fecha_emision: '2026-09-12', total: 64200, saldo_pendiente: 32100, cliente_nombre: 'Transportes del Golfo' },
    { id_factura: 214, id_cliente: 1, serie: 'F', folio: 1812, fecha_emision: '2026-10-02', total: 18450.8, saldo_pendiente: 18450.8, cliente_nombre: 'Transportes del Golfo' },
  ])));
  await page.route('**/api/v1/cuentas-proveedor/dashboard', route => route.fulfill(ok({
    resumen: { total: 286400.75, vencido: 48210, discrepancias: 2, porConciliar: 3 },
    antiguedad: [{ rango: 'Por vencer', facturas: 6, saldo: 168200 }, { rango: '1–30 días', facturas: 2, saldo: 48210 }, { rango: '31–60 días', facturas: 0, saldo: 0 }],
    recibidoSinFactura: [], anticipos: [], notasCredito: [] })));
  await page.route('**/api/v1/cuentas-proveedor/facturas', route => route.fulfill(ok([
    { idFacturaProveedor: 1, idProveedor: 7, idOrden: 40, folioOrden: 1204, serie: 'A', folio: '9931', fechaEmision: '2026-10-01', fechaVencimiento: '2026-10-31', total: 96400, saldo: 96400, estado: 'Aprobada', moneda: 'MXN', proveedor: 'Diesel Parts México', tieneXml: true, tienePdf: true, discrepanciasPendientes: 0 },
    { idFacturaProveedor: 2, idProveedor: 8, idOrden: 41, folioOrden: 1207, serie: '', folio: 'FM-2210', fechaEmision: '2026-09-18', fechaVencimiento: '2026-10-18', total: 48210, saldo: 48210, estado: 'Con discrepancias', moneda: 'MXN', proveedor: 'Frenos y Ejes del Norte', tieneXml: true, tienePdf: false, discrepanciasPendientes: 2 },
    { idFacturaProveedor: 3, idProveedor: 9, idOrden: 43, folioOrden: 1211, serie: 'B', folio: '552', fechaEmision: '2026-10-20', fechaVencimiento: '2026-11-19', total: 141790.75, saldo: 71790.75, estado: 'Parcialmente pagada', moneda: 'MXN', proveedor: 'Motores del Golfo', tieneXml: true, tienePdf: true, discrepanciasPendientes: 0 },
  ])));
  await page.route('**/api/v1/pago-proveedor/deuda', route => route.fulfill(ok([])));
}


async function mockLedger(page: Page) {
  const now = Date.now(), hour = 3_600_000;
  const at = (h: number) => new Date(now - h * hour).toISOString();
  const turno = (id_turno: number, estado: 'Abierta' | 'Cerrada', h: number, responsable: string, esperado?: number, contado?: number) =>
    ({ id_turno, estado, apertura: at(h), responsable, contado_apertura: 2000, saldo_sistema_apertura: 2000, esperado_actual: 8450.5, esperado_cierre: esperado, contado_cierre: contado, diferencia: esperado == null || contado == null ? undefined : contado - esperado });
  await page.route('**/api/v1/caja', route => route.fulfill({ json: {
    saldo: { caja_chica: 8450.5, cuenta_banco: 152300 }, totales: { entradas: 7280.5, salidas: 830 },
    turno: turno(42, 'Abierta', 6, 'Laura M.'),
    historial: [turno(42, 'Abierta', 6, 'Laura M.'), turno(41, 'Cerrada', 30, 'Óscar R.', 6120, 6120), turno(40, 'Cerrada', 54, 'Laura M.', 9875.4, 9825.4)],
  } }));
  await page.route('**/api/v1/caja/*/movimientos?*', route => route.fulfill({ json: { data: [
    { id_movimiento: 'm3', fecha: at(1), efectivo: 1790, banco: 0, saldo_efectivo: 8450.5, saldo_banco: 152300, usuario: 'Laura M.', origen: 'Venta #2310' },
    { id_movimiento: 'm2', fecha: at(3), efectivo: -830, banco: 0, saldo_efectivo: 6660.5, saldo_banco: 152300, usuario: 'Laura M.', origen: 'Gasto: paquetería' },
    { id_movimiento: 'm1', fecha: at(5), efectivo: 5490.5, banco: 0, saldo_efectivo: 7490.5, saldo_banco: 152300, usuario: 'Laura M.', origen: 'Venta #2306' },
  ], total: 3 } }));
  const g = (idGasto: number, concepto: string, categoria: string, metodoPago: string, monto: number, h: number) =>
    ({ idGasto, concepto, categoria, metodoPago, monto, fecha: at(h), idCompra: null, idUsuario: 1, anulado: false, createdAt: at(h) });
  await page.route('**/api/v1/finanzas/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/finanzas\//, '');
    const body: Record<string, unknown> = {
      gastos: [g(9, 'Paquetería Estafeta a Altamira', 'Flete/Paquetería', 'Efectivo', 830, 3), g(8, 'Recibo CFE octubre', 'Operativos', 'Transferencia', 4215.8, 26), g(7, 'Publicidad en radio local', 'Marketing', 'Tarjeta de Débito', 2500, 50)],
      saldos: [{ idSaldo: 1, cajaChica: 8450.5, cuentaBanco: 152300, updatedAt: at(1) }],
      'contabilidad/polizas': { data: [
        { idPoliza: 3, folio: 118, fecha: at(2), tipo: 'Ingreso', concepto: 'Venta #2310 de mostrador', estado: 'Contabilizada', automatica: true, usuario: 'Sistema', debe: 1790, haber: 1790, partidas: [{ idCuenta: 1, codigo: '101.01', cuenta: 'Caja', debe: 1790, haber: 0 }, { idCuenta: 2, codigo: '401.01', cuenta: 'Ventas', debe: 0, haber: 1790 }] },
        { idPoliza: 2, folio: 117, fecha: at(26), tipo: 'Egreso', concepto: 'Recibo CFE octubre', estado: 'Borrador', automatica: false, usuario: 'Laura M.', debe: 4215.8, haber: 4215.8, partidas: [] },
      ], total: 2, page: 1, totalPages: 1 },
      'contabilidad/estado-resultados': { fechaInicio: '', fechaFin: '', ingresos: 486200, gastos: 371950.4, utilidadNeta: 114249.6, detalle: [
        { tipo: 'Ingreso', codigo: '401.01', nombre: 'Ventas de refacciones', saldo: 471300 }, { tipo: 'Ingreso', codigo: '402.01', nombre: 'Otros ingresos', saldo: 14900 },
        { tipo: 'Gasto', codigo: '501.01', nombre: 'Costo de ventas', saldo: 318420.4 }, { tipo: 'Gasto', codigo: '601.01', nombre: 'Gastos de operación', saldo: 53530 },
      ] },
      'contabilidad/balance-general': { fecha: '', activos: 1248300, pasivos: 412800, capitalBase: 721250.4, resultadoAcumulado: 114249.6, capital: 835500, diferencia: 0, detalle: [
        { tipo: 'Activo', codigo: '101.01', nombre: 'Caja', saldo: 8450.5 }, { tipo: 'Activo', codigo: '102.01', nombre: 'Bancos', saldo: 152300 }, { tipo: 'Activo', codigo: '115.01', nombre: 'Inventario', saldo: 1087549.5 },
        { tipo: 'Pasivo', codigo: '201.01', nombre: 'Proveedores', saldo: 412800 },
        { tipo: 'Capital', codigo: '301.01', nombre: 'Capital social', saldo: 721250.4 }, { tipo: 'Capital', codigo: '304.01', nombre: 'Resultado del ejercicio', saldo: 114249.6 },
      ] },
      'contabilidad/balanza': [
        { idCuenta: 1, codigo: '101.01', nombre: 'Caja', tipo: 'Activo', naturaleza: 'D', aceptaMovimientos: true, activa: true, saldoInicial: 2000, debe: 52400.5, haber: 45950, saldoFinal: 8450.5 },
        { idCuenta: 2, codigo: '102.01', nombre: 'Bancos', tipo: 'Activo', naturaleza: 'D', aceptaMovimientos: true, activa: true, saldoInicial: 98000, debe: 186300, haber: 132000, saldoFinal: 152300 },
        { idCuenta: 3, codigo: '201.01', nombre: 'Proveedores', tipo: 'Pasivo', naturaleza: 'A', aceptaMovimientos: true, activa: true, saldoInicial: 380000, debe: 96000, haber: 128800, saldoFinal: 412800 },
        { idCuenta: 4, codigo: '401.01', nombre: 'Ventas de refacciones', tipo: 'Ingreso', naturaleza: 'A', aceptaMovimientos: true, activa: true, saldoInicial: 0, debe: 0, haber: 471300, saldoFinal: 471300 },
      ],
      'contabilidad/dpo': { periodo: { inicio: '2026-07-31', fin: '2026-10-28', dias: 90 }, proveedores: { saldoInicial: 380000, saldoFinal: 412800, saldoMedio: 396500, compras: 812000, pagos: 779200, otrosAbonos: 0 }, costoVentas: 318420.4, dpoCosto: 112.1, dpoCompras: 43.9,
        conciliacionProveedores: { aplica: true, motivo: null, mayor: 412800, auxiliar: 412800, diferencia: 0, partidas: [{ concepto: 'Facturas de proveedor por pagar', importe: 412800 }, { concepto: 'Compras anteriores por pagar', importe: 0 }], diferenciaExplicada: false, causas: [] },
        conciliacionInventario: { saldoInicial: 760000, entradas: 700000, salidas: 318420.4, saldoFinal: 1141579.6, costoVentas: 318420.4, diferenciaSalidasCosto: 0 }, movimientos: [], plazoEfectivoOperativo: 38.5, advertencias: [] },
      'contabilidad/flujo-efectivo': { fechaInicio: '', fechaFin: '', saldoInicial: 100000, ingresos: 238700.5, egresos: 177950, flujoNeto: 60750.5, saldoFinal: 160750.5, detalle: [
        { origen: 'Ventas', ingresos: 224300.5, egresos: 0, neto: 224300.5 }, { origen: 'Pagos a proveedores', ingresos: 0, egresos: 132000, neto: -132000 }, { origen: 'Gastos', ingresos: 14400, egresos: 45950, neto: -31550 },
      ] },
      'contabilidad/periodos': [{ idPeriodo: 10, anio: 2026, mes: 9, fechaInicio: '2026-09-01', fechaFin: '2026-09-30', estado: 'Cerrado', polizas: 312 }, { idPeriodo: 11, anio: 2026, mes: 10, fechaInicio: '2026-10-01', fechaFin: '2026-10-31', estado: 'Abierto', polizas: 118 }],
      'contabilidad/presupuestos': [{ idPresupuesto: 1, anio: 2026, mes: 10, idCuenta: 6, codigo: '601.01', cuenta: 'Gastos de operación', centro: 'Mostrador', monto: 50000, real: 53530, variacion: -3530 }],
      'tesoreria/cuentas': [{ idCuenta: 1, nombre: 'Operación', banco: 'Banorte', moneda: 'MXN', ultimosCuatro: '4821', saldoInicial: 98000, saldo: 152300, activa: true, pendientes: 2 }],
      'tesoreria/movimientos': [
        { idMovimiento: 41, idCuenta: 1, cuenta: 'Operación', banco: 'Banorte', fecha: at(20), descripcion: 'SPEI Transportes del Golfo', referencia: 'F-1790', monto: 32100, estado: 'Pendiente' },
        { idMovimiento: 40, idCuenta: 1, cuenta: 'Operación', banco: 'Banorte', fecha: at(44), descripcion: 'Pago Frenos y Ejes del Norte', referencia: 'OC-12', monto: -18320, estado: 'Conciliado' },
      ],
    };
    return route.fulfill({ json: body[path] ?? [] });
  });
}

async function mockSupply(page: Page) {
  const now = Date.now(), hour = 3_600_000;
  const at = (h: number) => new Date(now - h * hour).toISOString();
  await page.route('**/api/v1/abastecimiento/solicitudes', route => route.fulfill({ json: [
    { idSolicitud: 31, folio: 31, estado: 'Borrador', motivo: 'Cubrir backorder de filtros ISX', partidas: 3, estimado: 8640, createdAt: at(2) },
    { idSolicitud: 30, folio: 30, estado: 'Autorizada', motivo: 'Reposición por mínimo de baleros', partidas: 5, estimado: 21450.75, createdAt: at(28) },
  ] }));
  await page.route('**/api/v1/abastecimiento/ordenes', route => route.fulfill({ json: [
    { idOrden: 12, folio: 12, estado: 'Emitida', proveedor: 'Frenos y Ejes del Norte', total: 18320, pendiente: 24, createdAt: at(20) },
    { idOrden: 11, folio: 11, estado: 'Recibida', proveedor: 'Distribuidora Diesel del Golfo', total: 9875.4, pendiente: 0, createdAt: at(96) },
  ] }));
  await page.route('**/api/v1/producto/smart-restock', route => route.fulfill({ json: [
    { id_producto: 101, codigo: 'FS1022', descripcion: 'Filtro separador de combustible ISX', unidades_vendidas_30d: 42, stock_actual: 3, precio_unitario: 742.5, margen: 34.2 },
    { id_producto: 103, codigo: 'K060', descripcion: 'Banda poly-V 6 costillas', unidades_vendidas_30d: 18, stock_actual: 0, precio_unitario: 389.9, margen: 22.5 },
    { id_producto: 102, codigo: '32210', descripcion: 'Balero cónico 50 x 90 mm', unidades_vendidas_30d: 11, stock_actual: 9, precio_unitario: 1180, margen: 8.4 },
  ] }));
  const pr = (id_producto: number, codigo: string, descripcion: string, stock_actual: number, v30: number, tendencia: 'ALTA' | 'BAJA' | 'ESTABLE', demanda: number, sugerida: number) =>
    ({ id_producto, codigo, descripcion, stock_actual, precio_unitario: 500, vendido_30d: v30, vendido_60d: v30 * 2 - 4, vendido_90d: v30 * 3 - 9, prom_diario_30d: 0, prom_diario_60d: 0, prom_diario_90d: 0, pendiente_regresion: 0.42, intercepto_regresion: 3.1, r_cuadrado: 0.81, num_semanas: 12, tendencia, demanda_proyectada_30d: demanda, cantidad_sugerida_compra: sugerida });
  await page.route('**/api/v1/producto/prediccion-compras', route => route.fulfill({ json: [
    pr(101, 'FS1022', 'Filtro separador de combustible ISX', 3, 42, 'ALTA', 48, 45), pr(103, 'K060', 'Banda poly-V 6 costillas', 0, 18, 'ESTABLE', 18, 18), pr(102, '32210', 'Balero cónico 50 x 90 mm', 2, 11, 'BAJA', 8, 6),
  ] }));
  await page.route('**/api/v1/abastecimiento/ordenes/12', route => route.fulfill({ json: {
    idOrden: 12, folio: 12, estado: 'Emitida', proveedor: 'Frenos y Ejes del Norte', total: 18320, pendiente: 24, createdAt: at(20), notas: '',
    partidas: [
      { idDetalle: 1, idProducto: 102, codigo: '32210', descripcion: 'Balero cónico 50 x 90 mm', cantidad: 12, cantidadRecibida: 4, cantidadFacturada: 0, costoUnitario: 820 },
      { idDetalle: 2, idProducto: 104, codigo: '4302', descripcion: 'Engrane de 3a velocidad', cantidad: 16, cantidadRecibida: 0, cantidadFacturada: 0, costoUnitario: 530 },
    ],
  } }));
  const log = (id: number, action: string, table_name: string, h: number, actor_name: string, old_record: Record<string, unknown> | null, new_record: Record<string, unknown> | null) =>
    ({ id, action, table_name, timestamp: at(h), actor_name, db_user: 'erp_app', protection_version: 2, old_record, new_record });
  await page.route('**/api/v1/auditoria', route => route.fulfill({ json: [
    log(3, 'UPDATE', 'producto', 1, 'Laura M.', { precio_unitario: 720 }, { precio_unitario: 742.5 }),
    log(2, 'INSERT', 'venta', 3, 'Óscar R.', null, { id_venta: 2310, total: 1790 }),
  ] }));
  await page.route('**/api/v1/auditoria/estado', route => route.fulfill({ json: { appendOnly: true, actorSnapshots: true, accessTables: 6, expectedAccessTables: 6, privilegedDatabaseRole: true, newEventVersion: 2, legacyLimit: 0 } }));
}

async function mockClients(page: Page) {
  await page.route('**/api/v1/cliente/7/360', route => route.fulfill({ json: {
    cliente: { IdCliente: 7, RazonSocial: 'Transportes del Golfo SA de CV', RFC: 'TGO010203AB1', Email: 'compras@tgolfo.mx', Telefono: '833 214 5500' },
    resumen: { saldoPendiente: 18450.5, ventasAcumuladas: 486200, unidades: 14, pedidosAbiertos: 2, garantiasAbiertas: 1 },
    contactos: [{ idContacto: 1, nombre: 'Ing. Ramiro Treviño', cargo: 'Jefe de taller', telefono: '833 214 5501', email: 'taller@tgolfo.mx', canalPreferido: 'Telefono', esPrincipal: true, notas: '' }],
    unidades: [], cotizaciones: [], pedidos: [], facturas: [], garantias: [], oportunidades: [],
  } }));
  await page.route('**/api/v1/comercial/clientes', route => route.fulfill({ json: [
    { idCliente: 7, cliente: 'Transportes del Golfo', rfc: 'TGO010203AB1', lista: 'Flotillas', limiteCredito: 150000, diasCredito: 30, bloqueado: false, deuda: 18450.5 },
    { idCliente: 9, cliente: 'Fletes Pánuco', rfc: 'FPA990101XY2', lista: 'Mostrador', limiteCredito: 40000, diasCredito: 15, bloqueado: true, deuda: 41200, motivoBloqueo: 'Límite excedido' },
  ] }));
  await page.route('**/api/v1/comercial/listas', route => route.fulfill({ json: [{ idLista: 1, nombre: 'Flotillas', productos: 320 }, { idLista: 2, nombre: 'Mostrador', productos: 1284 }] }));
  await page.route('**/api/v1/comercial/autorizaciones', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/comercial/politica-aprobaciones', route => route.fulfill({ json: { reglas: [], limites: [], aprobadores: [] } }));
}

async function mockDialogs(page: Page) {
  const now = Date.now(), day = 86_400_000;
  const at = (d: number) => new Date(now - d * day).toISOString();
  await page.route('**/api/v1/producto/*/kardex', route => route.fulfill({ json: [
    { id_kardex: 4, fecha: at(1), tipo_movimiento: 'VENTA', cantidad: -2, stock_anterior: 20, stock_resultante: 18, precio_unitario: 742.5, referencia: 'Venta #2310', usuario: 'Laura M.' },
    { id_kardex: 3, fecha: at(3), tipo_movimiento: 'COMPRA', cantidad: 12, stock_anterior: 8, stock_resultante: 20, precio_unitario: 512, referencia: 'OC-12', usuario: 'Óscar R.' },
    { id_kardex: 2, fecha: at(9), tipo_movimiento: 'AJUSTE_MANUAL_STOCK', cantidad: -1, stock_anterior: 9, stock_resultante: 8, precio_unitario: 0, referencia: 'Conteo cíclico A-03', usuario: 'Óscar R.' },
    { id_kardex: 1, fecha: at(20), tipo_movimiento: 'CAMBIO_PRECIO', cantidad: 0, stock_anterior: 9, stock_resultante: 9, precio_unitario: 742.5, referencia: 'Lista octubre', usuario: 'admin-e2e' },
  ] }));
  await page.route('**/api/v1/producto/*/cotizacion-prov', route => route.fulfill({ json: [
    { id_cotizacion_prov: 2, id_producto: 101, id_proveedor: 1, proveedor_nombre: 'Distribuidora Diesel del Golfo', marca_ofrecida: 'Fleetguard', precio_cotizado: '498.00', dias_entrega: 2, fecha_registro: at(4) },
    { id_cotizacion_prov: 1, id_producto: 101, id_proveedor: 2, proveedor_nombre: 'Frenos y Ejes del Norte', marca_ofrecida: 'Baldwin', precio_cotizado: '455.50', dias_entrega: 6, fecha_registro: at(12) },
  ] }));
  await page.route('**/api/v1/proveedor', route => route.fulfill({ json: [
    { IdProveedor: 1, RazonSocial: 'Distribuidora Diesel del Golfo', RFC: 'DDG010101AB1' }, { IdProveedor: 2, RazonSocial: 'Frenos y Ejes del Norte', RFC: 'FEN020202CD2' },
  ] }));
  await page.route('**/api/v1/venta/*/detalle', route => route.fulfill({ json: [
    { id_concepto: 1, id_producto: 101, cantidad: 8, cantidad_devuelta: 0, descripcion_producto: 'Filtro separador de combustible ISX', unidad: 'Pieza', codigo_producto: 'FS1022', precio_unitario: 742.5, importe: 5940, importe_iva: 950.4, importe_ret_isr: 0 },
    { id_concepto: 2, id_producto: 102, cantidad: 4, cantidad_devuelta: 1, descripcion_producto: 'Balero cónico 50 x 90 mm', unidad: 'Pieza', codigo_producto: '32210', precio_unitario: 1180, importe: 4720, importe_iva: 755.2, importe_ret_isr: 59 },
  ] }));
  await page.route('**/api/v1/fiscal/facturas/*', route => route.fulfill({ json: { fiscal: true, tipo: 'I', estado: 'Timbrado', uuid: 'MOCK-UUID-0000-SIMULADO', hasXml: true, fecha_timbrado: at(1) } }));
  await page.route('**/api/v1/cotizacion/300', route => route.fulfill({ json: { id_cotizacion: 300, id_cliente: 7, conceptos: [
    { id_concepto: 1, id_producto: 101, descripcion: 'Filtro separador de combustible ISX', cantidad: '8', precio: '742.50', stock: '18', estatus: 'Pendiente', motivo_rechazo: null, precio_cierre: null },
    { id_concepto: 2, id_producto: 102, descripcion: 'Balero cónico 50 x 90 mm', cantidad: '4', precio: '1180.00', stock: '3', estatus: 'Pendiente', motivo_rechazo: null, precio_cierre: null },
  ] } }));
  const u = (idProducto: number, codigo: string, descripcion: string, cantidadVendida: number, ingresosTotales: number, costoTotal: number | null) =>
    ({ idProducto, codigo, descripcion, cantidadVendida, ingresosTotales, costoTotal, utilidadBruta: costoTotal == null ? null : ingresosTotales - costoTotal, margenPorcentaje: costoTotal == null ? null : ((ingresosTotales - costoTotal) / ingresosTotales) * 100, costoConocido: costoTotal != null });
  await page.route('**/api/v1/reportes/utilidad', route => route.fulfill({ json: [
    u(101, 'FS1022', 'Filtro separador de combustible ISX', 126, 93555, 64512), u(105, 'DELO-15W40', 'Aceite Delo 400 15W40 cubeta 19 L', 54, 118530, 89640),
    u(102, '32210', 'Balero cónico 50 x 90 mm', 70, 82600, 57400), u(104, '4302', 'Engrane de 3a velocidad', 12, 67680, 45120), u(103, 'K060', 'Banda poly-V 6 costillas', 43, 16765, null),
  ] }));
}

async function mockCatalog(page: Page) {
  const p = (IdProducto: number, Codigo: string, Descripcion: string, CategoriaNombre: string, Marca: string, Ubicacion: string, PrecioUnitario: number, Existencia: number, Reservada = 0) =>
    ({ IdProducto, Codigo, Descripcion, CategoriaNombre, Marca, Ubicacion, PrecioUnitario, Existencia, Reservada, Disponible: Existencia - Reservada, imagenes: [] });
  await page.route('**/api/v1/producto?*', route => route.fulfill({ json: { data: [
    p(101, 'FS1022', 'Filtro separador de combustible ISX', 'Filtración', 'Fleetguard', 'A-03-2', 742.5, 18, 2),
    p(102, '32210', 'Balero cónico 50 x 90 mm', 'Rodamientos', 'Timken', 'B-11-1', 1180, 3, 1),
    p(103, 'K060', 'Banda poly-V 6 costillas', 'Motor', 'Gates', 'C-02-4', 389.9, 0),
    p(104, '4302', 'Engrane de 3a velocidad', 'Transmisión', 'Fuller', 'D-07-1', 5640, 4),
    p(105, 'DELO-15W40', 'Aceite Delo 400 15W40 cubeta 19 L', 'Lubricantes', 'Chevron', 'L-01-1', 2195, 26, 6),
  ], total: 1284, page: 1, totalPages: 129 } }));
  await page.route('**/api/v1/categoria', route => route.fulfill({ json: [{ IdCategoria: 1, Nombre: 'Filtración' }, { IdCategoria: 2, Nombre: 'Motor' }] }));
  await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [] }));
  const now = Date.now(), day = 86_400_000;
  const o = (idOportunidad: number, empresa: string, etapa: string, montoEstimado: number, siguienteAccion: string, offset: number, responsable: string) =>
    ({ idOportunidad, empresa, etapa, montoEstimado, siguienteAccion, fechaSiguienteAccion: new Date(now + offset * day).toISOString(), responsable, tipoCliente: 'Flotilla', contacto: 'Compras', version: 1 });
  await page.route('**/api/v1/crm/oportunidades?*', route => route.fulfill({ json: { data: [
    o(1, 'Transportes del Golfo', 'Prospecto', 85000, 'Visitar taller', 2, 'Laura M.'),
    o(2, 'Fletes Pánuco', 'Contactado', 42000, 'Enviar catálogo', -1, 'Óscar R.'),
    o(3, 'Logística Altamira', 'Cotizando', 128500, 'Ajustar precios', 1, 'Laura M.'),
    o(4, 'Autotransportes Madero', 'Negociacion', 310000, 'Llamar a gerente', 3, 'Óscar R.'),
    o(5, 'Grúas Tamaulipas', 'Ganada', 64000, '', 0, 'Laura M.'),
  ], total: 5, page: 1, limit: 25 } }));
  await page.route('**/api/v1/crm/resumen', route => route.fulfill({ json: { abiertas: 4, montoAbierto: 565500, vencidas: 1, ganadas: 12, perdidas: 3, ventasPerdidas30Dias: 7 } }));
  const i = (id: string, tipo: string, titulo: string, cuenta: string, estado: string, offset: number | null, plazo: string) =>
    ({ id, tipo, titulo, cuenta, responsable: 'Laura M.', estado, fecha: offset === null ? null : new Date(now + offset * day).toISOString(), plazo });
  await page.route('**/api/v1/crm/bandeja?*', route => route.fulfill({ json: { data: [
    i('T-311', 'tarea', 'Confirmar pedido de balatas', 'Fletes Pánuco', 'Pendiente', -1, 'vencidas'),
    i('2', 'oportunidad', 'Renovación de flotilla Kenworth', 'Fletes Pánuco', 'Contactado', 0, 'hoy'),
    i('T-318', 'tarea', 'Enviar ficha técnica de filtros', 'Logística Altamira', 'Pendiente', 3, 'proximas'),
    i('4', 'oportunidad', 'Kit de embrague Eaton', 'Autotransportes Madero', 'Negociacion', null, 'sin-fecha'),
  ], total: 4, page: 1, limit: 20, administrador: false, consultadoEn: new Date(now).toISOString(), resumen: { vencidas: 1, hoy: 1, proximas: 1, sinFecha: 1 } } }));
}

async function capture(page: Page, name: string) {
  if (prefix) await page.screenshot({ path: `../.artifacts/local/${prefix}-${name}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name}: desbordamiento horizontal`).toBeLessThanOrEqual(1);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`), `${name}: Axe`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Sistema visual ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await installErpApiMock(page);
      await mockDashboard(page);
      await page.route(/\/api\/v1\/crm\/(campanas-locales|secuencias|secuencias\/modelos|reglas-secuencias)(\?|$)/, route => route.fulfill({ json: { data: [], total: 0, page: 1 } }));
      await page.route('**/api/v1/almacen/movil/pedidos?*', route => route.fulfill({ json: { data: [{ id: 2310, folio: 'P-2310', estado: 'En surtido', version: 1 }, { id: 2306, folio: 'P-2306', estado: 'Pendiente', version: 2 }], total: 2 } }));
    });

    test(`login ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
      await capture(page, `login-${theme}`);
    });

    test(`dashboard ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, '/dashboard');
      await expect(page.locator('.metric-card').first()).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `dashboard-${theme}`);
    });

    // U01.3: las gráficas se difieren hasta entrar en pantalla; las secundarias están en "Análisis avanzado".
    const showCharts = async (page: Page, advanced: boolean) => {
      await expect(page.locator('.metric-card').first()).toBeVisible();
      if (advanced) {
        await page.getByText('Análisis avanzado', { exact: true }).click();
        await page.locator('.advanced-analysis .chart-grid, .advanced-analysis .chart-skeleton').first().scrollIntoViewIfNeeded();
      } else {
        await page.locator('#analysis-title').scrollIntoViewIfNeeded();
      }
      const title = advanced ? 'Venta por categoría' : 'Tendencia de ventas';
      await page.getByText(title, { exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await page.waitForTimeout(800);
    };

    for (const [label, advanced] of [['tendencia', false], ['categorias', true]] as const) {
      test(`gráficas ${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await login(page, '/dashboard');
        await showCharts(page, advanced);
        await capture(page, `graficas-${label}-${theme}`);
      });
    }

    test(`gráficas cambian de tema ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, '/dashboard');
      await showCharts(page, false);
      const chart = page.locator('[echarts] canvas').first();
      await expect(chart).toBeVisible();
      await page.waitForTimeout(500);
      const before = await chart.screenshot();
      await page.getByRole('button', { name: theme === 'light' ? 'Usar tema oscuro' : 'Usar tema claro' }).click();
      await page.waitForTimeout(700);
      const after = await page.locator('[echarts] canvas').first().screenshot();
      expect(after.equals(before), `${theme}: la gráfica debe redibujarse con los tokens del otro tema`).toBe(false);
    });

    for (const path of ['/perfil', '/usuarios']) {
      test(`cuenta ${path} ${theme}`, async ({ page }) => {
        const now = Date.now();
        await page.route('**/api/v1/auth/users', route => route.fulfill({ json: [{ idUser: 1, username: 'admin-e2e', role: 'admin', isActive: true, profileName: null, overrideCount: 0 }, { idUser: 2, username: 'laura.m', role: 'user', isActive: true, profileName: 'Mostrador', overrideCount: 1 }, { idUser: 3, username: 'oscar.r', role: 'user', isActive: false, profileName: 'Almacén', overrideCount: 0 }] }));
        await page.route('**/api/v1/auth/access-profiles', route => route.fulfill({ json: [] }));
        await page.route('**/api/v1/auth/permission-catalog', route => route.fulfill({ json: [] }));
        await page.route('**/api/v1/auth/sessions', route => route.fulfill({ json: [{ idSession: 's1', clientLabel: 'Chrome · Windows', createdAt: new Date(now - 7_200_000).toISOString(), lastSeenAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), current: true }] }));
        await page.setViewportSize({ width: 1280, height: 900 });
        await login(page, path);
        await page.waitForTimeout(700);
        await capture(page, `cuenta${path.replace('/', '-')}-${theme}`);
      });
    }

    for (const path of ['/cliente', '/proveedor', '/compra', '/compra/historial', '/garantias', '/reportes/utilidad']) {
      test(`tokens U01.5 ${path} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await login(page, path);
        await page.waitForTimeout(700);
        await capture(page, `u015${path.replace(/\//g, '-')}-${theme}`);
      });
    }

    test(`diálogo de producto ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockCatalog(page);
      await login(page, '/producto');
      await page.getByRole('button', { name: /Nuevo Producto/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(600);
      await capture(page, `dialogo-producto-${theme}`);
    });

    test(`venta ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockSale(page);
      await page.addInitScript(draft => localStorage.setItem('rtt-venta-draft-v1', draft), JSON.stringify(saleDraft));
      await login(page, '/venta');
      await expect(page.getByText('Balero cónico Timken 32210')).toBeVisible();
      await page.waitForTimeout(3500);
      await capture(page, `venta-${theme}`);
    });

    test(`venta móvil ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockSale(page);
      await page.addInitScript(draft => localStorage.setItem('rtt-venta-draft-v1', draft), JSON.stringify(saleDraft));
      await login(page, '/venta');
      await expect(page.getByText('Balero cónico Timken 32210')).toBeVisible();
      await page.waitForTimeout(3500);
      await capture(page, `venta-390-${theme}`);
    });

    for (const [route, name, text] of [['/facturas', 'facturas', 'Autotransportes Huasteca'], ['/cotizacion/historial', 'cotizaciones', 'Logística Altamira']]) {
      test(`${name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await mockLists(page);
        await login(page, route);
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
        await page.waitForTimeout(300);
        await capture(page, `${name}-${theme}`);
      });
      test(`${name} móvil ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await mockLists(page);
        await login(page, route);
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
        await page.waitForTimeout(300);
        await capture(page, `${name}-390-${theme}`);
      });
    }

    test(`nueva cotización ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, '/cotizacion/nueva');
      await page.getByLabel('Agregar producto a cotización...').fill('FILTRO');
      await page.getByRole('option', { name: /Filtro de combustible ISX/ }).click();
      await page.getByLabel('Buscar Cliente').fill('Trans');
      await page.getByRole('option', { name: 'Transportes del Golfo' }).click();
      await expect(page.locator('.selected-client')).toContainText('Transportes del Golfo');
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await capture(page, `cotizacion-nueva-${theme}`);
    });

    for (const [label, width] of [['cobranza', 1440], ['cobranza móvil', 390]] as const) {
    test(`${label} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockFinance(page);
      await login(page, '/cobranza');
      await page.getByLabel('Buscar Cliente').fill('Trans');
      await page.getByRole('option', { name: /Transportes del Golfo/ }).click();
      await expect(page.getByText('1790', { exact: false }).first()).toBeVisible();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await capture(page, `cobranza${width === 390 ? '-390' : ''}-${theme}`);
    });
    }

    test(`cuentas por pagar ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockFinance(page);
      await login(page, '/cuentas-por-pagar');
      await expect(page.getByText('Frenos y Ejes del Norte')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `cxp-${theme}`);
    });

    for (const [label, width] of [['productos', 1440], ['productos móvil', 390]] as const) {
      test(`${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockCatalog(page);
        await login(page, '/producto');
        await expect(page.getByText('Filtro separador de combustible ISX')).toBeVisible();
        await page.waitForTimeout(500);
        await capture(page, `productos${width === 390 ? '-390' : ''}-${theme}`);
      });
    }

    test(`crm pipeline ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockCatalog(page);
      await login(page, '/crm');
      await page.getByRole('radio', { name: /Pipeline/ }).click();
      await expect(page.getByText('Autotransportes Madero')).toBeVisible();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await capture(page, `crm-pipeline-${theme}`);
    });

    test(`crm bandeja ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockCatalog(page);
      await login(page, '/crm/bandeja');
      await expect(page.getByText('Confirmar pedido de balatas')).toBeVisible();
      await page.waitForTimeout(300);
      await capture(page, `crm-bandeja-${theme}`);
    });

    for (const path of ['/crm/campanas', '/crm/secuencias', '/crm/reglas-secuencias', '/crm/reportes-programados', '/almacen/movil', '/facturas/correos']) {
      test(`formulario compartido ${path} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await login(page, path);
        await page.waitForTimeout(600);
        await capture(page, `shared${path.replace(/\//g, '-')}-${theme}`);
      });
    }

    test(`caja ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockLedger(page);
      await login(page, '/caja');
      await expect(page.getByText('Venta #2310')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `caja-${theme}`);
    });

    for (const [label, width] of [['gastos', 1280], ['gastos móvil', 390]] as const) {
      test(`${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockLedger(page);
        await login(page, '/gastos');
        await expect(page.getByText('Recibo CFE octubre').locator('visible=true')).toBeVisible();
        await page.waitForTimeout(400);
        await capture(page, `${label.replace(' ', '-')}-${theme}`);
      });
    }

    test(`contabilidad ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockLedger(page);
      await login(page, '/contabilidad');
      await expect(page.getByText('Venta #2310 de mostrador')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `contabilidad-${theme}`);
    });

    for (const [label, path, text] of [
      ['abastecimiento', '/abastecimiento', 'Cubrir backorder de filtros ISX'],
      ['reabastecimiento', '/operaciones/smart-restock', 'Filtro separador de combustible ISX'],
      ['auditoria', '/reportes/auditoria', 'Protección de la bitácora'],
    ] as const) {
      test(`${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await mockSupply(page);
        await login(page, path);
        await expect(page.getByText(text).first()).toBeVisible();
        await page.waitForTimeout(400);
        await capture(page, `${label}-${theme}`);
      });
    }

    for (const [label, path, text] of [
      ['cliente 360', '/cliente/7', 'Transportes del Golfo SA de CV'],
      ['politica comercial', '/comercial', 'Actualizar política comercial'],
    ] as const) {
      test(`${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await mockClients(page);
        await login(page, path);
        await expect(page.getByText(text).first()).toBeVisible();
        await page.waitForTimeout(500);
        await capture(page, `${label.replace(/ /g, '-')}-${theme}`);
      });
    }

    for (const [label, width] of [['factura global', 1440], ['factura global móvil', 390]] as const) {
      test(`${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const t = (idFactura: number, folio: number, dias: number, nombreReceptor: string, subtotal: number) => ({
          idFactura, serie: 'T', folio, fechaEmision: new Date(Date.now() - dias * 86_400_000).toISOString(), rfcReceptor: 'XAXX010101000', nombreReceptor,
          subtotal, totalImpuestosTrasladados: +(subtotal * 0.16).toFixed(2), totalImpuestosRetenidos: 0, total: +(subtotal * 1.16).toFixed(2),
        });
        await page.route('**/api/v1/factura/global/tickets-pendientes?*', route => route.fulfill({ json: {
          tickets: [t(501, 2301, 1, 'PUBLICO EN GENERAL', 640), t(502, 2304, 2, 'PUBLICO EN GENERAL', 1543.1), t(503, 2306, 4, 'Mostrador · Juan Pérez', 389.9), t(504, 2309, 6, 'PUBLICO EN GENERAL', 2195)],
          totales: { subtotal: 4768, totalImpuestosTrasladados: 762.88, totalImpuestosRetenidos: 0, total: 5530.88 },
        } }));
        await login(page, '/facturas/global');
        await expect(page.getByText('T-2304')).toBeVisible();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(700);
        await capture(page, `${label.replace(/ /g, '-')}-${theme}`);
      });
    }

    test(`reabastecimiento móvil ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockSupply(page);
      await login(page, '/operaciones/smart-restock');
      await expect(page.getByText('Filtro separador de combustible ISX')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `reabastecimiento-390-${theme}`);
    });

    for (const tab of ['Balanza de comprobación', 'Estado de resultados', 'Balance general', 'Tesorería y conciliación', 'Control financiero']) {
      test(`contabilidad ${tab} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await mockLedger(page);
        await login(page, '/contabilidad');
        await page.getByRole('tab', { name: tab }).click();
        await page.waitForTimeout(600);
        await capture(page, `contabilidad-${tab.split(' ')[0].normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}-${theme}`);
      });
    }

    test(`predicción de demanda ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockSupply(page);
      await login(page, '/operaciones/smart-restock');
      await page.getByRole('tab', { name: /Predicción de demanda/ }).click();
      await expect(page.getByText('45 uds')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `prediccion-${theme}`);
    });

    test(`recepción de orden ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockSupply(page);
      await login(page, '/abastecimiento');
      await page.getByRole('tab', { name: /Órdenes/ }).click();
      await page.getByRole('button', { name: 'Recibir' }).click();
      await expect(page.getByText('Recibir OC-12')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `recepcion-${theme}`);
      await page.keyboard.press('Escape');
      await expect(page.getByText('Recibir OC-12')).toBeHidden();
    });

    for (const [label, path, tab] of [
      ['cliente 360 contactos', '/cliente/7', /Contactos/],
      ['politica comercial credito', '/comercial', /Crédito de clientes/],
      ['politica comercial reglas', '/comercial', /Reglas de aprobación/],
    ] as const) {
      test(`${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await mockClients(page);
        await login(page, path);
        await page.getByRole('tab', { name: tab }).click();
        await page.waitForTimeout(600);
        await capture(page, `${label.replace(/ /g, '-')}-${theme}`);
      });
    }

    test(`revisiones de cotización ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const now = Date.now(), day = 86_400_000;
      await page.route('**/api/v1/cotizacion/77/versiones?*', route => route.fulfill({ json: {
        gestion: true, seleccion: 2, revisionTotal: 2, coincide: true, productos: [],
        actual: { idRevision: 2, idCotizacion: 77, numero: 2, respuesta: { decision: 'Aceptada', nombre: 'Ing. Ramiro Treviño', comentario: 'Autorizado por compras', fecha: new Date(now - day).toISOString() } },
        revisiones: [
          { idRevision: 2, idCotizacion: 77, numero: 2, motivo: 'Ajuste de precio por volumen', autor: 'Laura M.', creadaEn: new Date(now - 2 * day).toISOString(), decision: 'Aceptada', nombreDeclarado: 'Ing. Ramiro Treviño', comentario: 'Autorizado por compras', respondidaEn: new Date(now - day).toISOString() },
          { idRevision: 1, idCotizacion: 76, numero: 1, motivo: 'Propuesta inicial', autor: 'Laura M.', creadaEn: new Date(now - 5 * day).toISOString(), decision: null, nombreDeclarado: null, comentario: null, respondidaEn: null },
        ],
        invitaciones: [{ idInvitacion: 5, venceEn: new Date(now + 0.5 * day).toISOString(), revocada: false, motivo: null, autor: 'Laura M.' }],
        snapshot: { idCotizacion: 77, idCliente: 7, idUnidad: null, folio: 2041, nombre: 'Transportes del Golfo', rfc: 'TGO010203AB1', fecha: new Date(now - 2 * day).toISOString(), vencimiento: new Date(now + 13 * day).toISOString(), subtotal: '9840', impuestos: '1574.4', retenciones: '0', total: '11414.4', conceptos: [
          { idConcepto: 1, idProducto: 101, descripcion: 'Filtro separador de combustible ISX', unidad: 'Pieza', cantidad: '8', precio: '705', importe: '5640', iva: '902.4', retencion: '0' },
          { idConcepto: 2, idProducto: 102, descripcion: 'Balero cónico 50 x 90 mm', unidad: 'Pieza', cantidad: '4', precio: '1050', importe: '4200', iva: '672', retencion: '0' },
        ] },
      } }));
      await login(page, '/cotizacion/77/versiones');
      await expect(page.getByText('Cotización C-2041 · Transportes del Golfo')).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `cotizacion-revisiones-${theme}`);
    });

    test(`expediente de unidad ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const now = Date.now(), day = 86_400_000;
      await page.route('**/api/v1/crm/unidades/12/expediente?*', route => route.fulfill({ json: {
        unidad: { idUnidad: 12, idCliente: 7, idOportunidad: null, vin: '3AKJHHDR5KSKM1234', esn: '79912345', numeroEconomico: 'TG-118', marca: 'Freightliner', modelo: 'Cascadia', anio: 2019, motor: 'Detroit DD15', notas: null, placas: 'XA-1234-B', transmision: 'Eaton Fuller 10V', diferencial: '3.36' },
        kilometrajeActual: '412850', horasActuales: null, permisos: { gestionar: true, anularRetirar: true },
        lecturas: { data: [{ idLectura: 3, fecha: new Date(now - 3 * day).toISOString(), kilometraje: '412850', horas: null, notas: 'Lectura en taller', autor: 'Óscar R.', anulada: false, motivoAnulacion: null }], total: 1, page: 1, limit: 10 },
        mantenimientos: { data: [{ idMantenimiento: 4, titulo: 'Cambio de filtros de combustible', notas: '', fechaObjetivo: new Date(now + 12 * day).toISOString(), kilometrajeObjetivo: '420000', horasObjetivo: null, estado: 'Pendiente', condicion: 'Lo que ocurra primero', version: 1, fechaRealizada: null, detalleCierre: null, autor: 'Óscar R.', cerradoPor: null }], total: 1, page: 1, limit: 10 },
        archivos: [],
      } }));
      await page.route(/\/api\/v1\/crm\/unidades\/12\/piezas(\/origenes)?\?/, route => route.fulfill({ json: { data: [], total: 0, page: 1, limit: 10 } }));
      await login(page, '/crm/unidades/12/expediente');
      await expect(page.getByText('Cambio de filtros de combustible').first()).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `expediente-${theme}`);
    });

    test(`crédito de cliente ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockClients(page);
      await login(page, '/comercial');
      await page.getByRole('tab', { name: /Crédito de clientes/ }).click();
      await page.getByRole('button', { name: 'Configurar' }).first().click();
      const dialog = page.getByRole('dialog', { name: /Crédito de Transportes del Golfo/ });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `credito-cliente-${theme}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    for (const [label, button] of [['kardex', 'Ver Kardex del producto'], ['cotizaciones-proveedor', 'Ver cotizaciones de proveedores']] as const) {
      test(`diálogo ${label} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await mockCatalog(page);
        await mockDialogs(page);
        await login(page, '/producto');
        await page.getByRole('button', { name: button }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(700);
        await capture(page, `dialogo-${label}-${theme}`);
      });
    }

    test(`diálogo detalle de factura ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockLists(page);
      await mockDialogs(page);
      await login(page, '/facturas');
      await page.getByRole('button', { name: 'Ver detalle de factura' }).first().click();
      await expect(page.getByText('Balero cónico 50 x 90 mm')).toBeVisible();
      await page.waitForTimeout(500);
      await capture(page, `dialogo-factura-${theme}`);
    });

    test(`diálogo convertir cotización ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockSale(page);
      await mockLists(page);
      await mockDialogs(page);
      await login(page, '/cotizacion/historial');
      await page.getByRole('button', { name: 'Convertir cotización a venta' }).first().click();
      await expect(page.getByText('Balero cónico 50 x 90 mm')).toBeVisible();
      await page.waitForTimeout(500);
      await capture(page, `dialogo-convertir-${theme}`);
    });

    test(`reporte de utilidad ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockDialogs(page);
      await login(page, '/reportes/utilidad');
      await expect(page.getByText('Engrane de 3a velocidad').first()).toBeVisible();
      await page.waitForTimeout(600);
      await capture(page, `utilidad-${theme}`);
    });

    test(`pedidos ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, '/pedidos');
      await page.waitForTimeout(300);
      await capture(page, `pedidos-${theme}`);
    });

    test(`dashboard móvil ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await login(page, '/dashboard');
      await expect(page.locator('.metric-card').first()).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `dashboard-390-${theme}`);
    });
  });
}
