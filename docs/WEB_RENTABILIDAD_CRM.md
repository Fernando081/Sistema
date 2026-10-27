# Rentabilidad de ventas vinculadas — WEB05.2d

Implementado y comprobado localmente el **12 de octubre de 2026**. Añade la utilidad bruta atribuible a la cohorte de solicitudes web; el [dashboard y los reportes generales de utilidad](ANALITICA_DASHBOARD.md) ya existían y conservan su alcance.

Complementa [WEB05.2c](WEB_MEDICION_FINANCIERA.md) y usa los vínculos de [WEB05.2b](WEB_TRAZABILIDAD_COMERCIAL.md). No requiere dominio/hosting, compras, Ollama o APIs bancarias.

## Uso

**ADMIN → CRM y agenda → Solicitudes web → Medición de solicitudes → Consultar medición → Importes y cobros por moneda → Rentabilidad de las ventas en MXN.**

El periodo selecciona solicitudes por recepción, no ventas por fecha de factura. Los vínculos, estados, notas y devoluciones se observan al consultar. Retirar un vínculo cambia la atribución actual; no se guarda una nueva serie histórica ni se infiere una venta por Ganada o por un clic.

Cada fila conserva su moneda. Se muestra costo histórico neto, utilidad bruta y margen, junto con documentos comprobables y motivos de incertidumbre. Desplegar rentabilidad reutiliza el mismo reporte y no envía otra consulta. Las pérdidas conservan signo negativo y etiqueta «pérdida».

## Fuente del costo y moneda

La migración **028** ya creó `conceptofactura.costo_unitario_snapshot`. La función aplicada `fn_asignar_costo_venta()` congela el costo medio conocido de compras clásicas anteriores a la venta; una compra posterior no se utiliza para recalcular este panel. El reporte lee exclusivamente ese valor guardado, sin consultar precios de producto, costos de compras actuales o el snapshot de una nota de crédito nueva.

Se contrastó la función de la BD actual con028, las fórmulas de036/079, CompraService/DTO y `frontend/src/app/app.config.ts`: las compras clásicas no tienen moneda propia y la configuración local usa **MXN**. El snapshot tampoco conserva moneda/origen cambiario propios. Por ello esta fase aplica la convención local explícita **`snapshot-local-MXN`** y sólo considera comparable una venta **MXN con tipo_cambio=1**. No certifica la procedencia monetaria de cada histórico.

USD y otras monedas mantienen importe, neto y cobros de WEB05.2c, pero costo/utilidad/margen se muestran **Por conciliar**. MXN con factor ausente, distinto de1 o NaN también queda no comparable. No se aplica el tipo de cambio de una venta a un costo cuya conversión no está documentada. La normalización/procedencia monetaria de snapshots para otras monedas sigue pendiente; no afecta el reporte general existente ni modifica compras históricas.

## Fórmulas

| Campo | Definición |
| --- | --- |
| Costo vendido original por factura/producto | Suma de cantidad de cada concepto × su snapshot original |
| Cantidad neta | Cantidad vendida − cantidad de devolución comprobada − cantidad de nota vigente comprobada |
| Costo neto por producto | Costo vendido original × cantidad neta / cantidad vendida |
| Costo histórico neto por documento | Suma de costos netos de sus productos, redondeada a dos decimales |
| Costo neto por moneda | Suma de costos netos por documento, sólo si todos son comprobables |
| Utilidad bruta | Venta neta sin impuestos de WEB05.2c − costo histórico neto |
| Margen bruto | Utilidad bruta total / venta neta total ×100, redondeado a dos decimales, con base positiva |

Productos repetidos con snapshots diferentes se agrupan por factura/producto, con el costo ponderado de sus conceptos originales. Las devoluciones se registran por producto, no por lote/concepto; no es una identificación FIFO de la pieza física devuelta. Se reutiliza la relación cantidad/costo histórico de036, con redondeo explícito **por documento** para reconciliar costo + utilidad = venta neta en centavos. El margen se calcula sobre las sumas, no promediando porcentajes de facturas.

