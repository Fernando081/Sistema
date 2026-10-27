# Expediente de revisión de privacidad y retenciones de solicitudes web

Negocio: **Refacciones y Tractorepuestos Tampico**. Fecha documental: **10 de octubre de 2026**. Plan: **WEB05.1b/c**, preparación documental completada; aprobación y operación siguen pendientes.

## Resultado y alcance

Expediente basado en el contrato, controladores, servicios y migraciones089–091 actuales. Incluye un [borrador de aviso](plantillas/AVISO_SOLICITUDES_WEB.borrador.txt), inventario de datos, diferencias entre vencimiento y purga, decisiones a resolver y procedimiento de aceptación. No habilita formularios, cambia políticas, ejecuta purgas ni acredita aprobación del propietario. No contiene claves o datos de clientes de prueba.

El aviso se limita a consultas de refacciones de la web y su conversión comercial. No cubre automáticamente expedientes de clientes, VIN/ESN, empleados, facturación, garantías o todo el ERP. Tampoco sustituye la [aceptación del lote](WEB_ACEPTACION_LOTE.md) ni el [perfil técnico local](WEB_SOLICITUDES_CRM.md#perfil-local-y-comprobación-previa-sin-persistencia--2026-10-10).

## 1. Información confirmada y decisiones abiertas

| Elemento | Estado actual |
| --- | --- |
| Nombre comercial | Refacciones y Tractorepuestos Tampico, confirmado por propietario |
| Domicilio comercial | Calle Sor Juana Inés de la Cruz #201-A, Colonia Nuevo Progreso, C.P. 89318, Tampico, Tamaulipas |
| Correo comercial | refaccionesytractorepuestos@hotmail.com |
| Teléfono fijo / móvil | 8332261772 / 8333095845; móvil con WhatsApp normal, migración a Business prevista por propietario |
| Responsable legal | Pendiente: persona o razón social real; nombre comercial no lo determina |
| Canal para privacidad y encargado | Correo comercial es candidato, todavía sin confirmación para este uso ni persona designada |
| Dominio y proveedores de publicación | Pendientes; no hay compra autorizada ni presupuesto actual |
| Aviso, retenciones y recepción comercial | Sin aprobación operativa registrada; perfil incluido y procesos habituales cerrados |

No se requiere RFC, identificación, contraseña, CSD o secreto para completar este expediente en el repositorio. Evidencias con datos personales deben guardarse en un archivo privado apropiado, no en Git.

## 2. Marco de revisión consultado

Referencia oficial consultada el 10 de octubre de 2026: [LFPDPPP, Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), texto con última reforma indicada 14-11-2025. Arts.14–16: información sobre tratamiento y contenido/disponibilidad del aviso; art.15 contempla identidad/domicilio, datos, finalidades, limitación, derechos ARCO y comunicación de cambios. Arts.10 y24: conservación, bloqueo y cancelación; art.25: excepciones a cancelación. Arts.28–31: solicitud, persona encargada y atención de derechos.

Estos puntos orientan la revisión del borrador; no se declara cumplimiento legal ni se fija aquí un plazo general para todos los datos. Revisar el tratamiento concreto y sus obligaciones antes de aprobar el texto.

## 3. Flujo actual e inventario contrastado

```text
Visitante → POST nativo → servidor web valida → puente HMAC local
          → bandeja PostgreSQL privada
          → revisión ADMIN → oportunidad CRM + snapshot de piezas

Purga de bandeja → payload NULL
                  conserva UUID/huella/estado/vínculo/historial
                  no elimina oportunidad, snapshot o respaldo
```

| Grupo | Datos / finalidad técnica | Ubicación y acceso | Comportamiento actual |
| --- | --- | --- | --- |
| Consulta en navegador | Nombre, canal y valor, piezas/cantidades, UUID y aviso | Formulario/HTML de resultado; navegador del visitante | Sin almacenamiento local añadido ni JS cliente; reenvío conserva UUID/contenido. Historial, restauración de pestañas o capturas del navegador son externos al control de purga del servidor |
| Payload de bandeja | Contacto, piezas normalizadas, aviso aceptado/versión, origen | crm_solicitud_web.payload; API privada ADMIN | Vence90 días por predeterminado089. Listado oculta vencidos antes de limpiar; purga pone payload NULL. No amplía vencimiento por revisión/reintento |
| Metadatos de bandeja | UUID, HMAC, estados/versiones/fechas, revisor y vínculo | crm_solicitud_web; diagnóstico ADMIN sin payload/huella | Persisten después de purga para idempotencia/diagnóstico; sin plazo final ni eliminación implementados. No son automáticamente anónimos |
| Oportunidad convertida | Nombre a empresa/contacto; correo o teléfono; responsable y seguimiento | crm_oportunidad / crm_seguimiento; permisos CRM | Copia el contacto y crea nota con UUID. No hereda vencimiento/purga90 días; no presupone que ya exista cliente |
| Snapshot comercial | Piezas/cantidades, UUID, autor/fecha | crm_oportunidad_consulta_web (090); ADMIN/responsable actual | Permanece tras purga. Aplicación libre podría contener información identificable; no tratarlo como información siempre impersonal |
| Decisiones administrativas | operationId, motivo, versiones, autor/fecha, clasificación y vínculo | crm_solicitud_web_resolucion (091); ADMIN | No guarda contacto o huella, pero puede vincularse con otras tablas. Trigger impide UPDATE/DELETE ordinarios; no hay expiración o política de archivo implementada |
| Logs backend | requestId técnico, método, path, código, duración e idUser | Salida del proceso; configure-app.ts | Logger HTTP no registra body/query ni claves. Path puede incluir UUID; conservación depende del archivo/servicio que recoja la salida |
| Protección de abuso | Dirección de conexión y contadores en memoria | request-limits.mjs del servidor público | Ventanas/límites acotados; no equivale a política para logs de un futuro proxy/hosting |
| Copias y artefactos | BD completa, uploads y evidencias de aceptación | .backups/, archivos locales de .artifacts/ y salidas | backup.js crea dump custom y copia uploads; no añade cifrado ni eliminación programada. Un dump anterior puede contener datos ya purgados |
| Canales externos | Enlace que el visitante decide abrir/enviar | WhatsApp, correo y Maps; futuros proveedores | No hay envío automático del agente. Proveedores reales/ubicaciones/contratos todavía deben inventariarse; no afirmar que ningún tercero accede a datos |

Fuentes contrastadas: `public-web/lead-contract.mjs`, `lead-intake.mjs`, `lead-form.mjs`, `request-limits.mjs`; `backend/src/configure-app.ts`; servicios/controlador `crm-solicitudes-web*`; `backend/migrations/089_solicitudes_web.sql`, `090_conversion_solicitud_web.sql`, `091_resolucion_solicitudes_web.sql`; `backend/backup.js`. No se consultaron contactos de la base de trabajo para elaborar esta matriz.

## 4. Matriz de retención a decidir

Los plazos numéricos distintos del predeterminado técnico90 días quedan **por definir**. No asumir retención indefinida ni aplicar el mismo plazo a todas las tablas. Separar conservación activa, posibles restricciones/bloqueos, eliminación y copias históricas.

| ID de decisión | Ámbito | Decisión requerida | Mecanismo actual / trabajo posterior |
| --- | --- | --- | --- |
| D01 | Identidad/canal | Nombre legal, encargado y canal real de atención | Documentación por completar; no requiere migración |
| D02 | Bandeja | Confirmar o sustituir90 días; finalidad y punto inicial; frecuencia/seguimiento de limpieza | 089 fija90 días desde creación. Purga manual o cron horario minuto15, hasta1000 registros/ejecución. Cambiar predeterminado exige migración nueva y decidir registros existentes; no editar089 |
| D03 | Contacto CRM/snapshot/seguimientos | Plazo/criterio después de conversión, cierre sin venta y venta; qué se limita o elimina | No hay política específica web aplicada a esas copias. Diseñar operación transaccional y revisar relaciones comerciales antes de automatizar |
| D04 | UUID/huella/decisiones | Tiempo de idempotencia/diagnóstico, archivo y fin de conservación | Eliminar tombstone de UUID/huella permitiría que un reintento parezca nuevo. Retiro/archivo de historial exige diseño compatible con FKs y trigger091, migración nueva si procede |
| D05 | Respaldos/uploads | Número/plazo de copias, ubicación, cifrado, acceso, eliminación y tratamiento al restaurar | Script no cifra ni caduca. Política requiere mecanismo y simulacro; no borrar copias por aprobar un documento |
| D06 | Logs/evidencias | Retención y acceso de logs, screenshots y reportes; redacción y limpieza | No hay caducidad global automatizada. Capturas de pruebas no deben contener contactos reales sin necesidad/control |
| D07 | Proveedores/canales | Proveedor, ubicación, acceso, finalidad, responsabilidades y comunicaciones | No contratar ni inventar servicios. Completar cuando se seleccionen; revisar WhatsApp/correo además del hosting |
| D08 | Derechos/cambios | Procedimiento, encargado, medio de cambios y versión del aviso | Preparación manual aquí; no hay módulo ARCO ni ruta pública de aviso aprobada |
| D09 | Aceptación operativa | Configuración/secretos, limpieza, lote comercial y despliegue | Perfil y preflight implementados; aceptación técnica en copia ya existe. No confundir con aprobación real o exposición HTTPS |

Para cada decisión registrar en archivo privado: estado pendiente/aprobada/rechazada, criterio/plazo, finalidad/justificación, quién revisó, fecha, evidencia y mecanismo efectivo. Una aprobación documental con eliminación aún no implementada no cierra operación. Los IDs D01–D09 son decisiones de este expediente, no nuevas fases que sustituyan WEB05.

## 5. Tratamiento de solicitudes de privacidad: procedimiento propuesto

Este procedimiento es una propuesta manual; no se ha creado un buzón, enviado correos ni instalado un módulo ARCO.

1. Designar encargado y suplente; confirmar que pueden acceder al canal de privacidad y atenderlo. Crear un registro privado con folio, fecha de recepción, tipo de petición, medio de respuesta y estado. No anexar documentos de identidad en README o issues.
2. Acordar una verificación proporcional de identidad antes de revelar información. Pedir por el canal inicial solo lo necesario para localizar la petición; no solicitar contraseñas, secretos o documentos fiscales como rutina.
3. Localizar copias en bandeja, oportunidad/contacto, piezas, seguimientos, metadatos y respaldos. La consulta ADMIN por UUID informa estado/vínculo; no es una exportación de todos los datos de la persona. No confirmar datos de terceros por endpoints públicos.
4. Registrar finalidad vigente, obligaciones aplicables y alcance de acceso/corrección/restricción/eliminación. Revisión de cada caso antes de cambiar tablas relacionadas; no hacer borrados SQL improvisados ni desactivar trigger091 como procedimiento ordinario.
5. Como referencia para ARCO, art.31 establece20 días hábiles para comunicar determinación y15 siguientes para hacerla efectiva si procede; extensión justificada una vez según ese artículo. Registrar fechas y revisión del caso; el proyecto no calcula ni vigila estos plazos automáticamente. [Fuente oficial](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf).
6. Responder mediante el canal verificado, registrar acción/evidencia y copias pendientes de tratamiento. Revocación, limitación y cambio de finalidad requieren su propio análisis; no equiparar borrar payload con resolver toda la solicitud.
7. Si hay restauración de un dump histórico, hacerlo primero en entorno privado y restringido. Reconciliar los registros de peticiones/eliminaciones posteriores al respaldo antes de reabrir accesos; conservar esa bitácora privada fuera de la copia que se restaura. No existe reconciliación automática implementada.

## 6. Cómo revisar y convertir el borrador en texto utilizable

1. Revisar [AVISO_SOLICITUDES_WEB.borrador.txt](plantillas/AVISO_SOLICITUDES_WEB.borrador.txt). Reemplazar todos los marcadores `[[...]]` únicamente con decisiones confirmadas. El borrador permanece interno y no se copia al perfil habilitado.
2. Resolver D01–D08 y contrastar cada promesa con la matriz y el mecanismo real. Si el texto promete borrar CRM/respaldos/metadatos que el sistema aún conserva, corregir alcance o implementar y verificar antes de aprobar operación.
3. Conservar versión exacta aprobada, autor/fecha de revisión y SHA-256 de sus bytes UTF-8. No tratar el hash como firma del propietario. El perfil calcula hash del string `privacy.text`; copiar texto/cambiar finales de línea puede cambiarlo: comprobar el texto exacto que irá al perfil.
4. Perfil sigue disabled durante preparación. Solo después de revisión real rellenar campos declarativos de aviso/retención; no convertir este borrador en approved:true ni generar secretos como efecto de elaborar documentación. Revisar independientemente purga y sus controles.
5. Probar con fixtures en copia desechable; después aceptar lote/comportamiento real autorizado. Operación pública también depende de arquitectura HTTPS, dominio/proveedores y separación del ERP. La ausencia de presupuesto no se resuelve exponiendo el puerto ERP.

Registro mínimo privado para aprobación final:

| Campo | Valor por completar |
| --- | --- |
| Responsable legal, encargado y canal | Pendiente |
| Aviso/versión/hash exactos revisados | Pendiente |
| D02–D06: plazos, restricciones, limpieza y respaldos | Pendiente |
| D07: proveedores/canales y accesos | Pendiente |
| D08: procedimiento y medio de cambios | Pendiente |
| Revisión: persona/fecha/evidencia | Pendiente |
| Resultado técnico y comercial separado | Pendiente de aceptación operativa |

## 7. Comprobaciones seguras y límites de esta sesión

Con Node24, `npm run check:web-intake` debe informar closed/captureStarted=false. No leer ni imprimir secretos para comprobarlo. GET `/solicitar` y POST `/solicitudes` del preview habitual siguen503; el puente permanece deshabilitado. Los archivos de este expediente y su borrador no forman parte del catálogo/rutas públicas.

La revisión de documentación no requiere una migración o consultas a la base de trabajo. No se aplicó ninguna ni se cambió el vencimiento90 días. No se repiten todas las pruebas ERP/UI por documentos; verificaciones de cierre/rutas y consistencia del repositorio se registran en la sesión del README.

Siguiente orden de WEB05.1b/c: respuestas D01 y revisión D02–D08; implementar solo los mecanismos que resulten de esas decisiones, después aprovisionamiento y aceptación D09. No marcar WEB05 completo por producir este expediente. WEB05.2 sigue pendiente de métricas reales; IA01–IA05 sin prioridad; fiscal mock, UUID/idempotencia y exclusión bancaria conservados.

**Actualización 11/10/2026:** WEB05.2a añade [medición privada de solicitudes ya conservadas](WEB_MEDICION_CRM.md), mediante lectura READ ONLY sin datos de contacto/UUID en respuesta, eventos de visitantes, nueva persistencia o cambios a retención. No sustituye decisiones D01–D09 ni convierte fixtures en resultados comerciales. Instrumentación de visitantes y atribución a ventas siguen pendientes con sus políticas/configuración acordadas.

**WEB05.2b, 11/10/2026:** [relaciones comerciales explícitas](WEB_TRAZABILIDAD_COMERCIAL.md) mediante tabla092 e historial/auditoría existentes; conteo de documentos de venta internos con cliente/rutas comprobados. No recopila visitantes/contactos adicionales ni decide retenciones. Captura, instrumentación pública e importes/cobros/netos conservan aprobación/configuración pendientes; el conteo local no certifica resultados comerciales reales o legalidad de retenciones.
