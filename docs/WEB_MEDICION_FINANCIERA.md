# Importes y cobros de solicitudes web — WEB05.2c

Implementado y verificado localmente el **12 de octubre de 2026**. Complementa [medición de solicitudes](WEB_MEDICION_CRM.md) y [vínculos comerciales](WEB_TRAZABILIDAD_COMERCIAL.md). No requiere dominio, hosting, compras o APIs bancarias.

Desde la misma fecha, **WEB05.2d** añade [costo histórico/utilidad bruta/margen atribuibles](WEB_RENTABILIDAD_CRM.md) como sección separada por moneda. Las cifras de WEB05.2c conservan sus definiciones; sus resultados fechados más abajo corresponden a esa fase.

## Uso y alcance

**ADMIN → CRM y agenda → Solicitudes web → Medición de solicitudes → Consultar medición → Importes y cobros por moneda.**

Las fechas seleccionan solicitudes por recepción, ambas incluidas, en `America/Mexico_City`. Se observan sus vínculos, documentos, ajustes y cobros **registrados al consultar**, aunque se hayan agregado después del periodo. No es un reporte de ventas o cobros realizados durante esas fechas. El origen comercial fue declarado por el operador al vincular la cotización; no se infiere por teléfono, nombre, etapa Ganada o clic de WhatsApp.

Cada moneda aparece separada. No se aplica tipo de cambio ni se presume MXN cuando falta moneda. Sólo se desglosan códigos reconocidos por `Intl.supportedValuesOf('currency')` del servidor Node24; `XXX`, códigos desconocidos, espacios o minúsculas permanecen en la cobertura sin total monetario. La lista pertenece al servidor, no al visitante. No certifica validación del catálogo SAT.

Los importes permanecen `numeric` en PostgreSQL y llegan como **cadenas decimales con dos posiciones**. La UI agrupa los millares directamente en la cadena, sin convertir a `Number`; incluso un total `10000000000000127.59` conserva los centavos. Es la precisión de las columnas actuales, no una conversión de unidades monetarias.

## Indicadores y fórmulas

| Indicador por moneda | Fuente y significado |
| --- | --- |
| Documentos | Facturas internas de ingreso vigentes, coherentes y vinculadas, excluyendo contenedores de factura global |
| Importe documentado, con impuestos | Suma del total original de esos documentos; antes de notas/devoluciones |
| Ventas netas, sin impuestos | Subtotal menos descuento, menos neto de notas vigentes y neto proporcional de devoluciones comprobadas |
| Notas de crédito, con impuestos | Total de notas tipo E con vínculo explícito `id_factura_origen` a esos documentos |
| Devoluciones, con impuestos | `devolucion.monto_total`, comprobado contra sus detalles y cantidades vendidas |
| Cobros registrados | Pagos directos sin REP más detalles canónicos de REP vigentes; no incluye otra vez sus copias en `pago` |
| Saldo pendiente registrado | `factura.saldo_pendiente` actual; no se reconstruye desde importe o estado |

**Venta neta no significa utilidad.** Ese indicador no descuenta costo de mercancía ni gastos operativos. WEB05.2d calcula la utilidad bruta por separado, sólo con costo histórico comparable/comprobado. Los cobros son abonos guardados, antes de reembolsos: no constituyen flujo de caja neto, confirmación bancaria o validación fiscal. Una devolución a saldo a favor y una nota de crédito tampoco prueban una salida de efectivo. Estas lecturas no alteran caja, saldos, documentos, inventario o pólizas.

Un documento Pagada/PUE sin registros de abonos aporta cero **registros de cobro**, no prueba que el cliente no pagó. Se muestra cuántos documentos no tienen registros y cuántos presentan diferencia superior a un centavo entre `total − saldo` y el detalle de cobros. Esa diferencia requiere revisión local; no corrige automáticamente históricos ni inicia una conexión bancaria.

## Coherencia, cancelaciones y cobertura

