# Pedidos, reservas y backorders

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
