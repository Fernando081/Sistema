# O01.2a — Preparación transaccional de documentos y consumidor local

Refacciones y Tractorepuestos Tampico.22/10/2026. Primera parte de O01.2: solicitud privada conservada, revisión, idempotencia, archivo y procesamiento **exclusivamente local** de documentos de venta. O01.2 sigue parcial por el ejecutor asíncrono/transporte O01.2b y otros consumidores O01.2c. No sustituye la cola de reportes O01.1.

## Operación en el ERP

**Ventas → Facturas → Preparar correo local de factura** (icono de correo) abre `/facturas/correos?factura=ID`.

1. La pantalla indica **Envío externo desactivado**. Abrirla sólo consulta el historial.
2. **Revisar destinatario y documento** muestra dirección registrada del cliente, asunto, folio y ambiente fiscal. Se exige una sola dirección válida; no se permite introducir destinatarios libres o encabezados. Corregir el cliente si falta o está equivocado. No comprueba identidad del destinatario, propiedad del correo o recepción real.
3. **Preparar solicitud local** exige confirmación explícita. Conserva juntos metadatos, destinatario/cuerpo y copia exacta del PDF existente. Si el documento/destinatario cambió desde la revisión, se rechaza y pide actualizar. No envía mensajes ni genera un timbre.
4. En el historial se puede descargar el **PDF preparado**, simular el procesamiento o cancelar con motivo. Se conservan fecha, autor, ambiente, tamaño y huella.
5. **Simular procesamiento** exige otra confirmación: comprueba archivo/huellas y consulta nuevamente el origen. Resultado **Simulado** significa únicamente que pasó el consumidor local. No es Enviado, Aceptado ni Entregado.
6. Si cambió destinatario, factura, concepto o representación fiscal, el cierre queda **Obsoleto**, con el archivo anterior conservado. Revisar el estado presente y preparar otra solicitud si corresponde.
7. **Cancelar solicitud** requiere motivo y confirmación. No borra el documento, mueve inventario, cancela la factura o afecta otros módulos.

Los estados son **Preparado → Simulado / Cancelado / Obsoleto**. Los cierres son definitivos y únicos; no se puede convertir una solicitud Local histórica en un envío real. La simulación se ejecuta deliberadamente desde la pantalla/API: **no hay cron, SMTP, consumo automático o reintentos en segundo plano de estas solicitudes**. El consumidor local sólo produce un cierre transaccional en la BD.

## Qué se reutiliza y qué se corrigió

- El renderizador PDF `DocumentosVentaService`/`TicketService` ya existe. Se separó la obtención de datos PDF para usar el mismo manager transaccional; la ruta de descarga tradicional sigue disponible. No cambia el diseño del comprobante ni sus reglas fiscales.
- La función histórica `fn_preparar_envio_correo` inserta en `historial_correos` antes de que ocurra un envío. Se conserva, pero la aplicación deja de invocarla para esta operación. La nueva revisión es una consulta pura; abrir/revisar/simular no inserta registros que aparenten envío en ese historial.
- El antiguo botón hacía SMTP síncrono con un remitente fijo en el código. Se retiraron ese transporte y el remitente del servicio activo. El botón abre la revisión local y el endpoint histórico exige el nuevo contrato cerrado; una llamada antigua con cuerpo vacío devuelve400, sin enviar. No se reutilizan credenciales SMTP ni se configura otro remitente.
- El ambiente del PDF se toma de su documento fiscal conservado; si no existe, se conserva su presentación Borrador/mock existente. Preparar o simular no valida el CFDI con SAT/PAC ni altera UUID técnicos, timbres simulados, estado fiscal o XML originales.

## Autorización y consistencia

Nuevo permiso **ventas.correo.gestionar**, inicialmente ADMIN y delegable a USER con los mecanismos S01. USER sólo consulta/controla sus propias solicitudes; ADMIN puede revisar/controlar las de otros sobre la factura seleccionada. Esto no otorga permisos de cancelar ventas o modificar clientes. Se valida actividad, rol, versión de sesión y permiso efectivo en lectura/escritura; las escrituras revalidan después de esperar bloqueos de factura/solicitud.

Revisión en snapshot READ ONLY coherente. Preparación bloquea factura, toma bloqueo compartido del cliente y verifica la huella de la revisión; conserva PDF/destino/metadatos/auditoría en una transacción. Cierre bloquea factura/solicitud antes de volver a comprobar autoridad y origen. El origen se vuelve a leer en el mismo manager; los hashes detectan cambios observados, sin afirmar que exista una firma independiente o bloqueo absoluto de cada posible edición SQL de todas las tablas relacionadas.

