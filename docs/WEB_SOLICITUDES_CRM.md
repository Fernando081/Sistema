# Solicitudes públicas y CRM — WEB05.1

## Estado actual — 2026-10-12

WEB05.1 sigue parcial y la captura habitual permanece cerrada. Existen contrato, formulario multipieza mixto, puente local firmado, bandeja ADMIN, revisión/asignación/conversión y snapshot privado de piezas. La confirmación del receptor ya tiene un plazo máximo configurado de cinco segundos; se prueba el recorrido POST nativo → puente firmado → almacenamiento PostgreSQL aislado, incluido un commit cuyo recibo vence y sus reintentos. Las secciones fechadas siguientes conservan el historial de implementación y sus límites en cada sesión.

El diagnóstico administrativo permite comprobar por UUID si hay registro vigente, vencido o purgado y si existe oportunidad vinculada, sin devolver payload o huella. Decisión conservadora ADMIN con motivo y confirmación explícita, original conservado e historial idempotente (091). Rotación técnica de firma v2 implementada: ID autenticado, huella estable independiente, anterior con intervalo máximo24 horas y estado privado sin secretos. Perfil local explícito y comprobación firmada de ambas claves/aviso implementados antes del arranque, sin persistencia; permanecen cerrados por defecto. Aceptación con Angular producción, AppModule, autenticación global y login PostgreSQL real verificada en copia desechable. Pendientes operativos: aviso real y retenciones aprobadas (incluidos CRM/respaldos), aprovisionamiento de secretos, activación autorizada y aceptación final. Las pruebas aisladas no habilitan ni certifican captación comercial pública.

Desde 11/10/2026, **WEB05.2a** añade el panel ADMIN **Medición de solicitudes**: cohorte por fechas de recepción, solicitudes/opportunidades/conversión, estados, días y ranking de referencias con cobertura explícita. Consulta sólo registros existentes en READ ONLY y omite contactos/UUID; no añade seguimiento/captación o retenciones. Vacío con conversión indefinida; Ganada en CRM no equivale a venta. Pendientes vistas/búsquedas/clics/atribución a ventas. Contrato y pruebas: [WEB_MEDICION_CRM.md](WEB_MEDICION_CRM.md).

WEB05.2b implementa [vínculos comerciales explícitos](WEB_TRAZABILIDAD_COMERCIAL.md): cliente ERP/cotización en la ficha y conteo de documentos internos por cotización/pedido. Cliente común, acceso ADMIN/responsable, versiones/idempotencia y auditoría (092); cancelados/inconsistentes/NC excluidos del conteo de ventas. WEB05.2c añade [importes, cobros y venta neta por moneda](WEB_MEDICION_FINANCIERA.md), sin duplicar REP/globales y con «Por conciliar» cuando corresponde. No activa captación ni acepta contenido/privacidad comercial; navegación, ventas sin vínculo y flujo neto siguen fuera de medición.

WEB05.2d agrega [rentabilidad atribuible](WEB_RENTABILIDAD_CRM.md) con costo original congelado, cantidades netas y comparabilidad local MXN/factor1. Costos/ajustes/moneda no comprobables conservan utilidad/margen desconocidos. WEB05.2e añade [cobros netos y reembolsos](WEB_COBROS_NETOS_CRM.md) con gastos explícitos, saldo a favor separado y desconocidos visibles. Flujo integral y normalización de otros casos monetarios siguen pendientes; no afecta privacidad, captura o prioridad de IA.

## WEB05.1a: contrato interno (2026-10-07)

Implementado `public-web/lead-contract.mjs`, módulo independiente sin endpoint HTTP, almacenamiento, búsqueda de clientes ni transmisión externa. No modifica el funcionamiento de `/consulta` o `/cotizar`. Revisados CRM_OPERATIVO, controlador/DTO y creación de oportunidades: existen oportunidades y comunicaciones autenticadas; este contrato prepara el puente sin duplicar esas capacidades.

Entrada estricta: schemaVersion 1, requestId UUID v4, contact, items y privacy. Contacto mínimo: nombre, canal email/phone/whatsapp y un único valor; teléfono internacional con + y 8–15 dígitos. Correo ASCII: dominio normalizado a minúsculas, parte local preservada. No verifica propiedad ni entrega del contacto. Sin cliente interno, responsable, precio, stock, VIN/ESN o importe aportados por el visitante.

De una a diez piezas, cantidad entera 1–9999. Pieza `catalog`: solo kind/slug/quantity; código y marca derivados del catálogo validado vigente. Rechaza piezas no publicadas, retiradas o no aprobadas. Pieza `reference`: kind/code/brand/application/quantity; conserva la referencia indicada y campos opcionales vacíos, sin afirmar equivalencia o existencia. Rechaza duplicados en lugar de sumar silenciosamente. Texto acotado, sin controles; campos desconocidos rechazados. El transporte futuro debe limitar bytes antes de interpretar JSON y escapar al presentar texto.

Privacy requiere accepted exactamente true y version igual a la versión aprobada indicada por servidor. No existe aviso real aprobado en este bloque; no se activa recopilación pública ni se presume que este indicador por sí solo cubra las obligaciones de privacidad. Las pruebas utilizan una versión fixture aislada.

`leadFingerprint` valida y calcula HMAC-SHA256 del contenido normalizado, excluyendo requestId, con clave Buffer de al menos 32 bytes suministrada por el operador. No hay clave operativa creada ni registrada en documentos. Mismo ID y misma huella permitirán reconocer reintentos; mismo ID y contenido diferente deberán producir conflicto en almacenamiento. Huella sola no implementa unicidad, deduplicación entre visitantes, cifrado ni retención. No usar como identidad pública ni registrar payload/contactos en logs.

## Siguiente orden

1. **WEB05.1b:** bandeja privada persistente, restricción única y transacción para requestId/huella; estados, retención y acceso por roles; respaldos y migración nueva después de db:check/respaldo. Recepción POST con límite de cuerpo/frecuencia, validación de origen, respuesta genérica sin revelar contactos existentes; aviso real y versión aprobados antes de activar captura. No guardar contactos en query strings. No conectar directamente el navegador público a rutas administrativas ERP.
2. **WEB05.1c:** UI privada para revisar/asignar y convertir una solicitud en oportunidad existente, conservando piezas/cantidades/origen y auditoría; transición idempotente para evitar oportunidades duplicadas. No crear automáticamente cliente ni asumir venta por clic WhatsApp. Probar concurrencia y autorización en BD aislada.
3. **WEB05.2:** medir consulta recibida y conversión realmente vinculada; separar los clics de solicitudes/ventas.

WEB05.1a permanece como módulo interno sin recepción pública.

## WEB05.1b: almacenamiento privado (2026-10-07, parcial)

Migración 089 crea `crm_solicitud_web`. Request ID único, huella HMAC, payload JSONB, estado/versiones, autor de revisión y vencimiento técnico inicial a 90 días. Este plazo es un valor técnico de desarrollo, no una política legal/comercial aprobada. No cambiar migraciones aplicadas; ajustes posteriores mediante nueva migración.

Servicio interno `CrmSolicitudesWebService.receive` acepta únicamente entradas previamente validadas por WEB05.1a y huella calculada por componente confiable. No es endpoint ni verifica HMAC por sí mismo. Inserción ON CONFLICT en transacción; reintento con igual huella conserva un registro, contenido distinto produce conflicto; reintento de registro purgado no restaura contactos. Clave debe conservarse estable para reintentos; rotación y ventanas de deduplicación pendientes antes de habilitar recepción.

