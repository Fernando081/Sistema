# Secuencias internas de seguimiento — C02

Fecha: **21/10/2026**. C02.1 implementa el motor de pasos sucesivos iniciado explícitamente para un cliente; **C02.2a añade pausa, reanudación y reasignación versionadas**. **C02.2b ya implementa reglas supervisadas por eventos de alta/etapa/asignación**, revisión/deduplicación e historial. C02/C02.2 conservan piloto y validación operativa; ejecución desatendida/colas pertenecen a O01. No confundir secuencias con campañas C01 ni repetir tareas, agenda o bitácora existentes.

## Uso en el ERP

1. Abrir **CRM → Operación CRM → Abrir secuencias de seguimiento**, ruta `/crm/secuencias`.
2. Crear un modelo con nombre y entre **uno y ocho pasos** ordenados. Cada paso tiene título, instrucciones, prioridad y plazo de **0 a720 horas enteras**. Cero significa vencimiento al crearse. Los plazos cuentan horas continuas, incluidos fines de semana; no son días hábiles.
3. Buscar/seleccionar modelo y cliente por nombre/RFC, escribir motivo, revisar pasos y confirmar. La interfaz asigna el seguimiento al usuario actual. La API permite a un ADMIN asignar otro responsable activo; un operador sólo se asigna a sí mismo.
4. Se crea únicamente la primera tarea. **Completar paso** conserva el evento y crea la siguiente tarea en la misma transacción. Su plazo empieza en ese momento, sin acumular atrasos de pasos previos. Completar el último cierra la ejecución como Completada.
5. **Cancelar secuencia** cancela la tarea actual y cierra la cadena, conservando los pasos realizados. No crea pasos posteriores. Una tarea cerrada de secuencia no se reabre.

El detalle muestra cliente, responsable, estado, instrucciones/plazos, tareas creadas, pasos futuros e historial con actor y fecha. `?secuencia=UUID` conserva el detalle al recargar; el enlace de una tarea CRM abre su secuencia. Listados de modelos/clientes/ejecuciones: búsqueda literal y páginas de20, sin descargar todos los clientes. Errores visibles, actualización/reintento, estados de carga y controles deshabilitados durante solicitudes. Confirmación antes de iniciar/completar/cancelar, estilos claros/oscuros y controles nativos etiquetados.

## Qué se reutiliza

- Las tareas se guardan en **crm_tarea**, aparecen en Operación CRM y conservan su ACL y control de versión. La ruta heredada de cambio de estado también ejecuta el avance automático.
- Las alertas vencidas usan **NotificationService**, `crm_task_overdue` y la misma clave deduplicada. Cancelar/completar marca el aviso atendido en la siguiente revisión normal. No se añade un cron ni una tabla de recordatorios paralela.
- La agenda de oportunidades y la bitácora de comunicaciones continúan con su función existente. Completar un paso **no prueba que se llamó, visitó o envió algo**: los hechos se capturan en esa bitácora. No se insertan comunicaciones ficticias.
- Consentimiento/bajas/preparación promocional C01.1 conserva su alcance independiente. Una tarea de llamar no autoriza un envío ni sustituye una manifestación del cliente.

## Persistencia e integridad — migración107

- **crm_secuencia_modelo**: UUID técnico de intención, nombre, pasos y huella de la solicitud/creador. Modelo inmutable; una variante se guarda como otro modelo, sin alterar ejecuciones antiguas.
- **crm_secuencia**: modelo, cliente, responsable, creador, motivo, huella, paso actual y estado Activa/Completada/Cancelada con cierre. Índice único parcial de modelo/cliente mientras esté Activa; otra ejecución deliberada es posible después de cerrar.
- **crm_tarea** añade id_secuencia/paso_secuencia y unicidad de ejecución/paso. Las tareas independientes no se inscriben automáticamente.
- **crm_secuencia_evento**: creación/completado/cancelación por tarea/paso, actor y fecha. FK restrictiva y guardas ALWAYS UPDATE/DELETE/TRUNCATE para modelos/eventos. Las tareas vinculadas no se eliminan ni cambian de contexto.
- Auditoría nominal en las tres tablas nuevas; `setAuditActor` LOCAL dentro de la transacción existente para las transiciones de tareas. No documentar secretos ni usar estas huellas como firma electrónica o certificado fiscal.

