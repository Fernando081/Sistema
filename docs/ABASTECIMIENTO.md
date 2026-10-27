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

## Integridad concurrente — Q04.5.3c2c1, 2 de octubre de 2026

Solicitud, orden, recepción, costo y devolución serializan por operación/requestId antes de consultar repetición mediante advisory lock transaccional. Ocho reintentos simultáneos probados sin duplicar efectos; el lock se libera con rollback/commit. No implica validación de payload diferente con la misma clave.

Migración 085 evita que el trigger de producto registre como ajuste manual el stock ya registrado por recepción/devolución. Indicador local restaurado tras UPDATE; auditoría manual/precio y sincronización por ubicación siguen activas. No repara registros históricos ni otros servicios.

Verificador perf:business-concurrency exige backup dentro de .backups, restaura/migra únicamente base propia y la elimina al terminar. Comprueba carrera control 23505, ocho reintentos en cinco operaciones, rollback después de stock/Kardex y reintento de misma clave, límite pendiente concurrente, recepción parcial/completa y devolución/costo únicos. Existencia por ubicaciones igual a global en cada assert. [Reporte](q0453c2c1-business.json). No es prueba HTTP, carga prolongada, backorders concurrentes ni recuperación física de PostgreSQL.

## Q04.5.3c2c2b1 — contenido de los reintentos, 2 de octubre de 2026

Las cinco operaciones nuevas guardan huella y respuesta en operation_idempotency dentro de la transacción del negocio. Mantenga una misma clave con los mismos datos para reintentar; cantidades/costo/motivo/documento distintos o compartir clave entre operaciones devuelve 409. Partidas ordenadas por ID y propiedades canónicas evitan conflictos por orden JSON; defaults/opcionales normalizados. El reintento devuelve respuesta original, que puede reflejar estado de ese momento: consulte el registro para estado actual.

**Claves históricas sin huella:** devuelven 409 con indicación de consultar operación original. No se crea una huella a partir de un reenvío ni se modifica el registro histórico. Compruebe la operación antes de registrar otra; no convierta automáticamente el conflicto en petición con nueva clave. Sin nueva migración, reutiliza tabla 030.

perf:supply-payload prueba ocho reintentos, contenido/documento/tipo distintos, UUID mayúsculas/orden de propiedades, histórico sin huella y rollback/ubicaciones/Kardex. [Reporte](q0453c2c2b1-supply-payload.json); copia eliminada, sin datos operativos modificados. No es prueba HTTP/UI ni validación de REP u otros movimientos de stock.
