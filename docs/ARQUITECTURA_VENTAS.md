# Arquitectura de ventas

Actualizado: 29 de septiembre de 2026. Q03.2, reorganización interna sin nuevas rutas ni migraciones.

`VentaService` conserva los métodos usados por los controladores de venta, factura y pedido. Delega con `Parameters` y `ReturnType` en cinco proveedores registrados en `VentaModule`:

| Servicio | Responsabilidad |
| --- | --- |
| `RegistroVentaService` | Alta de venta y nota de crédito, idempotencia, política comercial, stock/reservas, folio y reembolso |
| `ConsultasVentaService` | Listado, detalle, facturas relacionables y comisiones |
| `DocumentosVentaService` | PDF con información fiscal y envío por correo solicitado |
| `ReversionVentaService` | Cancelación fiscal/local y devolución parcial |
| `FacturaGlobalService` | Tickets elegibles y agrupación en factura global |

Los tipos SQL internos están en `venta.types.ts`; `TicketResumenRow` se reexporta desde la fachada para conservar compatibilidad. `TicketService` sigue encargándose de la presentación del PDF y `FiscalService` del ciclo PAC. La reorganización no modifica la configuración de correo ni realiza envíos durante las pruebas.

## Límites transaccionales

- El alta conserva un único QueryRunner, bloqueo de idempotencia, validación comercial e inventario, actualización de pedido/reservas, reembolso y commit; un error revierte todo y libera el runner.
- La cancelación consulta primero el resultado fiscal. Si sigue pendiente del PAC, no inicia la reversión local. Al confirmarse, conserva el bloqueo de factura origen y ejecuta el procedimiento de cancelación dentro de su transacción.
- La devolución parcial conserva su procedimiento SQL, commit/rollback y liberación del runner.
- La factura global bloquea los tickets elegibles y valida periodo, selección y relaciones antes de agruparlos.

El modo fiscal mock sigue siendo de pruebas. Ver [PAC sandbox](FISCAL_PAC_SANDBOX.md) para el límite entre cancelación comercial y fiscal.

## Validación

### Frontend tipado — Q03.3.2 (30 de septiembre de 2026)

`venta-api.types.ts` define las respuestas de registro, listado paginado, mensajes, cancelación, comisiones y tickets de factura global. Se reutilizan los modelos existentes de resumen y detalle de factura. `cotizacion-api.types.ts` define resumen/paginación, conceptos del detalle y el DTO de conversión con partidas aceptadas/rechazadas y medios de pago.

La tabla de cotizaciones y el diálogo de conversión consumen estos contratos. Las pruebas HTTP comprueban los campos enviados al convertir una cotización y el periodo/selección de tickets al generar una global. Los tipos no validan por sí solos datos de una API en ejecución; las validaciones del backend siguen siendo necesarias.

Este bloque conserva rutas, respuestas y operaciones comerciales. El resto del tipado progresivo del frontend se registra en el README.

Pruebas existentes de inventario apartado, notas/reembolsos y facturación de pedidos. Pruebas de composición Nest para cancelación pendiente, confirmación y rollback de devolución. La verificación aislada restaura un respaldo en una base desechable y ejecuta operaciones reales de venta, devoluciones, NC/REP y pedidos. La suite de navegador comprueba el flujo de pedido hasta factura.

Q03 se cerró en el alcance previsto; su evidencia y límites están en el README. El alta de venta aún concentra un flujo transaccional amplio; futuras extracciones internas deben recibir su runner activo y conservar el orden de bloqueo.

Q04.2.2a (30 de septiembre de 2026) incorpora orden remoto real y CSV filtrado al historial de cotizaciones. Página/conteo/CSV comparten filtro literal y columnas permitidas; una cotización aparece una vez aunque haya varios pedidos vinculados. Las operaciones de PDF, creación de pedido y conversión mantienen sus contratos. Ver [Listado de cotizaciones](COTIZACIONES_LISTADO.md). Facturas y compras permanecen en los bloques siguientes del README.

Q04.2.2b (1 de octubre de 2026) incorpora orden remoto real y CSV filtrado a facturas mediante ConsultasVentaService y su fachada. El tipo I/E se conserva; página y CSV usan filtro/orden comunes y columnas permitidas. Estado fiscal del listado conserva el enriquecimiento existente y el CSV lo consulta sin modificarlo. No cambia registro, cancelación, devoluciones ni factura global. Ver [Listado de facturas](FACTURAS_LISTADO.md). Sigue compras en Q04.2.2c.

## Documentos comerciales HTTP — Q04.5.3c2c3d7

El verificador comercial descarga ticket de venta, cotización y REP PDF generados por la aplicación, revisa contrato HTTP y firma/EOF, y prueba IDs inválidos/documentos inexistentes. PDF de cotización y PDF/XML de REP usan ParseIntPipe; una proyección ausente de venta/cotización devuelve 404 antes de generar PDF.

El XML de REP requiere factura relacionada timbrada; la regresión conserva ese requisito y usa fiscal mock. XML timbrado descargado y resguardado deben coincidir, y repetir el timbrado mantiene el original. Ver README y reporte c3d7 para evidencia. No se envían correos ni documentos al PAC y no se valida diseño visual en esta regresión.
