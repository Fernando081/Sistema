# A01 — Escaneo de almacén

**Decisión del propietario,21/10/2026:** no se planea usar cámara o QR en ningún flujo por ahora. A01.2 queda diferido y no condiciona el avance de O01 ni otras fases. No ampliar esas funciones ni preparar hardware/impresión/HTTPS para ellas sin que se retome su uso. El código opcional existente y la captura manual se conservan.

## Alcance y estado

A01.1 permite verificar la recogida del picking que ya existe en Pedidos. Se accede desde **Almacén → Escaneo móvil de picking**, o desde el detalle de un pedido. Ruta privada `/almacen/movil`; acepta `?pedido=ID`.

Es una verificación complementaria: no crea otro surtido, reserva, salida, entrega o factura, y no impide usar las rutas anteriores de facturación/entrega. El surtido original asigna las posiciones; la facturación consume ese picking y la cancelación del pedido lo libera. A01.2 conserva el piloto físico, la aceptación del procedimiento y la decisión sobre una eventual verificación obligatoria antes de entregar.

## Procedimiento

1. Confirmar y surtir el pedido mediante el flujo existente. Sin posiciones asignadas no hay partida que verificar.
2. Abrir Escaneo de almacén y buscar por **folio**. El filtro inicial muestra pedidos activos con picking; no significa que todos tengan cantidad pendiente. El otro filtro conserva acceso al historial cerrado.
3. Elegir **Verificar partida**. Revisar producto, almacén/ubicación, cantidad asignada, verificada y pendiente.
4. Leer la ubicación y después la refacción con lector que escriba como teclado, captura manual o cámara compatible. Enter en los campos no registra automáticamente.
5. Capturar cantidad positiva con punto y hasta seis decimales. Cambiar cualquier código, cantidad o método desmarca la revisión física.
6. Marcar la revisión física y confirmar en el diálogo. La interfaz no supone que cada lectura equivale a una pieza.
7. Consultar el historial. Una corrección requiere motivo y confirmación; crea una anulación, sin borrar o editar el antecedente.

Se aceptan varias recogidas parciales hasta el total asignado. No se puede verificar picking Consumida/Liberada, pedidos fuera de Parcialmente surtido/Surtido o ubicaciones/almacenes inactivos. Una modificación concurrente exige actualizar y revisar de nuevo. El cierre posterior del pedido conserva la historia.

## Códigos y etiquetas

| Tipo | Captura aceptada | QR propio |
| --- | --- | --- |
| Producto | Número de parte `producto.Codigo` exacto | `RTT1:P:<IdProducto>` |
| Posición | `almacen.codigo/ubicacion.codigo`, por ejemplo `TAM-01/GENERAL` | `RTT1:U:<id_ubicacion>` |

`GENERAL` sin almacén se rechaza. No se deduce una pieza mediante equivalentes, coincidencias parciales o códigos EAN de proveedores. Los IDs del QR son referencias técnicas internas; no son timbres fiscales, credenciales ni prueba de presencia física.

Almacén → Etiquetas y cada partida permiten descargar PDF con QR real, código legible y descripción. Las etiquetas históricas de vista previa muestran texto, sin barras decorativas que aparenten un código escaneable. Los QR descargados son privados y requieren permiso; no abren un catálogo anónimo. La ficha QR mantiene su ID aunque cambie la descripción; reimprimir si cambia el código legible.

## Permisos y privacidad

`inventario.escanear` se asigna inicialmente a ADMIN y puede delegarse a USER mediante los perfiles/excepciones existentes. Se valida cuenta activa, rol, versión de sesión y permiso efectivo en cada operación; las escrituras revalidan después de adquirir el bloqueo. No habilita otros movimientos de inventario.

La consulta incluye pedidos/picking necesarios para operar y el historial nominal; no incluye importes ni contactos del cliente. Un operador puede anular su propia verificación y un ADMIN también las de otros operadores. El método Manual/Lector/Camara es declarado, no una certificación del dispositivo utilizado.

La cámara se activa únicamente por solicitud explícita, sin audio. El navegador procesa el video localmente y sólo copia el texto leído al formulario; no envía ni conserva imágenes/video. Una lectura nunca guarda la verificación por sí sola. Se detienen las pistas al leer, detener, cambiar partida, ocultar la pestaña o salir, incluso si el permiso llega después de cancelar.

