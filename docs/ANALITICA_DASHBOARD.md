# Analítica del dashboard

Actualizado el 29/09/2026. Migraciones 077–080. Todas las cifras desconocidas se conservan como `NULL`; la UI muestra «No disponible» en los indicadores avanzados. Cero sigue siendo un resultado válido.

## Definiciones verificables

| Indicador | Fuente y cálculo | Alcance |
| --- | --- | --- |
| Nivel de surtido | `100 × sum(cantidad_surtida) / sum(cantidad)` | Pedidos creados en los últimos 90 días, excluyendo borradores/cancelados; avance por unidades, no porcentaje de pedidos completos |
| Conversión | Cotizaciones con factura de ingreso vigente / cotizaciones del periodo × 100 | Cohorte de 90 días; vínculo `factura.id_cotizacion` o pedido original; varias facturas no duplican la cotización |
| Plazo efectivo de pago | `sum(días entre emisión y pago × monto) / sum(monto)` | Pagos vigentes de 90 días, compras clásicas y facturas profesionales; excluye reversos, cancelaciones y pagos anteriores a emisión. Anticipos y notas de crédito no son pagos de efectivo |
| Margen bruto | `(ingreso neto − costo histórico neto) / ingreso neto × 100` | Histórico de ingresos no cancelados, después de devoluciones/notas; sin impuestos ni gastos operativos, costo congelado de venta |
| Utilidad por marca | Suma de utilidad bruta de productos por marca | Histórico neto; desconocida si falta algún costo de esa marca. No atribuye ventas a un proveedor ficticio |
| Días sin venta | Fecha actual menos última factura Timbrada/Pagada de ingreso | Sin ventas anteriores: NULL. Notas/cancelaciones no reinician el contador |
| Devoluciones | Unidades devueltas de los últimos 90 días / unidades vendidas de los últimos 90 días × 100 | Flujos del periodo: una devolución de una venta antigua puede hacer que supere 100%; no es porcentaje de devolución de una cohorte |
| Rotación | Unidades vendidas en 90 días anualizadas / stock físico actual | Estimación explícitamente etiquetada; no rotación contable por costo medio |

El plazo efectivo **no es DPO contable**. El campo API `dias_cuentas_por_pagar` se conserva por compatibilidad, pero su etiqueta y definición están corregidas. El DPO con saldos medios queda como requisito contable adicional F03 del README.

La gráfica de utilidad usa barras para representar ganancias y pérdidas. Omite marcas sin costo completo y lo explica en la pantalla; no convierte costos desconocidos en ganancias de cero.

## Valoración y GMROI

La valoración operativa usa existencia física y costo medio de entradas `COMPRA`, ponderado por cantidad. No usa precio de venta multiplicado por 0.6. Solo admite entradas registradas a la fecha; si hay stock con costos desconocidos o negativos/inconsistentes, la valoración completa es NULL. Los costos adicionales que no se hayan incorporado al precio de entrada del Kardex no están incluidos: no es una valoración contable certificada ni un cálculo perpetuo de costo medio móvil.

`analytics_inventario_diario` conserva una captura real por fecha de México. `fn_capturar_valor_inventario_diario()` toma el valor actual, identifica productos sin costo y no sobrescribe una captura existente. La migración registra la primera; el proceso de las 02:00 registra las posteriores antes de refrescar las vistas. Son capturas a la hora de ejecución, no cierres retroactivos de medianoche.

`fn_gmroi_90d()` calcula:

```text
GMROI = margen bruto neto de ventas de los últimos 90 días
        / promedio de 90 capturas diarias de valor de inventario
```

El margen utiliza costo congelado y ajusta las ventas de esa cohorte por devoluciones y notas vinculadas. Se exige una captura completa para cada uno de los 90 días, costos de venta conocidos y promedio de inventario mayor a cero. Si falta una condición, devuelve NULL. No inventa registros históricos ni anualiza el resultado de GMROI.

La API agrega `gmroi_dias_historial` y la UI muestra el avance. Tener 90 capturas no garantiza disponibilidad si alguna no tiene costo completo. Para la primera instalación deben transcurrir días de operación con captura efectiva; si el backend no ejecuta el proceso diario, no se rellenan automáticamente fechas perdidas.

## Refresco y pruebas

El proceso mantiene su horario `America/Mexico_City` y advisory lock. Las vistas materializadas son una fotografía al refresco; no se promete actualización por cada operación. GMROI se consulta mediante la función y el historial al solicitar inventario.

```powershell
npm run test:analytics
npm run verify
```

