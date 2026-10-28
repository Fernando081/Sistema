# Cuentas por pagar y conciliación de proveedores

## Organización del backend — Q03.2

Desde el 29 de septiembre de 2026, `CuentasProveedorService` conserva los métodos públicos del controlador y delega en cuatro servicios registrados en Nest:

| Servicio | Responsabilidad |
| --- | --- |
| `FacturasProveedorService` | Captura, conciliación con recepciones, documentos XML/PDF, discrepancias, aprobación y cancelación |
| `PagosProveedorService` | Programación, pago y reversión |
| `SaldosProveedorService` | Anticipos, notas de crédito y aplicación de saldos |
| `ConsultasProveedorService` | Listado, detalle y dashboard |

Las filas internas están en `cuentas-proveedor.types.ts`. La fachada utiliza `Parameters` y `ReturnType` para mantener firmas sincronizadas. Las operaciones conservan sus transacciones, bloqueos y consultas SQL. La conciliación de partidas y aplicación de saldos reciben el manager de la transacción que las inicia; no abren otra transacción. La separación no agrega rutas ni requiere migraciones.

Las pruebas de composición comprueban resolución de proveedores, pago con bloqueo de factura, actualización de obligación y saldos en una transacción y reintento sin repetir movimientos. La verificación sobre una base restaurada y desechable cubre el flujo operativo real; los datos de trabajo no se usan como destino de esas pruebas.

## Flujo operativo

1. Emita la orden de compra desde **Abastecimiento**.
2. Registre la recepción física. Esa recepción es el único paso que aumenta existencia y genera kardex.
3. En **Cuentas por pagar**, capture la factura contra la orden y adjunte su XML y PDF.
4. El sistema distribuye las cantidades facturadas entre recepciones pendientes por orden de antigüedad y compara cantidad, costo e impuestos.
5. Resuelva las discrepancias documentando la justificación. Una factura con discrepancias abiertas no se puede aprobar.
6. Apruebe la factura para liberar su calendario de pago.
7. Programe y registre pagos parciales o totales. También puede registrar anticipos y notas de crédito y aplicarlos al saldo del mismo proveedor.

La captura de una factura no modifica inventario. Así se evita duplicar existencia al separar recepción física, documento fiscal y obligación de pago.

## Controles

- El folio por proveedor y el UUID fiscal son únicos.
- Cada alta de factura, pago, anticipo o nota de crédito recibe un `requestId` para impedir duplicados por reintentos.
- El XML rechaza declaraciones `DOCTYPE` y `ENTITY`, y valida RFC emisor, UUID y total cuando esos datos se informan en pantalla.
- El PDF debe tener firma `%PDF` y no puede superar 10 MB. XML y PDF quedan en PostgreSQL, protegidos por autenticación.
- Una factura sólo se aprueba cuando tiene recepción asociada y todas sus discrepancias fueron aprobadas.
- No se puede pagar más que el saldo ni usar una programación por un importe diferente.
- Los pagos, anticipos, notas de crédito y aplicaciones generan pólizas automáticas y trazabilidad de usuario.
- Las aplicaciones sólo pueden cruzarse con facturas del mismo proveedor. La pantalla actual aplica anticipos y notas en MXN.

## Estados principales

- Factura: `Conciliada → Aprobada → Parcialmente pagada → Pagada`.
- Con diferencias: `Con discrepancias`; cada diferencia queda `Pendiente`, `Aprobada` o `Rechazada`.
- Programación: `Pendiente → Pagada`.
- Anticipo: `Disponible → Aplicado`.
- Nota de crédito: `Disponible → Aplicada`.

## Permisos

- `compras.facturas`: captura de factura y carga de PDF.
- `compras.autorizar`: resolución de discrepancias.
- `compras.pagar`: aprobación, programación, pagos, anticipos y notas de crédito.

Las acciones de autorización y tesorería requieren además rol administrador.

## API

- `GET /api/v1/cuentas-proveedor/dashboard`
- `GET|POST /api/v1/cuentas-proveedor/facturas`
- `GET /api/v1/cuentas-proveedor/facturas/:id`
- `GET|POST /api/v1/cuentas-proveedor/facturas/:id/pdf`
- `GET /api/v1/cuentas-proveedor/facturas/:id/xml`
- `POST /api/v1/cuentas-proveedor/discrepancias/:id/resolver`
- `POST /api/v1/cuentas-proveedor/facturas/:id/aprobar`
- `POST /api/v1/cuentas-proveedor/facturas/:id/programaciones`
- `POST /api/v1/cuentas-proveedor/facturas/:id/pagos`
- `POST /api/v1/cuentas-proveedor/notas-credito`
- `POST /api/v1/cuentas-proveedor/anticipos`

## Compatibilidad

Las compras históricas creadas por el flujo anterior continúan visibles y pagables en la pestaña **Compras anteriores**. Desde H01 (27/10/2026) ese pago exige ADMIN + `compras.pagar`, registra actor y usa `requestId` idempotente como los demás pagos; su fusión con el flujo de facturas queda en H02-b. Las nuevas operaciones deben usar orden, recepción y factura separadas.

## Contrato JSON de identificadores — 2 de octubre de 2026

Las respuestas JSON del controlador entregan IDs numéricos seguros, incluidos los IDs bigserial de PostgreSQL que el driver devuelve como texto. Esto permite reutilizar el ID de factura en los DTO de anticipo/nota y en los selectores del frontend. También normaliza IDs en partidas, pagos, programaciones y dashboard; importes y fechas conservan su representación anterior. Valores fuera del rango seguro de JavaScript se rechazan para evitar redondear identificadores. Descargas XML/PDF conservan sus respuestas de archivo.

La regresión HTTP de Q04.5.3c2c3d4 comprueba conciliación, aprobación, anticipo/nota/pago, reversión y cancelación sobre copia aislada. Al cancelar se liberan saldos aplicados; liberar un anticipo no equivale a recibir efectivo de vuelta. Las conexiones/APIs bancarias permanecen excluidas.

## Reintentos seguros — Q04.5.3c2c3d5

Factura, anticipo, nota de crédito y pago requieren un requestId técnico. Dentro de la misma transacción se bloquea esa clave, se compara una huella SHA-256 del contenido normalizado y se conserva la respuesta original. Repetir la misma operación devuelve esa respuesta sin duplicar efectos; cambiar contenido, factura destino o tipo de operación con la misma clave devuelve 409. Las partidas de factura se ordenan por detalle para comparar contenido equivalente.

Los registros históricos con UUID pero sin huella se rechazan con 409: revisar el registro y su historial antes de actuar; no asumir que basta generar otro UUID. La interfaz conserva la clave después de errores de red o resultado incierto y bloquea cambios de contenido hasta confirmar. Los errores definitivos de validación permiten corregir. La conservación es en memoria del componente: recargar o abandonar la página pierde esa clave; ante incertidumbre revisar historial antes de volver a registrar. El UUID no es un timbre fiscal.

## Regresión documental HTTP — Q04.5.3c2c3d6

`perf:documents-http` prueba en copia propia el resguardo PDF multipart y XML incorporado al registrar la factura. Compara descarga/bytes/hash almacenado, MIME y disposición de archivo; prueba ausencia, autenticación, permiso de carga, contenido inválido y límite de 10 MiB. Rechazar una carga no debe sustituir el PDF anterior. Ver README/reporte para resultados.

La validación actual del PDF comprueba MIME, firma inicial y EOF; no es un parser completo ni antivirus. El XML comprueba estructura identificable, rechazo DTD/entidades y concordancia de metadatos; no certifica validez fiscal. Los fixtures no son documentos para producción.
