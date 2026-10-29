# Contabilidad y tesorería

## Alcance

El módulo `/contabilidad` mantiene un libro mayor de doble partida y ofrece:

- catálogo inicial de cuentas;
- pólizas automáticas para facturas, notas de crédito, cobros, compras, pagos a proveedor y gastos;
- pólizas manuales en borrador con validación de cargos y abonos antes de contabilizar;
- balanza de comprobación, estado de resultados y balance general;
- cuentas bancarias propias, importación masiva local de estados de cuenta y conciliación contra la bitácora de caja/bancos;
- conciliaciones agrupadas y parciales, ajustes documentados, transferencias entre cuentas propias y cierre mensual de tesorería;
- periodos contables con cierre mensual y bloqueo de movimientos posteriores;
- centros de costo y presupuestos mensuales comparados contra el resultado real;
- flujo de efectivo por origen y exportación CSV de los reportes financieros.

## Reglas operativas

- Una póliza contabilizada siempre debe tener el mismo total en debe y haber.
- Las pólizas automáticas se identifican por el tipo e id del documento origen y se actualizan dentro de la misma transacción del documento.
- Una cancelación conserva la cabecera de la póliza con estado `Cancelada` para mantener trazabilidad.
- La pantalla de tesorería solo guarda los últimos cuatro dígitos de una cuenta; no necesita conservar el número bancario completo.
- Tesorería no se conecta a bancos ni solicita credenciales bancarias. La información entra únicamente por CSV o captura manual controlada.
- En el estado de cuenta, los depósitos se capturan positivos y los retiros negativos.
- Una conciliación puede reunir varios movimientos bancarios y varios movimientos del sistema. Sus totales deben coincidir a centavos.
- Una diferencia sólo se permite si se clasifica y documenta; el sistema crea el movimiento compensatorio y una póliza contable balanceada.
- Las transferencias entre cuentas propias enlazan una salida y una entrada iguales sin reconocerlas como ingreso o gasto.
- La conciliación automática sólo ocurre cuando existe una única coincidencia de monto exacto dentro de tres días. Los casos ambiguos permanecen pendientes para revisión manual.
- Cada archivo se identifica por su huella SHA-256 y cada renglón por una huella estable. Reimportar el archivo o una versión que repita movimientos no duplica el estado de cuenta.
- Una conciliación puede revertirse como grupo sin borrar movimientos. Si contenía un ajuste, se registra su compensación y se cancela la póliza automática.
- Los renglones revisados que no representan un movimiento contable pueden marcarse como ignorados con trazabilidad en auditoría.
- El cierre mensual de tesorería exige cero pendientes hasta la fecha de corte y saldo exacto contra el estado de cuenta. Después bloquea cambios en ese mes y fechas anteriores.
- El cierre de un periodo exige que no existan pólizas en borrador ni pólizas descuadradas. Una vez cerrado, el periodo bloquea altas, cambios y eliminaciones de pólizas y sus movimientos.
- El gasto o ingreso real de cada presupuesto considera únicamente pólizas contabilizadas dentro del año y mes seleccionados.
- Los archivos CSV neutralizan valores que una hoja de cálculo podría interpretar como fórmulas.

## Puesta en marcha

Las migraciones `060_contabilidad_libro_mayor.sql`, `061_tesoreria_conciliacion.sql`, `062_control_financiero.sql`, `072_conciliacion_bancaria_automatica.sql` y `073_tesoreria_avanzada_local.sql` crean el libro mayor, la conciliación local avanzada, la importación por lotes y el control por periodos, centros de costo y presupuestos. La reconstrucción de documentos existentes no inventa una póliza de apertura: si el negocio necesita saldos anteriores al sistema, se deben registrar en una póliza manual de apertura con respaldo del contador.

## Formato del estado de cuenta

El importador acepta CSV separado por coma, punto y coma o tabulador, con fechas `AAAA-MM-DD` o `DD/MM/AAAA`. Reconoce encabezados comunes en español e inglés:

- `Fecha`, `Descripción`, `Referencia` y `Monto`; o
- `Fecha`, `Descripción`, `Referencia`, `Cargo` y `Abono`.

Los cargos deben ser negativos cuando se usa la columna `Monto`. En el formato separado, el sistema calcula `Abono - Cargo`. Admite números `1,234.56` y `1.234,56`. Las filas inválidas se reportan sin impedir que se importen las filas correctas.

Los reportes son información operativa. Antes de utilizarlos como libros fiscales definitivos, el contador debe revisar el catálogo, los saldos de apertura y el tratamiento particular de impuestos del negocio.

## F03 — DPO contable (28/10/2026)

**Contabilidad → Días de pago (DPO)** usa el mismo rango de fechas que los demás reportes. API: `GET /finanzas/contabilidad/dpo?fechaInicio&fechaFin`, sólo ADMIN; por defecto, los últimos 90 días. Sólo lee pólizas contabilizadas y no escribe nada.

