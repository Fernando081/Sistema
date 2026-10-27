# Medición privada de solicitudes web — WEB05.2a/b/c/d

Actualizado el 12 de octubre de 2026: WEB05.2a/b comprobados en las sesiones del 11; WEB05.2c añade importes/cobros y WEB05.2d rentabilidad atribuible el 12.

## Alcance y acceso

Implementado: **CRM y agenda → Solicitudes web → Medición de solicitudes**, exclusivamente para ADMIN. El panel consulta los registros de la base actual; si son ficticios, sus resultados también lo son. No añade eventos de navegación, cookies, envíos o contactos. WEB05.2b añade vínculos comerciales explícitos entre oportunidad/cotización y su conteo de documentos; la lectura del panel no los modifica. WEB05.2c incorpora [importes, venta neta y cobros por moneda](WEB_MEDICION_FINANCIERA.md) en el mismo snapshot, con incertidumbre visible y sin duplicar REP/globales. La captación pública sigue condicionada a WEB05.1 y su expediente de privacidad.

1. Abrir «Medición de solicitudes».
2. Elegir fechas de recepción, ambas incluidas; por defecto los últimos 30 días de Tampico.
3. Pulsar «Consultar medición». Las fechas y el botón quedan bloqueados durante la consulta.
4. Después de revisar o convertir solicitudes, volver a consultar. Se indica el momento de cálculo y cambiar fechas elimina los resultados anteriores.

El intervalo admite 1–366 días, entre 2000 y 2099. Calendario y corte diario usan **America/Mexico_City**; no se depende de la zona del equipo o de PostgreSQL. El periodo selecciona solicitudes por **fecha de recepción** y observa su **estado actual** y la etapa actual de su oportunidad. Una conversión posterior al periodo permanece asociada al día en que llegó la solicitud. No es un historial de cambios de etapa ni el número de conversiones realizadas cada día.

## Qué significa cada indicador

| Indicador | Cálculo / interpretación |
| --- | --- |
| Recibidas | Registros únicos por request_id recibidos en el periodo; un reintento idempotente no crea otra solicitud |
| Oportunidades creadas | Solicitudes con id_oportunidad vinculado, no todos los prospectos del CRM |
| Conversión a oportunidad | Oportunidades vinculadas / recibidas × 100, redondeado a dos decimales; «Sin datos» cuando no hay solicitudes |
| Pendientes sin oportunidad | Estado Pendiente sin vínculo; puede incluir contenido vencido o purgado |
| Revisadas sin oportunidad | Estado Revisada sin vínculo |
| Descartadas | Estado Descartada sin vínculo |
| Abiertas / Ganadas / Perdidas en CRM | Etapa actual de las oportunidades vinculadas; «Ganada» no demuestra factura, venta, cobro o utilidad |
| Tendencia diaria | Solicitudes recibidas por día y cuántas de esas solicitudes tienen oportunidad hoy; conserva los días con cero |
| Vigentes / Vencidas / Purgadas | Clasificación de contenido según payload y expires_at al comienzo del snapshot |

Recibidas = pendientes sin oportunidad + revisadas sin oportunidad + descartadas + oportunidades. Vigencia constituye otra clasificación, no etapas adicionales de conversión. Los metadatos retenidos pueden sumar más registros que la bandeja, que muestra únicamente solicitudes con contacto vigente.

## Referencias más solicitadas y cobertura

Las diez primeras se ordenan por **solicitudes distintas**, luego unidades solicitadas y finalmente código/marca para desempatar. Código y marca se conservan exactamente, retirando sólo espacios externos: no se mezclan marcas, mayúsculas o equivalencias técnicas. Una solicitud con dos líneas del mismo código/marca cuenta una vez en solicitudes y suma ambas cantidades. Cantidad válida: entero entre 1 y 9999 por línea; cantidades inválidas se omiten.

Fuentes, sin doble conteo:

- Lista de piezas de payload **vigente**.
- Si venció/se purgó, snapshot comercial existente, únicamente cuando coincide la solicitud y su oportunidad vinculada.
- Sin lista disponible: no recuperar piezas vencidas de un contacto sin snapshot ni reconstruirlas desde respaldos.

La cobertura muestra solicitudes con lista vigente, con snapshot y sin lista disponible. No afirma que todas las piezas de una lista antigua sean válidas; para el ranking se omiten entradas fuera del contrato. Las listas malformadas o con más de diez líneas se excluyen. El ranking no devuelve nombres de contactos, correos, teléfonos, aplicaciones libres, UUID, huellas, responsables, precios/costos unitarios o VIN/ESN. WEB05.2c devuelve únicamente importes financieros agregados privados por moneda.

Una referencia libre puede no pertenecer al catálogo y el código puede repetirse con marcas diferentes. Este ranking mide **piezas solicitadas en consultas guardadas**, no productos más vistos, búsquedas ni unidades vendidas. La purga puede reducir su cobertura; el panel no prolonga retenciones ni guarda resultados históricos.

## API y protección

```text
GET /api/v1/crm/solicitudes-web/metricas?desde=2026-10-01&hasta=2026-10-03
```