Rutas privadas bajo JWT global y rol ADMIN:

- GET `/api/v1/crm/solicitudes-web?page=1&limit=25`: lista paginada, sin payloads vencidos.
- PATCH `/api/v1/crm/solicitudes-web/:uuid`: estado Revisada/Descartada y expectedVersion; guarda autor y aumenta versión; modificación desactualizada rechazada.
- POST `/api/v1/crm/solicitudes-web/purgar-vencidas`: elimina payloads vencidos y devuelve cantidad; conserva UUID/huella/estado para reintentos. Purga manual, sin cron añadido. Los respaldos históricos requieren su propia retención; esta operación no borra copias antiguas ni protege frente a operadores con acceso directo a BD.

No hay ingreso público, UI de bandeja o conversión a oportunidad aún. No se recopilaron contactos operativos. El backend compilado incorpora las rutas; un proceso previo requiere reinicio para cargarlas. WEB05.1b sigue parcial por puente, protección de transporte, aviso aprobado, automatización/retención y pruebas completas de JWT. No exponer ERP al público.

Actualización 2026-10-08 WEB05.1c: ya existe UI privada en **CRM > Solicitudes web**, visible a administradores, cargada al abrir la pestaña. Lista páginas de 25, muestra contacto/piezas/cantidades, estados de carga/error/vacío y revisión/descartar con expectedVersion. No realiza enlaces de envío ni crea oportunidades; conversión/asignación siguen pendientes. Contactos se muestran solo en memoria de página, sin almacenamiento local añadido. Backend continúa siendo autoridad de permisos. Paginación sin total: una página exactamente llena puede permitir avanzar a la siguiente vacía. Revisión fallida exige actualizar antes de reintentar.

Verificación reproducible: build backend y `npm run test:web-inbox-db`. Usa esquema aleatorio propio sin search_path public, tablas/usuario fixture y servicio real; prueba concurrencia, conflicto, revisión simultánea, vencimiento, purga y reintento después de purga. Elimina únicamente su esquema verificado. No usa clientes o solicitudes reales. Prueba HTTP de roles usa identidad simulada aislada y RolesGuard real; no certifica login JWT operativo.

## WEB05.1c — conversión a oportunidad (2026-10-08)

Migración 090 añade vínculo único de solicitud a oportunidad y tabla `crm_oportunidad_consulta_web` con piezas/cantidades JSONB, request ID, autor y fecha. POST privado ADMIN `/api/v1/crm/solicitudes-web/:uuid/convertir`, cuerpo expectedVersion. Bloquea solicitud en transacción, verifica vigencia/estado/version/responsable activo, crea Prospecto sin cliente fiscal, snapshot y seguimiento Nota, y enlaza solicitud como Revisada. Reintento devuelve la oportunidad vinculada incluso tras purgar payload; no crea otra ni modifica responsable. Solicitud descartada, vencida, sin payload o versión obsoleta no genera oportunidad. Conversión ya vinculada no se puede descartar mediante revisión genérica.

UI: **Crear oportunidad a mi cargo**, exclusivamente para ADMIN. Responsable es administrador autenticado; selección de otro vendedor pendiente. Empresa/contacto toma nombre indicado, email/teléfono del canal elegido; monto inicial 0 es estimación sin valor calculado, no precio de las piezas. Correo mayor de 150 caracteres requiere revisión manual: se rechaza conversión en lugar de truncar al límite del CRM. No confirma compatibilidad, precio, existencia, pedido o venta; no envía mensajes ni crea cliente. Link busca por nombre en CRM, mostrando ID de oportunidad en bandeja; nombres repetidos pueden devolver varias oportunidades.

Datos convertidos pertenecen al historial comercial del CRM: purga de payload de bandeja no elimina contacto de oportunidad, seguimiento ni snapshot de piezas. Definir su retención junto con política CRM/respaldos antes de activar captura pública. Snapshot se conserva en BD; vista detallada desde ficha de oportunidad pendiente. Recepción pública y aviso aprobado siguen pendientes, sin contactos operativos nuevos.

Prueba PostgreSQL aislada ampliada: simultaneidad produce una oportunidad/seguimiento/snapshot, versiones/autor inválidos no crean registros y reintento tras purga conserva vínculo. UI y roles se prueban con API/identidad simuladas; no certifican recorrido completo de login/recepción real.

### WEB05.1c — selección de responsable (2026-10-08)

La bandeja permite elegir usuario activo de `/auth/users` o conservar **A mi cargo**. El selector aplica a nuevas conversiones; no reasigna oportunidades existentes. Ante fallo del equipo muestra aviso/reintento y conserva creación a cargo del administrador. POST convertir acepta idResponsable opcional entero positivo; sin él mantiene administrador actual. Backend vuelve a comprobar is_active, no confía en opciones del navegador. Autor de snapshot/seguimiento y revisor siguen siendo administrador autenticado; id_responsable de oportunidad es usuario elegido. Reintento devuelve vínculo existente sin cambiar asignación, aunque envíe otro responsable.

No añade rol vendedor nuevo: reutiliza usuarios activos ADMIN/user actuales. La función no cambia permisos de consulta del CRM ni incorpora notificaciones o mensajes al vendedor. Administración posterior de responsables continúa bajo los flujos existentes del CRM. Sin migración nueva: reutiliza 090 y auth_user. Pendiente vista del snapshot en ficha y recepción pública protegida/aviso real.

### WEB05.1c — piezas en ficha (2026-10-08)

GET autenticado `/api/v1/crm/oportunidades/:id/consulta-web` devuelve snapshot de piezas/request ID/fecha únicamente para ADMIN o responsable actual. Usuario ajeno o ID inexistente reciben mismo 404. Oportunidad autorizada sin origen web devuelve null. No devuelve contactos ni clave/huella de bandeja. Usa tablas de 090, sin migración.

Al abrir ficha de oportunidad existente se carga panel Consulta web original con código/marca/cantidad/aplicación, texto explícito de falta de confirmación comercial y error/reintento independientes de edición CRM. Referencias siguen siendo las conservadas al convertir; no se recalculan desde catálogo actual. No añade edición de snapshot. La retención del historial comercial continúa pendiente de política; purga de bandeja no borra este snapshot. Recepción pública sigue desactivada.

### WEB05.1b — mantenimiento programable (2026-10-08)

Nuevo proveedor Cron cada hora al minuto 15, habilitado únicamente si `WEB_INBOX_PURGE_ENABLED=true` al iniciar backend. Por defecto desactivado; no se activó en operación. Tras confirmar política/retención se puede configurar y reiniciar backend. No modifica el plazo técnico de 90 días ni avala una política legal.

Purga manual y programada procesan como máximo 1000 payloads vencidos por ejecución, en orden de vencimiento. SELECT FOR UPDATE SKIP LOCKED evita disputar filas tomadas por otro proceso/conversión. No carga contactos en memoria; conserva identificador/huella/estado y datos comerciales convertidos. Si quedan más filas, siguiente lote manual o siguiente hora las procesa. Sin límite temporal garantizado para el total; filas bloqueadas se difieren. No borra respaldos o snapshots comerciales.

GET ADMIN `/api/v1/crm/solicitudes-web/mantenimiento`: habilitado, en ejecución, última finalización/resultado/cantidad y alcance. Estado en memoria, reinicio lo pierde; no consolida otros servidores ni purgas manuales. Registro de fallo genérico, sin excepción/contactos. Guardia local impide solapamiento; varios procesos usan bloqueo SQL por fila, sin líder distribuido. No ejecuta una purga durante el arranque ni ofrece activación por navegador. La programación requiere backend activo; no es una automatización del escritorio Codex.