- **Saldo medio de Proveedores (2100):** promedio de los saldos de cierre de **cada día** del periodo (saldo inicial más movimientos acumulados). No es el promedio simple de inicio y fin.
- **DPO sobre costo** = saldo medio ÷ costo de ventas (5000) × días.
- **DPO sobre compras** = saldo medio ÷ compras a crédito × días. Las compras a crédito son los abonos a 2100 de `FacturaProveedor` y `Compra`, con IVA, igual que el saldo de Proveedores.
- **Conciliación de Proveedores (mayor contra auxiliar):** compara el saldo 2100 con las facturas de proveedor por pagar más las compras anteriores por pagar. Detecta las compras anteriores liquidadas sin pago contable, que son la causa conocida, e indica si la diferencia queda explicada por completo. El auxiliar sólo se conoce al día de hoy, así que esta parte aplica cuando el periodo termina hoy.
- **Conciliación de inventario:** 1130 inicial + entradas − salidas = final, y las salidas se comparan contra el costo de ventas.
- **Advertencias:**
  - mayor y auxiliar no cuadran, así que el DPO no es confiable;
  - la contabilidad empieza después del inicio del periodo;
  - Proveedores tuvo saldo deudor algún día;
  - no hay costo o compras para el denominador;
  - las salidas de inventario difieren del costo.
- **Plazo efectivo operativo (Q02):** se muestra sólo como contraste. Mide días entre factura y pago, ponderados por monto, y es otra métrica.

**Hallazgo con los datos actuales:**

- El mayor de Proveedores es 674,091.00 y el auxiliar 78,650.00. La diferencia de 595,441.00 queda explicada por completo por 9 compras anteriores de contado: el modelo anterior (`fn_reconstruir_poliza_compra`) abonó 2100 y nunca registró su pago.
- Con ese saldo, el DPO sobre costo de los últimos 90 días sale en 9,759 días. La pantalla lo marca como no confiable.
- La corrección es una póliza de ajuste que debe revisar el contador (F02). F03 no la crea. Desde F02a se puede preparar en borrador (sección siguiente).
- Inventario contra costo cuadra al centavo en el periodo.

**Límites:**

- El auxiliar no se puede reconstruir a una fecha pasada.
- No usa saldos medios por proveedor ni pondera por moneda (todo en MXN con el tipo de cambio de cada factura).
- No incluye gastos (6000) en el denominador.

## F02a — Propuesta de ajuste de Proveedores (28/10/2026)

En **Contabilidad → Días de pago (DPO)**, debajo de las conciliaciones, el panel "Propuesta de ajuste para tu contador (F02)" lista las compras anteriores de contado:

- liquidadas y sin pago registrado;
- con su póliza automática original y el abono que hizo a Proveedores (2100).

Con los datos actuales son 9 compras por 595,441.00. Es la misma diferencia que explica F03.

**Qué hace:**

- Crea una **póliza manual en Borrador**, tipo Diario:
  - un cargo a 2100 por cada compra, con referencia `F02:compra:<id>`;
  - un abono total a la **cuenta de contrapartida que elija el contador**, por ejemplo 1100 Caja o 1110 Bancos.
- La fecha y el motivo los captura quien la prepara; el motivo queda en el concepto. Se pide confirmar que se revisó con el contador.
- **No cambia saldos.** La póliza se contabiliza en la pestaña Pólizas con "Contabilizar" (permiso `contabilidad.operar`), cuando el contador la apruebe.
- Al contabilizarla, F03 deja de contar esas compras como causa y el mayor de Proveedores cuadra con el auxiliar. Mientras siga en Borrador, la diferencia sigue a la vista.

**Controles:**

- Una compra sólo puede estar en un ajuste vigente: no Cancelado y no automático. Dos solicitudes simultáneas se serializan; una crea la póliza y la otra recibe conflicto.
- La contrapartida debe estar activa, aceptar movimientos y no ser 2100. Una compra que ya no aplica rechaza la solicitud completa sin dejar pólizas.
- El trigger de periodos cerrados existente impide fechar la póliza en un mes cerrado.
- API:
  - `GET /finanzas/contabilidad/dpo/ajuste-proveedores` (ADMIN);
  - `POST` con `{fecha, idCuentaContrapartida, motivo (10–200), compras[], confirmacion:true}` (ADMIN y `contabilidad.operar`).
  - Sin migración: usa `poliza_contable` y `poliza_contable_detalle`.

**Verificación:**

- `npm run test:supplier-adjustment`: copia aislada del último respaldo; exige 15/15.
- `tests/dpo-contable.spec.ts`: interfaz, sin 2100 en contrapartidas, confirmación y axe.

**Pendiente (F02, externo):**

- Que el contador decida la contrapartida y la fecha (y si conviene una póliza por compra o una sola), y que la contabilice.
- Los **saldos iniciales** previos al sistema: se registran como póliza manual de apertura con respaldo del contador. No hay importación de balanza inicial.
- La validación contable general del catálogo y de las pólizas automáticas.
