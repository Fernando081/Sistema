# Reportes comerciales programados — C03.2

Implementado localmente el21/10/2026. **CRM → Bandeja comercial → Reportes programados**, ruta `/crm/reportes-programados`. Destinatario: el propio usuario ADMIN que crea la programación. Los resultados se consultan dentro del ERP; no se envían correos, WhatsApp o archivos a terceros.

**Actualización O01.1,21/10/2026:** migración112 agrega cola persistente de recuperación, hasta tres intentos, espera10/20min, reserva temporal/recuperación de interrupciones, cancelación y bitácora. Conserva el Error original y un snapshot de recuperación separado con nuevo corte real. [Uso, API, pruebas y límites](COLA_REPORTES.md). Cámara/QR diferidos por el propietario; no son dependencia de reportes.

## Qué conserva

Un resumen de **asuntos comerciales pendientes**, reutilizando el cálculo de [Bandeja comercial C03.1](BANDEJA_COMERCIAL.md): tareas abiertas sin secuencias pausadas, oportunidades abiertas, cotizaciones Pendiente/Vigente y solicitudes web vigentes sin convertir. Se puede elegir todos los orígenes o uno, y todos los plazos o Vencidas/Hoy/Próximas/Sin fecha.

Cada resultado conserva versión de formato1, fecha real del corte, zona horaria, origen/plazo, total y conteos por plazo. No conserva clientes, contactos, productos, listas de documentos, payload web, valores monetarios o muestras de las primeras20 filas. Una oportunidad y su tarea son dos asuntos distintos. «Posteriores» sólo contribuye al total. Para web, el vencimiento significa conservación del contenido, no SLA de respuesta.

No agrega un cálculo financiero ni reemplaza los reportes existentes de utilidad, ventas, cobranza o medición web. Los datos de prueba generan resúmenes de prueba. Los resultados anteriores se leen desde su snapshot: no se recalculan al consultar ni cambian al cerrar tareas o editar oportunidades.

## Crear, suspender y consultar

1. Usar ADMIN activo con permiso efectivo `crm.reportes.programar` (incluido inicialmente en ADMIN).
2. Elegir nombre, frecuencia **Diaria/Semanal**, hora de Tampico y minutos00/10/20/30/40/50. Para semanal, seleccionar lunes1 a domingo7. Zona fija `America/Mexico_City`, sin configuración de claves o destinatarios externos.
3. Seleccionar origen/plazo y guardar. El UUID/huella identifica la intención; reintentar la misma creación devuelve su ID sin duplicar o reactivar una programación suspendida. Otra configuración con ese UUID devuelve409. Máximo50 programaciones conservadas por propietario; las listas muestran20 por página.
4. Abrir su historial. **Suspender/Reanudar** requiere confirmación y versión vigente. Conserva resultados y auditoría. Reanudar establece un nuevo corte desde el reloj de la base; no completa periodos anteriores a la reanudación.
5. Para cambiar nombre, hora, frecuencia o filtros, crear otra programación y suspender la anterior: la definición histórica permanece intacta. **Ver estado actual en la bandeja** consulta el estado presente, que puede diferir del snapshot.

El destinatario no se elige por ID ni por dirección de correo: siempre es el usuario autenticado. Otros ADMIN tampoco pueden consultar/controlar esa programación. Roles externos del portal u operadores no obtienen acceso. Perder actividad, rol ADMIN o permiso bloquea consultas/generación; cerrar la sesión no suspende una programación de una cuenta que conserva autoridad.

## Calendario y límites del ejecutor

El cron despierta cada diez minutos, con servidor/base disponibles, y procesa como máximo50 programaciones elegibles por pasada. Es elegible el horario del **día local actual** que ya llegó, posterior al corte de creación/reanudación y, si es semanal, del día elegido. No reconstruye días anteriores ni genera resultados al abrir la pantalla. Los horarios definidos antes de crear/reanudar esperan la siguiente ocurrencia.

Si el servidor vuelve después de la hora dentro del mismo día elegible, puede generar tarde. Se guardan por separado **programada_en**, fecha real de registro y fecha real del corte. Ese resultado describe los datos presentes al generar, no una reconstrucción del estado a la hora programada. Una interrupción que atraviese el día puede dejar ese periodo sin resultado. No hay calendario de días hábiles o promesa de hora exacta bajo carga.

La consulta compartida de C03.1 usa el mismo manager/snapshot `REPEATABLE READ` que la inserción del resultado, sin abrir otra transacción. El proceso bloquea la programación y revalida la cuenta/permiso del propietario antes de capturar; sus bloqueos de cuenta se conservan hasta finalizar. La consulta HTTP normal de C03.1 mantiene su transacción READ ONLY. Configuración y controles conservan actor humano; el cron no inventa una acción humana del destinatario en auditoría.

`UNIQUE(id_programa,programada_en)` evita duplicar por horario. `runScheduledJob` reutiliza historial y guardia PostgreSQL entre instancias (`72410,5`); una instancia competidora omite sin registrar un intento ficticio. Los accesos HTTP sólo leen/configuran, sin endpoint de ejecución o reloj arbitrario.

