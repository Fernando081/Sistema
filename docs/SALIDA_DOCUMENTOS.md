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
