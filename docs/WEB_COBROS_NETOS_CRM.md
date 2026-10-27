# Cobros netos y reembolsos vinculados — WEB05.2e

Implementado y verificado localmente el **12 de octubre de 2026**. Complementa [importes y cobros](WEB_MEDICION_FINANCIERA.md), [rentabilidad](WEB_RENTABILIDAD_CRM.md) y [vínculos comerciales](WEB_TRAZABILIDAD_COMERCIAL.md). No requiere dominio, hosting, servicios de pago ni conexiones bancarias.

## Para qué sirve y cómo abrirlo

**ADMIN → CRM y agenda → Solicitudes web → Medición de solicitudes → Consultar medición → Importes y cobros por moneda → Cobros netos y reembolsos.**

Permite comparar los abonos guardados de las ventas atribuidas a solicitudes web con los reembolsos en efectivo comprobados. El saldo a favor se distingue de una salida de efectivo. Así una venta cobrada y posteriormente devuelta no se presenta como el mismo cobro neto que una venta sin reembolso.

Las fechas seleccionan la **recepción de la solicitud**, ambas incluidas, en `America/Mexico_City`; las ventas, pagos y ajustes se observan al consultar. No es un reporte de movimientos realizados durante esas fechas ni atribución automática por nombre, teléfono, etapa Ganada o UUID fiscal mock. Los datos de prueba producen resultados de prueba.

## Indicadores

| Indicador | Definición |
| --- | --- |
| Reembolsos en efectivo vinculados | Ajustes vigentes de las ventas seleccionadas, método Efectivo, con un gasto explícito conciliado |
| Cobros netos registrados | Cobros registrados de WEB05.2c menos esos reembolsos en efectivo |
| Saldo a favor generado | Importe de notas/devoluciones vigentes con método Saldo a Favor; información separada, no se resta como efectivo |
| Documentos con cobro neto comprobado | Ventas con moneda comparable, ajustes comprobados e historial de pagos conciliado |
| Documentos por conciliar | Ventas que no satisfacen alguna condición para calcular el cobro neto |

El saldo a favor generado **no es el saldo disponible actual del cliente**: puede haberse utilizado después. Tampoco es una cuenta bancaria, una confirmación de depósito, utilidad bruta o utilidad después de gastos. El cobro neto sólo incluye las ventas vinculadas y sus reembolsos; **no es todo el flujo de caja del negocio**. La tesorería y sus reportes generales locales ya existen.

## Evidencia exigida

1. Reutiliza la cadena comercial y las reglas de coherencia/cancelación/ajustes de WEB05.2b/c. Facturas globales contenedoras, ventas canceladas, relaciones incoherentes o ventas sin vínculo no aportan a este total.
2. Nota de crédito: origen explícito `factura.id_factura_origen`, método registrado y, para efectivo positivo, `factura.id_gasto_reembolso` (035).
3. Devolución: detalle e importe bruto exacto comprobados; para efectivo positivo, `devolucion.id_gasto_reembolso` (093).
4. El gasto debe estar vigente, método Efectivo, categoría Devoluciones y Reembolsos, monto finito/no negativo e igual al ajuste. Un gasto referenciado por más de un documento queda no conciliado, incluso si otro documento está cancelado o fuera de la cohorte.
5. Saldo a Favor no debe tener gasto de reembolso. Un ajuste de efectivo **comprobado de importe cero** puede carecer de gasto porque no salió efectivo. Un método ausente no se interpreta como saldo a favor o cero.
6. El historial de abonos debe ser válido y concordar con `total − saldo_pendiente`, con tolerancia máxima de un centavo. Una factura Pagada/PUE sin historial suficiente no demuestra cobro neto. Los detalles canónicos de REP se cuentan una vez; sus copias no duplican ingresos.
7. Los gastos y el saldo a favor clásicos no registran moneda propia. La comparación exige **venta MXN/factor1 y notas MXN/factor1**. Otras monedas conservan los importes/cobros originales, pero su desglose neto local se muestra por conciliar; no se aplica una conversión supuesta.

