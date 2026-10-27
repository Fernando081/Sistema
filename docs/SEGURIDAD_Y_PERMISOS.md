# Seguridad y permisos — S01 / S02.1 / S02.2 / S02.3 / S02.4 / S03.1 / S03.2 / D01 / D02 / V01

## O01.2a — Documentos preparados localmente (22/10/2026)

`ventas.correo.gestionar`, ADMIN inicial/delegable S01. USER sólo sus solicitudes, ADMIN control transversal sobre la factura; actividad/rol/token_version/permiso revalidados tras bloquear. Destinatario único registrado, confirmación/UUID/evaluación cerrados; sin remitente, modo real, archivo, destino o proveedor arbitrarios. PDF/datos privados separados de metadatos auditables, huellas/tamaño/FKs y guardas ALWAYS de vínculo/conservación/privacidad. Cierre único confirmado Simulado/Cancelado/Obsoleto; Simulado no es enviado. Revisión pura no llama función histórica con INSERT de historial. Se retira el SMTP/remitente fijo del servicio activo; no hay consumidor automático ni llamadas externas. [Contratos, almacenamiento, autorización y límites](SALIDA_DOCUMENTOS.md).

## O01.1 — Reintentos privados de reportes (21/10/2026)

Reutiliza ADMIN/`crm.reportes.programar` y alcance por propietario, incluso frente a otros ADMIN. Preparación y cancelación confirmadas; DTO cerrados sin payload/SQL/destinatario/reloj/contador arbitrarios. Cancelación versionada/idempotente y revalidación de cuenta/rol/token_version/permiso después de bloquear programación. Ejecutor revalida autoridad/corte bajo READ COMMITTED tras esperar, conserva reserva UUID5min, máximo tres intentos y recuperación única transaccional. Eventos/snapshots originales y recuperados protegidos contra reescritura; auditoría humana separada del cron sin autor humano inventado. No hay ruta HTTP para ejecutar la cola ni respuestas con tokens/errores privados. Sin comunicaciones externas/PAC/bancos; [contratos y límites](COLA_REPORTES.md).

## A01.1 — Escaneo de picking (21/10/2026)

Permiso `inventario.escanear`, ADMIN inicial/delegable S01; cuenta/rol/versión/permiso revalidados dentro de escritura después del bloqueo de pedido. Lectura privada paginada sin importes/contactos de cliente; operador corrige sólo su verificación, ADMIN también las ajenas. UUID ligado a contenido/actor/pedido, evaluación obsoleta rechazada, cantidad exacta y eventos conservados/auditados con guardas ALWAYS. QR técnico no autentica ni prueba presencia. Cámara local opcional por acción explícita, sin audio/archivo/subida; método declarado. No sustituye autorización de movimientos, identidad física o procedimiento operativo. [Contratos y límites](ESCANEO_ALMACEN.md).

## Reportes internos programados — C03.2,21/10/2026

CRM → Bandeja comercial → Reportes programados (`/crm/reportes-programados`): ADMIN propietario con permiso `crm.reportes.programar`, frecuencia diaria/semanal, hora Tampico en múltiplos de10min y filtros de origen/plazo. Snapshots de conteos completos reutilizan C03.1 en la misma transacción/snapshot, sin listas/contactos/importes. Definición conservada, suspensión/reanudación versionadas y corte nuevo sin periodos retroactivos; historial paginado protegido. Migración110 aplicada tras respaldo y db:check; no crea programaciones o resultados de ejemplo.

Nuevo proceso `crm_reports` cada10min, máximo50 elegibles/pasada, guardia PostgreSQL72410,5 y unicidad programa/horario. Reutiliza historial/estado/avisos O02 existentes, incluida recuperación del proceso; esa recuperación no repara resultados Error anteriores. Cuenta activa/ADMIN/permiso revalidados antes de generar; configuración/controles con actor humano, cron sin autor humano inventado. Error guarda sólo código fijo, sin snapshot/SQL ni reintento del periodo conservado. O01 conserva colas/reintentos generales; C03.3 piloto/retención/capacidad. No modifica horarios/cálculos de los procesos anteriores. Sin envíos o bancos.

Aceptación con copia propia restaurada y AppModule/SQL/HTTP/Angular/login reales, calendario adelantado sólo dentro del verificador y sin fixtures en origen. Separa reloj de disparo probado de una ejecución nocturna real. `npm run test:crm-reports -- --backup=.backups/FECHA/database.dump`; resultados definitivos/regresiones/respaldo y límites en README. [Manual, contratos y evidencia](REPORTES_COMERCIALES_PROGRAMADOS.md).

## Bandeja comercial — C03.1, 21/10/2026