## Fallos y observabilidad

Un fallo de generación revierte la transacción y, si la base permite registrarlo, conserva resultado **Error**, sin snapshot, con código fijo `GENERACION_FALLIDA`. No persiste SQL, excepción, tokens o datos privados. Desde O01.1/112, Error nuevo y su cola se conservan juntos: hasta tres intentos adicionales, con esperas10/20min. Los errores anteriores sin cola pueden prepararse con confirmación del propietario. El Error original no se reescribe; el snapshot recuperado usa un corte posterior y no reconstruye el horario fallido. Los periodos siguientes siguen su calendario. Otros consumidores y efectos externos mantienen los pendientes O01.2/O01.3.

Si tampoco se puede conservar el error, no hay resultado confirmado: el job conserva su fallo/sin cierre según lo que alcance a persistir y una pasada posterior puede volver a considerar el horario aún elegible. No se afirma entrega o generación exactamente una vez ante toda pérdida de conexión.

`crm_reports` se registra en `operational_job` con intervalo600s/tolerancia300s. **Dashboard → Procesos automáticos**, `GET /dashboard/scheduled-jobs` y los avisos internos O02 existentes incluyen Reportes comerciales, historial/último éxito/fallo/atraso y recuperación. O01.1 procesa también la cola bajo la guardia existente, aunque falle la generación inicial. Un proceso recuperado no prueba que todos los Error/Agotado anteriores estén resueltos: revisar cada resultado. El monitor verifica la salud del cron aun sin programaciones, no que cada destinatario haya leído un reporte. Monitor externo, centralización y retención de logs siguen pendientes.

## Contratos y persistencia

Todas las rutas privadas bajo `/api/v1/crm/reportes-programados`, ADMIN + permiso, DTO cerrados y `Cache-Control: private, no-store`:

| Método/ruta | Función |
|---|---|
| GET `?page=1` | Mis programaciones,20 por página |
| POST | Crear con requestId UUIDv4, nombre, frecuencia, hora/minuto, día sólo semanal, tipo/plazo |
| GET `/:id/historial?page=1` | Definición y resultados conservados paginados, alcance por propietario |
| PATCH `/:id` | `{activa,expectedVersion}`; confirmar y actualizar ante409 |

Migración **110_crm_reportes_programados.sql**: permiso, metadato del job, `crm_reporte_programa` y `crm_reporte_resultado`, índices, FKs restrictivas, unicidad del periodo, constraints, trigger de configuración/corte servidor, auditoría y guardas ALWAYS que conservan definición/resultados contra reescritura/eliminación/truncate ordinarios. No crea programaciones, reportes de ejemplo o resultados anteriores a su instalación. No modifica migraciones aplicadas ni retira permisos de otros módulos.

No hay purga automática. La conservación de snapshots/configuraciones/auditoría requiere decisión operativa antes de producción. El administrador de la base y restauraciones de respaldo siguen siendo límites de confianza, como en los otros historiales del proyecto.

## Verificación y alcance de la evidencia

Node24 y builds backend/Angular previos:

```powershell
npm run test:crm-reports -- --backup=.backups/FECHA/database.dump
```

Restaura una base propia `verify_reports_*`, ejecuta db:check antes de db:migrate sólo allí, carga AppModule/SQL/HTTP y Angular de producción y detiene cron heredados. Usa credenciales efímeras en memoria, elimina la copia y no siembra ejemplos en origen. El calendario se adelanta **sólo en el verificador interno** para ejercitar periodos diarios/semanales; cálculo de negocio, transacciones, guardia, callback cron, HTTP, permisos y login son reales. No acredita una ejecución nocturna desatendida en el tiempo real.

La aceptación comprueba configuración cruzada/DTO, UUID/huella incluida normalización, caché/ACL entre ADMIN y operador, callback/guardia real y deduplicación, días/plazos/corte sin backfill, snapshot que permanece al modificar origen, suspensión/reanudación, error sin contenido privado y avisos/recuperación, revocación de rol/permiso y durante bloqueo, inmutabilidad/auditoría y lecturas sin ejecutar reportes. Navegador claro1280/oscuro390: páginas, creación semanal, suspensión/reanudación/recarga, resultados y error, enlace C03.1, Axe/reflujo y ausencia de errores JS. Reportes artificialmente adelantados sólo existen en la copia de prueba.

[Reporte de aceptación](../.artifacts/c032-reportes.json), [salida posterior a110](../.artifacts/c032-acceptance-post.log), capturas [clara](../.artifacts/c032-reportes-light.png)/[oscura](../.artifacts/c032-reportes-dark.png). Cifras efectivas, respaldos, regresión C03.1 y limitaciones en la sesión C03.2 del README. No equivale a piloto gerencial real, prueba de carga distribuida, retención aprobada, PAC o despliegue HTTPS público. IA y conexiones bancarias permanecen fuera de esta fase.
