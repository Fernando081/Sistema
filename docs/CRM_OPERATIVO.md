# CRM operativo

## Reportes internos programados — C03.2,21/10/2026

CRM → Bandeja comercial → Reportes programados (`/crm/reportes-programados`): ADMIN propietario con permiso `crm.reportes.programar`, frecuencia diaria/semanal, hora Tampico en múltiplos de10min y filtros de origen/plazo. Snapshots de conteos completos reutilizan C03.1 en la misma transacción/snapshot, sin listas/contactos/importes. Definición conservada, suspensión/reanudación versionadas y corte nuevo sin periodos retroactivos; historial paginado protegido. Migración110 aplicada tras respaldo y db:check; no crea programaciones o resultados de ejemplo.

Nuevo proceso `crm_reports` cada10min, máximo50 elegibles/pasada, guardia PostgreSQL72410,5 y unicidad programa/horario. Reutiliza historial/estado/avisos O02 existentes, incluida recuperación del proceso; esa recuperación no repara resultados Error anteriores. Cuenta activa/ADMIN/permiso revalidados antes de generar; configuración/controles con actor humano, cron sin autor humano inventado. Error guarda sólo código fijo, sin snapshot/SQL ni reintento del periodo conservado. O01 conserva colas/reintentos generales; C03.3 piloto/retención/capacidad. No modifica horarios/cálculos de los procesos anteriores. Sin envíos o bancos.

Aceptación con copia propia restaurada y AppModule/SQL/HTTP/Angular/login reales, calendario adelantado sólo dentro del verificador y sin fixtures en origen. Separa reloj de disparo probado de una ejecución nocturna real. `npm run test:crm-reports -- --backup=.backups/FECHA/database.dump`; resultados definitivos/regresiones/respaldo y límites en README. [Manual, contratos y evidencia](REPORTES_COMERCIALES_PROGRAMADOS.md).

## Bandeja comercial — C03.1, 21/10/2026

CRM → Bandeja comercial reúne tareas/oportunidades propias (ADMIN todas), cotizaciones Pendiente/Vigente y solicitudes web vigentes sólo ADMIN. Consulta READ ONLY, cuenta/rol/token_version vigentes, caché privada, paginación20 y plazos de Tampico. Excluye secuencias pausadas, asuntos cerrados y web vencida/purgada/descartada/convertida; no devuelve payload ni contactos web. Enlaza fichas y tareas existentes, con filtro directo de tarea sujeto a su ACL. Sin migración o envío externo. C03.2 conserva reportes internos programados. [Uso, contratos, pruebas y límites](BANDEJA_COMERCIAL.md).

## C02.2b — reglas supervisadas por eventos (21/10/2026)

Secuencias → **Reglas por eventos**, `/crm/reglas-secuencias`, ADMIN con permiso de secuencias. Reutiliza modelos/tareas: registra eventos nuevos por alta/cambio real de etapa/cliente/responsable, previsualiza pasos y estados, y permite confirmar un inicio por evento con motivo. No hace backfill ni inicia al consultar. Revalida el origen, cuenta, responsable y huella; impide evento/modelo repetido entre reglas y cadena abierta para el modelo/cliente. Evento sustituido excluido aunque vuelva a la etapa. Historial/origen enlazado en ambos sentidos, misma transacción/motor C02.1, migración109 y auditoría/guardas. Piloto real/retención y ejecutor desatendido O01 siguen pendientes; siguiente técnico local C03. [Manual](REGLAS_SEGUIMIENTO.md).

## C02.2a — control de secuencias (21/10/2026)