CRM → Bandeja comercial reúne tareas/oportunidades propias (ADMIN todas), cotizaciones Pendiente/Vigente y solicitudes web vigentes sólo ADMIN. Consulta READ ONLY, cuenta/rol/token_version vigentes, caché privada, paginación20 y plazos de Tampico. Excluye secuencias pausadas, asuntos cerrados y web vencida/purgada/descartada/convertida; no devuelve payload ni contactos web. Enlaza fichas y tareas existentes, con filtro directo de tarea sujeto a su ACL. Sin migración o envío externo. C03.2 conserva reportes internos programados. [Uso, contratos, pruebas y límites](BANDEJA_COMERCIAL.md).

## Reglas supervisadas — C02.2b, 21/10/2026

ADMIN activo con permiso efectivo de secuencias; operador403 incluso con permiso delegado. Revalida rol/token_version/permiso después de esperar la oportunidad y al entrar al motor compartido. La cuenta del responsable se bloquea/revisa antes de asignar. Evento/cliente/responsable se derivan del origen, no del cuerpo de aprobación; DTO cerrado, bigint como texto, confirmación/motivo/UUID/huella. Una revisión vieja devuelve409. Reintentos no duplican y evento/modelo tiene unicidad entre reglas, aun si la secuencia anterior se cerró; índice Activa/Pausada existente conserva protección de cliente/modelo.

Migración109 crea eventos/reglas/aplicaciones conservados con guardas ALWAYS, auditoría nominal de regla/aplicación, FKs restrictivas y validación de vínculo. Evento técnico no atribuye al responsable la autoría del cambio ni copia contactos. Se revierte con su origen; aplicación/secuencia/tarea/evento/auditoría comparten transacción y conexión. Sin backfill, ejecutor en segundo plano o mensajes externos. C02 conserva piloto/retención; no se publican datos en Internet. [Contrato y límites](REGLAS_SEGUIMIENTO.md).

## Control de secuencias — C02.2a, 21/10/2026

Pausa/reanudación/reasignación con permiso existente, motivo/confirmación/UUID/huella/actor y expectedVersion. Sólo ADMIN reasigna y consulta responsables activos; las otras acciones conservan ACL de creador/responsable. El antiguo asignado pierde acceso si no era creador. Bloqueos en orden tarea→ejecución y revalidación de cuenta/rol/token_version/permiso después de esperar; ruta heredada revalida también la versión de cuenta sin imponer el permiso de modelos al responsable. Un avance concurrente invalida una pantalla anterior. Guardas de tarea impiden avanzar durante pausa o eludir el control editando responsable/plazo desde PATCH común.

