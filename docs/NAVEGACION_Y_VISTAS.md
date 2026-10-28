# Navegación rápida y vistas guardadas (U02.1 y U02.2)

Implementado el 28/10/2026. Las acciones masivas (U02.3) quedan pendientes de definir con el propietario.

## U02.1 · Navegación rápida (Ctrl K)

Antes, el buscador de la barra superior sólo buscaba productos, clientes y unidades, desde 2 caracteres. Ahora también lleva a cualquier pantalla:

- **Pantallas:** aparecen desde la primera letra, sin consultar el servidor. Cada palabra escrita debe aparecer en el nombre, la descripción, la sección o la ruta, y no importan los acentos. Por ejemplo, `cotizacion`, `historial cotiz` o `proveedores pagar`. Se muestran hasta 6 y primero las que empiezan con lo escrito.
- **Permisos:** sólo se ofrecen pantallas que el rol puede abrir. Se leen los `data.roles` de las rutas del router, de modo que la lista no puede desviarse de lo que permite el guard.
- **Recientes:** con el campo vacío se muestran las últimas 5 pantallas visitadas. Se guardan en el navegador (`localStorage`, clave `erp.recent-pages`, sólo rutas). Si el navegador no permite guardarlas, simplemente no aparecen.
- **Teclado:**
  - `Ctrl K` enfoca el buscador.
  - `↓` y `↑` recorren los resultados; `↑` en el primero regresa al campo.
  - `Enter` abre el resultado enfocado.
  - `Escape` cierra el panel.
  - `Enter` en el campo sigue buscando productos, como antes.
- La búsqueda de productos, clientes y unidades no cambia.
- La lista de pantallas vive en `frontend/src/app/layout/app-pages.ts` y también alimenta el título de cada página.

## U02.2 · Vistas guardadas

Los seis listados que guardan sus filtros en la URL (Q04.3/Q04.4) tienen un botón **Vistas**: Clientes, Proveedores, Productos, Facturas, Cotizaciones y Compras.

- **Guardar filtros actuales…** guarda con un nombre la búsqueda, los filtros (tipo, estado, fechas), el orden y el tamaño de página. No guarda la página: una vista siempre abre en la 1. Guardar con un nombre que ya existe en ese listado actualiza esa vista, sin distinguir mayúsculas.
- Elegir una vista cambia la URL y el listado restaura los filtros como con cualquier enlace. Mientras los filtros coinciden, el botón muestra el nombre de la vista activa.
- **Eliminar «nombre»** aparece cuando hay una vista activa y pide confirmación. No toca los datos del listado.
- Cada usuario ve y elimina sólo sus vistas. Una vista ajena responde igual que una inexistente. Hay un máximo de 20 por listado, y se borran si se borra el usuario.

**API:**

- `GET /vistas-guardadas?ruta=` (sin caché).
- `POST /vistas-guardadas` con `{ruta, nombre, consulta}`.
- `DELETE /vistas-guardadas/:id`.

El servidor conserva sólo `q`, `limit`, `sort`, `order`, `tipo`, `estado`, `desde` y `hasta`, con un máximo de 200 caracteres cada uno. Cada listado vuelve a validar sus parámetros al abrirse, así que una vista con valores ya no válidos se normaliza igual que un enlace.

**Migración 118:** tabla `vista_guardada`, con `CHECK` de rutas permitidas, nombre único por usuario y listado, y `ON DELETE CASCADE`.

## Corrección transversal encontrada al probar

Con TypeORM y PostgreSQL, `query()` devuelve `[filas, afectadas]` para `UPDATE`/`DELETE … RETURNING`, en lugar de las filas. Ahora `queryRows` (`backend/src/common/database/typed-query.ts`) reconoce esa forma. Esto corrige:

- eliminar contactos de cliente, números de parte o aplicaciones inexistentes, que respondía "eliminado" en vez de 404;
- la revisión de piezas instaladas, que devolvía una lista en vez de `{version}`;
- la protección contra cambios simultáneos del estado de cascos, que nunca se activaba;
- el alta de proveedor con días de crédito de H03, que devolvía una lista;
- la actualización y eliminación de vistas guardadas.

## Límites

