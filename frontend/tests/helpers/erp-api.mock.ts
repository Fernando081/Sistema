import { Page, Route } from '@playwright/test';
import type { EntregaEstado } from '../../src/app/services/pedido.service';

export interface MockOrder {
  idPedido: number;
  version: number;
  folio: number;
  estado: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  cliente: string;
  rfc: string;
  cantidadPendiente: number;
  idCliente: number;
  subtotal: number;
  impuestos: number;
  partidas: Array<{
    idDetalle: number;
    idProducto: number;
    codigo: string;
    descripcion: string;
    cantidad: number;
    valorUnitario: number;
    importe: number;
    importeIva: number;
    cantidadReservada: number;
    cantidadSurtida: number;
    picking: Array<{ almacen: string; ubicacion: string; cantidad: number; estado: string }>;
  }>;
}

export interface ErpMockState {
  orders: MockOrder[];
  requests: Array<Record<string, unknown>>;
  orderSequence: number;
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify(body),
});

export async function installErpApiMock(page: Page): Promise<ErpMockState> {
  const state: ErpMockState = { orders: [], requests: [], orderSequence: 9000 };
  const deliveries=new Map<number,EntregaEstado['evidencia']>();
  let authenticated=false;
  const browserState=()=>({profile:{idUser:1,username:'admin-e2e',role:'admin',isActive:true},expiresAt:Math.floor(Date.now()/1000)+3600});
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/auth/login' && method === 'POST') {authenticated=true;return json(route,browserState(),201);}
    if (path === '/auth/browser-state') return authenticated?json(route,browserState()):json(route,{message:'Sesión requerida'},401);
    if (path === '/auth/logout' && method === 'POST') {authenticated=false;return json(route, { ok: true }, 201);}
    if (path === '/auth/me') return json(route, { idUser: 1, username: 'admin-e2e', role: 'admin', isActive: true });
    if (path === '/auth/mfa/status') return json(route,{enabled:false,available:true,recoveryCodesRemaining:0});
    if (path === '/auth/password-recovery/status') return json(route,{configured:false,confirmedAt:null,expiresAt:null,pending:false});
    if (path === '/notifications') return json(route, { unread: 1, items: [{ idNotification: 1, type: 'quote_expiring', title: 'Cotización por vencer', message: 'COT-100 vence mañana', severity: 'warning', route: '/cotizacion/historial', createdAt: new Date().toISOString() }] });
    if (path === '/notifications/read-all' || /^\/notifications\/\d+\/read$/.test(path)) return json(route, { ok: true }, 201);

    if (path === '/cliente' && method === 'GET') return json(route, [{ IdCliente: 1, RFC: 'XAXX010101000', RazonSocial: 'Transportes del Golfo', Pais: 'MEX', CodigoPostal: '89000', IdMetodoDePago: 1, IdFormaPago: 1, IdRegimenFiscal: 1, IdUsoCFDI: 1 }]);
    if (path === '/producto' && method === 'GET') return json(route, { data: [{ IdProducto: 101, Codigo: 'FILTRO-ISX', Descripcion: 'Filtro de combustible ISX', PrecioUnitario: 850, Existencia: 12, Reservada: 0, Disponible: 12, TasaIVA: 0.16, ObjetoImpuesto: '02', imagenes: [] }], total: 1, page: 1, limit: 100 });
    if (path === '/proveedores' && method === 'GET') return json(route, [{ IdProveedor: 7, RazonSocial: 'Diesel Parts México' }]);
    if (path === '/crm/clientes/1/unidades' && method === 'GET') return json(route, [{ idUnidad: 81, idCliente: 1, vin: '1M8GDM9AXKP042788', esn: 'ISX-7788', numeroEconomico: 'T-14', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);

    if (path === '/pedidos/backorders') return json(route, []);
    if (path === '/pedidos/reservas/vencidas') return json(route, []);
    if (path === '/pedidos/disponibilidad/101') return json(route, { existenciaFisica: 12, reservada: 0, disponible: 12 });
    if (path === '/pedidos' && method === 'GET') return json(route, { data: state.orders, total: state.orders.length, page: 1, limit: 25 });
    if (path === '/pedidos' && method === 'POST') {
      const payload = request.postDataJSON();
      const idPedido = ++state.orderSequence;
      state.orders.unshift({
        idPedido, version:1, folio: idPedido, estado: 'Borrador', total: 986, subtotal: 850, impuestos: 136,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cliente: 'Transportes del Golfo',
        rfc: 'XAXX010101000', cantidadPendiente: 1, idCliente: payload.idCliente,
        partidas: [{ idDetalle: 5001, idProducto: 101, codigo: 'FILTRO-ISX', descripcion: 'Filtro de combustible ISX', cantidad: 1, valorUnitario: 850, importe: 850, importeIva: 136, cantidadReservada: 0, cantidadSurtida: 0, picking: [] }],
      });
      return json(route, { idPedido }, 201);
    }
    const deliveryMatch=path.match(/^\/pedidos\/(\d+)\/entrega(?:\/(evidencia))?$/);
    if(deliveryMatch){
      const id=Number(deliveryMatch[1]),order=state.orders.find(o=>o.idPedido===id);
      if(!order)return json(route,{message:'Pedido no encontrado'},404);
      if(method==='GET')return json(route,{estado:order.estado,version:order.version,evidencia:deliveries.get(id)??null,entregaAnterior:null});
      const bytes=request.postDataBuffer();if(!bytes)return json(route,{message:'Falta formulario'},400);
      const form=await new Response(new Uint8Array(bytes),{headers:{'Content-Type':request.headers()['content-type']}}).formData();
      if(order.estado!=='Surtido'||Number(form.get('version'))!==order.version)return json(route,{message:'El pedido cambió'},409);
      if(!String(form.get('recibidoPor')??'').trim()||form.get('confirmacion')!=='true'||!String(form.get('motivoSinEvidencia')??'').trim())return json(route,{message:'Falta confirmar receptor y motivo'},400);
      const evidence={idEntrega:String(id),creadaEn:new Date().toISOString(),autor:'admin-e2e',sha256:'a'.repeat(64),snapshot:{folio:order.folio,cliente:order.cliente,recibidoPor:String(form.get('recibidoPor')),notas:String(form.get('notas')??''),motivoSinEvidencia:String(form.get('motivoSinEvidencia')),ubicacion:null,archivos:[]}};
      deliveries.set(id,evidence);order.estado='Entregado';order.version++;return json(route,evidence,201);
    }
    const orderMatch = path.match(/^\/pedidos\/(\d+)(?:\/(confirmar|surtir|entregar|facturar|cancelar))?$/);
    if (orderMatch) {
      const order = state.orders.find((item) => item.idPedido === Number(orderMatch[1]));
      if (!order) return json(route, { message: 'Pedido no encontrado' }, 404);
      const action = orderMatch[2];
      if (!action && method === 'GET') return json(route, order);
      order.version++;
      if (action === 'confirmar') { order.estado = 'Confirmado'; order.partidas[0].cantidadReservada = 1; order.cantidadPendiente = 0; }
      if (action === 'surtir') { order.estado = 'Surtido'; order.partidas[0].cantidadSurtida = 1; order.partidas[0].picking = [{ almacen: 'Principal', ubicacion: 'GENERAL', cantidad: 1, estado: 'Surtida' }]; }
      if (action === 'entregar') order.estado = 'Entregado';
      if (action === 'facturar') order.estado = 'Facturado';
      if (action === 'cancelar') order.estado = 'Cancelado';
      return json(route, action === 'facturar' ? { message: 'Pedido facturado', idFactura: 7001 } : order, 201);
    }

    if (path === '/abastecimiento/solicitudes' && method === 'GET') return json(route, state.requests);
    if (path === '/abastecimiento/solicitudes' && method === 'POST') {
      const payload = request.postDataJSON();
      state.requests.unshift({ idSolicitud: 301, folio: 301, estado: 'Borrador', motivo: payload.motivo, createdAt: new Date().toISOString(), solicitante: 'admin-e2e', partidas: payload.partidas.length, estimado: payload.partidas.reduce((sum: number, item: { cantidad: number; costoEstimado: number }) => sum + item.cantidad * item.costoEstimado, 0) });
      return json(route, { idSolicitud: 301 }, 201);
    }
    if (path === '/abastecimiento/ordenes') return json(route, []);
    if (path === '/abastecimiento/recepciones') return json(route, []);
    if (path === '/abastecimiento/evaluaciones') return json(route, []);

    if (path === '/crm/oportunidades') return json(route, { data: [], total: 0, page: 1, limit: 25 });
    if (path === '/crm/ventas-perdidas') return json(route, { data: [], total: 0, page: 1, limit: 25 });
    if (path === '/crm/resumen') return json(route, { abiertas: 0, montoAbierto: 0, vencidas: 0, ganadas: 0, perdidas: 0, ventasPerdidas30Dias: 0 });
    if (path === '/crm/busqueda') return json(route, { productos: [{ id: 101, titulo: 'Filtro de combustible ISX', codigo: 'FILTRO-ISX', subtitulo: 'Fleetguard', existencia: 12, precio: 850 }], clientes: [{ id: 1, titulo: 'Transportes del Golfo', codigo: 'XAXX010101000' }], unidades: [{ id: 81, titulo: 'T-14 · ISX-7788', codigo: '1M8GDM9AXKP042788', cliente: 'Transportes del Golfo' }] });
    if (['/crm/segmentos','/crm/plantillas','/crm/campanas','/crm/encuestas','/crm/metas','/crm/tareas','/crm/comunicaciones'].includes(path)) return json(route, []);

    return json(route, { message: `Mock faltante para ${method} ${path}` }, 501);
  });
  return state;
}

export async function login(page: Page, returnUrl = '/pedidos') {
  await page.goto(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  await page.getByRole('textbox', { name: 'Usuario', exact: true }).fill('admin-e2e');
  await page.locator('input[type="password"]').fill('prueba-segura');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`**${returnUrl}`);
}