Migración108 conserva107: estado Pausada, intervalo firmado y versión; índice evita doble inicio Activa/Pausada. Nuevo historial de controles con FK restrictivas/auditoría y guardas ALWAYS UPDATE/DELETE/TRUNCATE. Contexto de modificación limitado a la transacción. Fallos de auditoría revierten responsables, estado, plazo, versiones, avisos e historia. Reasignar no altera pasos cerrados ni reactiva cuentas. No se activa una automatización por eventos ni un envío. [Contrato, reglas y límites](CRM_SECUENCIAS.md#c022a--pausa-reanudación-y-reasignación).

## Secuencias internas — C02.1, 21/10/2026

Migración107 añade `crm.secuencias.gestionar`, ADMIN inicial/delegable. Las rutas nuevas revalidan cuenta/rol/token_version/permiso efectivo; el inicio/modelo revalida después de la guardia. Operadores sólo consultan ejecuciones propias/asignadas y se asignan a sí mismos; ajenos404. Las transiciones de la ruta nueva revalidan permiso/versión de sesión al adquirir la tarea. La ruta existente de tareas mantiene su ACL de responsable/creador/ADMIN para atender compromisos, con cuenta activa/rol vigente y sin permitir editar contexto o reabrir pasos cerrados.

Modelos/eventos conservados con guardas ALWAYS, tareas vinculadas preservadas, UUID/huella por intención/actor, índice único de ejecución activa por cliente/modelo y tarea por paso. Cierre/evento/siguiente tarea/avance/cancelación dentro de la transacción, auditoría con actor LOCAL y rollback completo ante fallos. No duplica comunicaciones, consentimiento o documentos fiscales. No certifica retención/anonimización ni prueba distribuida de carga; C02 conserva piloto operativo; controles C02.2a y reglas supervisadas C02.2b ya existen. [Contratos, reglas y evidencia](CRM_SECUENCIAS.md).

## Revisiones y respuesta comercial — V01, 20/10/2026

Migración102 añade cotizaciones.versionar, inicialmente sólo admin y delegable por S01. Consulta de versiones requiere cuenta vigente; activar/revisar/emitir/revocar exige el permiso revalidado transaccionalmente. No es aislamiento por cliente/sucursal. Snapshots/respuestas con triggers ALWAYS contra UPDATE/DELETE/TRUNCATE y auditoría con contexto LOCAL; dueño PostgreSQL conserva capacidad DDL.

Dos POST de respuesta admiten capacidad por token en JSON sin sesión, con proyección mínima, cabecera propia, límites y HTTPS obligatorio en modo producción. Token HMAC emitido por servidor, sólo SHA en BD, fragmento retirado del navegador y sin persistirlo allí. Una respuesta externa se registra con nombre declarado, sin atribuirla a un actor JWT/cookie; no verifica identidad ni firma avanzada. No amplía acceso al resto del ERP o aprueba operación/retenciones/HTTPS públicos. [Contrato y límites V01](VERSIONES_COTIZACION.md).

## Instalaciones reportadas y garantías — D02, 20/10/2026

D02 reutiliza crm.unidades.consultar/gestionar: consultar permite historial/orígenes/candidatos/vínculos; gestionar más consulta permite altas/revisiones/vínculos. Anular/retirar también requiere ADMIN. **Al delegar gestión D01 se delega también esta función D02**; no hay concesiones nuevas a cuentas de origen ni permisos por cliente/sucursal. Backend comprueba actor vigente dentro de transacción, bloquea unidad/origen/garantía según operación y conserva auditoría con actor LOCAL. Garantías sólo devuelve IDs de expediente relacionado si el solicitante tiene consulta efectiva; no usa un botón oculto como autorización. Migración101 añade dos tablas sin sembrar historia. [Contrato, integridad, pruebas y límites](PIEZAS_INSTALADAS.md).

## Expedientes privados de unidades — D01, 19–20/10/2026

Migración100 incorpora `crm.unidades.consultar` y `crm.unidades.gestionar`, concedidos inicialmente sólo al rol admin. Lectura/descarga exige consulta; creación de lecturas, planes/cierres y archivos exige ambos. Anular lecturas o retirar archivos requiere además rol ADMIN y motivo. Se delegan por perfiles/excepciones S01 sin reasignar cuentas existentes. La UI distingue consulta de gestión mediante permisos efectivos. Cuenta/rol/versión/permisos se revalidan dentro de la transacción y con bloqueo para escrituras; pruebas reales incluyen revocación mientras se espera y operador de sólo consulta.

El permiso permite consultar unidades del ERP en general; no añade aislamiento por cliente/sucursal ni cambia las reglas anteriores de edición VIN/ESN. Los binarios privados están en BD, separados de metadata auditada y de `/uploads`; descarga autenticada no-store/attachment/nosniff/CSP, cuotas y verificación SHA256. Retirar conserva bytes y bloquea descargas futuras; no revoca copias descargadas. Validación básica de firmas no equivale a antivirus; hash no equivale a firma externa. [Contrato y límites D01](EXPEDIENTE_UNIDADES.md).

Actualizado: 19/10/2026. Los perfiles reutilizables se administran en **Usuarios y acceso** (`/usuarios`), únicamente con una cuenta administradora persistida. No requieren dominio, hosting ni servicios externos.

## Tres niveles de acceso

1. **Rol base**: `admin` o `user` (operador). Conserva las restricciones existentes de cada controlador. Cambiarlo es una acción administrativa separada.
2. **Perfil reutilizable**: un operador puede tener un perfil, por ejemplo Mostrador o Almacén. El perfil contiene una lista explícita de permisos permitidos; los no seleccionados se deniegan. Sin perfil, se heredan los permisos históricos del rol base.
3. **Excepción individual**: permite o deniega un permiso para una cuenta y tiene prioridad sobre el perfil o el rol base.

Ejemplo: un perfil permite `ventas.crear` y `compras.recibir`. Una denegación individual de `ventas.crear` impide vender a ese empleado aunque el perfil lo permita. Una concesión individual puede permitir una operación que el perfil no incluya. Asignar otro perfil conserva las excepciones y muestra cuántas existen.

**Un perfil no concede el rol administrador.** Si una ruta exige `@Roles(admin)` y un permiso, ambos requisitos deben cumplirse. Caja, autorizaciones comerciales y otros módulos conservan sus restricciones actuales. Los perfiles actúan sobre los permisos declarados mediante `@Permissions`; no crean aislamiento de todos los listados, datos de clientes o módulos que hoy no declaran permisos. Ocultar una pantalla no sustituye la autorización del servidor. Este alcance no equivale a un sistema completo de acceso por sucursal, registro o campo.

Los administradores no reciben perfiles personalizados. La promoción explícita de un operador retira su asignación; conserva sus excepciones individuales. No se crean perfiles ni se reasignan cuentas automáticamente al migrar.

## Operación desde el ERP

1. En **Perfiles de acceso → Nuevo perfil**, indicar nombre, descripción y permisos; guardar. Un perfil vacío deniega todas las operaciones protegidas por permisos salvo excepciones individuales.
2. En la tabla de usuarios, seleccionar el perfil de un operador y confirmar. **Usar rol base** retira la asignación.
3. **Permisos detallados** muestra el resultado efectivo, la herencia y las excepciones. Cambiar una casilla crea una excepción; **Heredar [permiso]** la retira del borrador. **Heredar todos los permisos** prepara la retirada de todas las excepciones. Solo **Guardar permisos** confirma los cambios.
4. Editar un perfil afecta a todos sus usuarios y cierra sus sesiones. Duplicar crea otro perfil independiente, sin asignaciones. Para eliminar un perfil, primero reasignar a todos sus usuarios, incluidos los desactivados.

Nombres únicos sin distinguir mayúsculas ni espacios exteriores. Máximos: nombre80, descripción500, lista1000 permisos conocidos sin duplicados. Las operaciones son transaccionales y serializan los cambios de acceso mediante la misma guarda de administración de usuarios.

## Sesiones y concurrencia

- Asignar/retirar un perfil, editarlo o guardar excepciones incrementa `auth_user.token_version`. Los JWT anteriores se rechazan en la siguiente solicitud; el empleado debe iniciar sesión otra vez. Una asignación idéntica no revoca innecesariamente sesiones.
- El editor de perfiles exige su `version`; edición y eliminación con una versión anterior devuelven409.
- Asignaciones y excepciones exigen `accessVersion`, correspondiente a la versión de sesiones del usuario. También puede cambiar al cerrar todas las sesiones o cambiar contraseña: recargar ante409.
- Los perfiles y excepciones revalidan al administrador dentro de la transacción; un administrador revocado mientras esperaba la guarda no puede guardar.
- El frontend conserva el borrador de perfil ante error; para resolver un conflicto, copiar los cambios necesarios, cancelar y abrir la versión recargada. El editor individual informa que debe volver a abrir los permisos.
- Se mantienen protección del último administrador y prohibición de desactivarse/retirarse a sí mismo el rol administrador. Guardar las propias excepciones cierra la sesión del administrador; no elimina su rol base.

## API privada

Todas las entradas siguientes requieren administrador autenticado:

| Método/ruta bajo `/api/v1/auth` | Contrato |
| --- | --- |
| GET `permission-catalog` | Catálogo de códigos y descripciones existentes |
| GET `access-profiles` | Perfiles, versión, permisos y número de usuarios asignados |
| POST `access-profiles` | `{name, description, permissions: string[]}` |
| PUT `access-profiles/:id` | Mismos campos y `version` actual |
| DELETE `access-profiles/:id` | Cuerpo `{version}`;409 si tiene asignaciones |
| PUT `users/:id/access-profile` | `{idProfile: number|null, accessVersion}` |
| GET `users` | Añade `idProfile`, `profileName`, `overrideCount`, `accessVersion`; no devuelve hashes |
| GET `users/:id/permissions` | Efectivo, `overridden`, `inheritedGranted`, `accessVersion` por permiso |
| PUT `users/:id/permissions` | `{permissions: [{permissionCode, granted}], accessVersion}`; reemplaza **solo** excepciones |

Las lecturas administrativas usan `Cache-Control: private, no-store`. El cambio del contrato de excepciones exige actualizar clientes anteriores para enviar `accessVersion`. S02.1 añade sesiones individuales, S02.2 cookie HttpOnly, S02.3 MFA opcional y S02.4 recuperación offline previamente inscrita. S02/S02.4 siguen parciales por soporte asistido/identificación real y aviso externo verificado antes de producción.

## Persistencia y despliegue

Migración nueva **094_roles_personalizados.sql**: `app_access_profile`, `app_access_profile_permission`, `app_user_access_profile`, índices y `fn_effective_permission`. La función es de lectura y usa la precedencia excepción → perfil de operador → rol base. No modifica migraciones anteriores, hashes, usuarios ni concesiones previas. No se modificó la entidad AuthUser: las asignaciones tienen tabla independiente.

Antes de desplegar backend/frontend nuevos: respaldo completo → `db:check` → `db:migrate`. No editar094 una vez aplicada. El backend nuevo requiere las migraciones correspondientes. S03.1/098 añade bitácora de cambios de usuarios, perfiles y permisos con lista de campos permitidos, actor transaccional e historial protegido frente a UPDATE/DELETE/TRUNCATE. No confundir logs HTTP con esta bitácora ni afirmar protección frente al propietario PostgreSQL. [Controles, prueba y límites](AUDITORIA_Y_APROBACIONES.md).

## Validación reproducible

Con Node24 y PostgreSQL local con permiso CREATE DATABASE, después de compilar backend y frontend:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace backend run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace frontend run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:access-profiles -- --backup=.backups/FECHA/database.dump
```

El verificador restaura únicamente en una base propia con nombre aleatorio, ejecuta check/migrate, inicia AppModule completo con guards/DTO y cron detenido en la copia, y utiliza cuentas/contraseñas aleatorias. Prueba permisos, sesiones, conflictos concurrentes y UI Angular de producción con login real. No simula API ni cambia cuentas de la base de origen. Elimina solo su copia y deja reporte sanitizado en `.artifacts/s01-access-profiles.json` y capturas claro/oscuro. Mantiene restricciones de frecuencia de la aplicación.

Evidencia del19/10/2026: 12 grupos integrales aprobados, incluido editor móvil390/escritorio1280 y axe sin infracciones en el panel. Backend232 pruebas/52 suites; frontend74 pruebas. Esta aceptación local no certifica producción ni todos los flujos de negocio. Datos de prueba, fiscal mock e identificadores técnicos se conservan. No se habilitan conexiones bancarias.

## S02.1 — Sesiones por navegador (19/10/2026)

**Mi cuenta → Sesiones activas** (`/perfil`) muestra las sesiones activas de la propia cuenta, incluida la actual. Permite actualizar la lista, cerrar una sesión específica, cerrar la actual y cerrar todas. Se pide confirmación antes de cerrar. Cada login es una sesión: no se identifican equipos físicos ni se certifica que el navegador declarado sea auténtico. Las pestañas que comparten el mismo token cuentan como una sesión.

### Reglas de servidor

- Login persistido crea un UUID técnico aleatorio `sid` vinculado a usuario/versión y lo firma dentro del JWT. La tabla `auth_session` **no guarda JWT, contraseñas, IP ni cabecera User-Agent completa**. Solo conserva etiqueta reducida de navegador/sistema y fechas. Conocer el UUID no autoriza solicitudes: sigue siendo obligatorio un JWT firmado, vigente y perteneciente a la cuenta.
- Cada solicitud comprueba cuenta activa, rol, versión, firma/claims y fila de sesión no revocada/vencida. Una sesión ajena no puede consultarse ni cerrarse mediante estas rutas, aunque el solicitante sea administrador. Un UUID inexistente o ajeno devuelve404 y uno mal formado400. El cierre repetido de una sesión propia ya cerrada es idempotente usando otra sesión vigente.
- Duración absoluta de **8 horas desde el login**, como el JWT previo. Vencimiento tanto en JWT como en PostgreSQL. No se añade vencimiento por inactividad en esta entrega. Última actividad se actualiza como máximo una vez por minuto; incluye solicitudes automáticas del navegador, no mide presencia física ni trabajo del empleado.
- **Máximo20 sesiones activas por cuenta**. Los logins se serializan bloqueando su fila; al superar20 se revocan las más antiguas y se conserva el acceso nuevo. No se mantiene un dispositivo confiable ni se evita otro login válido.
- `POST auth/logout` ahora cierra **solo la sesión actual**. `POST auth/logout-all` incrementa la versión de cuenta y cierra todas sus sesiones. Contraseña, rol, estado, perfiles y excepciones siguen revocando todas mediante la versión ya existente. La revocación se aplica en la siguiente solicitud; no cancela una operación ya autorizada y en ejecución.
- La inserción revalida la cuenta, versión y hash dentro de la transacción: no crea una sesión con una verificación de contraseña anterior a un cambio concurrente.
- Al iniciar sesión, se eliminan únicamente registros de esa cuenta ya vencidos y creados hace más de30 días. Es limpieza oportunista: sin nuevo login no hay purga programada. Los registros restantes no constituyen una bitácora inmutable; una política global de retención y auditoría sigue pendiente.

### Rutas propias bajo `/api/v1/auth`

| Método/ruta | Resultado |
| --- | --- |
| GET `sessions` | Hasta20 sesiones propias activas; ID técnico, etiqueta, inicio, actividad, vencimiento y `current`; `private, no-store` |
| POST `sessions/:id/revoke` | Cierra sesión propia; `{message,current}` permite redirigir al login si era la actual |
| POST `logout` | Cierra el acceso actual, conservando los demás |
| POST `logout-all` | Cierra todos los accesos propios y exige otro login |

No se añade un endpoint para inspeccionar las sesiones de otro empleado. El bootstrap por variables de entorno conserva su alcance de desarrollo, sin cuenta ni sesiones persistidas; estas herramientas requieren usuario registrado. Producción mantiene prohibido ese bootstrap.

### Migración y compatibilidad

**095_sesiones_por_navegador.sql**, nueva y aplicada tras respaldo/check, añade tabla/índices sin modificar usuarios ni permisos. El backend nuevo exige la migración. **JWT anteriores sin sid de cuentas persistidas dejan de aceptarse al actualizar el backend**; se debe iniciar sesión nuevamente. No se simula un registro retroactivo ni se modifica la contraseña. Integraciones que usaban logout para cerrar todos deben pasar a logout-all. Desde S02.2, los endpoints admiten cookie para el ERP; Bearer se conserva para clientes API y el frontend ya no guarda JWT en Web Storage.

### Validación

Después de compilar backend/frontend con Node24:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:account-sessions -- --backup=.backups/FECHA/database.dump
```

Restaura exclusivamente una base propia, ejecuta check/migrate y AppModule completo, conserva guards/límites de frecuencia y detiene cron únicamente en la copia. Usa contraseñas/JWT temporales sin guardarlos en reportes. Doce grupos verifican aislamiento/404, formatos y propiedad de sid, JWT antiguos, revocación individual/global, versión/perfiles/estado/contraseña, expiración, actividad, 24 logins concurrentes/límite20 y limpieza30 días. Dos contextos de navegador inician sesión mediante el formulario real; Angular producción sin API simulada ejecuta los tres tipos de cierre. Claro1280/oscuro390 y axe sin infracciones en el panel; copia eliminada. Reporte `.artifacts/s021-account-sessions.json`.

También aprobadas regresiones S01 en copia (12 grupos), jobs en esquema propio (13), métricas web (8), y backend234 pruebas/53 suites más frontend74. Esto no sustituye una auditoría de producción o toda la batería de cargas financieras.

### Pendientes de S02 y referencia

S02 sigue **parcial**. Sesiones/dispositivos orientativos S02.1, cookie/CSRF S02.2, MFA opcional S02.3 y método offline de recuperación S02.4 implementados; pendientes soporte asistido/identificación real y aviso externo verificado. HTTP local no sustituye HTTPS al publicar. No se almacena una huella física ni se proporciona monitoreo en tiempo real.

Referencia de diseño: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), sobre estado/expiración/revocación de sesiones en servidor y límites del almacenamiento del navegador. La implementación local no equivale a certificación OWASP ni completa todos los controles de esa guía.