Cada intención usa UUIDv4 + SHA256 ligado a factura/actor/evaluación; un reintento con la misma clave/contenido recupera su ID, incluso si posteriormente alcanzó la cuota o cambió el origen. Otra operación con esa clave devuelve409. El cierre también usa UUID/huella; se conserva un solo cierre ante simulación y cancelación concurrentes. No se debe crear otra clave para repetir una operación incierta.

La pantalla conserva claves en memoria mientras sigue abierta, incluido ante una respuesta perdida tras commit. Tras recargar/cambiar contenido, revisar historial antes de volver a preparar. No existe cola offline del navegador. Leer el historial no procesa solicitudes ni reemplaza archivos conservados por PDFs regenerados.

## Archivos, privacidad y límites

- PDF privado exacto con máximo **2MiB**, cabecera PDF, tamaño y SHA256. Descarga y simulación verifican tamaño/huella; el contenido de la solicitud también liga destino/asunto/cuerpo al PDF.
- Hasta **20 preparaciones conservadas por factura**, controladas bajo bloqueo, páginas de20. Es una cuota del alcance local, no una política de retención o capacidad empresarial aprobada.
- Destinatario/asunto/cuerpo/bytes están en `documento_salida_archivo`, sin trigger de auditoría de contenido. Un trigger ALWAYS rechaza insertar esa tabla en `auditoria_jsonb`. La auditoría de metadatos/cierres conserva actor y huellas, sin dirección/cuerpo/bytes. Los archivos contienen información comercial/personal y sus respaldos requieren controles de O03; hashes no son anonimización.
- Intenciones, archivos y cierres se conservan contra UPDATE/DELETE/TRUNCATE ordinarios con triggers ALWAYS. FKs restrictivas, relación factura/cliente y tamaño del archivo/metadato comprobados en la BD. No protege contra un administrador que quite guardas o restaure respaldos antiguos.
- Timeouts SQL8s en lectura y10s en escritura. No hay purga, antivirus de adjuntos entrantes (no se reciben archivos), cifrado nuevo de BD, bandeja global, XML adjunto, confirmación SMTP o constancia de entrega. Facturas canceladas/incluidas en global no admiten nuevas preparaciones; una simulación pendiente pasa a Obsoleto si su origen deja de ser válido.

## API privada

Todas las rutas requieren JWT ERP y `ventas.correo.gestionar`, con respuestas `private, no-store`; PDF attachment/nosniff. DTO cerrados, IDs int válidos y UUIDv4. No hay entrada de SQL, bytes, destinatario, remitente, modo real o URL de proveedor.

| Método y ruta bajo `/api/v1/venta` | Contrato |
| --- | --- |
| GET `/:id/preparar-correo` | Revisión pura; dirección/asunto/folio/ambiente/evaluacionSha256/Local |
| POST `/:id/enviar-correo` | `{requestId,evaluacionSha256,confirmacion:true}`; prepara, no envía |
| GET `/:id/correos?page=1` | Historial autorizado de la factura |
| GET `/:id/correos/:solicitud/pdf` | Archivo exacto preparado, privado |
| POST `/:id/correos/:solicitud/simular` | `{requestId,confirmacion:true}`; Simulado/Obsoleto y envioExterno=false |
| POST `/:id/correos/:solicitud/cancelar` | `{requestId,confirmacion:true,motivo}`; cierre Cancelado |

Migración113: permiso inicial y tablas `documento_salida`, `documento_salida_archivo`, `documento_salida_cierre`, con índices, unicidad/constraints/FKs, vínculo/privacidad/conservación ALWAYS y auditoría nominal. Sin backfill, envíos o modificaciones de migraciones aplicadas.

## Verificación reproducible

Node24, builds terminados y dump local legible:

```powershell
npm run test:document-outbox -- --backup=.backups/FECHA/database.dump
```

Restaura copia propia `verify_outbox_<16hex>`, hace check/migrate allí, usa AppModule/PostgreSQL/HTTP/Angular/login y venta real en copia. Direcciones de fixtures `example.invalid`, sin uso de destinatarios reales. Vigila el transporte SMTP y exige cero llamadas. Prueba contrato/confirmación/ACL/propietario/factura, revisión sin escrituras, UUID/huellas/bytes, archivo privado, fuente modificada, cancelación/concurrencia, auditoría/rollback/guardas/cuota y revocación durante espera de bloqueo. UI claro1280/oscuro390: revisar/confirmar/preparar, respuesta perdida sin duplicar, descargar/simular/cancelar/recargar y entrar desde Facturas, con Axe/reflujo. Service worker bloqueado sólo en ese contexto para interceptar transporte; no prueba offline/PWA.

