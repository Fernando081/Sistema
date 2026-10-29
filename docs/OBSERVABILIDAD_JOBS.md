# Seguimiento de procesos programados

## O01.1 — Cola de recuperación de reportes,21/10/2026

`crm_reports` reutiliza su cron/guardia/historial/avisos para generación y cola durable de reportes fallidos (112). Error nuevo y cola se conservan juntos; consumidor acotado20/pasada, tres intentos adicionales, espera10/20min, reserva5min con token y revisión de interrupciones. Snapshot recuperado separado del Error, atomicidad/auditoría, cancelación/versiones y ACL de propietario. Una pasada saludable no certifica que no haya trabajos Agotado/Pendiente; su estado/bitácora se muestra en el historial de reportes. Sin otro cron, proveedor o envío. [Contrato, operación, aceptación real y límites](COLA_REPORTES.md).

## Reportes internos programados — C03.2,21/10/2026

CRM → Bandeja comercial → Reportes programados (`/crm/reportes-programados`): ADMIN propietario con permiso `crm.reportes.programar`, frecuencia diaria/semanal, hora Tampico en múltiplos de10min y filtros de origen/plazo. Snapshots de conteos completos reutilizan C03.1 en la misma transacción/snapshot, sin listas/contactos/importes. Definición conservada, suspensión/reanudación versionadas y corte nuevo sin periodos retroactivos; historial paginado protegido. Migración110 aplicada tras respaldo y db:check; no crea programaciones o resultados de ejemplo.

Nuevo proceso `crm_reports` cada10min, máximo50 elegibles/pasada, guardia PostgreSQL72410,5 y unicidad programa/horario. Reutiliza historial/estado/avisos O02 existentes, incluida recuperación del proceso; esa recuperación no repara resultados Error anteriores. Cuenta activa/ADMIN/permiso revalidados antes de generar; configuración/controles con actor humano, cron sin autor humano inventado. Error conserva código fijo sin snapshot/SQL; O01.1/112 agrega su cola de recuperación y snapshot posterior separado, sin reescribir el resultado original. Otros consumidores/reintentos generales siguen O01.2; C03.3 piloto/retención/capacidad. No modifica horarios/cálculos de los procesos anteriores. Sin envíos o bancos.

Aceptación con copia propia restaurada y AppModule/SQL/HTTP/Angular/login reales, calendario adelantado sólo dentro del verificador y sin fixtures en origen. Separa reloj de disparo probado de una ejecución nocturna real. `npm run test:crm-reports -- --backup=.backups/FECHA/database.dump`; resultados definitivos/regresiones/respaldo y límites en README. [Manual, contratos y evidencia](REPORTES_COMERCIALES_PROGRAMADOS.md).

Actualizado: **21/10/2026**. O02.1–O02.4 implementan observación y avisos locales; O02 permanece parcial por monitor externo, retención y centralización.

## Procesos existentes

| Proceso | Horario | Registro | Atraso |
| --- | --- | --- | --- |
| Refresco dashboard | 02:00 America/Mexico_City | Inicio/resultado/último éxito e historial, 086 | Sin éxito esperado después de 30 minutos; aviso interno a administradores |
| Generación de alertas operativas | Cada diez minutos | operational_alerts, 087 | Sin éxito desde el último límite de diez minutos, después de cinco minutos de tolerancia |
| Revisión de frescura dashboard | Cada diez minutos | dashboard_freshness, 087 | Mismo cálculo de diez minutos/cinco minutos |
| Reportes comerciales C03.2 | Cada diez minutos; calendario por programa | crm_reports,110 | Intervalo600s/tolerancia300s; mismo monitor/avisos existentes |

O02.4 agrega avisos propios de fallo/atraso y recuperación de los dos últimos. El monitor del dashboard conserva sus avisos de métricas atrasadas: esos avisos describen el refresco diario y se distinguen de los incidentes del proceso que revisa su frescura.

### Agregados en O01.2c (28/10/2026)

- `fiscal_followup` — Seguimiento de cancelaciones fiscales: cron cada 5 min; registra ejecución con trabajo pendiente o cada 25 min (intervalo esperado 30 min, gracia 10 min). Bloqueo 7.
- `campaign_simulation` — Simulación de campañas: cron cada minuto (segundo 30); registra con simulaciones en curso o cada 9 min (intervalo 10 min, gracia 5 min). Bloqueo 8.

Ambos usan `runScheduledJob`, aparecen en Procesos automáticos y avisan fallos/atrasos como los demás.

### Agregado en O01.3a (28/10/2026)