## S02.2 — Cookie HttpOnly y defensa CSRF (19/10/2026)

El ERP deja de almacenar o decodificar JWT en `localStorage`/`sessionStorage`. Angular conserva únicamente identidad pública y vencimiento en memoria (`getSessionIdentity`). Al entrar directamente o recargar una ruta protegida, consulta al servidor; guards simultáneos comparten una consulta. Una respuesta pendiente anterior al cierre no puede restaurar la identidad después de cerrarla. Se eliminan las claves antiguas `access_token` sin borrar temas ni borradores.

### Contrato del navegador y API

| Entrada | Resultado |
| --- | --- |
| POST `/api/v1/auth/login` con `X-ERP-Browser: 1` | Exige origen/cabecera/transporte válidos; crea sesión registrada, entrega cookie HttpOnly y `{profile,expiresAt}` sin JWT en JSON |
| GET `/api/v1/auth/browser-state` | Cookie o credencial válida y cabecera de navegador; identidad pública/vencimiento, `private, no-store` |
| Peticiones Angular a la API | Credenciales de cookie y `X-ERP-Browser: 1`; no construyen Authorization |
| POST login sin cabecera de navegador | Conserva contrato Bearer para verificadores y clientes API existentes |

La cookie y Bearer usan la misma validación de usuario, rol, versión y fila revocable de S02.1; no hay autenticación paralela que omita permisos. Si un cliente API envía Authorization explícito, se valida ese Bearer y no se cambia de identidad usando una cookie como fallback. Cabeceras de Authorization mal formadas no recuperan una sesión por cookie.