Exigir `passed/cleanupPassed/copyRemoved=true`, `apiMocked=false`, `smtpCalls=0`, `externalDeliveryEnabled=false` en `.artifacts/o012a-outbox.json`. Reporte/respaldos/migración/pruebas/limitaciones efectivas en README. Esta aceptación no es validación de un servidor SMTP, datos comerciales reales, propiedad del correo, capacidad distribuida o fiscal PAC.

## Continuación finita de O01.2

- **O01.2a:** esta preparación y consumidor manual local de documentos.
- **O01.2b, siguiente técnico:** ejecutor persistente/adaptador de correo con reintentos/esperas, tratamiento de aceptación incierta del proveedor, conciliación/cancelación y configuración validada. Probar con transporte local controlado sin mensajes a terceros. Un proveedor puede aceptar un correo aunque se pierda la respuesta: no asumir que reintentar siempre evita duplicados o que SMTP aceptado significa entregado. No convertir estados Simulado históricos en entregas reales.
- **O01.2c:** adaptadores PAC/campañas sobre los proveedores/contratos/idempotencia y consentimientos C01 ya existentes, primero mock/local y revalidando bajas/configuración. Registrar comunicaciones no equivale a enviarlas.
- **O01.3:** operación/retención/capacidad/recuperación, canales/proveedores/destinatarios verificados y configuración real. Decisiones externas siguen pendientes, sin comprar servicios ni activar envíos durante esta fase.

Cámara/QR diferidos, IA sin nueva prioridad, modo fiscal mock e identificadores técnicos conservados. APIs/conexiones bancarias excluidas.

# O01.2b — Envío real por correo con ejecutor persistente (28/10/2026)

## Qué cambia

- **Dos modos al preparar.**
  - **Local** (O01.2a, sin cambios): nunca se envía y su huella e idempotencia son las mismas que antes.
  - **Correo**: sólo existe si la configuración SMTP es válida y el dominio del destinatario está permitido. Encola un envío real.
- Una solicitud Local histórica **no se puede convertir** en envío. La base lo impide: un cierre `Aceptado`/`Fallido` sólo es posible en modo Correo y `Simulado` sólo en Local (trigger ALWAYS).
- **Estados de un envío por correo:**
  - **En cola**: esperando su turno.
  - **Enviando**: reserva de 5 minutos con token.
  - **Reintento**: el servidor respondió 4xx o no se pudo conectar; espera 1, 5, 15 y 60 minutos, hasta `MAIL_MAX_ATTEMPTS` (4 por defecto).
  - **Aceptado**: el servidor respondió 250 al contenido. **No es constancia de entrega al buzón.**
  - **Fallido**: rechazo 5xx o intentos agotados, con motivo.
  - **Incierto**: se perdió la conexión o la respuesta después de enviar el contenido, o el proceso se cayó con la reserva activa.
  - **Cancelado**: sólo mientras está En cola o en Reintento.
  - **Obsoleto**: el documento o el destinatario cambió antes de enviar; no se envía.
- **Incierto nunca se reenvía solo.** Un administrador, con motivo, elige una de tres opciones; la decisión queda en `documento_salida_conciliacion`, inmutable y auditada:
  - *Confirmar que sí llegó*: cierre Aceptado con su nombre.
  - *Reintentar envío*: aviso de posible duplicado.
  - *Dar por fallido*.
- Cada solicitud tiene un `Message-ID` fijo (`<salida-UUID@dominio-del-remitente>`). Un reintento lleva el mismo, así el cliente de correo del destinatario puede reconocer duplicados. Esto no lo garantiza.

## Ejecutor

- `SalidaCorreoEjecutorService` revisa cada minuto (`@Cron`). Registra la ejecución en Procesos automáticos (`document_mail`, intervalo de 10 minutos y 5 de tolerancia) sólo cuando hay trabajo o como latido cada 9 minutos. Sus fallos y atrasos avisan como los demás jobs.
- Ciclo:
  1. Marca como Incierto las reservas vencidas.
  2. Reserva hasta 5 envíos con `FOR UPDATE SKIP LOCKED`.
  3. Por cada uno, en una transacción con bloqueo, comprueba la reserva, el archivo (tamaño y huellas) y el origen. Si cambió, cierra Obsoleto.
  4. Envía fuera de la transacción.
  5. Registra el intento (`documento_salida_intento`, inmutable) y el nuevo estado. Si la reserva ya no es suya, conserva el intento sin pisar el estado.