La API nativa de lectura tiene disponibilidad limitada y la cámara requiere un contexto seguro; en un teléfono, una dirección HTTP de la red local puede no permitirla. Consultar [Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API) y [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Ante incompatibilidad o permiso denegado se mantiene captura manual/lector de teclado. No se instala un certificado ni se abre la red automáticamente.

## Integridad y reintentos

- Cantidades `numeric(18,6)` y cadenas decimales en el contrato; comparación y suma autoritativas en PostgreSQL.
- Bloqueo de pedido antes de picking, versión/huella de evaluación y revisión de eventos para detectar cambios, incluyendo anulación y nueva recogida.
- UUID por intención y huella del contenido/actor/pedido. Mismo UUID y contenido devuelve el recibo original; contenido distinto produce409. Un recibo válido puede recuperarse aunque el pedido se cierre después.
- El navegador conserva la intención para el mismo contenido mientras permanece abierta la pantalla. Si se pierde la respuesta, reintentar sin cambiar el formulario. Después de recargar o cambiar contenido, revisar el historial antes de repetir una recogida incierta. No hay cola offline ni persistencia local de intenciones.
- Anulación compensatoria única, cantidades limitadas al picking y relaciones restrictivas. Eventos protegidos contra UPDATE/DELETE/TRUNCATE mediante trigger ALWAYS y auditados con actor nominal. Las comprobaciones no protegen contra un administrador de BD que elimine deliberadamente las guardas.
- Historial conserva código/ubicación del snapshot original, incluso tras renombrarlos. No reemplaza inventario/kardex ni reconstruye verificaciones de pedidos históricos.
- Consultas en snapshot coherente, páginas de20 y timeout8s; escrituras transaccionales con timeout10s. No se certifica capacidad distribuida o SLA productivo.

## API privada

Prefijo `/api/v1/almacen/movil`, autenticación ERP y permiso indicado:

| Método | Recurso | Uso |
| --- | --- | --- |
| GET | `pedidos?page=1&q=&estado=pendientes` | Lista por folio; estado alternativo `todos` |
| GET | `pedidos/:id?page=1` | Picking y huella de evaluación |
| GET | `pedidos/:id/historial?page=1` | Verificaciones/anulaciones |
| POST | `pedidos/:id/verificar` | UUID, idSurtido, evaluacionSha256, producto, ubicacion, cantidad, metodo, confirmacion=true |
| POST | `pedidos/:id/anular` | UUID, idVerificacion, motivo y confirmacion=true |
| GET | `etiquetas/producto/:id` | PDF QR privado |
| GET | `etiquetas/ubicacion/:id` | PDF QR privado |

La migración111 agrega permiso y `almacen_picking_verificacion`, índices, restricciones, función de vínculo/cantidad y guardas/auditoría. No modifica migraciones anteriores, existencias ni pedidos existentes. Se usa pdfmake ya instalado, sin dependencia adicional; [documentación QR](https://pdfmake.github.io/docs/0.1/document-definition-object/qr/).

## Validación reproducible y pendientes

Con Node24, builds terminados y un respaldo local legible:

```powershell
npm run test:warehouse-mobile -- --backup=.backups/FECHA/database.dump
```

El verificador restaura una base propia `verify_mobile_<16hex>`, ejecuta check/migrate en esa copia y usa AppModule, SQL, HTTP y Angular compilado reales. Prueba permisos/delegación/revocación bajo bloqueo, DTO, códigos, decimales, cambios concurrentes, UUID, anulación/propiedad, estados, stock intacto, auditoría/rollback/guardas y paginación. Navegador claro1280/oscuro390 con login real, confirmación/corrección/recarga/PDF, Axe y reflujo. Interrumpe una respuesta después de guardar realmente para comprobar el reintento; el service worker se bloquea en ese contexto de prueba para que la interrupción sea observable por Playwright. No es una prueba del modo offline/PWA.

Las APIs de cámara se simulan con MediaStream de canvas: compatibilidad ausente, lectura, parada, permiso tardío, pestaña oculta y navegación. No activa cámara física ni acredita lectura HID/impresión reales. El informe `.artifacts/a01-mobile.json` debe contener `passed`, `cleanupPassed` y `copyRemoved` verdaderos, `apiMocked=false` y los indicadores de hardware explícitamente falsos. Los PDF finales se renderizan, inspeccionan y decodifican por separado. Resultados efectivos, respaldos y aplicación de111 en la sesión del README.

**Pendiente A01.2:** probar teléfonos/navegadores, lector físico, impresión/tamaño/contraste/daño de etiquetas, conexión segura para cámara en LAN y operación con personal real; aprobar procedimiento, alcance obligatorio si procede y conservación/capacidad. No requiere comprar dominio para validar captura manual/lector local. No introducir controles bancarios ni cambiar fiscal mock; IA mantiene su prioridad diferida. Siguiente bloque técnico del plan: O01, contrastando primero trabajos programados/reintentos existentes.
