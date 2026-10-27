# Arquitectura de cobranza y REP

Actualizado: 29 de septiembre de 2026. Refactor Q03.2, sin nuevas rutas ni migraciones.

`PagoService` conserva los métodos del controlador y delega con firmas derivadas mediante `Parameters` y `ReturnType` en cuatro proveedores Nest registrados en `PagoModule`:

| Servicio | Responsabilidad |
| --- | --- |
| `CobranzaService` | Registro de pagos, historial por factura y obligaciones pendientes por cliente/general/PPD |
| `RegistroRepService` | Alta, historial y cancelación de REP |
| `RepPdfService` | PDF del recibo e información fiscal |
| `RepXmlService` | XML mediante constructor fiscal y compatibilidad de pruebas sin proveedor |

Las filas SQL internas están en `pago.types.ts`. Se mantiene la integración de `FiscalModule`, la presentación de PDF y el contrato HTTP actual. El XML de compatibilidad conserva el escape de atributos; no equivale a certificación fiscal.

## Transacciones

- El pago bloquea la factura antes de comprobar saldo y registrar el cobro. Error: rollback; siempre libera el QueryRunner después del bloque transaccional.
- El REP valida importes y facturas duplicadas, bloquea las facturas por ID ascendente, comprueba cliente/moneda/PPD y registra vínculos, saldos y pagos dentro del mismo runner. Si falla una factura, revierte todo el REP.
- La cancelación consulta primero al proveedor fiscal. Una respuesta pendiente no inicia reversión local ni cambia los saldos.
- Al confirmar cancelación, se mantienen los bloqueos de REP/facturas, comprobaciones de devoluciones/notas y eliminación exclusiva de pagos ligados a ese REP dentro de la transacción.

Las cuentas de beneficiario son datos del documento, no conexiones bancarias. No se incorporan APIs ni accesos a bancos.

## Validación

### Frontend tipado — Q03.3.1

`pago-api.types.ts` describe las respuestas reales de pendientes, historial REP, registro de pagos/REP y cancelación. Se conservan los nombres SQL del contrato y los importes `number | string` recibidos de PostgreSQL; el componente REP los convierte a números para su edición.

El formulario REP tiene controles explícitos, no anulables, y usa `getRawValue()` para construir el DTO. El selector admite texto o un `Cliente` y valida la selección contra los clientes cargados. Las respuestas de clientes y pendientes son arreglos, conforme a sus servicios; no se utiliza un supuesto envoltorio `data`.

Pruebas del frontend comprueban normalización de importes, límite al saldo pendiente, descarte de una respuesta tardía del cliente anterior y contrato de cancelación fiscal pendiente. Este bloque no modifica rutas, SQL ni el comportamiento fiscal y permanece parte del tipado progresivo del frontend registrado en el README.

Las pruebas existentes cubren sobrepagos, orden de bloqueo, vínculos de pagos, reversos y escape XML. Las pruebas de composición del módulo cubren cancelación pendiente, uso del constructor fiscal y rollback por cliente distinto en una segunda factura. La restauración aislada ejecuta operaciones reales de NC/REP y saldos sobre una base desechable; el frontend dispone de sus suites generales de navegador.

Ver [PAC sandbox](FISCAL_PAC_SANDBOX.md) para los modos fiscales y [README](../README.md) para resultados y pendientes de cada sesión.

## Q04.5.3c2c2a — cobro simple idempotente, 2 de octubre de 2026

POST /api/v1/pago acepta requestId UUID opcional. Mantenga la misma clave y contenido al reintentar; un cobro nuevo requiere clave nueva. Sin clave se conserva comportamiento previo sin garantía contra duplicados. Interfaz PagoDto expone la clave; no se añadió formulario ni almacenamiento/generación automática en frontend.

Cobranza toma advisory lock transaccional por UUID normalizado y consulta operation_idempotency antes de saldo. Mismo contenido devuelve respuesta existente incluso tras liquidar factura. SHA-256 de factura/importe/forma/referencia/notas en orden explícito, opcionales ausentes igual a vacíos. Datos diferentes con misma clave: 409. Pago/caja/saldo y respuesta idempotente se confirman o revierten juntos. Reutiliza tabla 030; no nueva migración.

perf:payment-concurrency con backup aislado verifica ocho reintentos, orden de propiedades/UUID mayúsculas, importe/factura distintos 409, fallo tras movimientos financieros y rollback, reintento posterior, sobrepago concurrente 400 y factura liquidada. [Reporte](q0453c2c2a-payments.json): cuatro cobros efectivos, caja +100 y saldo 0; copia eliminada. Regresión integral db:verify también aprobada y comprueba migraciones antes de aplicarlas en copia. No prueba HTTP de cobro, UI, REP concurrente, pagos a proveedores ni carga prolongada.

## REP idempotente — Q04.5.3c2c2b2a (2026-10-02)

RegistrarRepDto admite requestId UUID opcional. Se bloquea la clave en PostgreSQL y se compara huella de cliente, fecha, forma, moneda, monto, cuenta/RFC y facturas ordenadas. Respuesta original y movimientos se guardan en la misma transacción; contenido diferente devuelve 409. La respuesta se recupera antes de validar saldo, para permitir reintentos de facturas ya liquidadas.

El formulario reutiliza la clave ante respuesta incierta y bloquea cambios de contenido; errores definitivos de validación liberan el intento. La clave no persiste al navegar/recargar. [Prueba real y límites](q0453c2c2b2a-rep.json): ocho concurrentes, rollback financiero, reintento posterior y liquidación. No prueba PAC ni carga prolongada.