El frontend solo añade credenciales/cabecera a la API configurada y su límite de ruta, no a otros orígenes o prefijos similares. Se conservan navegación por roles y comprobación de permisos en servidor. El bootstrap por variables de entorno sigue disponible únicamente para API de desarrollo bajo sus condiciones previas; el modo navegador exige cuenta persistida.

### Cookie y compatibilidad

- Desarrollo: `erp_session`, HttpOnly, SameSite=Strict, sin Domain y Path=/api/v1. HTTP se admite únicamente cuando la conexión recibida por el backend es loopback. La instalación local usa el proxy Angular hacia3100.
- Producción: `__Host-erp_session`, HttpOnly, Secure, SameSite=Strict, Path=/ y sin Domain. Las peticiones autenticadas por cookie y el login del navegador requieren HTTPS reconocido por Express.
- Caduca a la misma hora del JWT/sesión (8h), sin renovación silenciosa. Cookie/metadata no sustituyen la revocación SQL.
- Logout actual/global, revocación de la actual y cambio de contraseña limpian la cookie cuando se usa ese transporte. Una cookie inválida/vencida recibe401 y se limpia; cookies duplicadas se rechazan como ambiguas. No se revela el token en errores o reportes.
- Se requiere **nuevo login del navegador** tras retirar el almacenamiento anterior. Los clientes API Bearer y sus sesiones siguen sujetos a su expiración y a los controles de cierre de S02.1; eliminar una clave del navegador no equivale a revocar una credencial previamente emitida. Cerrar todas las sesiones conserva el mecanismo global explícito.