Pruebas: desactivación, solapamiento, fallo y recuperación; PostgreSQL aislado de 1001 payloads, lote 1000 + 1 + 0. Sin migración/activación ni cambios visuales. Políticas, respaldo/retención histórica y observabilidad persistente siguen pendientes.

### WEB05.1b — recepción HTTP cerrada por defecto (2026-10-08)

POST `/solicitudes` implementado en servidor preview. Sin configuración explícita del servidor devuelve 503 JSON received:false; CLI normal no ofrece interruptor para habilitarlo. No se activó ni se añadió formulario de datos personales. Opciones internas de createPreviewServer permiten probar un receptor aislado con privacyApproved/version/origin/key/receive; no deben recibir configuración desde el navegador.

Controles: cuota por conexión compartida con búsqueda/consulta, origen exacto y rechazo Sec-Fetch-Site cross-site, JSON UTF-8 únicamente sin compresión, máximo 16 KiB antes de validar, plazo de lectura cinco segundos, contrato WEB05.1a y aceptación de la versión de privacidad. Catálogo tomado del snapshot de versión activa del servidor, no del visitante. HMAC calculado internamente, clave privada al menos32 bytes. Respuesta sin contacto, UUID de cliente o detalle de excepción; sin CORS ni consulta de clientes existentes. Errores de origen403, formato415, tamaño413, entrada400, lectura408 y configuración/almacenamiento503; éxito202 received:true solo después de resolver callback.

Callback recibe contrato validado/huella; adaptador persistente/puente autenticado aún pendiente. No usar éxito de fixture como prueba de integración ERP. El callback de almacenamiento no tiene deadline en este bloque; antes de operación debe definir timeout/idempotencia y reconciliación de fallos inciertos. Origen/HTTP no prueba humano: cuotas no sustituyen protección antiabuso de hosting. Noindex/loopback permanecen. Nunca habilitar captura solo cambiando privacyApproved: se requiere aviso real aprobado y su versión, retención y adaptador revisados.

Prueba HTTP aislada verifica bloqueo por defecto, origen/MIME/tamaño/JSON/aceptación antes de llamar receptor, confirmación después de recepción y respuesta genérica ante excepción privada. Solo contactos fixture en memoria del test; sin BD operativa/migración ni envío externo.

### WEB05.1b — puente local firmado (2026-10-09)

Implementados cliente `public-web/lead-bridge.mjs` y POST backend `/api/v1/web-lead-bridge`. Endpoint de servicio excluido del JWT mediante Public, pero exige su propia autenticación HMAC/configuración; no permite listar/consultar/modificar clientes ni usar credenciales de administrador. Solo origen de conexión loopback. No habilitar este endpoint como ruta administrativa abierta.

Backend cerrado por defecto: `WEB_LEAD_BRIDGE_ENABLED=false`, clave base64 privada al menos32 bytes y versión de privacidad vacías en env.example. No se generó clave operativa ni se activó configuración. Para integración futura, operador debe proporcionar clave estable de propósito exclusivo y misma versión/clave al receptor público; callback se construye con createLeadBridge. No hay cableado automático del CLI ni formulario público activado; aviso y retención requieren aprobación real.

Firma HMAC-SHA256 sobre dominio web-lead-v1, timestamp y JSON del sobre lead/fingerprint. Ventana60 segundos, comparación de tiempo constante y recomputación de huella del contenido. Valida forma/contacto/piezas/versiones y tamaño16KiB antes de guardar mediante receive transaccional. Snapshot del sitio firmado se confía como publicación autorizada por el componente emisor; backend no vuelve a consultar aprobaciones comerciales ERP. Compromiso de clave/emisor permite inyectar solicitudes; segregación/rotación y administración de secretos pendientes de operación.

Cliente permite únicamente HTTP loopback127.0.0.1, ruta fija, rechaza redirects, limita respuesta4KiB y plazo5s. Confirma received y mismo request ID; no reintenta automáticamente. Si vence plazo después de commit, resultado es incierto: no indicar recibido, repetir misma solicitud/UUID/contenido para obtener recibo sin duplicar. No cancelar garantiza rollback: backend puede finalizar después del timeout. Reconciliación administrativa y métricas persistentes siguen pendientes; nunca generar UUID nuevo para resolver un fallo incierto.

Prueba integra cliente firmado, controlador Nest HTTP y servicio PostgreSQL real en esquema aislado: cerrado, ausencia/firma inválida, timestamp vencido, huella inválida y simultaneidad con un solo registro. No usa datos operativos ni habilita configuración del proceso ERP real. El test no prueba guards globales/login operativo completo ni recepción comercial pública. Sin migración ni conexiones bancarias/hosting/gastos.

### WEB05.1b — formulario nativo condicionado (2026-10-09)

GET `/solicitar` muestra formulario únicamente con opciones internas de recepción/clave/versión y texto de privacidad aprobado no vacío (máximo10000 caracteres). De lo contrario503; no aparece en navegación normal ni activa el CLI. El texto no se inventó: pruebas usan aviso fixture identificado como no operativo. No se habilitó el formulario real.

Formulario sin JavaScript, POST application/x-www-form-urlencoded a `/solicitudes`: nombre, canal, contacto, referencia indicada/marca/aplicación/cantidad y checkbox obligatorio sin preselección. Esta primera versión recibe una sola referencia libre, sin afirmar producto aprobado. Lista multipieza existente por WhatsApp/correo permanece independiente. No pide RFC/VIN/ESN ni envía mensajes externos. Contacto no viaja en URL/query/localStorage. Decodificación UTF8, mismo límite16KiB y controles de origen/cuota; campos repetidos/desconocidos rechazados y contrato validado antes de callback.

HTML202 solo tras recepción confirmada; errores muestran aviso sin afirmar recibido y conservan campos acotados/escapados y requestId válido para reintento. Campos ambiguos/ininterpretables pueden descartarse. UUID oculto técnico no es token de autenticación. Recarga POST mantiene mismo identificador; backend debe conservar idempotencia. Si cambia contenido de un envío incierto, no debe reutilizarse como nueva consulta sin reconciliar el anterior. Plazos del adaptador firmado/estado incierto siguen aplicando.

Solo las pantallas activadas del formulario/respuesta usan Referrer-Policy same-origin para conservar Origin en POST nativo; no se acepta Origin null. URLs del flujo no llevan contactos y no envían referrer a terceros. Otras páginas conservan no-referrer. CSP permanece sin JavaScript/inline styles, presupuesto HTML+CSS aplicado también al formulario/respuesta. Header de aviso de preview identificado como región accesible.

Prueba navegador móvil sin JavaScript envía por POST al receptor real aislado, confirma tras callback fixture y revisa accesibilidad/overflow; captura .artifacts/public-lead-form-mobile.png muestra contenido fixture. Prueba HTTP comprueba cierre, preservación de contacto/UUID ante error y rechazo de cantidad inválida sin persistir. No acredita formulario operativo conectado con ERP/aviso real. Sin migraciones ni contactos operativos almacenados.
### WEB05.1b — referencias múltiples en formulario nativo (2026-10-09)

El formulario condicionado ahora admite entre una y diez referencias libres en una solicitud. La primera pieza es obligatoria; nueve apartados opcionales desplegables permiten añadir referencias, marca, aplicación y cantidad sin JavaScript. Etiquetas únicas y fieldset/legend identifican cada pieza; el control nativo details se abre con teclado. Cantidad vacía en una referencia adicional equivale a1, indicado en pantalla. Para retirar una pieza adicional, vaciar sus cuatro campos; cerrar su apartado no la elimina.

