# O01.1 — Cola persistente de recuperación de reportes

**Continuidad22/10/2026:** O01.2a ya implementa preparación privada/archivo exacto y consumidor manual local de documentos de venta, sin SMTP. O01.2b mantiene ejecutor/adaptador de correo y O01.2c PAC/campañas; no volver a presentar la preparación como faltante. [Manual de salida local](SALIDA_DOCUMENTOS.md).

Refacciones y Tractorepuestos Tampico. Implementación local21/10/2026. Amplía C03.2, no crea otro calendario, bandeja comercial, reporte financiero o proveedor de mensajes. **O01 sigue parcial:** esta fase cubre reportes internos; correo/PAC/campañas y una infraestructura común para esos efectos externos conservan sus pendientes separados.

## Para qué sirve

Cuando falla un resumen programado, el sistema conserva el Error original y pone su recuperación en una cola PostgreSQL. Si el servicio se reinicia, la cola y los intentos permanecen. Se permiten como máximo **tres intentos adicionales** por resultado fallido: el primero queda disponible inmediatamente, el segundo después de10min y el tercero después de20min. El cron existente revisa cada10min; son plazos mínimos, no horas exactas garantizadas.

Un resumen recuperado describe los datos de **su nuevo corte real**, no reconstruye cómo estaba la empresa en el horario que falló. Error y recuperación se muestran por separado y permanecen conservados. No se crean resultados para horarios que nunca llegaron a generar un Error observado. No se modifica ni vuelve a calcular un snapshot anterior al consultarlo.

No requiere Redis, servicios de pago, cámara, QR, dominio o hosting. No envía correos, mensajes, campañas o peticiones al PAC y no conecta bancos. Datos de prueba y modo fiscal mock se conservan.

## Uso desde el ERP

Abrir **CRM → Bandeja comercial → Reportes programados**, seleccionar una programación y revisar **Historial conservado**:

- Error nuevo: incluye automáticamente una recuperación Pendiente.
- Error anterior a112, sin cola: **Preparar reintento → Poner en cola** exige confirmación y programación activa con el mismo corte vigente. Sólo registra la intención; abrir/actualizar no ejecuta el trabajo.
- **Pendiente:** muestra cuántos intentos iniciaron y desde cuándo está disponible. Espera el cron con el servicio encendido.
- **En curso:** el ejecutor obtuvo una reserva temporal; el estado por sí solo no acredita que el proceso siga activo después de una caída.
- **Completado:** aparece un Resumen recuperado con fecha de conservación, corte y conteos; el Error original sigue visible.
- **Agotado:** tres intentos iniciados sin recuperación. Revisar la causa; los siguientes periodos mantienen su calendario. No hay repetición infinita ni botón que reinicie el contador.
- **Cancelado:** conserva eventos y no se reactiva. Puede resultar de una cancelación confirmada del propietario, suspensión/cambio del corte o pérdida de autoridad del propietario.
- **Ver bitácora de intentos:** muestra Inicio, Generado, Error, Interrumpido o Cancelado con número, fecha y código fijo. No expone SQL, excepciones privadas, tokens de reserva ni datos de clientes.

**Cancelar reintento** exige confirmación y versión vigente, incluso en curso. Si el ejecutor ya confirmó el éxito, la cancelación devuelve conflicto y exige actualizar. Cancelar no elimina resultados ni suspende los siguientes reportes. Una respuesta de cancelación perdida puede reintentarse sin duplicar el evento. Suspender/reanudar una programación mantiene el contrato de C03.2: su corte nuevo invalida recuperaciones de periodos anteriores al nuevo corte.

## Concurrencia, interrupciones e integridad

