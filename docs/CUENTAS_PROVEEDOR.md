# Cuentas por pagar y conciliación de proveedores

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

Las compras históricas creadas por el flujo anterior continúan visibles y pagables en la pestaña **Compras anteriores**. Las nuevas operaciones deben usar orden, recepción y factura separadas.
