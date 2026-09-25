# Contabilidad y tesorería

## Alcance

El módulo `/contabilidad` mantiene un libro mayor de doble partida y ofrece:

- catálogo inicial de cuentas;
- pólizas automáticas para facturas, notas de crédito, cobros, compras, pagos a proveedor y gastos;
- pólizas manuales en borrador con validación de cargos y abonos antes de contabilizar;
- balanza de comprobación, estado de resultados y balance general;
- cuentas bancarias propias, captura de movimientos del estado de cuenta y conciliación contra la bitácora de caja/bancos;
- periodos contables con cierre mensual y bloqueo de movimientos posteriores;
- centros de costo y presupuestos mensuales comparados contra el resultado real;
- flujo de efectivo por origen y exportación CSV de los reportes financieros.

## Reglas operativas

- Una póliza contabilizada siempre debe tener el mismo total en debe y haber.
- Las pólizas automáticas se identifican por el tipo e id del documento origen y se actualizan dentro de la misma transacción del documento.
- Una cancelación conserva la cabecera de la póliza con estado `Cancelada` para mantener trazabilidad.
- La pantalla de tesorería solo guarda los últimos cuatro dígitos de una cuenta; no necesita conservar el número bancario completo.
- En el estado de cuenta, los depósitos se capturan positivos y los retiros negativos.
- La conciliación exige igualdad exacta a centavos y cada movimiento de caja solo puede conciliarse una vez.
- El cierre de un periodo exige que no existan pólizas en borrador ni pólizas descuadradas. Una vez cerrado, el periodo bloquea altas, cambios y eliminaciones de pólizas y sus movimientos.
- El gasto o ingreso real de cada presupuesto considera únicamente pólizas contabilizadas dentro del año y mes seleccionados.
- Los archivos CSV neutralizan valores que una hoja de cálculo podría interpretar como fórmulas.

## Puesta en marcha

Las migraciones `060_contabilidad_libro_mayor.sql`, `061_tesoreria_conciliacion.sql` y `062_control_financiero.sql` crean el libro mayor, la conciliación bancaria y el control por periodos, centros de costo y presupuestos. La reconstrucción de documentos existentes no inventa una póliza de apertura: si el negocio necesita saldos anteriores al sistema, se deben registrar en una póliza manual de apertura con respaldo del contador.

Los reportes son información operativa. Antes de utilizarlos como libros fiscales definitivos, el contador debe revisar el catálogo, los saldos de apertura y el tratamiento particular de impuestos del negocio.