El detalle de `/crm/secuencias` ya permite **pausar/reanudar** con motivo, confirmación, versión e historial. La pausa conserva el saldo firmado del plazo y suspende avisos; reanudar conserva la tarea y su tiempo pendiente/vencido. **Reasignar**, sólo ADMIN, busca un responsable activo y cambia el paso actual/futuros sin reescribir los cerrados. Operación CRM muestra la pausa sin marcarla como vencimiento activo ni permitir avanzar; cancelar sigue disponible desde la cadena. La ruta heredada rechaza avanzar en pausa y revalida versión de cuenta tras esperar la tarea. Migración108, historia de controles paginada/conservada y rollback transaccional. No crea otra tarea, agenda o comunicación. C02.2b ya añade reglas supervisadas por eventos; C02 conserva piloto operativo. [Manual y límites](CRM_SECUENCIAS.md#c022a--pausa-reanudación-y-reasignación).

## C02.1 — secuencias internas (21/10/2026)

Operación CRM → **Abrir secuencias de seguimiento** abre `/crm/secuencias`. Modelos conservados de1–8 pasos, búsqueda/selección explícita de cliente, responsable actual, motivo y confirmación; crea una tarea a la vez. Completar crea el siguiente paso en la misma transacción; completar el último o cancelar cierra la cadena. Historial nominal, UUID/versiones/ACL y enlaces directos con recarga. Reutiliza crm_tarea, alertas de vencimiento y rutas existentes; no crea otra agenda ni registra comunicaciones ficticias. Migración107 sin backfill. **C02 parcial operativo**: controles C02.2a y reglas supervisadas C02.2b ya existen; piloto/retención pendientes. [Uso, contratos, verificación y límites](CRM_SECUENCIAS.md).

## Piezas instaladas y garantías — D02, 20/10/2026

El expediente de unidad incorpora piezas vendidas reportadas como instaladas, revisión manual de compatibilidad con fuente/versión, snapshot de VIN/ESN/código y vínculos a garantías existentes. Cantidades asignadas entre todas las unidades no superan el renglón vendido; orígenes cancelados/devueltos se conservan con aviso y no se usan para nuevas altas. Corrección ADMIN con motivo, permisos D01/S01, UUID/huella/auditoría y consulta paginada de piezas/vínculos. Garantías ofrece regreso al expediente sólo con consulta efectiva. Migración101, sin completar historia ficticia o consumir stock al registrar. [Manual D02 y límites](PIEZAS_INSTALADAS.md).

## Expediente de unidades — D01, 19–20/10/2026

**Clientes → Unidades → Expediente**, ficha de oportunidad y Cliente360 acceden al expediente privado de la unidad existente. D01 añade lecturas km/horas con cronología/anulación e historial, mantenimiento reportado por fecha/contadores y cierre versionado, fotos JPEG/PNG/WebP y PDF privados con descarga autenticada, cuotas y retiro lógico. Los últimos valores desconocidos no se convierten en cero. Consulta y gestión se delegan mediante permisos S01; anular/retirar también requiere ADMIN. Sin sembrar datos, instalar piezas o generar inventario/costos/facturas. No hay recurrencia/avisos automáticos de estos planes.

`UnidadExpedienteController` y `UnidadExpedienteService` son componentes dedicados de CrmModule, adicionales a los cuatro proveedores de la reorganización Q03.2 descrita abajo. Migración100 aplicada. D02 añade UnidadPiezasController/Service y101 sin duplicar datos VIN/ESN o trámite de garantías. [Manual D01: acceso, permisos, reglas, contratos, pruebas y límites](EXPEDIENTE_UNIDADES.md).

## Solicitudes de la web — WEB05.1 parcial

La pestaña ADMIN **Solicitudes web** ofrece bandeja, revisión, asignación/conversión a oportunidad y diagnóstico **Comprobar recepción** por UUID. Permite saber si un envío con recibo incierto dejó un registro vigente/vencido/purgado o una oportunidad vinculada. La comprobación devuelve solo estado/fechas/vínculo, sin contactos o piezas; no restaura ni modifica registros. Desde ese diagnóstico, ADMIN puede registrar decisión **Conservar original** con motivo, confirmación e historial de versiones/autor (091). Conserva huella, contenido, vencimiento y vínculo; no crea otra oportunidad ni acepta automáticamente un reenvío cambiado. Captación pública desactivada mientras se aprueban aviso/retenciones y configuración operativa. Detalle y límites en [Solicitudes públicas y CRM](WEB_SOLICITUDES_CRM.md).

En **Solicitudes web → Estado del puente de recepción → Consultar configuración del puente**, ADMIN puede ver habilitación/configuración del receptor, protocolo, ID de firma activa y fechas/estado de la anterior. Consulta manual, sin secretos ni formulario para introducirlos; una configuración válida no confirma que la captura pública esté habilitada. Las firmas se rotan en el servidor con huella estable y ventana acotada; procedimiento en [Solicitudes públicas y CRM](WEB_SOLICITUDES_CRM.md#rotación-técnica-de-firma-y-huella-estable--2026-10-10).

El servidor de la web admite un perfil local explícito con comprobación firmada previa de firma, huella y versión del aviso; no inserta registros durante la comprobación. Arranque habitual y perfil incluido siguen cerrados. Es configuración del servidor, sin formulario nuevo de claves en CRM; la consulta ADMIN del puente sigue siendo una observación puntual. Ver [perfil local y límites](WEB_SOLICITUDES_CRM.md#perfil-local-y-comprobación-previa-sin-persistencia--2026-10-10).

Para revisar aviso y conservación de consultas, usar el [expediente de privacidad y retenciones](WEB_PRIVACIDAD_RETENCION.md). Convertir copia el contacto a una oportunidad; purgar bandeja no lo elimina ni borra snapshot/seguimientos o respaldos. El expediente prepara decisiones y procedimiento manual, sin añadir un módulo ARCO o aprobar plazos.

## Medición de solicitudes — WEB05.2a/d

ADMIN dispone de **Solicitudes web → Medición de solicitudes**: fechas de recepción, recibidas/oportunidades, conversión, estados, tendencia diaria y referencias. WEB05.2c agrega **Importes y cobros por moneda**, venta neta sin impuestos, notas/devoluciones comprobadas, cobros y saldo registrados, sin duplicar REP/facturas globales y con «Por conciliar» ante información incompleta. Lectura READ ONLY de la base actual; vacío sin conversión o moneda inventada. No recupera contactos vencidos, activa captación o cambia retenciones. Ganada no confirma venta; cobros/saldo no equivalen a utilidad o flujo neto. [Medición de solicitudes](WEB_MEDICION_CRM.md), [medición financiera](WEB_MEDICION_FINANCIERA.md).

**WEB05.2d → Rentabilidad de las ventas por moneda** agrega costo histórico neto, utilidad bruta y margen con snapshots originales, ajustados por cantidades devueltas. Comparabilidad local MXN/factor1; cobertura de costo/detalle/moneda desconocidos, pérdidas explícitas y margen indefinido con neto cero. No cambia reportes generales de utilidad ni costos guardados, y no equivale a utilidad después de gastos. [Definiciones y pruebas](WEB_RENTABILIDAD_CRM.md).

## Cotizaciones y documentos de venta — WEB05.2b

En la ficha de oportunidad, **Cliente ERP, cotizaciones y ventas vinculadas** permite buscar/asociar un cliente existente y vincular/retirar cotizaciones con confirmación. ADMIN o responsable actual; cliente común y cotización de una única oportunidad, verificados en servidor/BD. Versiones, reintentos e historial/auditoría conservan trazabilidad. El panel de solicitudes añade conteos por cotización/pedido sin duplicados, excluyendo cancelados e inconsistencias; Ganada no basta para contarlos. WEB05.2c agrega los importes agregados de esa cadena sólo al panel ADMIN. [Manual y pruebas](WEB_TRAZABILIDAD_COMERCIAL.md).

## Organización del backend (Q03.2, 29 de septiembre de 2026)

`CrmService` conserva el contrato del controlador y delega en cuatro proveedores Nest:

- `CrmOportunidadesService`: pipeline, agenda de oportunidades, seguimientos, búsqueda y ventas perdidas.
- `CrmUnidadesService`: consulta y mantenimiento de unidades VIN/ESN para clientes y oportunidades.
- `CrmComercialService`: segmentos, plantillas, campañas en borrador, encuestas y metas.
- `CrmActividadService`: tareas y bitácora de comunicaciones.

Unidades utiliza el servicio de oportunidades para consultar y bloquear la oportunidad. Al registrar una unidad, el bloqueo, inserción e historial comparten el mismo `EntityManager` dentro de una única transacción. El método interno `lockOportunidad` no agrega una ruta HTTP. La fachada mantiene los métodos y firmas mediante `Parameters` y `ReturnType`; `crm.types.ts` concentra las filas internas.

Las pruebas existentes conservan cobertura de concurrencia, agenda, historial y validación VIN/ESN. Las pruebas de composición del módulo verifican los proveedores reales, el manager compartido y el filtro de propietario de tareas. Esta reorganización no necesita migraciones ni activa campañas o comunicaciones externas.

La pestaña **Clientes y CRM > Operación CRM** concentra herramientas comerciales que complementan el pipeline y la agenda.

## Tareas y recordatorios

Las tareas se relacionan con un cliente, unidad, oportunidad, cotización o pedido. Incluyen responsable, prioridad, vencimiento, estado y control de versión para evitar que dos usuarios sobrescriban cambios. Los usuarios comunes ven las tareas asignadas o creadas por ellos; un administrador puede consultar y reasignar todas.

Una tarea vencida genera una alerta deduplicada en el centro de notificaciones. Al completarla o cancelarla, la alerta pendiente se marca automáticamente como atendida.

## Alertas operativas

El centro de notificaciones revisa cada diez minutos y al abrirse:

- Cotizaciones pendientes que vencen dentro de tres días o que ya vencieron.
- Facturas PPD cuyo saldo superó los días de crédito del cliente.
- Garantías abiertas a dos días de su fecha compromiso o ya vencidas.
- Productos con demanda reciente, faltante proyectado y existencia crítica.

Las alertas usan una clave única por documento y usuario. Una alerta activa se actualiza en lugar de duplicarse y se marca como atendida cuando desaparece la condición que la originó.

## Bitácora de comunicaciones

Registra comunicaciones entrantes y salientes por llamada, correo, WhatsApp, visita u otro canal. La bitácora conserva autor, fecha, cliente, unidad u oportunidad y el resumen del resultado. Registrar una comunicación no envía mensajes a terceros.

## Segmentos

Permite agrupar clientes por tipo y por días transcurridos sin compra. El total de clientes se calcula al consultar el segmento; no se copia una lista que pueda quedar obsoleta.

## Plantillas y campañas

Las plantillas admiten llamada, correo o WhatsApp. Las campañas se guardan como borradores con segmento, plantilla, vigencia y objetivo. Crear una campaña no envía mensajes: la activación y la integración con un proveedor de comunicación se incorporarán como un flujo separado y auditable.

## Satisfacción

Registra una calificación de 1 a 5 y un comentario ligado a un cliente u oportunidad. El backend rechaza respuestas sin una relación comercial identificable.

## Metas

Un administrador puede definir metas de importe y cierres por vendedor y periodo. El avance se calcula con oportunidades ganadas dentro del intervalo configurado.

## Seguridad y trazabilidad

- La creación de segmentos, plantillas, campañas y metas requiere rol administrador.
- Los cambios se registran mediante los disparadores de auditoría de la base de datos.
- Las consultas usan parámetros para los valores aportados por el usuario.
- Las campañas permanecen en borrador y no producen comunicaciones externas desde esta pantalla.

## Base de datos

La migración `067_crm_operativo.sql` crea las tablas, restricciones, índices y disparadores necesarios. Se valida con `npm run db:check` y se aplica con `npm run db:migrate`.


## Estado del proceso de alertas (O02.3)

La revisión programada tiene historial y estado en Procesos automáticos del dashboard administrativo. La revisión al abrir notificaciones no se registra como cron. Si falla esa revisión, el centro intenta mostrar los avisos existentes; una caída de base aún impide consultarlos. Ver [Seguimiento de jobs](OBSERVABILIDAD_JOBS.md).

## V03.1 - Portal de clientes (20/10/2026)

Clientes incorpora Accesos al portal (Portal en móvil), separado de usuarios/perfiles del personal. Permiso portal.gestionar para invitar, restablecer o suspender con motivo/versión y revocación. No habilita por RFC/correo ni envía mensajes. Contacto consulta sólo su empresa en /portal, sin costos/notas/proveedores/adjuntos internos. [Manual de portal y pendientes V03.2/V03.3](PORTAL_CLIENTES.md).

## V03.2 — Documentos compartidos en portal (20/10/2026)

Clientes → Documentos del portal requiere portal.publicar, independiente del permiso de cuentas. Permite elegir origen, descargar para revisar, confirmar publicación con motivo y retirar conservando historial. Todos los contactos activos del mismo cliente pueden consultar los archivos autorizados; los demás clientes no. XML/acuses I/E conservados distinguen mock/sandbox/producción registrada; copias V01/V02 PDF identificadas y entrega sin anexos personales/internos. No publica la web comercial ni convierte resúmenes en CFDI. [Uso, tipos y límites](PORTAL_CLIENTES.md#v032--publicación-y-descarga-de-archivos-20102026).

## C01.1 — Consentimiento y preparación local de campañas (20/10/2026)

Cliente360 → Consentimiento comercial reutiliza contactos existentes para registrar autorizaciones/bajas de promociones por canal, referencia de evidencia, motivo, fechas, versión e historial. CRM → Operación CRM → Preparar destinatarios y revisar bajas abre `/crm/campanas`, reutilizando segmentos/plantillas/borradores: conteos, exclusiones, revisión y preparación conservada. No envía mensajes ni activa campañas. Segmentos y preparación comparten clasificación de compras recientes I/Timbrada/Pagada no globales, con fecha Tampico; pendientes/canceladas/NC no reinician inactividad. Baja por destino/canal también excluye contactos compartidos fuera del segmento, sin levantarla al borrar contactos. C01 sigue parcial por ejecución/métricas reales y operación/evidencia humana C01.2. [Manual, fuentes, reglas, HTTP y límites](CAMPANAS_CONSENTIMIENTO.md).