- `outputs_health` — Salud de las salidas. El cron corre a los minutos 15 y 45 de cada hora; intervalo esperado de 30 min y gracia de 15 min (migración 121). Bloqueo 9.
  - Revisa acumulación, capacidad y retención del correo de documentos, la recuperación de reportes, las cancelaciones fiscales pendientes, las simulaciones de campaña y el almacenamiento.
  - Envía un aviso por área con problema, por administrador y por día (`salidas:<área>:<fecha>:<usuario>`). Si el área empeora a crítico el mismo día, el aviso se actualiza y vuelve a quedar sin leer.
  - Panel: Inicio → "Salud de las salidas" (`/dashboard?salidas=1`). Ver [SALIDA_DOCUMENTOS](SALIDA_DOCUMENTOS.md#o013a--salud-de-las-salidas-28102026).

## Persistencia y concurrencia

`operational_job` conserva fecha de instalación y, para jobs periódicos, intervalo/tolerancia. `operational_job_run` conserva UUID técnico, inicio, cierre y estado `running`, `success` o `failed`. No se guarda texto de errores, secretos ni datos de negocio. El historial completo no tiene aún política de retención; las respuestas muestran los últimos 20 por job, con índices para las consultas.

El refresco diario conserva su advisory lock de sesión existente. Los dos jobs de diez minutos utilizan `runScheduledJob`: una conexión mantiene una transacción de guardia con `pg_try_advisory_xact_lock`; el historial se escribe con otra conexión, para quedar confirmado incluso si falla el trabajo. La guardia no modifica tablas y termina con rollback/liberación de conexión. Una segunda instancia omite el trabajo sin generar intento ficticio cuando no obtiene el bloqueo.

El callback conserva sus transacciones de negocio existentes. El generador de alertas mantiene su transacción completa de inserciones/actualizaciones. Un cron requiere conexión para la guardia y capacidad adicional para historial/trabajo; el pool vigente es diez. Si falla registrar el inicio, no se ejecuta el trabajo sin seguimiento. Si falla guardar el cierre, puede quedar `running`, que se presenta como «sin cierre confirmado». No implica que aún esté trabajando. Pérdida de conexión libera la guardia PostgreSQL; no constituye garantía de exactamente una ejecución ante toda caída.

## Revisión bajo demanda

`NotificationService.refreshOperationalAlerts()` sigue siendo el recorrido al abrir notificaciones. El cron usa `scheduledRefreshOperationalAlerts()` y es el único que registra el job. Abrir el centro no inventa un éxito del cron. Si falla la generación bajo demanda, se intenta leer los avisos existentes; una base no disponible seguirá impidiendo la lectura. Los mensajes de error del recorrido son genéricos.

## API y pantalla

- `GET /api/v1/dashboard/refresh-status`: estado del refresco diario.
- `GET /api/v1/dashboard/scheduled-jobs`: los tres jobs periódicos, con fecha comprobada/esperada, último éxito, último intento, atraso e historial.

Ambas rutas conservan el rol ADMIN del controlador. No hay controles para ejecutar, cancelar o borrar jobs desde la pantalla. El dashboard consulta cada 60 segundos y muestra «Procesos automáticos», con historial desplegable, fecha en hora de México y mensajes de fallo/sin cierre. El error de estas consultas no bloquea los indicadores de negocio. No se acusa atraso antes de la instalación y no se inventa historia anterior.

## O02.4 — avisos internos de jobs periódicos

**Implementado y verificado el 12/10/2026**, sin migración o dependencia nueva. Reutiliza `app_notification` (064), catálogo/historial/función de estado (086–087); 093 sigue siendo la última migración aplicada. No modifica las migraciones anteriores.

- Al finalizar un intento registrado de `operational_alerts` o `dashboard_freshness`, el runner libera su guardia y revisa avisos. Un fallo confirmado genera aviso crítico inmediatamente; la ausencia de éxito después de tolerancia genera warning. Los mensajes son genéricos, sin error SQL, secretos o datos de clientes.
- Ambos cron revisan también el estado del otro. La consulta del centro de notificaciones revisa incidentes de forma independiente de la generación comercial, incluso si ésta falla; el shell consulta cada60s mientras está activo. Las rutas de estado del dashboard conservan sólo lectura y no crean ejecuciones.
- Una revisión usa transacción y guardia no bloqueante `(72410,4)`, plazo SQL5s y un snapshot de decisión. Sólo considera los dos nombres permitidos. Una revisión competidora omite sin mutar avisos.
- Un registro por proceso/ADMIN activo, con clave `scheduled-job:<nombre>:<id_user>`. Se reutiliza al recuperarse y ante una nueva incidencia; no crece una fila por cada sondeo o fallo repetido. En un incidente igual se conservan ID, fecha y estado leído, sin spam. Un cambio de condición o un incidente posterior reabre el aviso.
- **Leer no equivale a recuperar.** Se conserva el fallo del último intento finalizado aunque después existan muchos `running`. La recuperación requiere éxito finalizado posterior a la creación del aviso y estado al día; un éxito histórico, intento en curso o simple desaparición del atraso no bastan. El aviso pasa a info/recuperado y queda leído, conservando evidencia.
- La consulta y el conteo unread omiten avisos de jobs si el usuario ya no es ADMIN activo, aunque conserve filas históricas. Leer una notificación ajena no modifica su estado. No se crean nuevos avisos para usuarios inactivos u operadores. GET de notificaciones usa `Cache-Control: private, no-store` para no conservar estados privados en cachés HTTP.
- Un fallo al sincronizar avisos se registra genéricamente; no cambia un trabajo exitoso a fallido ni reemplaza el error original del trabajo. Si no puede persistirse el resultado, `running` conserva su significado de cierre no confirmado.
- El aviso enlaza `/dashboard?procesos=1`, que abre Procesos automáticos, también cuando se vuelve a navegar a la misma URL después de cerrar el detalle. No ejecuta/reintenta trabajos ni repara automáticamente datos.
- El menú de notificaciones permanece dentro de la pantalla en móvil320/390px, con altura acotada y scroll; se corrigió el recorte izquierdo detectado en las capturas. Claro/oscuro y navegación por controles nativos conservados.

Los atrasos se revisan cuando ejecuta alguno de los dos cron o cuando se consultan notificaciones. No es un monitor separado: servidor/base caídos o ambos cron detenidos sin consulta no pueden entregar esos avisos. Historial sin retención nueva y mantenimiento de solicitudes web fuera de este alcance. No se envían correos, WhatsApp o mensajes a terceros, no se activan conexiones bancarias y no se despliega hosting.

## Validación y repetición

Usar Node 24 y backend compilado. `npm run test:operational-jobs -- --backup=RUTA_DEL_DUMP` exige un dump existente bajo `.backups`, restaura una base propia `sistema_jobs_*`, ejecuta db:check antes de db:migrate solo allí y elimina la copia al terminar. Comprueba concurrencia PostgreSQL real, fallo/recuperación, callbacks reales de ambos servicios, ausencia de registros por lectura bajo demanda, tolerancia/instalación, historial y cero transacciones ociosas finales. No inyecta incidentes ni avisos en la base operacional.

Resultados históricos O02.3: 196 unitarias/43 suites, ocho HTTP/2 suites y 11 Playwright. Guardas HTTP reales con autenticación simulada para la ruta; UI con API simulada y servicios/SQL en copia real. Capturas `o023-dashboard-light.png`/dark; initial475.04kB de esa sesión. No reutilizar estas cifras como verificación actual.

**O02.4, 12/10/2026:** `npm run test:scheduled-job-alerts`, Node24, compila backend y ejecuta **13/13 grupos SQL/login/HTTP reales** en esquema propio, sin fallback public: instalación/gracia, fallo, deduplicación/lectura/reiteración/concurrencia,25running, guardia real, recuperación/reapertura, éxito anterior, roles/inactivos, revocación, acceso ajeno, ausencia de cron ficticio y limpieza. [Reporte](../.artifacts/o024-job-alerts-db.json), [salida](../.artifacts/o024-job-alerts-db.log). Incidentes sólo allí; no se provocan fallos en la base de trabajo.

`test:operational-jobs` con respaldo restaura/elimina una copia, verifica los callbacks reales de NotificationService/DashboardService, aviso crítico/recuperado, reglas horarias/concurrencia/historial y cero transacciones ociosas. [Reporte de ocho grupos](../.artifacts/o024-operational-jobs-copy.json), [salida](../.artifacts/o024-operational-jobs-copy.log). Tablas/servicios completos; no equivale a AppModule HTTP/UI completo.

**232/232 unitarias,52 suites**, [salida](../.artifacts/o024-unit.log). **15/15 Playwright**: cuatro nuevos de avisos y once de dashboard; login/API simulados, Axe del menú sin infracciones, claro/oscuro320/390/1280, lectura sin falsa recuperación, regreso a la misma URL y reflujo. [Salida](../.artifacts/o024-ui.log), [captura clara](../.artifacts/o024-notifications-light.png), [oscura](../.artifacts/o024-notifications-dark.png) inspeccionadas. Primer fallo al redimensionar conservado en `o024-ui-resize-first.log`; se espera estabilización del viewport antes de comprobar geometría.

Build backend/frontend y ESLint aprobados; initial **477.10kB /500kB**, sin aumentar presupuestos. Estado de migraciones/aplicación actual y controles de repositorio se registran en la sesión final del README.

Migración 087 aplicada después del respaldo legible/restaurado `.backups/2026-10-05T19-52-26-235Z/database.dump` y db:check previo; ninguna migración anterior modificada.

## Límites y siguientes pasos

O02.1–O02.4 cubren el refresco diario y los dos procesos de 087 dentro del alcance descrito; el mantenimiento de solicitudes web y trabajos futuros requieren su tratamiento independiente. Monitor externo para servidor/base caídos, centralización de logs/métricas, retención y avisos fuera de la app siguen pendientes. No se envían mensajes a terceros ni se conectan APIs bancarias. Q04/c3d12b conserva su incidente histórico sin causa identificada; estos avisos no lo resuelven ni acreditan una ejecución nocturna real o SLA externo.