HttpOnly evita leer la cookie desde JavaScript, pero no elimina XSS ni impide a un script ejecutado en el propio origen realizar acciones con la sesión. HTTPS y política de contenido siguen siendo necesarios. Cookies no separan puertos de un mismo host; para despliegue usar un origen ERP dedicado y proxy de API del mismo origen. No se publicó ni configuró dominio/hosting/TLS real en esta entrega.

### Protección de solicitudes

Se utiliza la estrategia de **origen exacto + cabecera no simple para APIs**, respaldada por CORS y SameSite; no es un token CSRF sincronizado. Toda escritura autenticada mediante cookie exige `Origin` en `CORS_ORIGINS` y `X-ERP-Browser: 1`. Se rechaza `Sec-Fetch-Site: cross-site`. Falta de origen, `null`, otro origen o cabecera ausente/incorrecta devuelve403 antes de ejecutar la operación. Login en modo navegador aplica las mismas reglas. Las lecturas de estado del navegador también exigen cabecera y rechazan un Origin externo si lo incluyen.

CORS utiliza lista canónica de orígenes exactos; rechaza wildcard, credenciales, rutas y orígenes inválidos. En desarrollo, sin configuración explícita, admite localhost/127.0.0.1 en4200/4300/4400. En producción exige `CORS_ORIGINS` explícito exclusivamente HTTPS. La web pública4500/4600 no forma parte de la lista predeterminada. No se confía solamente en SameSite o en que el navegador oculte una respuesta CORS.

