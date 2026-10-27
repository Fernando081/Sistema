# Reglas de seguimiento por eventos — C02.2b

Fecha: **21/10/2026**. Inicio **supervisado** de secuencias a partir de eventos nuevos del CRM. Reutiliza modelos, tareas, alertas, pausas, reasignación e historial C02.1/C02.2a. No es una IA ni un ejecutor en segundo plano. El piloto operativo con reglas elegidas por el negocio y la ejecución desatendida/colas O01 siguen pendientes.

## Uso

Acceso ADMIN con permiso `crm.secuencias.gestionar`: **CRM → Secuencias de seguimiento → Reglas por eventos**, ruta `/crm/reglas-secuencias`.

1. Conservar un modelo en Secuencias de seguimiento si todavía no existe. Sus pasos son inmutables y se reutilizan.
2. Crear una regla con nombre, modelo y etapa (Prospecto, Contactado, Cotizando, Negociacion, Ganada o Perdida). La selección muestra los pasos/prioridades/plazos. Guardar una regla sólo guarda configuración; no inicia cadenas.
3. Crear o actualizar oportunidades por los flujos normales del CRM. Se registra un evento cuando se crea la oportunidad o cambian realmente su etapa, cliente o responsable. Editar sólo contacto/notas, o volver a guardar los mismos valores, no fabrica otro evento.
4. Abrir la regla y consultar **Eventos y elegibilidad**. Muestra oportunidad, cliente, responsable, fecha, causa y resultado de la evaluación. Los pasos/instrucciones del modelo están visibles. Buscar y paginar no crea seguimientos.
5. En un evento **Elegible**, pulsar Revisar evento, escribir motivo, marcar la revisión y confirmar el inicio. El servidor vuelve a evaluar el origen, cuenta, responsable y duplicados. Si algo cambió responde409; actualizar y revisar otra vez.
6. **Historial de aplicaciones** conserva el inicio y enlaza la secuencia. Su detalle muestra regla/etapa/oportunidad de origen; ADMIN puede volver a la regla. El seguimiento se completa, pausa, reanuda, reasigna o cancela por los controles ya existentes.

La regla sólo considera eventos **posteriores a su creación**: se guarda el máximo ID visible al crearla y se exige también fecha posterior. No incorpora oportunidades antiguas ni hace backfill de eventos de la base de desarrollo. Para una oportunidad anterior puede registrarse un cambio real de etapa/cliente/responsable según la operación del negocio; no se recomienda fabricar cambios para alterar la historia. El inicio manual C02.1 permanece disponible para seguimientos que no provengan de un evento nuevo.

Un cambio posterior de la oportunidad no mueve ni cancela una cadena ya iniciada: conserva su origen y se atiende con los controles C02.2a. Por ejemplo, reasignar la oportunidad genera otro evento, pero el responsable de una secuencia existente sólo cambia al confirmar su reasignación en esa secuencia.

Las reglas son configuraciones conservadas. Para otra etapa/modelo/alcance se crea otra regla. No hay activación de procesamiento masivo o envío al guardarlas; no necesitan un interruptor de cron para detener un ejecutor que no existe. Cada aplicación requiere revisión y confirmación humana. Los procesos programados del dashboard/notificaciones no aplican reglas por consultar sus avisos.

## Evaluación determinista

Se evalúa SQL parametrizado y reglas cerradas; no admite SQL, scripts, destinatarios o responsables libres en la solicitud de aplicación.

| Resultado | Significado y resolución |
| --- | --- |
| Ya procesado | Ese evento/modelo ya originó una secuencia, incluso usando otra regla. Conservar y consultar la aplicación anterior; cancelar o completar la cadena no habilita reprocesar el mismo evento |
| Sin cliente | El evento se registró sin cliente vinculado. Vincularlo correctamente genera otro evento con contexto nuevo; el anterior no se reescribe |
| Sin responsable | El evento carece de responsable. Asignarlo en el origen genera un evento nuevo; nunca se crea una tarea sin responsable |
| Responsable inactivo | No se asignan tareas a una cuenta inactiva. Atender la cuenta o reasignar la oportunidad por el procedimiento autorizado y volver a revisar |
| Origen modificado | La etapa, cliente o responsable actuales no coinciden con el evento. Consultar el evento vigente y conservar la referencia anterior |
| Evento sustituido | Hubo otro evento posterior para la oportunidad, aunque haya vuelto a la misma etapa/cliente/responsable. Sólo el evento vigente puede iniciar otra cadena |
| Seguimiento abierto | Ya existe una secuencia Activa o Pausada para ese modelo/cliente. Atenderla mediante los controles existentes; no se abre otra en paralelo |
| Elegible | Cumple alcance y requisitos actuales. Todavía requiere revisión, motivo y confirmación de ADMIN |

La métrica de estados corresponde a **todo el alcance de la regla**; la búsqueda sólo filtra el listado/paginación, no cambia esas cifras. Reglas, modelos, eventos y aplicaciones usan páginas de20; no se descarga toda la base de clientes. Un evento nuevo distinto puede ser evaluado después de cerrar una cadena anterior, siempre que siga siendo el vigente y cumpla los requisitos. Nunca se deduce que una llamada, venta, instalación o factura ocurrió por iniciar/completar la secuencia.

La evaluación lleva SHA-256 de regla/modelo/evento/cliente/responsable/versión vigente/resultado. Incluso una edición sin evento nuevo que incremente la versión de oportunidad invalida una revisión anterior: actualizar antes de aprobar. El modelo es inmutable, por lo que su ID identifica los pasos revisados. Son huellas e identificadores técnicos, no firmas electrónicas ni timbres fiscales.