Los campos se envían por POST, incluso los de apartados cerrados. Solo filas completamente vacías se omiten; una marca/aplicación/cantidad sin número de parte causa400, nunca desaparece silenciosamente. Se rechazan campos fuera de las diez posiciones, repetidos o desconocidos, cantidades fuera de1–9999/no enteras y referencias duplicadas según identidad normalizada del contrato. Se conservan referencia/marca/aplicación/cantidad y UUID ante error interpretable, escapados y acotados; cantidades inválidas0/10000 se conservan sin sustituir por1 ni truncar a1000 al mostrarlas.

Los huecos vacíos se compactan al conservar una respuesta: una pieza capturada en posición10 puede reaparecer como pieza2, conservando contenido y orden relativo. El contrato JSON del receptor/puente y la persistencia CRM no cambiaron; la misma solicitud lleva su lista completa. El UUID corresponde al conjunto de piezas/contacto: tras envío incierto, no modificar contenido al reintentar sin reconciliar antes el resultado anterior. Las confirmaciones siguen condicionadas al callback satisfactorio.

Esta ampliación recibe referencias indicadas, no certifica fichas, precio, compatibilidad o existencia. Selección desde catálogo autorizado pendiente; la lista preparada por WhatsApp/correo sigue siendo independiente. Activación habitual permanece deshabilitada y requiere aviso/retención reales y configuración operativa. Sin migraciones, claves ni contactos operativos. Pruebas usan fixture en memoria; no certifican recorrido integral formulario/ERP real.

Verificación de esta ampliación:67 pruebas Node y30 Playwright aprobadas; pruebas HTTP con diez referencias/rechazo previo al receptor, preservación de0/10000, escape y UUID, navegador sin JavaScript en390/1440px con fallo/reintento/recibo, teclado native details y axe sin infracciones. Capturas revisadas en .artifacts/public-lead-form-mobile.png y public-lead-form-desktop.png; notice no se estira a la altura del formulario en escritorio. Formulario con aviso fixture28141bytes HTML+CSS (límite50000), gzip6481/Brotli5202 (límite15000); contenido real requiere nueva comprobación. Preview habitual sigue cerrado y29 controles HTTP aprobados. Sin validación de contactos comerciales reales.

### WEB05.1b — selección autorizada desde catálogo (2026-10-09)

Recorrido condicionado: ficha → consulta /cotizar → Continuar al formulario de solicitud → POST /solicitudes. El nuevo enlace solo aparece cuando recepción y aviso están configurados internamente; no se habilitó en el CLI ni en operación. GET /solicitar admite únicamente producto/cantidad/piezas, sin contactos, campos repetidos o desconocidos. Comparte cuota por conexión y límite de URL8192bytes. Cantidades y ambigüedades se validan antes de renderizar; fichas inexistentes/retiradas/no aprobadas devuelven404, selección inválida400, almacenamiento/snapshot no disponible503.

La selección usa la lista multipieza existente (hasta diez fichas): referencias repetidas en /cotizar acumulan cantidades, máximo9999 por ficha. Solo resuelve fichas del snapshot publicado/aprobado; no consulta clientes, costos ni API administrativa. Muestra número/marca de solo lectura derivados del snapshot y manda únicamente slug/cantidad. POST no acepta code/brand/application junto al slug, ni confía en identidad indicada por el navegador. Receptor deriva nuevamente identidad autorizada desde el snapshot vigente.

Se pueden combinar fichas seleccionadas y referencias libres en los espacios restantes, hasta diez piezas en total; estas últimas siguen siendo referencias indicadas, sin declarar equivalencia o compatibilidad. Antes de ingresar contacto, modificar la selección usando la consulta existente; el formulario no añade un buscador de catálogo ni eliminación de fichas seleccionadas. Cantidades sí se pueden ajustar antes del envío. No elimina contactos al navegar automáticamente; volver a catálogo/consulta es decisión del visitante.

Fallo interpretable conserva slugs, referencias libres, cantidades, contacto y UUID; fichas siguen mostrándose desde snapshot autorizado. Si una ficha se retira entre apertura y envío, no se convierte silenciosamente en referencia libre: POST400 y aviso de ficha no disponible; no se llama al receptor. Un cambio de catálogo tras un resultado incierto puede cambiar la huella de reintento: reconciliación administrativa y revisión de ese caso siguen pendientes. No prometer idempotencia entre versiones comerciales distintas.

Abrir /cotizar o continuar al formulario no registra una solicitud; confirmación solo después de POST aceptado por receptor. Los mensajes de la consulta distinguen preparación de WhatsApp/correo de recepción persistente. GET con parámetros no preselecciona consentimiento ni crea un registro. Respuestas y formulario conservan noindex, cuerpo POST sin contacto en URL y presupuestos vigentes. Pruebas usan fichas/contactos fixture en carpeta temporal y memoria; no aprueban productos reales ni capturan contactos operativos.

Sin migraciones: reutiliza contrato WEB05.1a, receptor, puente y tablas089/090. Captura habitual sigue cerrada por aviso/retención y configuración operativa pendientes. No requiere dominio, hosting, gastos o conexiones bancarias.

Validación de esta sesión:71 Node/32 Playwright aprobadas; pruebas HTTP reales aisladas de selección y catálogo retirado antes de POST, y recorrido nativo mixto con fallo/reintento en390/1440px. Axe sin infracciones/overflow y capturas revisadas. Formulario con dos fichas y aviso fixture28356bytes HTML+CSS, gzip6680/Brotli5400, dentro de50000/15000; no es medición de aviso real ni catálogo comercial operativo. Sin modificación de servicios/migraciones ERP ni repetición de sus suites.

### WEB05.1b — confirmación acotada y reintento tras commit (2026-10-10)

`receiveLeadHttp` limita la espera del callback de recepción a **5000 ms por defecto**, después de leer y validar la entrada. `storageTimeoutMs` es una opción interna de servidor, entero entre1 y5000; valores nulos, no numéricos o fuera del intervalo bloquean el POST503 antes de llamar al receptor. El visitante no puede ajustar ese límite: el contrato rechaza campos adicionales. El plazo de lectura del cuerpo sigue siendo independiente (5000 ms); no es un límite total de cinco segundos para toda la solicitud.

El temporizador se libera al terminar la espera. Un callback pendiente produce503/received:false, que significa **recepción sin confirmar**, sin asegurar que no se guardó. El formulario conserva contacto, piezas/cantidades y UUID, y muestra: “El envío pudo haber quedado registrado. Reintenta esta misma solicitud sin cambiar las piezas ni el contacto.” No genera otro UUID ni reintenta automáticamente. Solo una confirmación dentro del plazo produce202/recibo; una resolución o rechazo tardíos no cambian la respuesta enviada ni dejan un rechazo sin manejar.

El plazo no cancela ni revierte una transacción: el receptor puede terminar después. Su propia protección de conexiones/SQL y la reconciliación operativa siguen siendo necesarias; el temporizador depende del event loop y no certifica un SLA. Reintentar con mismo UUID y contenido normalizado/clave estables recupera el recibo del registro existente. Cambiar piezas, contacto, catálogo o clave puede producir conflicto: no asumir que el plazo autoriza una nueva consulta o altera el registro anterior.

