# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend\tests\web-product-editor.spec.ts >> Ficha web: edición, persistencia y accesibilidad light 1280
- Location: frontend\tests\web-product-editor.spec.ts:7:9

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/login?returnUrl=%2Fproducto", waiting until "load"

```

# Test source

```ts
  18  |     idProducto: number;
  19  |     codigo: string;
  20  |     descripcion: string;
  21  |     cantidad: number;
  22  |     valorUnitario: number;
  23  |     importe: number;
  24  |     importeIva: number;
  25  |     cantidadReservada: number;
  26  |     cantidadSurtida: number;
  27  |     picking: Array<{ almacen: string; ubicacion: string; cantidad: number; estado: string }>;
  28  |   }>;
  29  | }
  30  | 
  31  | export interface ErpMockState {
  32  |   orders: MockOrder[];
  33  |   requests: Array<Record<string, unknown>>;
  34  |   orderSequence: number;
  35  | }
  36  | 
  37  | const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  38  |   status,
  39  |   contentType: 'application/json; charset=utf-8',
  40  |   body: JSON.stringify(body),
  41  | });
  42  | 
  43  | function token(role: 'admin' | 'user' = 'admin') {
  44  |   const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  45  |   return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'admin-e2e', role, idUser: 1, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  46  | }
  47  | 
  48  | export async function installErpApiMock(page: Page): Promise<ErpMockState> {
  49  |   const state: ErpMockState = { orders: [], requests: [], orderSequence: 9000 };
  50  |   await page.route('**/api/v1/**', async (route) => {
  51  |     const request = route.request();
  52  |     const url = new URL(request.url());
  53  |     const path = url.pathname.replace(/^\/api\/v1/, '');
  54  |     const method = request.method();
  55  | 
  56  |     if (path === '/auth/login' && method === 'POST') return json(route, { access_token: token() }, 201);
  57  |     if (path === '/auth/logout' && method === 'POST') return json(route, { ok: true }, 201);
  58  |     if (path === '/auth/me') return json(route, { idUser: 1, username: 'admin-e2e', role: 'admin', isActive: true });
  59  |     if (path === '/notifications') return json(route, { unread: 1, items: [{ idNotification: 1, type: 'quote_expiring', title: 'Cotización por vencer', message: 'COT-100 vence mañana', severity: 'warning', route: '/cotizacion/historial', createdAt: new Date().toISOString() }] });
  60  |     if (path === '/notifications/read-all' || /^\/notifications\/\d+\/read$/.test(path)) return json(route, { ok: true }, 201);
  61  | 
  62  |     if (path === '/cliente' && method === 'GET') return json(route, [{ IdCliente: 1, RFC: 'XAXX010101000', RazonSocial: 'Transportes del Golfo', Pais: 'MEX', CodigoPostal: '89000', IdMetodoDePago: 1, IdFormaPago: 1, IdRegimenFiscal: 1, IdUsoCFDI: 1 }]);
  63  |     if (path === '/producto' && method === 'GET') return json(route, { data: [{ IdProducto: 101, Codigo: 'FILTRO-ISX', Descripcion: 'Filtro de combustible ISX', PrecioUnitario: 850, Existencia: 12, Reservada: 0, Disponible: 12, TasaIVA: 0.16, ObjetoImpuesto: '02', imagenes: [] }], total: 1, page: 1, limit: 100 });
  64  |     if (path === '/proveedores' && method === 'GET') return json(route, [{ IdProveedor: 7, RazonSocial: 'Diesel Parts México' }]);
  65  |     if (path === '/crm/clientes/1/unidades' && method === 'GET') return json(route, [{ idUnidad: 81, idCliente: 1, vin: '1M8GDM9AXKP042788', esn: 'ISX-7788', numeroEconomico: 'T-14', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
  66  | 
  67  |     if (path === '/pedidos/backorders') return json(route, []);
  68  |     if (path === '/pedidos/reservas/vencidas') return json(route, []);
  69  |     if (path === '/pedidos/disponibilidad/101') return json(route, { existenciaFisica: 12, reservada: 0, disponible: 12 });
  70  |     if (path === '/pedidos' && method === 'GET') return json(route, { data: state.orders, total: state.orders.length, page: 1, limit: 25 });
  71  |     if (path === '/pedidos' && method === 'POST') {
  72  |       const payload = request.postDataJSON();
  73  |       const idPedido = ++state.orderSequence;
  74  |       state.orders.unshift({
  75  |         idPedido, folio: idPedido, estado: 'Borrador', total: 986, subtotal: 850, impuestos: 136,
  76  |         createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cliente: 'Transportes del Golfo',
  77  |         rfc: 'XAXX010101000', cantidadPendiente: 1, idCliente: payload.idCliente,
  78  |         partidas: [{ idDetalle: 5001, idProducto: 101, codigo: 'FILTRO-ISX', descripcion: 'Filtro de combustible ISX', cantidad: 1, valorUnitario: 850, importe: 850, importeIva: 136, cantidadReservada: 0, cantidadSurtida: 0, picking: [] }],
  79  |       });
  80  |       return json(route, { idPedido }, 201);
  81  |     }
  82  |     const orderMatch = path.match(/^\/pedidos\/(\d+)(?:\/(confirmar|surtir|entregar|facturar|cancelar))?$/);
  83  |     if (orderMatch) {
  84  |       const order = state.orders.find((item) => item.idPedido === Number(orderMatch[1]));
  85  |       if (!order) return json(route, { message: 'Pedido no encontrado' }, 404);
  86  |       const action = orderMatch[2];
  87  |       if (!action && method === 'GET') return json(route, order);
  88  |       if (action === 'confirmar') { order.estado = 'Confirmado'; order.partidas[0].cantidadReservada = 1; order.cantidadPendiente = 0; }
  89  |       if (action === 'surtir') { order.estado = 'Surtido'; order.partidas[0].cantidadSurtida = 1; order.partidas[0].picking = [{ almacen: 'Principal', ubicacion: 'GENERAL', cantidad: 1, estado: 'Surtida' }]; }
  90  |       if (action === 'entregar') order.estado = 'Entregado';
  91  |       if (action === 'facturar') order.estado = 'Facturado';
  92  |       if (action === 'cancelar') order.estado = 'Cancelado';
  93  |       return json(route, action === 'facturar' ? { message: 'Pedido facturado', idFactura: 7001 } : order, 201);
  94  |     }
  95  | 
  96  |     if (path === '/abastecimiento/solicitudes' && method === 'GET') return json(route, state.requests);
  97  |     if (path === '/abastecimiento/solicitudes' && method === 'POST') {
  98  |       const payload = request.postDataJSON();
  99  |       state.requests.unshift({ idSolicitud: 301, folio: 301, estado: 'Borrador', motivo: payload.motivo, createdAt: new Date().toISOString(), solicitante: 'admin-e2e', partidas: payload.partidas.length, estimado: payload.partidas.reduce((sum: number, item: { cantidad: number; costoEstimado: number }) => sum + item.cantidad * item.costoEstimado, 0) });
  100 |       return json(route, { idSolicitud: 301 }, 201);
  101 |     }
  102 |     if (path === '/abastecimiento/ordenes') return json(route, []);
  103 |     if (path === '/abastecimiento/recepciones') return json(route, []);
  104 |     if (path === '/abastecimiento/evaluaciones') return json(route, []);
  105 | 
  106 |     if (path === '/crm/oportunidades') return json(route, { data: [], total: 0, page: 1, limit: 25 });
  107 |     if (path === '/crm/ventas-perdidas') return json(route, { data: [], total: 0, page: 1, limit: 25 });
  108 |     if (path === '/crm/resumen') return json(route, { abiertas: 0, montoAbierto: 0, vencidas: 0, ganadas: 0, perdidas: 0, ventasPerdidas30Dias: 0 });
  109 |     if (path === '/crm/busqueda') return json(route, { productos: [{ id: 101, titulo: 'Filtro de combustible ISX', codigo: 'FILTRO-ISX', subtitulo: 'Fleetguard', existencia: 12, precio: 850 }], clientes: [{ id: 1, titulo: 'Transportes del Golfo', codigo: 'XAXX010101000' }], unidades: [{ id: 81, titulo: 'T-14 · ISX-7788', codigo: '1M8GDM9AXKP042788', cliente: 'Transportes del Golfo' }] });
  110 |     if (['/crm/segmentos','/crm/plantillas','/crm/campanas','/crm/encuestas','/crm/metas','/crm/tareas','/crm/comunicaciones'].includes(path)) return json(route, []);
  111 | 
  112 |     return json(route, { message: `Mock faltante para ${method} ${path}` }, 501);
  113 |   });
  114 |   return state;
  115 | }
  116 | 
  117 | export async function login(page: Page, returnUrl = '/pedidos') {
> 118 |   await page.goto(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  119 |   await page.getByRole('textbox', { name: 'Usuario', exact: true }).fill('admin-e2e');
  120 |   await page.locator('input[type="password"]').fill('prueba-segura');
  121 |   await page.getByRole('button', { name: 'Entrar' }).click();
  122 |   await page.waitForURL(`**${returnUrl}`);
  123 | }
  124 | 
```