El trigger de crm_tarea serializa el cierre por fila de tarea y ejecución; inserta evento, siguiente tarea y avance/cierre en la misma transacción. Una falla de auditoría o restricción revierte todo. `expectedVersion` rechaza dos cierres del mismo paso; el índice impide dos tareas de un paso. El cambio de estado escribe sólo sus columnas y conserva exactamente el vencimiento original, sin redondear microsegundos por el viaje PostgreSQL/JavaScript.

Los modelos/inicios usan UUID idempotente más huella/actor: repetir la misma intención devuelve la misma referencia; cambiar su contenido con el mismo UUID da409. La interfaz conserva el UUID ante respuesta incierta y lo descarta tras confirmar un inicio exitoso, para permitir un nuevo seguimiento deliberado después del cierre. Los identificadores bigint de tareas/eventos del detalle viajan como texto.

No se modifica ninguna migración anterior. La107 no crea modelos de ejemplo, ejecuciones, comunicaciones, ventas ni movimientos de inventario. Sus FKs impiden borrar clientes/usuarios que deban conservar historia; no es una política de anonimización ni retención aprobada.

## Acceso y contratos HTTP

Permiso independiente **crm.secuencias.gestionar**, concedido inicialmente a ADMIN y delegable mediante S01. Se revalida cuenta activa, rol, token_version y permiso efectivo en los servicios nuevos. Los inicios vuelven a comprobarlos después de esperar su guardia transaccional. Las lecturas usan snapshot READ ONLY y plazo SQL8s; los inicios/modelos tienen plazo10s. No se guarda contexto de actor fuera de la transacción.

ADMIN consulta las ejecuciones; otros usuarios sólo las que crearon o tienen asignadas. Una ejecución/tarea ajena responde404. El catálogo de modelos y búsqueda de clientes son compartidos para personal con permiso. La ruta heredada de tareas conserva su ACL: un responsable/creador autorizado puede cerrar su tarea aunque no administre modelos; nunca puede reabrir un paso cerrado ni editar su contexto. En transiciones por la API nueva se revalida también la versión de sesión/permiso al adquirir la tarea.

| Método y ruta bajo `/api/v1` | Contrato |
| --- | --- |
| GET crm/secuencias/modelos | page1–10000, q hasta120;20 modelos por página con sus pasos |
| POST crm/secuencias/modelos | requestId UUIDv4, nombre120, pasos1–8 con titulo180/descripcion2000/prioridad/horas0–720; límite10/min |
| GET crm/secuencias/clientes | page/q, nombre/RFC,20 por página |
| GET crm/secuencias | page/q, ACL,20 por página |
| POST crm/secuencias | requestId/idModelo UUIDv4, idCliente/idResponsable, motivo500, confirmacion=true; límite10/min |
| GET crm/secuencias/:id | UUIDv4; detalle hasta8 tareas y16 eventos finales/creación |
| PATCH crm/secuencias/:id/tarea | idTarea como texto, expectedVersion, estado En progreso/Completada/Cancelada; límite20/min; reutiliza CrmActividadService |

Respuestas privadas `Cache-Control: private, no-store`. DTO cerrados y validados, consultas parametrizadas, comodines de búsqueda escapados. Los errores de negocio no publican consultas SQL. Guardas y límites existentes del ERP siguen activos.

Si el responsable queda inactivo, no se completa un paso que generaría otra tarea para esa cuenta. Un ADMIN autorizado puede cancelar o reasignar la secuencia con motivo y confirmación; también puede pausarla mientras se resuelve. La reanudación requiere responsable activo. No se reasigna silenciosamente.

## Verificación reproducible