`npm run test:web-inbox-db` amplía la prueba existente: genera catálogo/contactos fixture en carpeta temporal, levanta preview y controlador Nest locales, POST nativo mixto con dos fichas y referencia libre, puente firmado y servicio PostgreSQL real en su esquema aleatorio sin search_path public. Se confirma commit antes de vencer el recibo; HTTP503 conserva captura, dos reintentos HTTP202 dejan un solo registro, contenido cambiado no modifica el payload y conversión concurrente conserva una sola oportunidad/snapshot de las tres piezas. Se liberan callback tardío, servidores, carpeta y esquema propios al finalizar. No aprueba fichas comerciales ni habilita configuración del proceso ERP operativo.

Validación Node24:73/73 pruebas Node web y32/32 Playwright aprobadas. Los dos recorridos de formulario en390/1440px ahora ejercitan timeout real del callback sin JavaScript, conservación y reintento; Axe y reflujo siguen aprobados. La prueba aislada PostgreSQL/puente/conversión y build backend pasan. No verifica login/guards globales operativos, políticas legales, configuración comercial o lanzamiento. Sin nuevas migraciones;089/090 se recrean únicamente en el esquema de prueba, sin modificar ni migrar tablas operativas.

### WEB05.1b — diagnóstico administrativo de recepción (2026-10-10)

GET privado ADMIN `/api/v1/crm/solicitudes-web/:uuid/estado` valida UUIDv4 y devuelve únicamente requestId, estado comercial, versión, fechas de registro/vencimiento, idOportunidad y contenido (`Vigente`, `Vencido` o `Purgado`). Consulta parametrizada por clave primaria; una sola lectura clasifica usando la hora de la sentencia PostgreSQL. Payload nulo significa Purgado; payload todavía almacenado pero vencido significa Vencido; en otro caso Vigente. No devuelve nombre, canal, contacto, piezas, huella ni clave. Respuesta de éxito con Cache-Control no-store. UUID inexistente404, inválido400, usuario sin rol ADMIN403; la ruta hereda autenticación JWT global y no es Public.

En **CRM → Solicitudes web → Comprobar recepción**, el administrador introduce el identificador original y consulta. Se muestran fechas/estado/vínculo sin modificar la solicitud. El identificador también puede desplegarse en cada registro de la bandeja. Este diagnóstico no añade consulta para visitantes ni hace visibles UUID de seguimiento en recibos públicos; el requestId del formulario condicionado sigue siendo un campo técnico oculto. No buscar por teléfono/correo ni persistir la consulta en URL/localStorage.

UUID inválido se rechaza en pantalla antes de HTTP. Durante la consulta se deshabilitan sus controles y se indica carga; espera de red limitada a10 segundos, sin reintento automático. Ante404 se explica que puede haber un envío en curso: ausencia en una lectura no prueba ausencia definitiva. El error conserva el identificador para consultar de nuevo. Cambiarlo o limpiar la consulta elimina el resultado anterior. Estados y errores del panel independientes de carga/revisión/conversión/paginación de la bandeja.

Vencidos/purgados no recuperan datos personales ni piezas; un vínculo convertido permanece visible como ID, aunque ya no haya payload. El historial de la oportunidad conserva su política CRM existente. No cambia estado, restaura datos, reasigna responsable ni crea otra oportunidad. Registro encontrado no confirma igualdad con un envío modificado: las diferencias de contenido/catálogo/clave necesitan revisión manual y política de resolución. La herramienta reduce la incertidumbre sobre persistencia, sin cerrar toda la reconciliación operativa.

Corregido contraste del botón durante su animación en modo claro. El panel usa colores del tema y mantiene etiquetas, teclado y reflujo. Opción HttpContext LOCAL_ERROR_FEEDBACK permite presentar errores HTTP de esta consulta junto al campo sin repetir un aviso global; por defecto otros flujos conservan avisos. Respuestas401 siempre mantienen cierre de sesión y navegación a login.

Pruebas Node24: build backend e integración PostgreSQL aislada aprobados, incluidos commit sin recibo consultable, registros vigentes/vencidos/purgados, ausencia de payload/huella y vínculo después de purga. Tres suites backend de controlador/mantenimiento/composición:6/6 pruebas aprobadas (RolesGuard real con identidad simulada). Frontend:3/3 pruebas del interceptor y6/6 Playwright de bandeja/diagnóstico/ficha/conversión; UI con API/login simulados, claro1280px y oscuro390px, Axe sin infracciones/reflujo y capturas .artifacts/web-receipt-light.png y web-receipt-dark.png. Build producción frontend aprobado:476.18kB inicial frente a500kB de advertencia. No se certifica login ADMIN operativo o recorrido autenticado completo. Sin nuevas migraciones ni activación de captura/retención.

### WEB05.1b/c — aceptación autenticada local (2026-10-10)

El nuevo verificador cierra el pendiente de login y guards reales para este recorrido local. Las pruebas anteriores conservan su alcance simulado; esta prueba usa AppModule completo, configureApp y PostgreSQL restaurado en base propia desechable. No aplica migraciones ni crea cuentas/solicitudes en la base de trabajo y no activa el preview habitual.