- Las vistas no se comparten entre usuarios y sólo existen en los seis listados con filtros en la URL.
- Los recientes son por navegador, no por usuario del ERP.
- No hay atajos de una tecla (tipo `g v`) ni acciones como "crear venta" en Ctrl K. Sólo pantallas y la búsqueda existente.

## U02.3 · Acciones en lote (28/10/2026)

El propietario eligió tres acciones. Todas comparten `frontend/src/app/shared/bulk-selection.ts`:

- casillas por fila y una casilla "seleccionar esta página";
- la selección se conserva al cambiar de página;
- una barra con el conteo, la acción y "Quitar selección".

### Facturas: descargar varias

- Se seleccionan hasta 100 facturas y "Descargar PDF y XML (ZIP)" llama a `GET /venta/documentos-lote?ids=…`, con el mismo acceso que la descarga individual.
- El ZIP contiene:
  - el PDF generado por el sistema;
  - el **XML timbrado guardado, sin modificar**, si existe;
  - `LEEME-descarga.txt`, que indica qué facturas no tienen XML (borrador o modo de pruebas) y qué identificadores no existen.
- Los nombres son `factura_<serie><folio>_<id>.pdf/.xml`, o `nota-credito_…` para egresos.
- El ZIP se genera sin dependencias (`backend/src/common/zip.ts`, deflate y nombres UTF-8, con `zlib.crc32` de Node 24). Se comprobó con el `Expand-Archive` de Windows.

### Productos: precio o categoría en lote (sólo administradores)

- Hasta 200 productos. **Cambiar precio…** aplica un porcentaje de −90 a +500 %, redondeado a centavos o a pesos enteros, con mínimo de $0.01 o $1. **Cambiar categoría…** asigna una categoría existente.
- **Ver vista previa** (`POST /producto/lote/vista-previa`) muestra, para cada producto, el valor actual y el nuevo, y la suma de precios. No guarda nada.
- **Aplicar** (`POST /producto/lote/aplicar`) funciona así:
  - todo se aplica en una transacción, con un `requestId` idempotente por diálogo;
  - envía los valores que se vieron en la vista previa; si algún precio o categoría cambió desde entonces, **rechaza el lote completo** y pide revisar de nuevo;
  - cada cambio de precio deja su movimiento `CAMBIO_PRECIO` en el kárdex y su registro en la auditoría con el usuario.

### Cuentas por pagar: pagar varias

- En **Facturas** se pueden marcar facturas *Aprobada* o *Parcialmente pagada* con saldo. Las que tienen discrepancias no se pueden seleccionar.
- **Pagar juntas…** sólo se habilita con 2 a 50 facturas del **mismo proveedor y moneda**.
- El monto propuesto es la suma de saldos:
  - si se deja igual, liquida cada factura;
  - si se reduce, **se paga primero lo que vence antes** (y luego por folio interno) y la última recibe un abono.
- `POST /cuentas-proveedor/pagos-agrupados` (ADMIN + `compras.pagar`):
  - registra en una transacción un pago por factura, con la misma referencia;
  - cada pago genera su póliza (2100 contra caja o banco) y su traspaso de IVA 1160 → 1170 (H03), y descuenta caja o banco;
  - es idempotente por `requestId`;
  - si una factura ya no admite pagos, rechaza el lote completo.
- Revertir sigue siendo por pago individual, desde el detalle de cada factura.

### Pruebas y límites

- **Pruebas:**
  - Aceptación real `npm run test:bulk-actions` (`backend/verify-bulk-actions.js`, transacción revertida):
    - vista previa sin escritura;
    - aplicación, kárdex y auditoría con el usuario;
    - reintento sin duplicar y vista previa vieja rechazada;
    - categoría en lote;
    - pago agrupado parcial, saldos, pólizas con IVA y banco;
    - reintento sin duplicar pagos y factura pagada rechazada;
    - liquidación final.
  - UI: `tests/bulk-actions.spec.ts`, con las tres acciones.
- **Límites:**
  - la descarga es por lote de hasta 100 y se arma en memoria;
  - el lote de precios no cambia costos ni listas de precios especiales;
  - el pago agrupado no aplica anticipos ni notas de crédito (siguen por su flujo) y no admite monedas mezcladas;
  - revertir un pago agrupado es factura por factura.