Detrás de un reverse proxy **local confiable**, `AUTH_TRUST_LOOPBACK_PROXY=true` permite a Express reconocer su protocolo; el proxy debe reemplazar `X-Forwarded-Proto` y no permitir acceso externo directo al backend. Desactivado por defecto. Enviar esa cabecera por sí sola no habilita HTTPS. Configuración de ejemplo actualizada, sin cambiar secretos/configuración privada local.

### Validación y límites

Sin migraciones ni dependencias nuevas; se conserva095 y sus checksums. Con builds backend/Angular previos y Node24:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:browser-auth -- --backup=.backups/FECHA/database.dump
```

Reutiliza el arnés de sesiones sobre una copia restaurada: 13 grupos combinan reglas S02.1 con dos logins reales por formulario, cookies HttpOnly/Strict/host/path, ausencia de JWT en respuesta/Storage/Authorization del frontend, restauración al recargar y cierre/limpieza de cookie. Comprueba origen/cabecera/Fetch Metadata, login CSRF, CORS externo y cookie ambigua/inválida. Angular producción y API/guards/SQL reales; sin inyectar JWT o simular API en esta aceptación. La copia se elimina. Reporte `.artifacts/s022-browser-auth.json`; atributos Secure/Host y HTTPS de producción se verifican en unitarias, no mediante un despliegue TLS real.

Unitarias del cliente prueban restauración compartida, rechazo de respuestas Bearer/metadata inválida, cierre frente a respuestas pendientes, limpieza de claves anteriores y límites del interceptor. La batería Playwright general usa API simulada; se separa de la aceptación autenticada real. S02 no se marca completo: MFA y recuperación offline están resueltos, pero quedan soporte asistido/identificación real y aviso externo verificado.

Referencias: [OWASP: cabeceras personalizadas y CORS contra CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi), [MDN: atributos Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [seguridad Angular](https://angular.dev/best-practices/security).

## S02.3 — MFA TOTP opcional (19/10/2026)

Mi cuenta permite configurar/confirmar autenticador, obtener diez respaldos de un uso y desactivar con contraseña + factor. La contraseña sola entrega un reto de cinco minutos; JWT/cookie solo después de verificar el segundo factor. Secreto AES-256-GCM con clave externa, respaldos/retos solo hasheados, cinco fallos bloquean diez minutos, anti-replay/consumo concurrente y versiones/revocación al activar/desactivar. Migración096 sin inscribir usuarios existentes. Configuración local idempotente `setup:mfa-key`, secreto nunca impreso; requiere conservar la clave fuera del respaldo SQL y reiniciar backend.

[Manual completo: uso, contrato HTTP, gestión de clave, pruebas y límites](AUTENTICACION_DOS_PASOS.md). Aceptación con AppModule/PostgreSQL/Angular reales en copia descartable, separada de mocks HTTP/UI; temas y accesibilidad. No hay QR externo, SMS, llaves FIDO, MFA obligatoria por rol ni bypass administrativo. S02.4 añade una clave offline específica para contraseña, conservando MFA; los respaldos MFA no la reemplazan.

## S02.4 — Recuperación local previamente inscrita (19/10/2026)

Mi cuenta permite emitir/confirmar/reemplazar/retirar una clave offline de contraseña. Contraseña actual y MFA si aplica para emitir/retirar; pendiente10min, clave256bits confirmada365d/un uso, SHA-256 solamente y ligada a la credencial. Login ofrece Olvidé mi contraseña: clave guardada + nueva contraseña/confirmación + MFA si está activo. No permite omitir MFA ni crea una sesión automáticamente; éxito revoca sesiones/retos, consume clave y registra aviso interno al titular. Errores genéricos sin enumerar cuentas, coste bcrypt común, límites HTTP y contador MFA persistente; consumo concurrente transaccional. Migración097, sin inscripción automática de cuentas.

[Manual de recuperación: política, procedimiento, endpoints, pruebas y límites](RECUPERACION_DE_CUENTA.md). Método local implementado/verificado con AppModule/PostgreSQL/Angular en copia descartable; S02/S02.4 permanecen parciales por identificación/recuperación asistida aprobada y ensayada ante pérdida total, y aviso externo por canal verificado. No hay envío de correo/SMS ni API/CLI de bypass administrativo. No repetir este método offline mientras se resuelven las decisiones operativas. S03.1 ya añade auditoría de cambios de credencial mediante indicador booleano sin conservar hashes, contexto LOCAL y protección de la bitácora; no audita tablas secretas de MFA/sesiones/recuperación. S03.2 añade reglas/límites/separación configurables, permiso comercial.configurar_aprobaciones y revalidación transaccional en las rutas documentadas. [Contrato de aprobaciones](POLITICA_COMERCIAL.md#s032--matriz-y-límites-de-aprobación-19102026). S03 conserva pendientes operativos de privilegios/retención/integridad externa.

## V02 - Evidencias privadas de entrega (20/10/2026)

Permiso pedidos.entregas sólo ADMIN inicialmente, delegable S01; exige cuenta/rol/versión/permiso vigentes y revalidación dentro de escritura, también en POST de entrega anterior. Sin acceso público ni aislamiento por cliente/sucursal. Consulta/originales/PDF no-store; multipart acotado, bytes fuera de auditoría, huellas y triggers ALWAYS de conservación. Firma/ubicación declaradas, sin identidad/presencia certificadas. Sin antivirus, limpieza EXIF, retención ni evidencia externa independientes. [Contratos y límites](ENTREGAS_EVIDENCIADAS.md).

## V03.1 - Identidad externa separada (20/10/2026)

Cuenta portal_acceso vinculada a un cliente fijo, no auth_user ni rol user. Sesión opaca/cookie HttpOnly propia, invitación de un uso, CSRF/cabecera/origen/HTTPS, bloqueo persistente, revocación y alcance SQL por cliente en cada lista/detalle/resumen. Portal401 no cierra ERP; si ambas cookies existen cada API usa sólo su identidad. portal.gestionar es permiso interno ADMIN inicial/delegable con revalidación. Metadata/eventos sin secretos; no RLS, MFA/recuperación del personal no cubren estas cuentas. V03 parcial por originales/publicación y operación/piloto/TLS. [Contrato completo y límites](PORTAL_CLIENTES.md).

## V03.2 — Publicación deliberada (20/10/2026)

portal.publicar es permiso ADMIN inicial/delegable S01, separado de portal.gestionar. Revalida identidad/permisos del personal dentro de transacción; publicación/retiro idempotentes y conservados con actor/motivo. Bytes fuera de auditoría y guard ALWAYS para evitar copiarlos. Descarga por sesión externa y cliente propios con verificación del origen y SHA-256, attachment/no-store/nosniff, sin fuentes arbitrarias. Etiquetas fiscales derivadas del registro del servidor; no validación SAT. Firmas/fotos/geolocalización V02 siguen privadas. Las consultas V03.1 conservan su alcance; el permiso de archivos no sustituye verificaciones humanas. Política/retención/piloto/TLS V03.3 siguen pendientes. [Contrato](PORTAL_CLIENTES.md).

## C01.1 — Autorización de campañas sin envío (20/10/2026)

Nuevo permiso crm.campanas.gestionar, ADMIN inicial/delegable S01, separado de administrar cuentas del portal o crear borradores. SQL por cliente/contacto para registrar preferencia, huella del destino consultado, UUID/versiones, actor LOCAL y revalidación de personal con bloqueo; baja compartida por destino/canal persiste al borrar contacto. Snapshot repetible para consultas y preparación verificada/conservada; máximo1000 contactos/512KiB sin muestras silenciosas. Guardas ALWAYS e historial sin reescritura en106, sin backfill. No APIs bancarias, envíos, tokens públicos, validación automática de evidencia/identidad o aprobación de privacidad; hashes no son anonimización. [Contrato y límites operativos](CAMPANAS_CONSENTIMIENTO.md).
