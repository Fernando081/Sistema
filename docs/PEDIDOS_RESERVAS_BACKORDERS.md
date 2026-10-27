# Pedidos, reservas y backorders

## Cotización versionada — V01, 20/10/2026

Crear pedido desde una cotización que activó V01 exige su última revisión vigente/aceptada y contenido coincidente; no basta el estado comercial del listado. Conserva la unidad de la propuesta. Si tiene retenciones, usar conversión directa a factura para conservarlas: el pedido anterior no las representa. Un pedido existente conserva su reintento; no se modifican reservas/surtido/entrega por responder a un enlace. Cotizaciones sin V01 conservan flujo anterior. [Versiones, respuesta y límites](VERSIONES_COTIZACION.md).

## Organización del backend — Q03.2

Desde el 29 de septiembre de 2026, `PedidoService` conserva los métodos públicos y delega en proveedores registrados en Nest:

| Servicio | Responsabilidad |
| --- | --- |
| `RegistroPedidoService` | Alta directa y conversión de cotización |
| `OperacionPedidoService` | Confirmación, surtido/picking, cancelación y entrega |
| `ReservasPedidoService` | Liberación de reservas vencidas y restitución de backorder |
| `ConsultasPedidoService` | Listado, detalle, backorders, reservas vencidas y disponibilidad |
| `FacturacionPedidoService` | Preparación del DTO de venta a partir del pedido |
| `PersistenciaPedidoService` | Bloqueo, partidas, historial y lectura completa sobre el manager recibido |

La fachada utiliza `Parameters` y `ReturnType`; las filas SQL están en `pedido.types.ts`. Los métodos compartidos reciben el `EntityManager` de la transacción activa y no abren otra transacción. Esto mantiene en una unidad el bloqueo de pedido, reservas, picking, cambios de estado, historial y lectura final. Son métodos internos, sin nuevas rutas HTTP.

Se conservan SQL, política comercial y contratos. Preparar la factura no la registra: el controlador sigue usando `VentaService` para completar la operación. La separación no necesita migraciones ni cambia las reglas del flujo siguiente.

La validación incluye pruebas de composición Nest para entrega/historial/lectura con el mismo manager y rechazo de entrega parcial, las pruebas existentes de pedidos, el flujo real sobre una base restaurada y desechable y el flujo de navegador hasta facturación.

## Flujo para ventas

1. Cree el pedido desde **Ventas > Pedidos y backorders**, o desde una cotización vigente con **Crear pedido**.
2. Asocie opcionalmente la unidad del cliente para conservar el VIN o ESN relacionado.
3. Revise cantidades y precios. El backend vuelve a calcular subtotal e IVA.
4. Confirme el pedido. En ese momento se aparta la existencia disponible.
5. Si falta mercancía, el pedido queda **En espera** y el faltante aparece en Backorders.

Una cotización solo puede generar un pedido. Repetir la solicitud devuelve el mismo pedido y no duplica la operación.

## Flujo para almacén

1. Abra el pedido confirmado.
2. Capture en **Surtir ahora** las cantidades físicamente preparadas.
3. Use **Registrar surtido**. Nunca se permite surtir más de lo apartado.
4. Mientras exista mercancía pendiente, el estado será **Parcialmente surtido**.
5. Cuando todo esté surtido, registre la entrega al cliente.
6. Facture desde el mismo pedido. El servidor reutiliza las cantidades y precios surtidos, descuenta la existencia y marca los apartados como consumidos.

La vista de surtido cambia a tarjetas en pantallas pequeñas para poder usarse desde un teléfono en almacén.

## Existencias

- **Física:** piezas registradas en inventario.
- **Apartada:** piezas comprometidas por pedidos confirmados.
- **Disponible:** física menos apartada.

El punto de venta y la lista de productos usan la existencia disponible. Una venta directa no puede consumir mercancía apartada para otro cliente.

Los apartados activos vencen después de siete días. La pestaña **Apartados vencidos** permite revisarlos y liberarlos de forma controlada; la demanda vuelve a backorder para no perder el compromiso con el cliente. Al registrar una compra, el sistema intenta apartar automáticamente la existencia recién disponible para los backorders por prioridad y antigüedad.

## Cancelaciones

Cancelar un pedido antes de entregarlo libera exactamente sus reservas y cancela sus backorders abiertos. Un pedido entregado o facturado ya no se puede cancelar desde este flujo.

## Estados

`Borrador → Confirmado/En espera → Parcialmente surtido → Surtido → Entregado → Facturado`

También puede terminar en `Cancelado`.

## API principal

- `POST /api/v1/pedidos`
- `POST /api/v1/pedidos/desde-cotizacion/:idCotizacion`
- `POST /api/v1/pedidos/:id/confirmar`
- `POST /api/v1/pedidos/:id/surtir`
- `POST /api/v1/pedidos/:id/entregar`
- `POST /api/v1/pedidos/:id/facturar`
- `POST /api/v1/pedidos/:id/cancelar`
- `GET /api/v1/pedidos/backorders`
- `GET /api/v1/pedidos/reservas/vencidas`
- `POST /api/v1/pedidos/reservas/vencidas/liberar`
- `GET /api/v1/pedidos/disponibilidad/:idProducto`

## V02 - Entregas evidenciadas (20/10/2026)

El botón Registrar entrega ahora captura receptor/notas, firma/foto o motivo de ausencia, ubicación opcional y confirmación. Guarda expediente privado inmutable y permite descargar comprobante PDF desde Evidencias de entrega, también tras facturar. Mantiene Surtido→Entregado, reserva/picking y consumo en factura sin movimiento adicional. Permiso pedidos.entregas (ADMIN inicial/delegable) también protege la ruta anterior. Entregas anteriores conservan receptor/notas sin inventar evidencias. [Uso, HTTP, migración103 y límites](ENTREGAS_EVIDENCIADAS.md).