- El transporte usa la conexión SMTP de bajo nivel de nodemailer (`SMTPConnection` + `MailComposer`) para saber **en qué fase falló**. Su transporte de alto nivel informa `command: "CONN"` incluso si la conexión se cortó después del contenido: se comprobó con el servidor local, y clasificarlo como temporal habría causado duplicados.
  - Conectar o autenticar → temporal.
  - Envío con respuesta 4xx → temporal; 5xx → permanente.
  - Envío sin respuesta → incierto.
- Con la configuración desactivada o inválida, las solicitudes esperan en cola sin enviarse ni fallar.

## Configuración (`backend/.env`, ver `.env.example`)

| Variable | Uso |
|---|---|
| `MAIL_MODE` | `desactivado` (por defecto) o `smtp`. |
| `SMTP_HOST`, `SMTP_PORT` | Servidor. Un servidor que no sea `localhost`/`127.0.0.1` exige `SMTP_SECURE=true` (465) o `SMTP_REQUIRE_TLS=true` (STARTTLS). En producción se exige además verificar el certificado. |
| `SMTP_USER`, `SMTP_PASSWORD` | Van juntos. La contraseña nunca se muestra; la pantalla sólo indica si hay autenticación. |
| `MAIL_FROM`, `MAIL_REPLY_TO` | Una sola dirección válida cada una. |
| `MAIL_RECIPIENT_DOMAINS` | Lista de dominios permitidos para un piloto controlado. Vacío = cualquiera. |
| `MAIL_MAX_ATTEMPTS` | De 1 a 10 (por defecto 4). |

La pantalla muestra el servidor, el tipo de TLS, el remitente, los dominios y los problemas de configuración.

## API nueva

- `POST /venta/:id/enviar-correo` acepta `modo: "Correo"`; sin `modo` es Local, como antes.
- `POST /venta/:id/correos/:solicitud/conciliar` con `{requestId, confirmacion: true, accion: ConfirmarAceptado|Reintentar|DarPorFallido, motivo}`. Sólo ADMIN; es idempotente por `requestId`.
- El historial agrega `modo`, `envioEstado`, `intentos`, `maxIntentos`, `proximoIntento`, `ultimoError` y `respuestaSmtp`. La revisión y el historial devuelven `correo` con el estado público de la configuración.

## Migración 119

- `documento_salida.modo` admite `Correo`.
- Cierres `Aceptado` y `Fallido`; `Fallido` lleva motivo y el `id_actor` es opcional para los cierres automáticos.
- Trigger de coherencia entre modo y cierre.
- Tablas `documento_salida_envio` (estado de trabajo), `documento_salida_intento` y `documento_salida_conciliacion` (inmutables, ALWAYS).
- Job `document_mail`.

## Verificación

- `npm run test:mail-outbox` (`backend/verify-mail-outbox.js`, **31/31**). Restaura el respaldo más reciente en una base aislada `verify_mail_*`, migra y usa los servicios reales con `SmtpLocalPrueba`, un servidor SMTP propio en 127.0.0.1 que no reenvía nada. Destinatarios `example.invalid`. Al final borra la base. Cubre:
  - Local intacto y su guarda en la base;
  - aceptado (destinatario, Message-ID y PDF recibidos), sin reenvío;
  - 4xx con espera y segundo intento;
  - intentos agotados → Fallido; 5xx inmediato;
  - incierto sin reenvío automático, no cancelable, sólo un administrador concilia y sus tres decisiones (idempotentes);
  - reserva vencida → Incierto;
  - destinatario cambiado → Obsoleto sin envío;
  - Correo no se simula; cancelar en cola;
  - configuración ausente, dominio no permitido y cola en espera con el correo desactivado;
  - historial e inmutabilidad.
- Pruebas unitarias: transporte real contra el servidor local (aceptado, 5xx, 4xx, corte tras el contenido, servidor apagado), configuración y decisiones del ejecutor.
- UI: `tests/mail-outbox.spec.ts` (envío, estados, conciliación con motivo, sin configuración; Axe).

## Límites

- No se probó con un servidor SMTP real de un proveedor, ni con SPF/DKIM/DMARC; tampoco hay entrega comprobada ni rebotes asíncronos.
- No hay bandeja global de envíos: el historial es por factura.
- El ejecutor corre dentro del backend: si este no está encendido, no se envía (la cola espera).
- `test:document-outbox` de O01.2a no se volvió a ejecutar; el modo Local conserva su contrato.
- **O01.2c** (consumidores PAC/campañas) y **O01.3** (operación real) siguen pendientes.