Ejemplo de fixture comprobado: venta neta80.00 MXN, costo original tras ajustes48.00 → utilidad32.00 y margen40.00%. Con costo128.00, la utilidad es−48.00 y el margen−60.00%; no se recortan pérdidas a cero. Son datos de pruebas aisladas, no resultados del negocio.

Las operaciones se realizan en PostgreSQL `numeric`. Costo/utilidad/margen llegan como cadenas decimales; la UI formatea esas cadenas directamente, sin `Number`. Un costo o porcentaje grande no se limita artificialmente a `numeric(30,2)`; la regresión cubre un margen de más de28 dígitos enteros sin desbordamiento.

## Cuándo se puede calcular

- Se conservan exclusiones de WEB05.2c: cliente/rutas coherentes, facturas de ingreso vigentes, contenedores globales fuera, cancelaciones locales/fiscales guardadas, notas vinculadas y devoluciones comprobadas.
- Todos los conceptos originales deben tener producto, cantidad positiva y detalle monetario coherente. El subtotal neto y el total con impuestos de los conceptos deben coincidir con su factura.
- Todos los snapshots originales deben ser finitos y no negativos. **Cero explícito es válido; NULL, NaN o negativo no son cero.** No se supone un costo por porcentaje del precio o por compras actuales.
- Las notas activas deben tener conceptos, productos presentes en la venta y detalle concordante con su encabezado. Sus cantidades, acumuladas con devoluciones, no deben superar lo vendido. Se usa el costo original de la venta, aunque el costo de la nueva nota sea diferente.
- Una mezcla histórica de nota/devolución incompatible o un neto no conciliado conserva incertidumbre. Cantidad cero no causa división por cero.
- Cobros y saldo se mantienen independientes: un costo desconocido no oculta ventas netas/cobros comprobados, y un abono no demuestra utilidad.

Si **algún documento** de una moneda no permite calcular rentabilidad, el costo/utilidad/margen **total de esa moneda** es `null`; no se muestra utilidad parcial como total completo. La UI usa «Por conciliar» y cobertura:

| Campo de cobertura | Significado |
| --- | --- |
| documentosConRentabilidad | Documentos con costo comparable y detalles completos |
| documentosRentabilidadDesconocida | Complemento de los anteriores dentro de la fila de moneda |
| documentosSinCostoValido | Ausencia de conceptos/snapshot o algún snapshot NULL, NaN o negativo |
| documentosMonedaCostoNoComparable | Moneda distinta de MXN o factor de MXN no comprobable como1 |
| documentosDetalleNoConciliado | Neto, conceptos, cantidades o ajustes no conciliables |

Los motivos pueden coincidir y no se deben sumar para reconstruir documentos. Comprobados + desconocidos sí coincide con el número de documentos de esa fila. Un documento totalmente devuelto con costos conocidos produce costo/utilidad0.00; margen `null` con cero documentos desconocidos significa **«Sin ventas netas positivas»**, no fallo ni0%. Si faltan snapshots originales, la cobertura conserva esa falta incluso con cantidades netas cero. Periodo vacío mantiene `currencies: []`.

## API y seguridad

La ruta ADMIN existente se conserva:

```text
GET /api/v1/crm/solicitudes-web/metricas?desde=2026-10-01&hasta=2026-10-31
```

`finance.currencies[].profit` contiene `baseCosto`, `costoVentaNeto`, `utilidadBruta`, `margenBrutoPct` y los cinco conteos anteriores. Importes/porcentaje son `string | null`. No devuelve costos unitarios, IDs de documentos/productos, contactos o referencias de pago. JWT, guards, `private, no-store`, fechas validadas, snapshot `REPEATABLE READ READ ONLY` y plazo SQL5s/UI10s se mantienen.

Sin dependencias, tablas o migraciones nuevas. Requiere028 y las estructuras anteriores hasta092. No se modificaron migraciones aplicadas ni se recalcularon/asignaron snapshots de negocio. El verificador ampliado restaura/migra sólo su copia desde respaldo previo a092; no cambia la BD de trabajo.