Desde raíz, con Node24, PostgreSQL disponible, permisos para crear/eliminar una base, herramientas PostgreSQL y Chromium de Playwright instalado:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-inbox-auth -- --backup=.backups/FECHA/database.dump
```

El comando compila backend y Angular producción antes de probar. Exige archivo de respaldo resuelto dentro de .backups, lee índice pg_restore y restaura con --exit-on-error; corre db:check antes de db:migrate en esa copia. Desactiva cuentas copiadas y vacía la bandeja/snapshots copiados solamente en la base desechable; prepara tres identidades con contraseña y claves aleatorias en memoria. AppModule se conecta a esa copia verificada, cron detenido y fiscal mock. Servidores loopback con puertos dinámicos y proxy de Angular: no necesitan alterar 3100/4300/4500 ni compartir sesiones operativas.

Cobertura aprobada:

- Login HTTP y navegador contra auth_user, JWT firmado y guards globales sin sustituciones. Seis rutas administrativas rechazan anónimo401/operador403; token alterado401 y UUID inválido400. La cadena PermissionsGuard permanece instalada; estas rutas no declaran permisos granulares adicionales a ADMIN.
- Formulario sin JavaScript con dos fichas fixture y referencia libre → puente firmado → PostgreSQL. Confirmación retenida después del commit causa503; formulario conserva datos/UUID. Diagnóstico real ADMIN confirma persistencia con proyección mínima/no-store. Reintentos concurrentes202 y conflicto503 no duplican ni sobrescriben solicitud.
- Navegador Angular producción claro1280px/oscuro390px: login, bandeja/diagnóstico, conversión asignada, enlace de búsqueda y snapshot en ficha. Axe de bandeja y reflujo aprobados. No se inyectan JWT ni se simulan respuestas API; bloqueo de orígenes externos y service worker desactivado solo en prueba.
- Conversión y reintentos HTTP dejan una oportunidad/snapshot/seguimiento, con autor/responsable correctos. Responsable lee snapshot, ajeno404 y anónimo401. Vencimiento/purga ocultan payload conservando vínculo/snapshot del CRM. Logout y desactivación invalidan JWT en nuevas peticiones.

Reporte sanitizado de última ejecución: `.artifacts/web-inbox-auth-acceptance.json`, con tiempos, etapas, dos recorridos, cierre de recursos y comprobación de eliminación de copia. Sin contraseñas, JWT, HMAC, payloads, contactos o conexión en el reporte; sin trazas de navegador que guarden credenciales. Restauración fallida devuelve error; no usar un reporte antiguo como evidencia de un comando fallido.

Sin nuevas migraciones en ese bloque de aceptación. Validación local con datos de demostración y aviso/catálogo fixture; no certifica texto legal, catálogo comercial, hosting, PWA, carga prolongada o todos los flujos ERP. Captura y mantenimiento operativos siguen cerrados. La siguiente sección registra la implementación posterior de resolución conservadora; aceptación en entorno final permanece pendiente.

### WEB05.1b/c — resolución conservadora (2026-10-10)

Política: conservar siempre la solicitud original. Un reenvío cuyo contenido normalizado o clave de huella cambió sigue en conflicto; registrar una decisión **no** vuelve aceptable ese reenvío ni confirma que su contenido era igual. ADMIN comprueba el estado y vínculo, conserva el original y continúa el trabajo comercial en su oportunidad existente si corresponde. Correcciones comerciales usan los flujos actuales del CRM y preservan el snapshot original; no crear otra solicitud/oportunidad como solución automática. No hay comparación automática de candidatos, carga de contactos alternativos o edición de huellas en esta pantalla.

Rutas privadas ADMIN con JWT/guards globales y Cache-Control no-store:

- GET `/api/v1/crm/solicitudes-web/:uuid/resoluciones`: últimas20 decisiones, ordenadas por versión descendente. Identificador inexistente404; no devuelve contactos, piezas, payload o huella. Registros anteriores no se borran por este límite de lectura.
- POST `/api/v1/crm/solicitudes-web/:uuid/resolver`: `{operationId, motivo, expectedVersion, originalVerificado:true}`. UUIDv4 para solicitud/operación, versión entera positiva, motivos Contenido/Catalogo/Clave/Confirmacion; campos adicionales rechazados. Única decisión ConservarOriginal, derivada por servidor. No admite texto libre para evitar copiar datos personales al historial.

Migration091 crea `crm_solicitud_web_resolucion`: operación única, solicitud, motivo/decisión, versión anterior/resultante, clasificación de contenido y oportunidad al decidir, autor/fecha. Sin contactos, piezas, hashes HMAC o claves. Trigger bloquea UPDATE/DELETE ordinarios; propietario/superusuario puede alterar esquema, desactivar trigger o usar TRUNCATE, por lo que no es una garantía contra acceso privilegiado. Retención de estos metadatos debe definirse antes de operación pública.

El servicio serializa por operationId y bloquea la solicitud; registra decisión y avanza versión en la misma transacción. No cambia estado comercial/revisor, payload, huella, vencimiento o vínculo. La decisión puede registrarse sobre metadatos vencidos/purgados y oportunidad conservada; no recupera datos expirados. Una solicitud inexistente no se crea. Identificador de operación reutilizado con mismo autor/solicitud/motivo/versión devuelve la decisión original, incluso si después hubo otras decisiones/purga; datos o autor distintos409. Dos operaciones distintas con la misma versión compiten y solo una puede avanzar. El avance de versión obliga a refrescar antes de revisión/conversión nueva.

UI: después de **Comprobar recepción**, elegir motivo y confirmar «Comprobé el estado y el vínculo…». Guardar conserva el original y muestra usuario, fecha, versión y estado del contenido al decidir. Historial se carga por separado con reintento. Ante timeout/error incierto, conserva misma clave y cuerpo; botón «Reintentar la misma decisión» y consulta de estado/historial permiten confirmar persistencia. Se bloquean identificador, motivo y checkbox de esa intención hasta confirmación; consultar estado está permitido cuando no hay envío activo. Errores definitivos400/404/409 requieren comprobar otra vez antes de decidir. No hay reintentos automáticos ni almacenamiento local de intención; salir/recargar la pierde y exige revisar historial antes de iniciar otra. La respuesta de decisión es histórica, no el estado actual; diagnóstico obtiene versión/vigencia actuales.

Pruebas PostgreSQL aisladas: misma operación concurrente/UUID mayúsculas, claves con datos/autor distintos, versión obsoleta, dos decisiones concurrentes, rollback por autor inválido, huella cambiada todavía rechazada, vencidos/purgados sin restauración, historial20 y trigger UPDATE/DELETE aprobados. Tres suites backend6/6 y UI8/8, API simulada para pérdida de recibo/error de historial; capturas claro1280/oscuro390 revisadas, Axe/reflujo aprobados. Una secuencia de lecturas descarta respuestas antiguas; prueba retrasa la primera lectura y comprueba que no reemplace el historial reciente. Aceptación completa con AppModule, login PostgreSQL y Angular producción también aprobada: ocho rutas privadas, registro/historial en ambos temas, idempotencia HTTP y decisión tras purga sin alterar snapshot. Reporte `.artifacts/web-inbox-auth-acceptance.json`; base de aceptación eliminada.

Respaldo `.backups/2026-10-10T22-11-01-819Z` antes de db:check y db:migrate;091 aplicada, no se alteraron migraciones previas ni se insertaron contactos fixture en base de trabajo. Builds Node24 aprobados, frontend inicial476.18kB dentro del aviso500kB. Captación operativa sigue desactivada. Próximo pendiente local: rotación/configuración segura de claves y pruebas de transición sin activar la captura pública.

## Rotación técnica de firma y huella estable — 2026-10-10

WEB05.1b/c: rotación implementada y verificada localmente, sin claves operativas creadas ni activación de captura. No requiere dominio, hosting o servicios externos. Configuración en servidor; no se almacenan claves en PostgreSQL ni se entregan al navegador. Las secciones anteriores describen sus versiones históricas.

### Configuración y protocolo

| Variable backend | Uso |
| --- | --- |
| WEB_LEAD_BRIDGE_ENABLED | Solo el valor true permite recepción; false por defecto |
| WEB_LEAD_PRIVACY_VERSION | Versión del aviso aprobada; no sustituye el texto ni su aprobación |
| WEB_LEAD_BRIDGE_KEY | Clave de firma de transporte activa, base64 canónico, al menos32 bytes |
| WEB_LEAD_BRIDGE_KEY_ID | ID de firma v2, 1–48 caracteres alfanuméricos, guion o guion bajo; primer carácter alfanumérico; legacy reservado |
| WEB_LEAD_FINGERPRINT_KEY | Clave estable de huella HMAC, base64 canónico, al menos32 bytes, distinta de firma activa |
| WEB_LEAD_BRIDGE_PREVIOUS_KEY / PREVIOUS_ID | Una firma anterior opcional; ID distinto del activo y material distinto de firma activa |
| WEB_LEAD_BRIDGE_PREVIOUS_FROM / PREVIOUS_UNTIL | Inicio incluido y fin excluido, UTC ISO con milisegundos; intervalo positivo máximo24 horas |

Las cuatro variables PREVIOUS llevan el prefijo WEB_LEAD_BRIDGE_. Se especifican todas juntas o se retiran todas. Configuración parcial, claves no canónicas/cortas, ID inválido/repetido o intervalo inválido cierran recepción con503 genérico. No se prueban silenciosamente todas las claves. El ID legacy en PREVIOUS exige que esa clave coincida con la clave estable de huellas, pues v1 usaba la misma para ambas funciones.

Con todos los campos nuevos vacíos se conserva v1, sin ID de cabecera y con huella derivada de su clave única. V2 requiere ID/clave estable explícitos: emisor `createLeadBridge(origin, signingKey, { keyId })`, cabecera X-Web-Key-Id y HMAC-SHA256 del dominio `web-lead-v2`, ID, timestamp y JSON separados por saltos de línea. Identificador firmado evita sustituir la selección de clave. Continúan restricciones loopback, tiempo±60 segundos, tamaño/contrato y validación de huella. Emisor no sigue redirecciones y mantiene plazo5 segundos.

La anterior se acepta solo cuando reloj del receptor **y** timestamp de firma están dentro del intervalo. Al vencer se rechaza automáticamente aunque siga configurada; firma activa continúa. Se puede revocar antes retirando los cuatro campos y reiniciando receptor. Retirar ID anterior no cancela commits hechos antes. Una firma capturada dentro de60 segundos puede repetirse: requestId/huella y almacenamiento transaccional impiden duplicar; HMAC no cifra tráfico ni sustituye HTTPS en un futuro despliegue. El puente actual admite únicamente loopback HTTP.

### Migrar v1 y rotar v2 sin romper reintentos

1. Ensayar en copia aislada. Conservar acceso seguro a la clave de huellas y respaldo; nunca copiar valores a README, tickets, capturas, frontend o logs. El aprovisionamiento real sigue pendiente.
2. Si existe historial v1, conservar su clave original **como WEB_LEAD_FINGERPRINT_KEY** en backend y como `intake.key` del servidor público. No generar otra huella ni recalcular hashes existentes. Preparar una firma nueva distinta y nuevo ID, y configurar anterior legacy con la clave antigua y un intervalo explícito suficiente para el cambio, máximo24 horas.
3. Desplegar/reiniciar receptor primero; comprobar estado ADMIN sin secretos. Durante intervalo puede recibir emisor v1 anterior y emisor v2 nuevo; ambos calculan huella con la misma clave estable. Si todavía no hay historial, usar directamente firma v2 y huella independiente, sin anterior.
4. Cambiar/reiniciar adaptador público con la firma nueva y su ID; conservar `intake.key`, UUID, contenido, catálogo y versión del aviso. Comprobar recepción y oportunidad antes de reintentar un resultado incierto. La preview CLI habitual continúa cerrada: este bloque proporciona adaptador/configuración, no instala una configuración de captura operativa.
5. Para siguiente rotación v2, nueva firma/ID activos; anterior con firma/ID v2 que se retira y fechas de transición. La clave estable de huellas permanece igual en ambos servidores. Confirmar reintento idéntico sin duplicar y rechazo de contenido cambiado.
6. Tras terminar, retirar los cuatro campos anteriores y reiniciar receptor; consultar estado y comprobar rechazo de emisor retirado. Para rollback dentro de transición, emisor anterior puede volver a usarse; fuera de intervalo debe configurarse una transición nueva explícita, conservando huella/UUID. No volver automáticamente a v1 ni resetear solicitudes.

Rotar **la clave de huellas** es otro problema y no está implementado: después de purga solo queda hash, por lo que no se puede recalcular contenido eliminado. Perderla o cambiarla unilateralmente rompe comparación de reintentos; diagnóstico/resolución conservadora registra decisión y preserva original, sin convertir una huella diferente en coincidencia. Un cambio de catálogo, contenido o política puede seguir generando conflicto aunque la firma se rote correctamente.

### Estado privado, pruebas y límites

GET ADMIN `crm/solicitudes-web/puente`, no-store, muestra exclusivamente enabled/configured/mode/activeKeyId/previous(ID/fechas/accepting). Una configuración inválida devuelve configured=false sin detalles privados. enabled refleja bandera; receptor solo está disponible con enabled y configured. No devuelve claves, digests, política o payload. UI en **CRM → Solicitudes web → Estado del puente de recepción**: consulta bajo demanda, estado de cierre/validez/firma/intervalo, error local y reintento manual; sin edición de secretos. Estado es instantáneo, no log de rotaciones ni evidencia de activación del formulario.

Node24: cuatro suites Jest10/10, web pública Node74/74 y ERP Playwright10/10. Casos de intervalo/configuración, firma/ID/clave copiados por emisor, UI claro1280/oscuro390, error/reintento, Axe0 y reflujo. Capturas `.artifacts/web-bridge-light.png` y `web-bridge-dark.png` revisadas. `test:web-inbox-db` compila backend y verifica con PostgreSQL aislado legacy→v2→v2, anterior expirada/revocada, ID alterado, firma vieja, huella inválida, contenido cambiado, concurrencia y reintento tras purga sin restauración.

`test:web-inbox-auth -- --backup=.backups/2026-10-10T22-11-01-819Z/database.dump` aprobado con AppModule, login PostgreSQL y Angular producción sin mocks: nueve rutas privadas401/403, transición sobre commit sin recibo, firma nueva con mismo formulario/huella, diagnóstico puente ADMIN en ambos temas, oportunidad/snapshot únicos y reintento tras purga. Copia restaurada, db:check antes de db:migrate solo en copia, cierre y eliminación verificados; reporte sanitizado actualizado. Backend/frontend builds aprobados, inicial476.18kB dentro de500kB; lint dirigido aprobado. Sin migraciones nuevas ni cambios a la base de trabajo.

Siguiente orden local: cableado y validación previa de un perfil de captura explícito que permanezca cerrado por defecto; después aprobación del aviso/retenciones y aprovisionamiento real; aceptación con lote comercial cuando esté disponible. WEB05.2 sigue pendiente de recepción/conversión operativas y métricas con datos verificables. Dominio/hosting, IA01–IA05 y exclusión bancaria conservan su prioridad/alcance anteriores.

## Perfil local y comprobación previa sin persistencia — 2026-10-10

WEB05.1b/c: perfil y cableado técnico local implementados. `public-web/capture-profile.json` incluido tiene `enabled:false`, sin aviso aprobado ni claves. Arrancar `start:web-publica` sin argumentos conserva captura cerrada, aunque existan claves en el entorno o el backend esté habilitado. El archivo no se carga implícitamente. No se creó una configuración operativa habilitada.

### Contenido del perfil

| Campo | Requisito |
| --- | --- |
| schemaVersion / enabled / mode | 1, booleano y exclusivamente local |
| origin / bridgeOrigin | Orígenes distintos, HTTP canónico de 127.0.0.1 con puerto 1024–65535; sin rutas, credenciales o parámetros |
| keyId | ID activo v2; no admite legacy para preparar captura nueva |
| privacy | approved, version, text, textSha256, reviewer, reviewedAt |
| retention | approved, inboxDays, crmPolicy, metadataPolicy, backupPolicy, reviewer, reviewedAt |

Con `enabled:true`, exige ambas revisiones declaradas, texto/versión del aviso y SHA-256 del texto UTF-8 exacto. Reviewer y fechas UTC ISO con milisegundos deben estar presentes; no admite fechas futuras. Version máximo80 caracteres, texto10000, reviewer120 y cada política2000; rechaza controles no permitidos. Los saltos de línea y tabuladores del aviso forman parte del hash. Cambiar el texto sin actualizar su hash impide preparación.

Estas declaraciones **no son una aprobación autenticada ni una revisión legal**. Una persona con acceso de escritura puede cambiar texto, hash y aprobaciones juntos. El hash detecta divergencia respecto del texto declarado; no certifica quién aprobó. No rellenar las revisiones con datos ficticios para activar operación. El perfil de pruebas está separado y solo se usa en procesos/base desechables.

`inboxDays` debe ser90 para coincidir con el valor predeterminado técnico actual. No es una recomendación de plazo ni una política ya aprobada. CRM, metadatos de resoluciones y respaldos tienen retenciones distintas: el perfil exige describirlas, pero **no añade su eliminación automática**. La purga existente de contactos de bandeja y su bandera siguen independientes.

Carga desde archivo regular, JSON UTF-8 válido y máximo64 KiB, con lectura acotada incluso si crece durante la carga. Rechaza campos desconocidos y estructuras distintas; el objeto validado se copia. No acepta campos de claves. Copia operativa prevista `public-web/capture-profile.local.json`, ignorada por Git; no fue creada en esta sesión. Perfil, código y archivos de entorno no se sirven por HTTP.

### Secretos del proceso y comprobación

Variables de la web: `PUBLIC_WEB_BRIDGE_KEY` y `PUBLIC_WEB_FINGERPRINT_KEY`, base64 canónico, al menos32 bytes y distintas. No deben guardarse en el perfil, README, navegador, capturas o logs. `public-web/.env.example` contiene solo nombres vacíos; el servidor no carga archivos dotenv automáticamente. Aprovisionar los valores por un mecanismo privado del proceso cuando exista aprobación operativa.

La firma debe coincidir con `WEB_LEAD_BRIDGE_KEY` del receptor y `keyId` con `WEB_LEAD_BRIDGE_KEY_ID`; la huella estable debe coincidir con `WEB_LEAD_FINGERPRINT_KEY`; versión del perfil con `WEB_LEAD_PRIVACY_VERSION`. Receptor requiere `WEB_LEAD_BRIDGE_ENABLED=true` y configuración v2 válida. Las dos claves se comprueban independientemente antes de iniciar captura.

`POST /api/v1/web-lead-bridge/check` admite solo schemaVersion1, nonce aleatorio de32 bytes en hexadecimal, privacyVersion y prueba HMAC de la clave estable. Solo conexión loopback, firma de transporte con ID activo, timestamp dentro de±60 segundos y cuerpo acotado; bypass de JWT exclusivamente para esta autenticación propia. Dominio de firma `web-lead-check-v2`, distinto del dominio de recepción de contactos; una firma de comprobación no puede reutilizarse para insertar una solicitud. No acepta la firma anterior para preparar un arranque, aunque siga válida para reintentos del endpoint de recepción.

La respuesta no-store también está firmada con dominio `web-lead-check-response-v2`, eco del nonce/timestamp y versión. Emisor rechaza redirecciones, tiene plazo5 segundos y limita la respuesta a4 KiB; verifica firma, campos exactos y coincidencia. No envía contactos ni consulta o escribe en BD. `inboxDays:90` informa el valor técnico esperado del código, **no inspecciona el predeterminado de la BD en ejecución**. La comprobación no prueba salud de BD, permisos de inserción, purga, disponibilidad futura o lanzamiento; es una observación de configuración entre procesos en ese momento.

### Comandos con Node.js24

Inspección segura del perfil incluido, sin leer claves ni llamar al backend cuando está cerrado:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-intake
```

