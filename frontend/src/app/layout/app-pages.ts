import { Route } from '@angular/router';

/** Pantallas del ERP: título del encabezado y destinos de la navegación rápida (Ctrl K). */
export interface AppPage { route: string; title: string; description: string; icon: string; }

export const APP_PAGES: AppPage[] = [
  { route: '/dashboard', title: 'Centro de operación', description: 'Prioridades, ventas y salud del negocio', icon: 'space_dashboard' },
  { route: '/venta', title: 'Nueva venta', description: 'Mostrador, cliente y facturación', icon: 'point_of_sale' },
  { route: '/pedidos', title: 'Pedidos y backorders', description: 'Apartados, surtido y mercancía pendiente', icon: 'assignment' },
  { route: '/comercial', title: 'Política comercial', description: 'Precios, márgenes, crédito y autorizaciones', icon: 'sell' },
  { route: '/cotizacion/nueva', title: 'Nueva cotización', description: 'Prepara una propuesta para tu cliente', icon: 'request_quote' },
  { route: '/cotizacion/historial', title: 'Cotizaciones', description: 'Seguimiento y conversión de propuestas', icon: 'history' },
  { route: '/cotizacion', title: 'Revisiones de cotización', description: 'Versiones, respuesta del cliente y conversión', icon: 'difference' },
  { route: '/facturas/global', title: 'Factura global', description: 'Concentra las ventas de mostrador', icon: 'receipt' },
  { route: '/facturas/correos', title: 'Salida de documentos', description: 'Preparación y simulación local de envíos', icon: 'outgoing_mail' },
  { route: '/facturas', title: 'Facturas', description: 'Historial, documentos y devoluciones', icon: 'receipt_long' },
  { route: '/producto', title: 'Productos e inventario', description: 'Existencias, aplicaciones y números de parte', icon: 'inventory_2' },
  { route: '/catalogo-web', title: 'Catálogo web', description: 'Revisión de calidad y preparación de fichas comerciales', icon: 'storefront' },
  { route: '/almacen/movil', title: 'Escaneo de almacén', description: 'Verificación de picking por ubicación y producto', icon: 'qr_code_scanner' },
  { route: '/almacen', title: 'Almacén profesional', description: 'Ubicaciones, transferencias, conteos, lotes y series', icon: 'warehouse' },
  { route: '/operaciones/smart-restock', title: 'Reabastecimiento', description: 'Sugerencias basadas en demanda y existencias', icon: 'autorenew' },
  { route: '/abastecimiento', title: 'Abastecimiento', description: 'Solicitudes, órdenes y recepciones de mercancía', icon: 'local_shipping' },
  { route: '/compra/historial', title: 'Compras', description: 'Historial de entradas de mercancía', icon: 'shopping_bag' },
  { route: '/compra', title: 'Nueva compra', description: 'Registra mercancía, factura del proveedor y pago en un solo paso', icon: 'add_shopping_cart' },
  { route: '/crm/campanas', title: 'Campañas', description: 'Autorizaciones, bajas y destinatarios; el envío permanece deshabilitado', icon: 'campaign' },
  { route: '/crm/secuencias', title: 'Secuencias de seguimiento', description: 'Un compromiso a la vez para cada cliente', icon: 'linear_scale' },
  { route: '/crm/reglas-secuencias', title: 'Reglas de seguimiento', description: 'Altas, cambios de etapa y asignaciones que inician un seguimiento', icon: 'rule' },
  { route: '/crm/reportes-programados', title: 'Reportes programados', description: 'Resumen interno de compromisos pendientes', icon: 'schedule_send' },
  { route: '/crm/unidades', title: 'Expediente de unidad', description: 'Lecturas, evidencias y mantenimiento', icon: 'agriculture' },
  { route: '/crm/bandeja', title: 'Bandeja comercial', description: 'Compromisos pendientes para continuar en su registro de origen', icon: 'inbox' },
  { route: '/crm', title: 'Clientes y CRM', description: 'Oportunidades, agenda, unidades y demanda', icon: 'groups' },
  { route: '/cliente', title: 'Clientes', description: 'Información fiscal y comercial', icon: 'person' },
  { route: '/proveedor', title: 'Proveedores', description: 'Condiciones y datos de compra', icon: 'factory' },
  { route: '/garantias', title: 'Garantías', description: 'Seguimiento de reclamaciones', icon: 'verified' },
  { route: '/cobranza', title: 'Cobranza', description: 'Pagos y complementos de recepción', icon: 'payments' },
  { route: '/cuentas-por-pagar', title: 'Cuentas por pagar', description: 'Compromisos con proveedores', icon: 'account_balance_wallet' },
  { route: '/caja', title: 'Caja', description: 'Apertura, movimientos y cierre', icon: 'point_of_sale' },
  { route: '/gastos', title: 'Saldos y gastos', description: 'Egresos y flujo operativo', icon: 'savings' },
  { route: '/contabilidad', title: 'Contabilidad', description: 'Pólizas, balanza y estados financieros', icon: 'account_balance' },
  { route: '/reportes/utilidad', title: 'Utilidad', description: 'Rentabilidad de ventas', icon: 'trending_up' },
  { route: '/reportes/auditoria', title: 'Auditoría', description: 'Trazabilidad de cambios', icon: 'manage_search' },
  { route: '/usuarios', title: 'Usuarios y acceso', description: 'Roles y sesiones', icon: 'admin_panel_settings' },
  { route: '/perfil', title: 'Mi cuenta', description: 'Seguridad y preferencias', icon: 'account_circle' },
];