- JWT, ADMIN y guards existentes del servidor; respuesta `Cache-Control: private, no-store`.
- DTO rechaza parámetros ajenos, repetidos o sin formato; servicio valida calendario, orden y extensión antes de acceder a PostgreSQL.
- Consulta parametrizada, una transacción `REPEATABLE READ READ ONLY`, límite SQL de 5 segundos y respuesta limitada a 366 días/10 referencias.
- Un snapshot conserva la coherencia entre totales, ranking, tendencia y conteo comercial. No realiza escrituras; WEB05.2b usa únicamente cotizaciones vinculadas explícitamente y relaciones de cliente/documentos comprobadas. No infiere atribución por nombre/teléfono o etapa.
- La UI espera como máximo 10 segundos; mantiene fechas, informa el error local y permite reintentar sin notificaciones duplicadas.
- Sin migraciones nuevas, dependencias, captura automática o envío a terceros. Un índice dedicado y medición con volumen real se evaluarán si el tráfico lo requiere; esta validación no certifica carga masiva o un SLA.

## Validación reproducible de WEB05.2a con Node.js 24

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-metrics-db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace backend test -- --runInBand crm-web-metrics.service.spec.ts crm-solicitudes-web.controller.spec.ts crm-solicitudes-web-maintenance.service.spec.ts crm.module.spec.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace frontend run test:e2e -- tests/web-metrics.spec.ts tests/web-inbox.spec.ts
```

El primer comando compila backend y crea sólo su esquema aleatorio `verify_web_metrics_*` en PostgreSQL local; reproduce las estructuras necesarias de 031/089/090 sin modificar migraciones aplicadas ni tablas de negocio. Usa contactos ficticios sólo allí, login HTTP/bcrypt/JWT y guards reales. Comprueba los ajustes READ ONLY/REPEATABLE READ/plazo, fechas cercanas a medianoche, reintentos, purga/snapshot, estados/porcentajes/ranking, protección de contactos, rechazos HTTP y revocación; elimina su esquema y cierra servidor/conexiones. No ejecuta AppModule completo, cron o carga masiva. Si el proceso se interrumpe abruptamente, revisar el esquema propio antes de eliminarlo; nunca eliminar esquemas ajenos por prefijo genérico.

Resultados de WEB05.2a (11/10/2026; históricos). La validación actual de WEB05.2c y sus regresiones se registra en [medición financiera](WEB_MEDICION_FINANCIERA.md):

- **8/8 grupos PostgreSQL/HTTP**; [reporte](../.artifacts/web-metrics-db.json) / [salida](../.artifacts/web-metrics-db.log). Los números del caso aislado no son resultados comerciales del negocio.
- **9/9 pruebas backend** en cuatro suites; [salida](../.artifacts/web-metrics-unit.log).
- **14/14 Playwright**: cuatro casos nuevos y diez de bandeja; claro a 1280 px y oscuro a 390 px, errores/carga/periodo vacío, conservación de fechas, datos anteriores limpiados, Axe sin infracciones y sin desbordamiento horizontal. API/login simulados para estas pruebas UI; [salida](../.artifacts/web-metrics-ui.log). Cuatro casos nuevos repetidos después de añadir capturas del encabezado: **4/4**, [salida](../.artifacts/web-metrics-ui-overview.log). Capturas del resumen y detalle inspeccionadas.
- Regresión PostgreSQL/formulario/puente/conversión/rotación/purga existente aprobada; [salida](../.artifacts/web-metrics-inbox-regression.log).
- Build backend/frontend y ESLint de archivos backend afectados aprobados. Frontend inicial **476.18 kB / 500 kB**; la UI nueva pertenece a la ruta diferida CRM. [Build](../.artifacts/web-metrics-frontend-build.log).
- Recorrido de la instalación actual **9/9 sondeos**: salud API, login ERP, web habitual/piloto, nueva ruta privada anónimo401 y ADMIN200 sin caché; captura habitual/piloto/puente permanecen503. Inicio de sesión real en Angular4300 y panel oscuro390px, API sin simular/JWT sin inyectar, respuesta coincidente con consulta READ ONLY de la base actual y sin desbordamiento. Esta base devolvió **0 solicitudes / 0 oportunidades** en 1–11 de octubre; no se insertaron fixtures allí. [Reporte](../.artifacts/web-metrics-live.json). Se reinició sólo el backend local con el build actual; no se considera despliegue de producción.

No equivale a aceptación comercial, todas las redes/dispositivos físicos o todas las condiciones de concurrencia. La consulta no borra/retiene datos personales adicionales y las decisiones D01–D09 siguen abiertas.

## Lo que conserva WEB05.2 pendiente

Desde WEB05.2b se cuentan documentos por vínculos explícitos: [trazabilidad](WEB_TRAZABILIDAD_COMERCIAL.md). WEB05.2c agrega [importes/cobros/neto por moneda](WEB_MEDICION_FINANCIERA.md); WEB05.2d añade [costo/utilidad bruta/margen atribuibles](WEB_RENTABILIDAD_CRM.md), con costo local comparable MXN/factor1 e incertidumbre explícita. WEB05.2e incorpora [cobros netos y reembolsos vinculados](WEB_COBROS_NETOS_CRM.md), efectivo comprobado y saldo a favor separado, con cobertura local MXN/factor1. Ganada no demuestra cobro/utilidad. Vistas, búsquedas, clics, términos sin resultado, ventas sin vínculo y flujo de caja integral **no medidos**; otros casos monetarios de costo requieren normalización/procedencia verificadas. Un clic de WhatsApp no confirma mensaje recibido. Captura/analítica futura requiere privacidad acordada. WEB05.2a/b/c/d/e completan capacidades locales; WEB05.2 permanece parcial.