1. La inserción del Error nuevo y su cola comparten transacción; no queda un Error nuevo confirmado sin cola cuando esa transacción falla. Los históricos no se encolan mediante backfill automático.
2. Una fila por `id_resultado` evita duplicados por petición o repetición. El identificador del Error ya determina la intención completa; la API no recibe payload, destino, horario o propietario libres.
3. El consumidor toma hasta20 elementos por pasada usando bloqueos `FOR UPDATE SKIP LOCKED`. Confirma inicio, contador y reserva de5min antes de calcular. Dos consumidores no reservan el mismo trabajo simultáneamente.
4. El cálculo bloquea programación → trabajo → cuenta y revalida estado/corte/ADMIN activo/permiso efectivo. Usa READ COMMITTED para observar revocaciones después de esperar bloqueos; todos los conteos y su corte se obtienen de **una sola sentencia SQL** de C03.1. No usa múltiples consultas parciales para sumar el resumen.
5. Cada reserva tiene un UUID nuevo. Sólo el token vigente y no vencido puede conservar la recuperación. El snapshot, evento de éxito y estado Completado se confirman juntos. Si falla la auditoría o una sentencia, todo ese resultado se revierte; se registra el fallo y siguiente disponibilidad por separado si la base responde.
6. Tras vencimiento se registra Interrumpido y se aplica la misma espera/límite. Un ejecutor antiguo no puede conservar resultados después de perder su reserva. Si también falla registrar el cierre, el estado permanece sin cierre confirmado hasta la revisión posterior. No se promete exactamente una ejecución del cálculo ante toda caída; la recuperación conservada es única por Error.
7. Estados terminales no se reabren; versión/identidad/transiciones se protegen mediante trigger ALWAYS. La cola no se borra; eventos y recuperaciones no admiten UPDATE/DELETE/TRUNCATE ordinarios. La BD valida que sólo se recupere un Error y que exista la reserva vigente. No protege frente a un administrador de BD que retire deliberadamente guardas o restaure versiones anteriores.

Las escrituras usan timeout SQL8/10s. Se conservan como máximo tres intentos por Error, con historial de eventos acotado por sus estados; el historial de resultados sigue paginado20. No hay purga automática: crecimiento, retención, alertas específicas de acumulación y aceptación de capacidad requieren operación posterior. No se acredita un SLA o una prueba prolongada con varias instancias productivas.

## Seguridad y API

Reutiliza ADMIN + `crm.reportes.programar`, con alcance **sólo al propietario** incluso entre dos ADMIN. Lecturas privadas `no-store`; controles humanos revalidan cuenta/rol/versión/permiso después de bloquear la programación. Creación/cancelación deliberadas conservan actor nominal; el ejecutor conserva actor de auditoría nulo y no atribuye al destinatario una acción humana ficticia. No hay endpoint público para ejecutar el consumidor, alterar el reloj, aumentar intentos o introducir SQL.

| Ruta bajo `/api/v1/crm/reportes-programados` | Contrato |
| --- | --- |
| GET `/:id/historial?page=1` | Añade reintento, eventos y recuperación al historial existente; mantiene estado/snapshot originales |
| POST `/:id/resultados/:resultado/reintentar` | `{confirmacion:true}`; encola Error histórico sin duplicar ni reactivar trabajos terminales |
| POST `/:id/resultados/:resultado/cancelar-reintento` | `{confirmacion:true,expectedVersion:N}`; cancela trabajo propio pendiente/en curso |

DTO cerrados y UUIDv4 en ambas referencias. El método de puesta en cola devuelve el identificador de la intención existente si ya se había registrado; no concede nuevos intentos. No cambia los contratos de crear/suspender/reanudar programas.

## Observabilidad reutilizada

`crm_reports`, su guardia PostgreSQL `(72410,5)`, `operational_job_run`, dashboard y avisos O02 ya existentes ejecutan generación y cola. El consumidor se intenta aunque falle la generación inicial. Un fallo de cualquiera marca fallido el job; una pasada saludable posterior puede recuperar el proceso, pero **no significa que todos los Error/Agotado históricos estén resueltos**. El estado por resultado se consulta en su historial.