La anulación local o fiscal registrada de una nota excluye su reembolso. El flujo existente de cancelación anula el gasto y restaura caja en su transacción; la consulta no realiza esa reversión. Un gasto anulado de una nota aún activa es una inconsistencia, no un reembolso válido.

**`null` → «Por conciliar»**. Si una venta de una moneda no permite calcular el indicador, no se publica una suma parcial como si fuera el total. Cero comprobado se muestra `0.00`. Las razones pueden coincidir: reembolso desconocido, falta de gasto, gasto inconsistente, historial de pagos o moneda no comparable. La cobertura distingue documentos de ajustes/gastos; no deben sumarse como incidentes independientes.

## Migración 093 y conservación de históricos

`093_gasto_reembolso_devolucion.sql` agrega la FK nullable `devolucion.id_gasto_reembolso`, índice único parcial para devoluciones y un índice parcial sobre el vínculo ya existente de notas. Reemplaza la función en esta **nueva migración**; 036 y las demás migraciones aplicadas conservan su contenido.

La nueva función mantiene validaciones, bloqueo de factura/productos, cálculo acumulado de centavos, inventario, saldo a favor, caja y pólizas existentes. Captura el `id_gasto` insertado y lo enlaza en la **misma transacción**. No crea un segundo gasto ni una segunda salida de caja. Un fallo revierte los movimientos de esa transacción.

La aceptación con tablas completas detectó que las devoluciones y cancelaciones SQL escribían su kardex y además generaban un ajuste manual por el trigger del producto. 093 también corrige ambas rutinas: marca únicamente su actualización de stock como movimiento gestionado (085), conserva/restaura el indicador anterior y mantiene activa la sincronización por ubicación. Cada operación genera su movimiento explícito una vez. Un ajuste manual posterior conserva su kardex. No elimina ni recalcula movimientos históricos.

Los vínculos de devoluciones anteriores quedan NULL. **No se reconstruyen por descripción, importe, fecha, cliente, posición de filas ni identificadores mock.** Su posible conciliación histórica requiere un procedimiento independiente con evidencia; esta fase no modifica los datos originales para hacer que el panel muestre cifras.

El endpoint legado `POST /venta/:id/devoluciones` conserva su contrato. Esta migración no agrega idempotencia de solicitud a ese endpoint; no convierte automáticamente una repetición de la captura en un reintento de la misma operación. La idempotencia existente de ventas, notas y REP se conserva.

## API, precisión y privacidad

Misma ruta privada ADMIN: `GET /api/v1/crm/solicitudes-web/metricas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`. Agrega `finance.currencies[].cash`:

- `baseMonetaria: registros-locales-MXN`;
- `reembolsosEfectivo`, `saldoAFavorGenerado`, `cobrosNetosRegistrados`: `string | null`, dos decimales;
- `documentosConCobroNeto`, `documentosCobroNetoDesconocido`, `documentosReembolsoDesconocido`;
- `reembolsosSinGastoVinculado`, `gastosNoConciliados`, `documentosPagosNoConciliados`, `documentosMonedaNoComparable`.

PostgreSQL calcula con `numeric`; la UI formatea cadenas y conserva centavos incluso por encima de `Number.MAX_SAFE_INTEGER`. No recorta a cero un resultado negativo. El panel opcional se integra al despliegue gradual y limpia sus resultados al cambiar fechas; abrir el detalle no solicita otra lectura.

Una consulta parametrizada en el mismo snapshot `REPEATABLE READ READ ONLY`, plazo SQL5s/UI10s, rango1–366 días. Reutiliza JWT/roles/permisos y `private, no-store`. Devuelve agregados, sin contactos, cuentas, referencias de pago, UUID, IDs de facturas/gastos/clientes o costos unitarios. No habilita la captación web ni cambia la retención, prioridades de IA o aceptación comercial.