## Validación — Node.js 24

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-profit-db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace backend test -- --runInBand crm
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace frontend run test:e2e -- tests/web-metrics.spec.ts tests/crm-commercial.spec.ts tests/web-inbox.spec.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-inbox-auth -- --backup=.backups/FECHA/database.dump
```

`test:web-profit-db` comparte el verificador financiero y admite únicamente su opción fija `--profit`. Su helper exige `verify_web_financial_*` propio; no hay fallback `public`. Añade casos de costo únicamente en ese esquema y restaura sus fixtures antes de comprobar las lecturas sin cambios. No contiene AppModule completo, cron o carga masiva. El último comando usa una copia restaurada propia con AppModule y sesiones reales; conserva el límite de login y no activa captura operativa.

Resultados de la sesión:

- **22/22 grupos PostgreSQL/HTTP**, diez nuevos de rentabilidad y doce de la base financiera. Costo original/NC, producto repetido, retornos, ganancias/pérdidas, cero/base indefinida, snapshots inválidos, moneda/factor, cantidades/detalles/cancelaciones, redondeo/margen enorme y auth/snapshot/limpieza. [Reporte](../.artifacts/web-profit-db.json), [salida](../.artifacts/web-profit-db.log).
- **40/40 backend** en siete suites CRM; [salida](../.artifacts/web-profit-unit.log).
- **26/26 Playwright**, cuatro nuevos de rentabilidad +22 regresiones, claro1280/oscuro390: costo/utilidad/margen, USD no comparable, pérdida/cero/desconocido, cadenas grandes, consulta única/limpieza, Axe del componente y reflujo. API/login simulados sólo en estas pruebas UI; capturas inspeccionadas. [Salida final](../.artifacts/web-profit-ui.log). Primer intento:24 aprobadas y dos aserciones con una frase esperada diferente al texto visible; se corrigió la expectativa y pasó el conjunto completo. [Primer intento](../.artifacts/web-profit-ui-first.log).
- Regresión SQL/HTTP de métricas **8/8** y vínculos **9/9**, en esquemas propios con auth real; [métricas](../.artifacts/web-profit-metrics-regression.log), [vínculos](../.artifacts/web-profit-commercial-regression.log).
- **12/12 grupos AppModule/copia restaurada**, Angular producción y login real claro/oscuro, sin API simulada/JWT inyectado. Una venta del respaldo conserva costo válido, pero detalle de devolución no conciliado: costo/utilidad/margen desconocidos, sin fabricar un cero. Copia/servidores cerrados y eliminados. [Reporte](../.artifacts/web-inbox-auth-acceptance.json), [salida](../.artifacts/web-profit-full-auth.log), capturas privadas de rentabilidad inspeccionadas.
- Backend/frontend y ESLint afectados aprobados. Angular inicial **476.79kB /500kB**, presupuesto conservado. [Build](../.artifacts/web-profit-frontend-build.log).
- **10/10 sondeos de instalación actual**, login/Angular4300 oscuro390 reales, `finance` coincidente con SQL READ ONLY y reflujo, sin fixtures nuevos allí. Periodo1–11/10:0 solicitudes/0 vínculos; no hay fila monetaria/rentabilidad artificial. API3100, ERP4300, web4500 y piloto4600 disponibles; captura/puente503. Backend local actualizado. [Reporte](../.artifacts/web-profit-live.json).

## Límites y siguiente trabajo

**WEB05.2d completa rentabilidad atribuible en este alcance local y comparabilidad MXN/factor1.** No es utilidad después de gastos, flujo de caja neto, margen comercial certificado o valoración de lotes físicos. No valida carga masiva, todo histórico fiscal, todas las redes/dispositivos o la procedencia monetaria de cada snapshot.

WEB05.2e incorpora [cobros netos de reembolsos comprobados](WEB_COBROS_NETOS_CRM.md) como indicador separado; no redefine la utilidad bruta. WEB05.2/WEB05 siguen parciales: normalización verificable de moneda/origen de costos para otros casos, flujo de caja integral, ventas sin vínculo y eventos de navegación con privacidad acordada. P1 exige lote real/revisión; D01–D09 mantienen privacidad/retenciones/activación. Dominio/hosting/HTTPS siguen aplazados, fiscal mock intacto, IA sin prioridad y conexiones bancarias excluidas.