## Persistencia — migración109

No se altera107/108 ni ninguna migración aplicada anterior.

- **crm_etapa_evento**: bigint como texto en API, oportunidad/versión de origen, tipo Alta/Etapa/Asignacion, etapa, referencias de cliente/responsable y reloj del servidor. Trigger transaccional en INSERT/cambio real de etapa/cliente/responsable. Si se revierte la operación origen se revierte también el evento. No copia nombres, correos, teléfonos o conversaciones ni atribuye al responsable la autoría del cambio.
- **crm_secuencia_regla**: UUID de intención, configuración/creador/huella, cursor inicial de eventos y fecha. FK al modelo conservado. No existe código de regla ejecutable aportado por usuarios.
- **crm_secuencia_aplicacion**: solicitud idempotente/huella, regla/evento/modelo/secuencia, actor humano, motivo, huella de evaluación y fecha. Unicidad evento/modelo y secuencia, validación SQL del vínculo, FKs restrictivas e historial paginado. Auditoría nominal de regla/aplicación.
- Las tres tablas tienen guardas **ALWAYS UPDATE/DELETE/TRUNCATE**. Índices por etapa/evento, oportunidad/evento e historial de aplicación. Las referencias preservan el origen; no constituye política de retención/anonimización aprobada.

Una aplicación bloquea la guardia transaccional existente de secuencias, la oportunidad y el responsable, revalida autorización y evaluación y reutiliza `CrmSecuenciasService.startInTransaction` en **la misma conexión/transacción**. No llama a un inicio con otra transacción. Aplicación, secuencia, primera tarea, evento de creación y auditoría confirman juntos o se revierten juntos. Una cuenta revocada mientras espera el origen no escribe; un responsable desactivado mientras espera tampoco recibe la tarea.

La solicitud UUID/huella/actor conserva el resultado para reintentos mientras haya autorización. Otro contenido con el mismo UUID da409; otro UUID para un evento/modelo ya aplicado también queda bloqueado. La restricción de secuencia Activa/Pausada por modelo/cliente continúa protegiendo el inicio manual y las reglas, aun con solicitudes concurrentes. La evaluación puede ser conservadora ante una carrera y pedir actualizar; no promete ejecución exactamente una vez frente a toda caída distribuida.

## Acceso y HTTP

ADMIN activo con permiso efectivo de secuencias, rol y token_version vigentes en guardas y servicio. Los operadores no acceden a la API/pantalla de reglas aunque tengan permiso para administrar sus propias secuencias. El responsable asignado conserva la ACL normal de sus tareas/cadenas; no recibe privilegios de reglas por esta asignación.

| Método bajo `/api/v1/crm/reglas-secuencias` | Contrato |
| --- | --- |
| GET `/` | page1–10000, q hasta120, nombre de regla y20 resultados |
| POST `/` | requestId/idModelo UUIDv4, nombre1–120 y etapa cerrada;10/min |
| GET `/:id/eventos` | Regla UUIDv4, page/q, métricas y candidatos/evaluación;20 resultados |
| GET `/:id/historial` | Regla UUIDv4/page, aplicaciones y enlaces;20 resultados |
| POST `/:id/aplicar` | requestId UUIDv4, idEvento decimal positivo como texto dentro de bigint, evaluacionSha256, motivo1–500, confirmacion=true;20/min |

Consultas privadas `Cache-Control: private, no-store`; parámetros y DTO cerrados. Lecturas READ ONLY con snapshot y plazo SQL8s; escrituras con plazo10s. La creación revalida cuenta después de esperar su guardia; la aplicación después de esperar el origen y nuevamente en el motor compartido. No registra contraseñas, tokens o destinos de comunicación.

## Verificación y límites

Con Node24 y builds backend/frontend terminados:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:crm-sequence-rules -- --backup=.backups/FECHA/database.dump
```

Amplía el arnés de copia propia de C02.1/C02.2a, restaura un respaldo local bajo `.backups`, verifica/aplica migraciones sólo en esa copia y usa AppModule/SQL/HTTP/Angular reales. Respeta límites reales y genera credenciales efímeras en memoria. Informe separado `.artifacts/c022b-reglas.json`, con limpieza y eliminación de la copia también ante fallos. No introduce fixtures en la base operacional.

Cubre permisos/contratos/rango bigint, creación idempotente/cursor sin backfill, eventos de etapa/asignación/no-op, cliente/responsable/origen/vigencia, revisiones obsoletas, inicio concurrente/reintentos/deduplicación entre reglas y secuencia pausada, fallo forzado de auditoría con rollback total, inactivo durante bloqueo, reentrada y evento sustituido, páginas20+1/búsqueda literal, guardas/auditoría y cuenta revocada durante espera. Conserva los recorridos base de C02.1/C02.2a. UI claro1280/oscuro390 crea regla, genera un evento por API real de oportunidades, revisa/confirma y consulta aplicaciones/origen, navega/cancela secuencia y recarga, con Axe/reflujo/errores JS. No presenta la creación de esa oportunidad de prueba como captura realizada desde un formulario de UI.

Las cifras definitivas, respaldos y servicios actuales se registran en README. C02 conserva piloto operativo/alcance real y retención; colas/ejecución desatendida O01 quedan pendientes. No implementa eventos de vencimiento de cotización/inactividad temporal, captación masiva ni un planificador horario. La agenda, recordatorios y notificaciones existentes mantienen sus funciones. Sin mensajes externos, contratación de dominio/hosting, APIs bancarias ni cambio de prioridad de IA/Ollama. Datos de desarrollo y fiscal mock conservados.