Con Node24 y backend/frontend compilados:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:crm-sequences -- --backup=.backups/FECHA/database.dump
```

El verificador exige respaldo local bajo `.backups`, restaura una base propia `verify_sequences_<hex>`, ejecuta db:check antes de db:migrate allí y usa AppModule/SQL/HTTP/Angular reales. Sólo desactiva usuarios heredados y crea fixtures dentro de esa copia. Credenciales de prueba aleatorias en memoria; sin API de interfaz simulada, correos ni WhatsApp. Elimina su copia exacta al terminar, también tras fallos, y registra `passed`, grupos comprobados, `cleanupPassed` y `copyRemoved` en `.artifacts/c02-secuencias.json`.

Cubre contratos y ACL, idempotencia/inicio concurrente, una tarea por paso, cierre concurrente, ruta heredada, plazos, cancelación, responsable inactivo, auditoría nominal/inmutabilidad/rollback forzado, revocación durante espera y alertas existentes. Angular real en claro1280/oscuro390 prueba creación de modelo, búsqueda/selección de cliente, revisión/confirmación, inicio/avance/cancelación/recarga, Axe, reflujo y errores JS. Baterías unitarias y regresión UI general se informan separadas; no equivalen a certificación productiva ni prueba de carga distribuida.

## C02.2a — pausa, reanudación y reasignación

Implementado localmente el21/10/2026 mediante **108_crm_secuencias_control.sql**;107 y anteriores se conservan. No se inscriben clientes/tareas ni se reconstruye historia anterior. Las ejecuciones existentes comienzan con versión1 para este control, sin inventar controles pasados.

### Operación y tiempo

En el detalle, **Control del seguimiento** permite escribir un motivo y confirmar:

- **Pausar secuencia**: conserva el mismo paso y estado Pendiente/En progreso. Guarda el instante de pausa y la diferencia exacta entre vencimiento y reloj PostgreSQL como intervalo firmado. No crea tareas, no completa el paso ni registra una llamada. Una ejecución pausada impide otro inicio del mismo modelo/cliente.
- **Reanudar secuencia**: conserva la tarea y traslada su vencimiento al reloj actual más el intervalo guardado. Si quedaban dos horas, vuelven a quedar aproximadamente dos horas; si llevaba una hora vencida, continúa una hora vencida. No regala un plazo nuevo ni descuenta tiempo durante la pausa. Mantiene horas continuas, sin calendario hábil. La pantalla identifica la fecha suspendida y no la presenta como un plazo corriendo.
- **Reasignar secuencia**: sólo ADMIN con permiso. Busca un usuario activo por nombre, selecciona otro responsable y confirma el cambio. Cambia la tarea actual y el responsable de los pasos que se creen después. No reescribe tareas cerradas, estado, vencimiento o saldo de pausa. Sirve también para recuperar una secuencia cuyo responsable fue desactivado. No permite asignar a la misma cuenta ni a una inactiva.

Completar/iniciar un paso de una ejecución pausada se rechaza también por la ruta heredada de tareas y por trigger. Se permite cancelar una secuencia pausada y se conserva su historia. Operación CRM indica Pausada y oculta los controles para avanzar; el enlace conduce al detalle de la cadena.

La consulta/generación normal de avisos suspende los vencimientos en pausa y marca atendidos los avisos del responsable anterior al reasignar. Al reanudar una tarea ya vencida se reabre su aviso existente para el responsable actual; si no existe, lo crea la revisión normal. Una tarea futura no se acusa de vencida. Se reutiliza app_notification/NotificationService y su frecuencia normal; no es entrega instantánea garantizada ni otro cron.

### Versiones, concurrencia e historia

crm_secuencia añade `version`, `pausada_en` y `plazo_restante`. Estado admite Pausada; índice único del modelo/cliente abarca Activa/Pausada y las restricciones mantienen cierre/datos de pausa coherentes. Cada control incrementa versión de ejecución y tarea. El avance normal también incrementa la versión de ejecución, por lo que una pantalla anterior no puede pausar/reasignar un paso que ya cambió.

Nueva tabla **crm_secuencia_control**, con UUID idempotente, huella/actor/acción/motivo, responsables anterior/nuevo, vencimientos anterior/nuevo, versiones y fecha. Auditoría nominal, FK restrictivas y guardas ALWAYS UPDATE/DELETE/TRUNCATE. No modifica los eventos inmutables de creación/cierre de107; los controles tienen su propia historia paginada de20. Los identificadores de tarea permanecen como texto en el detalle.

Los controles bloquean **tarea → ejecución**, en el mismo orden que completar/cancelar, y vuelven a validar cuenta/rol/token_version/permiso después de esperar la tarea. Después revalidan pertenencia, paso, estado y expectedVersion. No permiten dos ganadores de la misma versión. Los cambios de contexto permitidos (sólo responsable/plazo) usan un contexto LOCAL dentro de la transacción del control; el trigger sigue rechazándolos desde PATCH de tareas. Estado, plazo, responsables, versiones, aviso e historial se revierten juntos si falla cualquier escritura/auditoría. La ruta heredada revalida también la versión de cuenta después de bloquear una tarea vinculada, conservando su ACL sin exigir permiso de administrar modelos al responsable.

Cada intención usa requestId UUIDv4 más huella/actor. Repetir la misma solicitud devuelve su versión resultante; reutilizar el UUID con otro contenido da409. Un UUID nuevo con expectedVersion obsoleta da409 y exige actualizar. Motivo/confirmación obligatorios; DTO cerrado. Los usuarios conservan acceso como creador o responsable conforme a la ACL existente; un antiguo responsable que no creó la secuencia pierde acceso después de reasignar. ADMIN mantiene acceso.

| Método y ruta adicional bajo `/api/v1` | Contrato |
| --- | --- |
| GET crm/secuencias/responsables | Sólo ADMIN; page/q, usuarios activos, id/nombre y total;20 por página |
| GET crm/secuencias/:id/controles | UUIDv4, ACL; page, últimos controles/versiones primero;20 por página |
| POST crm/secuencias/:id/controles | requestId UUIDv4, expectedVersion entero positivo, accion Pausar/Reanudar/Reasignar, motivo1–500, confirmacion=true; idResponsable sólo al reasignar;20/min |

Mismo permiso `crm.secuencias.gestionar`, sin concesiones nuevas o contratación de servicios. Respuestas privadas no-store. La UI usa nombres y búsqueda paginada de responsables, revisión/confirmación y actualización ante conflictos; no exige capturar IDs técnicos.

### Prueba aislada ampliada

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:crm-sequence-control -- --backup=.backups/FECHA/database.dump
```