Cuando exista un perfil real revisado y secretos aprovisionados, estos comandos comprueban su estructura/configuración y después coincidencia con el receptor. Son ejemplos de procedimiento; no habilitan captura:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-intake -- --profile=public-web/capture-profile.local.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-intake -- --profile=public-web/capture-profile.local.json --online
```

Reporte sanitizado: `closed`, `prepared-local` o `checked-local`, con captureStarted=false y banderas de comprobación/revisiones declaradas. No imprime claves, hashes, texto del aviso, reviewer o configuración privada. La inspección sin `--online` no confirma al receptor; la comprobación cerrada no lo llama incluso con `--online`.

Arranque explícito únicamente después de revisión/provisión y aceptación local:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run start:web-publica -- --capture-profile=public-web/capture-profile.local.json
```

Origen del perfil determina el puerto. Si `PUBLIC_WEB_PORT` está definido debe coincidir. Perfil inválido, revisión incompleta, claves equivocadas, ID/aviso distintos, backend cerrado o respuesta sin autenticación impiden iniciar el servidor; no se abre primero el formulario. Perfil cerrado inicia preview sin captura. Cambios de archivo, aviso/revisiones o claves requieren reinicio: no hay recarga automática. Para rotar, preparar primero receptor con nuevo ID/clave activos y después reiniciar emisor conservando huella y contenido; firmas anteriores solo apoyan recepción durante el intervalo documentado.