## Verificación reproducible

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-cash-db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace frontend exec -- playwright test tests/web-metrics.spec.ts tests/web-inbox.spec.ts tests/crm-commercial.spec.ts
```

`test:web-cash-db` compila backend y crea sólo un esquema aleatorio propio `verify_web_financial_*`. Casos sintéticos: efectivo/saldo a favor, centavos, vínculos históricos ausentes, gasto anulado/incongruente/reutilizado, cancelaciones, moneda/factor, historial faltante/REP, cero y cifras grandes; además conserva regresión financiera, privacidad, lectura sin escrituras y auth real. Elimina ese esquema y cierra sus conexiones. No reemplaza la aceptación con las tablas completas.

`backend/verify-web-inbox-auth.js --backup=RUTA_BAJO_.backups` restaura una base propia, ejecuta db:check antes de db:migrate sólo allí, usa AppModule/guards/login reales y Angular de producción. Comprueba nuevas devoluciones y notas por API, gasto/actor/póliza/kardex/caja, exceso rechazado sin cambios y cancelación fiscal mock. Las relaciones de los documentos de prueba se preparan explícitamente sólo en esa copia. La copia, servidores y conexiones propios se eliminan al finalizar; no inserta esos fixtures en la base de trabajo.

**Resultados de la sesión (12/10/2026):**

- **23/23 grupos PostgreSQL/HTTP**: [reporte](../.artifacts/web-cash-db.json), [salida](../.artifacts/web-cash-db.log). Esquema eliminado, snapshot/plazos y tablas intactas comprobados; once grupos nuevos más regresión financiera/auth.
- **228/228 pruebas backend en 51 suites**: [salida](../.artifacts/web-cash-unit.log). Regresiones PostgreSQL: rentabilidad22/22, cohorte8/8 y vínculos9/9; salidas `web-cash-*-regression.log`.
- **30/30 Playwright con API/login simulados**: [métricas/bandeja26](../.artifacts/web-cash-ui.log), [vínculos4](../.artifacts/web-cash-commercial-ui.log). Claro1280/oscuro390, Axe sin infracciones y sin desbordamiento; [capturas](../.artifacts/web-cash-dark.png) inspeccionadas.
- **17/17 grupos AppModule/copia restaurada**: [reporte](../.artifacts/web-inbox-auth-acceptance.json), [salida](../.artifacts/web-cash-full-auth.log). Login/Angular producción/SQL/API reales. Nuevos gastos enlazados, caja/pólizas/actor/kardex/ubicaciones, indicador anterior/restauración, ajustes manuales y rechazo sin cambios comprobados. La copia y sus recursos se eliminaron. En el caso aislado, cobro20 − efectivo15 = neto5; saldo a favor2 separado. No son ventas reales del negocio.
- Respaldo legible previo, db:check con rollback, **093 aplicada** y db:status; migraciones anteriores intactas. Build/ESLint/Node24/sintaxis/repositorio/any/diff aprobados. Bundle inicial477.09kB, dentro de500kB.
- **10/10 sondeos actuales** con login real/panel oscuro390, API sin simular/JWT sin inyectar y HTTP coincidente con SQL: [reporte](../.artifacts/web-cash-live.json). API3100/ERP4300/web4500/piloto4600; captura503. Base actual: **0 solicitudes / 0 oportunidades** del1–11/10; no se agregaron fixtures allí.

Los primeros intentos del verificador detectaron el kardex duplicado; el resultado final corresponde a 093 corregida. No se suman grupos SQL, pruebas unitarias, UI simulada y flujos de copia como si fueran un solo tipo de prueba.

## Pendientes que permanecen

WEB05 sigue parcial: privacidad/retenciones D01–D09, aceptación/lote comercial P1, activación, visitas/búsquedas/clics, ventas sin vínculo, procedencia monetaria verificable para otros casos y flujo de caja integral. Esta fase completa únicamente cobros netos de reembolsos vinculados dentro de su alcance local. No certifica resultados comerciales reales, SAT/PAC, dispositivos físicos, concurrencia exhaustiva ni despliegue de producción.