const SECTIONS: Array<[string, string[]]> = [
  ['Ventas', ['/venta', '/pedidos', '/facturas', '/cotizacion', '/comisiones', '/comercial']],
  ['Inventario y compras', ['/producto', '/compra', '/operaciones', '/abastecimiento', '/almacen', '/catalogo-web']],
  ['Clientes y CRM', ['/crm', '/cliente', '/garantias', '/proveedor']],
  ['Finanzas y análisis', ['/caja', '/gastos', '/contabilidad', '/cobranza', '/cuentas-por-pagar', '/reportes']],
  ['Cuenta y acceso', ['/perfil', '/usuarios']],
];

/** Misma agrupación que la barra lateral. */
export function sectionForPath(path: string): string {
  return SECTIONS.find(([, prefixes]) => prefixes.some((p) => path === p || path.startsWith(p + '/')))?.[0] ?? 'Centro de operación';
}

export function pageForPath(path: string): AppPage | undefined {
  return APP_PAGES.find((p) => path === p.route) || APP_PAGES.find((p) => path.startsWith(p.route + '/'));
}

/** Roles exigidos por la ruta (data.roles del router); así la búsqueda no ofrece pantallas que el guard rechazaría. */
export function pageAllowed(page: AppPage, role: string | undefined, routes: Route[]): boolean {
  const route = routes.find((r) => '/' + (r.path ?? '') === page.route);
  const roles = route?.data?.['roles'] as string[] | undefined;
  return !roles?.length || (!!role && roles.includes(role));
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Coincide si cada palabra escrita aparece en el título, la descripción, la sección o la ruta; prioriza el título. */
export function searchPages(term: string, pages: AppPage[], limit = 6): AppPage[] {
  const words = fold(term).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return pages
    .map((page) => {
      const title = fold(page.title);
      const haystack = `${title} ${fold(page.description)} ${fold(sectionForPath(page.route))} ${page.route.replace(/[/-]/g, ' ')}`;
      if (!words.every((w) => haystack.includes(w))) return null;
      const score = (title.startsWith(words[0]) ? 0 : title.includes(words[0]) ? 1 : 2);
      return { page, score };
    })
    .filter((x): x is { page: AppPage; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.page);
}