- Se reutiliza la cadena de WEB05.2b: misma oportunidad/cliente/cotización, ruta directa o pedido compatible, estado conocido y ausencia de cancelación local/fiscal registrada. Una factura con ambas rutas se cuenta una vez.
- Un contenedor global se identifica por serie G o porque agrupa tickets mediante `id_factura_global`; se excluye de importes. Los tickets mantienen sólo su propio vínculo, sin atribuir a la solicitud otros tickets del contenedor. El conteo general de documentos de WEB05.2b conserva su definición, por lo que puede ser mayor que el financiero.
- Encabezados requieren importes finitos, no negativos, descuento no superior a subtotal y `total = subtotal − descuento + trasladados − retenidos`. Campos ausentes, NaN o inconsistentes no se completan con cero.
- Notas activas requieren origen explícito, cliente/moneda común, estado conocido y encabezado coherente. Las canceladas localmente o en `fiscal_documento` se excluyen. No se reconstruyen vínculos históricos desde UUID fiscales mock.
- Devoluciones requieren monto/cantidad válidos, método Efectivo/Saldo a Favor, detalles presentes y sumados al encabezado. Cada producto debe pertenecer a la venta y sus cantidades acumuladas no superarla; conceptos/impuestos/descuentos concuerdan con el documento original.
- Se conserva la regla de neto proporcional por producto de 036: `round(neto_vendido × cantidad_devuelta / cantidad_vendida, 2)`. El reembolso bruto acumulado se comprueba contra la proporción bruta vendida. Las fracciones de una devolución conservan sus centavos, sin multiplicar el precio redondeado como sustituto del importe exacto almacenado.
- Mezclar notas activas y el flujo legado de devolución para la misma venta deja el neto por conciliar; el ERP exige continuar por un único flujo y no es fiable descontar automáticamente ambos. Ajustes que superan importe/neto original también impiden calcular el neto.
- REP: cliente/moneda/estado conocidos, detalle positivo sin facturas repetidas y suma igual al encabezado. Se cuenta `rep_factura`, no la suma adicional de copias `pago.id_rep`. Copias idénticas no duplican el abono; copias con monto/vínculo incompatible dejan cobro por conciliar. REP cancelados localmente o en el registro fiscal se excluyen.

**`null` → «Por conciliar»**: si un documento de una moneda no permite calcular un indicador, el total de **ese indicador y esa moneda** queda desconocido; no se muestra un subtotal parcial como total completo. Los demás indicadores se mantienen independientes: un saldo inválido no reemplaza ni borra pagos comprobados. La fila indica documentos con neto/cobro/saldo desconocido.

La cobertura informa documentos vinculados/financieros, contenedores globales excluidos, moneda desconocida, encabezados inconsistentes, notas/REP cancelados y copias REP omitidas. Un periodo vacío devuelve `currencies: []`; no inventa una fila MXN con ceros. Los metadatos de solicitudes purgadas siguen utilizándose según WEB05.2a, sin restaurar contactos.

## API y protección

Se amplía la respuesta existente, sin una nueva ruta pública:

```text
GET /api/v1/crm/solicitudes-web/metricas?desde=2026-10-01&hasta=2026-10-31
```

Nuevo campo `finance`: `currencies` y `coverage`. Campos monetarios por fila: `importeDocumentado`, `ventasNetasSinImpuestos`, `notasCredito`, `devoluciones`, `cobrosRegistrados`, `saldoRegistrado`, cada uno `string | null`. WEB05.2d agrega `currencies[].profit` con costo/utilidad/margen agregados y cobertura. No se devuelve detalle de facturas/pagos, IDs, contactos, cuentas, UUID, costos unitarios o referencias de pago.

JWT, ADMIN, guards globales y `Cache-Control: private, no-store` conservados. Las mismas fechas/validación seleccionan todo el reporte; conteos, referencias y finanzas comparten **una consulta parametrizada en `REPEATABLE READ READ ONLY`, plazo SQL5s**. La lista de monedas es el tercer parámetro interno. Desplegar el detalle financiero reutiliza el reporte recibido y no hace otra petición. La UI conserva su plazo10s, bloqueo de fechas durante carga y limpieza de resultados al editar el periodo.

Sin dependencias nuevas ni migración. Requiere las estructuras anteriores, incluida **092**; no se modificó ni reaplicó esa migración en la BD de trabajo. El verificador de copia restaurada sí comprueba/migra su copia desde un respaldo previo a092. No hubo fixtures nuevos en las tablas de negocio de la instalación actual.