La reserva caducada se revisa cuando vuelve a funcionar el consumidor. Servidor/base apagados o cron detenido no pueden ejecutar recuperación o avisos internos. Monitor externo, supervisión de acumulación y retención centralizada siguen pendientes; no se instala otro servicio externo.

## Persistencia y validación

Migración112 agrega `crm_reporte_reintento`, `crm_reporte_intento_evento` y `crm_reporte_recuperacion`, con índices parciales de disponibilidad/lease, FKs restrictivas, unicidad, constraints, controles de vínculo/transición/conservación y auditoría. No modifica110/111 ni reescribe Error existentes; no inserta trabajos o resúmenes de ejemplo.

Con Node24, builds terminados y respaldo local legible:

```powershell
npm run test:report-retries -- --backup=.backups/FECHA/database.dump
```

Restaura una copia propia `verify_retries_<16hex>`, hace check/migrate sólo allí y usa AppModule/PostgreSQL/HTTP/Angular/login reales. Comprueba contrato/ACL/confirmaciones, concurrencia, recuperación única, reintentos/agotamiento, interrupción/token antiguo, cancelación/versión, suspensión y revocación antes/durante bloqueo, auditoría/rollback/guardas y callback cron. Navegador claro1280/oscuro390 comprueba cola/cancelación/recarga/bitácora/recuperación/agotado, respuesta perdida después de commit sin duplicar, Axe y reflujo.

Para no esperar10/20min o5min de reserva en cada caso, el verificador adelanta esas fechas **sólo en la copia**, deshabilitando temporalmente únicamente el trigger de transiciones al modificar el reloj de la fixture y reactivándolo ALWAYS en finally. No deshabilita guardas al probar generación, cancelación, permisos, concurrencia o inmutabilidad. El horario de negocio se adelanta sólo desde métodos internos de prueba; no acredita una ejecución nocturna real. Las APIs de negocio y login no se simulan. El service worker se bloquea en el contexto de Playwright para interceptar una respuesta perdida; no prueba PWA/offline.

Exigir `passed/cleanupPassed/copyRemoved=true`, `apiMocked=false` en `.artifacts/o011-reintentos.json`. Regresión C03.2 y suites generales/resultados/respaldos/aplicación de112 se registran en README. La prueba antigua C03.2 compara ahora las ejecuciones nuevas contra su baseline restaurado, sin asumir que el historial del respaldo esté vacío.

## Pendientes del bloque O01

- **O01.1:** recuperación durable de reportes internos, descrita aquí.
- **O01.2a implementado22/10/2026:** solicitudes/PDF privados y consumidor manual local de documentos, sin SMTP; ver [manual](SALIDA_DOCUMENTOS.md). **O01.2b siguiente:** ejecutor/adaptador de correo; O01.2c consumidores PAC/campañas. Se reutilizó el renderizador existente de `DocumentosVentaService`; separar solicitud, autorización, destinatario verificado, configuración, adjuntos/versiones, idempotencia y confirmación del proveedor antes de añadir reintentos. El transporte SMTP actual es síncrono y no ofrece garantía de entrega exactamente una vez; no duplicarlo ni activarlo durante las pruebas. Contrastar timbrado/cancelación y proveedores fiscales ya existentes antes de integrar PAC; promover sólo modo mock/local hasta sandbox autorizado. Campañas deben reutilizar consentimiento/preparaciones C01 y revalidar bajas antes del envío; registrar comunicaciones no equivale a enviarlas.
- **O01.3 operativo:** revisión de acumulación/retención/capacidad/recuperación, aceptación humana y canales/proveedores/credenciales reales. No completar estas decisiones con datos ficticios. No cambia la prioridad diferida de IA ni la exclusión bancaria.

Cámara y QR están diferidos por decisión del propietario del21/10/2026 y no son dependencia de O01 ni de la recuperación de reportes.