Reutiliza el arnés de copia propia de C02.1 y añade `backend/verify-crm-sequence-control.js`; informe separado `.artifacts/c022-control.json`. Prueba contratos/confirmación/ACL, duplicado mientras pausa, versión/idempotencia, bloqueo heredado en pausa, plazo firmado, reasignación histórica, cuentas inactivas/antiguo asignado, alertas, controles concurrentes y carrera con completar, rollback forzado de pausa/reanudación/reasignación (incluido aviso),22 controles reales con paginación/inmutabilidad/auditoría y revocación mientras se espera la tarea. La UI real claro1280/oscuro390 pausa/recarga/reanuda/reasigna y continúa la cadena, conserva la historia y verifica Axe/reflujo/errores JS. No se escriben fixtures en la base operacional. Los resultados finales y respaldos se registran en README.

## C02.2b — reglas supervisadas por eventos

Implementadas localmente mediante migración109: `/crm/reglas-secuencias`, accesible desde Secuencias → Reglas por eventos para ADMIN con permiso. Configuraciones conservadas sobre modelos existentes, eventos nuevos de alta/cambio real de etapa/cliente/responsable, previsualización de pasos/alcance/estados, revisión y aprobación por evento. Revalida origen/cuenta/responsable/huella y bloquea evento/modelo repetido entre reglas y modelo/cliente con seguimiento Activo/Pausado. La aplicación conserva origen y enlace en ambos sentidos; usa el mismo motor en una sola transacción, sin otro sistema de tareas. No hay backfill ni procesamiento por abrir la pantalla.

[Manual de reglas, HTTP, persistencia, pruebas y límites](REGLAS_SEGUIMIENTO.md). Piloto operativo pendiente; no hay ejecutor desatendido o eventos temporales por vencimiento/inactividad (O01). Pausa/reanudación/reasignación C02.2a ya existen: no repetirlas. Siguiente trabajo técnico local C03, contrastando primero bandejas/reportes existentes. Sin contratación de servicios, mensajes externos, bancos o prioridad nueva de IA/Ollama.