## Pruebas reproducibles — Node.js 24

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-financial-db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace backend test -- --runInBand crm
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace frontend run test:e2e -- tests/web-metrics.spec.ts tests/crm-commercial.spec.ts tests/web-inbox.spec.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-inbox-auth -- --backup=.backups/FECHA/database.dump
```

El primero exige PostgreSQL local y permiso para crear un esquema. Crea exclusivamente `verify_web_financial_*` propio: estructuras mínimas031/089/090/092/auditoría010 y tablas monetarias equivalentes, sin fallback `public`. Sus datos son fixtures aislados y se eliminan con el esquema. No es AppModule completo ni una prueba de carga. El último exige respaldo local legible, `pg_restore`, Angular de producción y Chromium; también requiere una cotización con venta en el respaldo de prueba para comprobar importes existentes. Usa copia de BD propia, AppModule, login/guards reales, cron detenido y captura fixture sólo allí; elimina copia/servidores/directorio temporal.

Resultados de esta sesión:

- **12/12 grupos SQL/HTTP**: monedas, notas/devoluciones/fracciones, impuestos/descuentos, REP/copia duplicada, estados/cancelaciones, encabezados/NaN, centavos grandes, códigos desconocidos, snapshot/privacidad/auth y limpieza. [Reporte](../.artifacts/web-financial-db.json), [salida](../.artifacts/web-financial-db.log).
- **40/40 pruebas backend** en siete suites CRM; [salida](../.artifacts/web-financial-unit.log).
- **22/22 Playwright** con API/login simulados: ocho de métricas, cuatro de vínculos y diez de bandeja. Cuatro nuevos casos financieros claro1280/oscuro390, dos monedas, desconocidos/vacío, centavos grandes, cobertura, fechas/consulta única, Axe sin infracciones en el componente y reflujo. [Salida](../.artifacts/web-financial-ui.log), capturas financieras claro/oscuro inspeccionadas.
- Regresión anterior de métricas **8/8 grupos** y trazabilidad **9/9 grupos**, PostgreSQL/login/HTTP en esquemas propios; [métricas](../.artifacts/web-financial-metrics-regression.log), [vínculos](../.artifacts/web-financial-commercial-regression.log).
- **11/11 grupos con AppModule y copia restaurada**, Angular producción claro/oscuro y sesiones reales reutilizadas, sin API simulada o JWT inyectado. La venta seleccionada del respaldo devuelve 104.40 MXN documentado/cobrado y neto/devolución por conciliar; conserva esa incertidumbre histórica. Copia eliminada y recursos cerrados. [Reporte](../.artifacts/web-inbox-auth-acceptance.json), [salida final](../.artifacts/web-financial-full-auth.log). El primer guion excedía cinco logins/minuto y recibió 429; se corrigió reutilizando las sesiones existentes, sin cambiar el límite de producción. [Primer intento](../.artifacts/web-financial-full-auth-first.log).
- Backend/frontend producción y ESLint afectado aprobados. Angular inicial **476.79kB /500kB**: el detalle pertenece a CRM diferido y no aumentó la carga inicial; [build](../.artifacts/web-financial-frontend-build.log).
- **Instalación actual: 10/10 sondeos**, login real y Angular4300 oscuro390 con `finance` igual a SQL READ ONLY, sin API simulada/JWT inyectado y sin desbordamiento. API3100, ERP4300, web4500 y piloto4600 disponibles; captura/puente503. Periodo 1–11/10: **0 solicitudes /0 vínculos**, sin insertar fixtures allí. Backend actualizado al build actual. [Reporte](../.artifacts/web-financial-live.json).

## Límites y pendientes conservados

WEB05.2c completa **importes documentados, venta neta sin impuestos, cobros registrados y saldo** de esta cadena explícita. WEB05.2d incorpora costo/utilidad bruta/margen atribuibles con la convención local MXN/factor1 y cobertura explícita; ver [rentabilidad](WEB_RENTABILIDAD_CRM.md). WEB05.2e añade [cobros netos después de reembolsos en efectivo vinculados](WEB_COBROS_NETOS_CRM.md), con saldo a favor separado y cobertura de conciliación MXN/factor1. WEB05.2/WEB05 siguen parciales por normalización verificable de costos multimoneda, flujo de caja integral, ventas sin vínculos, navegación/privacidad y aceptación comercial. No afirma causalidad, CFDI real, validación SAT en vivo, equivalencia de todas las partidas, carga masiva o todos los dispositivos.

P1 requiere contenido/fotos reales y revisión comercial; D01–D09 conservan las decisiones de privacidad/retenciones y activación. Captura/seguimiento operativos siguen cerrados. No se añade otra herramienta de recuperación ni conexión bancaria. Fiscal mock, UUID/idempotencia, dominio/hosting aplazados y IA sin prioridad permanecen como decisiones del propietario.
