import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PagoProveedorController } from '../pago-proveedor/pago-proveedor.controller';
import { CompraController } from '../compra/compra.controller';
import { PedidoController } from '../pedido/pedido.controller';
import { PagoController } from '../pago/pago.controller';
import { CotizacionController } from '../cotizacion/cotizacion.controller';
import { AlmacenController } from '../almacen/almacen.controller';

type Handler = (...args: never[]) => unknown;
const metadata = (key: string, target: object) => Reflect.getMetadata(key, target) as string[] | undefined;

// Escrituras que cualquier sesión del personal puede hacer, revisadas en H02-a
// (docs/SEGURIDAD_Y_PERMISOS.md). Toda ruta nueva de escritura sin @Roles,
// @Permissions o @Public debe clasificarse aquí de forma explícita.
const OPEN_WRITE_ROUTES = new Set([
  // Cuenta propia: operan sobre req.user y exigen contraseña/factor cuando corresponde.
  'POST /auth/logout', 'POST /auth/logout-all', 'POST /auth/password', 'POST /auth/sessions/:id/revoke',
  'POST /auth/mfa/setup', 'POST /auth/mfa/confirm', 'POST /auth/mfa/disable',
  'POST /auth/password-recovery/setup', 'POST /auth/password-recovery/confirm', 'POST /auth/password-recovery/revoke',
  'POST /notifications/:id/read', 'POST /notifications/read-all',
  // U02.2: vistas guardadas propias (sólo filtros; el servicio filtra por req.user y no revela vistas ajenas).
  'POST /vistas-guardadas', 'DELETE /vistas-guardadas/:id',
  // Maestros compartidos del personal; borrar cliente/proveedor sigue siendo ADMIN.
  'POST /cliente', 'PUT /cliente/:id', 'POST /cliente/:id/contactos', 'DELETE /cliente/:id/contactos/:idContacto',
  'POST /proveedores', 'PUT /proveedores/:id', 'POST /upload',
  // CRM compartido con versión/ACL de tareas en servicio; borrar unidad exige que no tenga expediente.
  'POST /crm/oportunidades', 'PATCH /crm/oportunidades/:id', 'POST /crm/oportunidades/:id/seguimientos',
  'POST /crm/oportunidades/:id/unidades', 'POST /crm/clientes/:id/unidades', 'PATCH /crm/unidades/:id',
  'DELETE /crm/unidades/:id', 'POST /crm/tareas', 'PATCH /crm/tareas/:id', 'POST /crm/comunicaciones',
  'POST /crm/encuestas', 'POST /crm/ventas-perdidas',
  'PUT /crm/oportunidades/:id/documentos-comerciales/cliente',
  'PUT /crm/oportunidades/:id/documentos-comerciales/cotizaciones/:quote',
  'PUT /crm/oportunidades/:id/documentos-comerciales/cotizaciones/:quote/retirar',
  // Propuestas y solicitudes: no mueven inventario ni dinero; la venta/autorización se valida al convertir/resolver.
  'POST /cotizacion', 'POST /pedidos', 'POST /pedidos/desde-cotizacion/:idCotizacion', 'POST /pedidos/:id/confirmar',
  'POST /comercial/autorizaciones', 'POST /comercial/simular-precio', 'POST /abastecimiento/solicitudes',
  'POST /garantias',
]);

function controllerClasses(): Array<new (...args: never[]) => unknown> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.controller.ts')) files.push(file);
    }
  };
  walk(join(__dirname, '..'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return files.flatMap(file => Object.values(require(file) as Record<string, unknown>))
    .filter((value): value is new (...args: never[]) => unknown =>
      typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined);
}

function openWriteRoutes(): string[] {
  const routes: string[] = [];
  for (const cls of controllerClasses()) {
    const base = String(Reflect.getMetadata(PATH_METADATA, cls));
    const classGuarded = metadata(ROLES_KEY, cls) || metadata(PERMISSIONS_KEY, cls) || Reflect.getMetadata(IS_PUBLIC_KEY, cls);
    for (const name of Object.getOwnPropertyNames(cls.prototype)) {
      const handler = (cls.prototype as Record<string, Handler>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (method === undefined || path === undefined || method === RequestMethod.GET) continue;
      if (classGuarded || metadata(ROLES_KEY, handler) || metadata(PERMISSIONS_KEY, handler) || Reflect.getMetadata(IS_PUBLIC_KEY, handler)) continue;
      routes.push(`${RequestMethod[method]} ${`/${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '')}`);
    }
  }
  return routes.sort();
}

describe('Permisos de rutas operativas (H01/H02)', () => {
  it('pago a compras anteriores exige ADMIN y compras.pagar', () => {
    const handler = PagoProveedorController.prototype.registrar;
    expect(metadata(ROLES_KEY, handler)).toEqual(['admin']);
    expect(metadata(PERMISSIONS_KEY, handler)).toEqual(['compras.pagar']);
  });

  it('compra directa (H02-b) exige ADMIN, compras.recibir y compras.pagar', () => {
    // Aprueba la factura del proveedor y, si es de contado, la paga: mismo control que Cuentas por pagar.
    expect(metadata(ROLES_KEY, CompraController.prototype.create)).toEqual(['admin']);
    expect(metadata(PERMISSIONS_KEY, CompraController.prototype.create)).toEqual(['compras.recibir', 'compras.pagar']);
  });

  it('operaciones de pedido exigen su permiso', () => {
    expect(metadata(PERMISSIONS_KEY, PedidoController.prototype.fulfill)).toEqual(['pedidos.surtir']);
    expect(metadata(PERMISSIONS_KEY, PedidoController.prototype.cancel)).toEqual(['pedidos.cancelar']);
    expect(metadata(PERMISSIONS_KEY, PedidoController.prototype.releaseExpiredReservations)).toEqual(['pedidos.cancelar']);
    expect(metadata(PERMISSIONS_KEY, PedidoController.prototype.invoice)).toEqual(['ventas.crear']);
  });

  it('cobros, REP, conversión a venta y trazabilidad exigen permiso', () => {
    expect(metadata(PERMISSIONS_KEY, PagoController.prototype.registrar)).toEqual(['cobranza.registrar']);
    expect(metadata(PERMISSIONS_KEY, PagoController.prototype.registrarRep)).toEqual(['cobranza.registrar']);
    expect(metadata(PERMISSIONS_KEY, CotizacionController.prototype.convertir)).toEqual(['ventas.crear']);
    for (const name of ['registerLot', 'registerSerial', 'createCore', 'updateCore'] as const)
      expect(metadata(PERMISSIONS_KEY, AlmacenController.prototype[name])).toEqual(['inventario.trazabilidad']);
  });

  it('no hay escrituras sin control fuera de la lista revisada', () => {
    const open = openWriteRoutes();
    expect(open.filter(route => !OPEN_WRITE_ROUTES.has(route))).toEqual([]);
    // La lista no conserva rutas que ya no existen o que ya tienen control.
    expect([...OPEN_WRITE_ROUTES].filter(route => !open.includes(route))).toEqual([]);
  });
});
