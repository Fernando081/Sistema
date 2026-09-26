# Abastecimiento y órdenes de compra

## Flujo operativo

1. Cree una **solicitud de compra** con los productos, cantidades, costo estimado y origen de la necesidad.
2. Un administrador autoriza la solicitud. El backend impide ordenar solicitudes sin autorización.
3. Emita la **orden de compra** indicando proveedor, costo acordado y fecha promesa.
4. Registre cada recepción física, incluso si es parcial. Nunca se permite recibir más de lo pendiente.
5. La recepción actualiza existencia y kardex dentro de la misma transacción.
6. La mercancía disponible se asigna automáticamente a backorders por prioridad y antigüedad.
7. Desde **Recepciones** distribuya flete, seguro, importación o maniobras por valor o cantidad. El reparto cuadra al centavo y actualiza el costo de reposición.
8. Registre devoluciones al proveedor desde la recepción original. El sistema valida lo recibido, lo devuelto anteriormente y la existencia disponible.
9. Compare cotizaciones por producto y califique al proveedor en precio, entrega, calidad y atención.
10. Capture el XML/PDF de la factura, concilie sus partidas contra orden y recepciones, resuelva diferencias y programe el pago desde **Cuentas por pagar**.

Cada solicitud, orden y recepción utiliza un UUID de idempotencia. Repetir una petición por doble clic o pérdida de conexión devuelve la operación existente y no duplica inventario.

La recepción es el único paso que incrementa inventario. La factura crea la obligación financiera y se documenta en [Cuentas por pagar y conciliación de proveedores](CUENTAS_PROVEEDOR.md).

## Estados

- Solicitud: `Borrador → Autorizada → Ordenada`.
- Orden: `Emitida → Parcialmente recibida → Recibida`.

## API

- `GET|POST /api/v1/abastecimiento/solicitudes`
- `POST /api/v1/abastecimiento/solicitudes/:id/autorizar`
- `GET|POST /api/v1/abastecimiento/ordenes`
- `GET /api/v1/abastecimiento/ordenes/:id`
- `POST /api/v1/abastecimiento/ordenes/:id/recepciones`
- `GET /api/v1/abastecimiento/recepciones`
- `GET /api/v1/abastecimiento/recepciones/:id`
- `POST /api/v1/abastecimiento/recepciones/:id/costos`
- `POST /api/v1/abastecimiento/devoluciones-proveedor`
- `GET /api/v1/abastecimiento/comparativo/:idProducto`
- `GET|POST /api/v1/abastecimiento/evaluaciones`