Esto es un **perfil local HTTP/loopback**; no es despliegue público HTTPS ni conecta servidores alojados en máquinas distintas. HMAC autentica pero no cifra. Arquitectura de publicación, secretos/staging/HTTPS y aceptación comercial siguen en WEB04/WEB05; no exponer el ERP como sustituto. Fallos posteriores al arranque conservan los mecanismos existentes de timeout/UUID/reintento; pasar preflight no elimina un resultado incierto posterior.

### Evidencia y siguiente orden

Node24.19.0: web Node79/79, Playwright público32/32, cinco suites Jest13/13, lint dirigido y builds backend/Angular aprobados; carga inicial476.18kB dentro del aviso500kB. Pruebas de CLI usan procesos propios con claves fixture: arranque sin argumentos cerrado, perfil cerrado sin llamadas, habilitado con comprobación antes de formulario y backend rechazado sin puerto abierto. El mock firmado de esas pruebas no sustituye integración real.

`test:web-inbox-db` verifica PostgreSQL aislado y comprobación real sin aumentar conteos de bandeja/oportunidades/snapshots/resoluciones. `test:web-inbox-auth -- --backup=.backups/2026-10-10T22-11-01-819Z/database.dump` aprobado con AppModule completo, guards/login PostgreSQL y Angular producción en claro1280/oscuro390; usa el adaptador preparado, reintentos/rotación/conversión/purga/revocación reales. Respaldo restaurado y db:check antes de db:migrate solo en copia; copia eliminada y cierre verificados en `.artifacts/web-inbox-auth-acceptance.json`, final2026-10-11T02:25:24.779Z (fecha local10 de octubre). Sin migraciones nuevas; última091, sin cambios en la base de trabajo.

Siguiente prioridad de WEB05.1: preparar el expediente del aviso y las retenciones de bandeja/CRM/metadatos/respaldos para revisión real del propietario; después aprovisionar claves, aceptar configuración y recorrido con lote comercial. No hay aprobación operativa ni recepción comercial habilitada por esta sesión. WEB05.2 sigue pendiente de medición real; IA01–IA05 sin prioridad. Sin gastos de dominio/hosting, conexiones bancarias o cambios al fiscal mock/UUID/idempotencia.

## Expediente preparado para revisión — 2026-10-10

Siguiente avance documental completado: [WEB_PRIVACIDAD_RETENCION.md](WEB_PRIVACIDAD_RETENCION.md) y [borrador interno del aviso](plantillas/AVISO_SOLICITUDES_WEB.borrador.txt). Inventario contrastado con contrato, servicios, logger, backup y migraciones089–091; decisiones D01–D09, matriz de retención por copia y procedimiento manual de atención/restauración. La purga del payload no elimina el contacto convertido en CRM ni respaldos; conservar esa distinción al revisar el aviso.

Nombre legal, canal/encargado y plazos/políticas/proveedores siguen pendientes de confirmación real. El borrador tiene marcadores abiertos y no se publica ni usa para activar captura. No existe aprobación operativa ni módulo ARCO, cifrado/retención de respaldos o borrado general añadido por este documento. Perfil incluido/procesos habituales siguen cerrados; sin migraciones nuevas, claves generadas, contacto nuevo o cambios a BD. Consultar expediente para el orden: D01, revisión D02–D08, mecanismos efectivos y finalmente aprovisionamiento/aceptación D09. WEB05.1 permanece parcial.