Las pruebas SQL crean esquemas transaccionales y siempre revierten. Verifican cantidades, cohortes, vínculos, duplicados, cancelaciones, egresos, reversos de pago, pérdidas, costos desconocidos, promedio ponderado, cobertura de 90 días, devoluciones y captura idempotente. Los datos sintéticos de 90 días se crean exclusivamente dentro de esos esquemas de prueba y jamás se agregan a la operación.

Playwright comprueba la distinción entre NULL, cero y números en GMROI, margen, surtido, conversión y plazo de pago. Las pruebas UI usan API simulada; las SQL prueban las funciones y vistas reales.

## Alertas de refresco (O02.1, 05/10/2026)

Si falla el refresco, los administradores activos reciben una alerta crítica interna con enlace al dashboard. La clave por administrador evita duplicados; un nuevo fallo vuelve a marcarla pendiente aunque se haya leído. Solo un refresco exitoso posterior la marca atendida y cambia su título a «Métricas actualizadas». No obtener el bloqueo por otra instancia no indica recuperación.

Se reutiliza app_notification (064) y el centro existente. No se guardan detalles SQL ni secretos en mensajes/logs de esta operación. Fallar al persistir el aviso se registra sin impedir liberar la conexión. Si la base está caída, no puede guardar alerta; no detecta un proceso apagado, ejecución omitida ni certifica frescura. Historial persistente, frescura y omisiones se siguen en O02.2; monitor externo pendiente.

Validación: build Node 24, pruebas del servicio/centro y SQL real temporal con rollback. `npm run test:dashboard-refresh-alert` requiere build backend y PostgreSQL; crea un esquema transaccional sin fallback public y comprueba su eliminación. No genera datos/alertas de prueba en tablas operacionales. No hay migración nueva.
## Estado e historial del refresco (O02.2, 05/10/2026)

La migración 086 añade operational_job y operational_job_run, con UUID técnico, inicio/cierre y estado running/success/failed. El refresco conserva el mismo advisory lock; solo la instancia que obtiene el bloqueo registra un intento. No guarda errores, datos de negocio ni secretos. La historia completa se conserva en base y la API devuelve los últimos 20 intentos.

GET /api/v1/dashboard/refresh-status conserva el acceso ADMIN del controlador. Informa checkedAt, expectedAt, lastSuccessAt, freshness (current/pending/overdue), overdue, lastRun y recentRuns. El horario se calcula en PostgreSQL con America/Mexico_City. La última ejecución esperada es a las 02:00; la alerta de omisión comienza a las 02:30 si no hubo éxito desde ese horario. No acusa omisiones anteriores a installed_at ni inventa refrescos históricos. Un intento running sin cierre no se interpreta como éxito.

El monitor cada diez minutos crea alertas de omisión a administradores activos, deduplicadas por fecha esperada y usuario. Cuando ya no hay atraso marca atendidas las alertas de omisión. El centro/dashboard consulta estado cada 60 segundos sin impedir cargar los demás indicadores si falla esa consulta. Muestra último éxito en hora de México y un historial desplegable; explica que las vistas no son datos en tiempo real. El estado describe refresco de vistas analíticas, no garantiza frescura de cada fuente ni disponibilidad del servidor.

Si se pierde la conexión durante el cierre, un intento puede quedar running: la UI dice «sin cierre confirmado», no afirma ejecución activa. Base/servidor apagados impiden guardar/entregar avisos; al volver el monitor puede detectar atraso. Monitor externo y otros jobs permanecen pendientes en O02.

Validación: build backend/frontend (initial 475.04 kB, presupuesto warning 500 kB), SQL transaccional con rollback, pruebas del servicio y 11 Playwright de estados/NULL/cero/valor, temas claro/oscuro, móvil y accesibilidad del panel. Capturas revisadas en .artifacts/o022-dashboard-light.png y o022-dashboard-dark.png. UI usa API simulada; SQL valida cálculo real. `npm run test:dashboard-job-status` requiere backend compilado y PostgreSQL; crea esquema aislado transaccional sin fallback public.

Respaldo previo .backups/2026-10-05T19-28-35-683Z/database.dump, db:check aprobado antes de db:migrate; 086 aplicada. No se alteraron migraciones anteriores. No se esperó una noche real ni se agregaron éxitos simulados a la base operacional. Solo el refresco dashboard está instrumentado; otros jobs se siguen en O02.3.

## Otros procesos (O02.3)

El monitor de frescura y el cron de alertas ya registran intentos/resultados y estado en Procesos automáticos del dashboard. Ver [Seguimiento de jobs](OBSERVABILIDAD_JOBS.md) para guardia entre instancias, lectura bajo demanda, validación y límites. No equivale a monitor externo ni avisos automáticos de fallo de esos dos jobs (O02.4).
