# V03 - Portal privado de clientes

## Estado y fases

V03.1 implementa acceso/consulta y V03.2 añade publicación deliberada y archivos conservados. Los resultados efectivos de cada sesión se registran en README. **V03 permanece parcial** por operación/piloto/despliegue, con un alcance finito:

| ID | Alcance |
| --- | --- |
| V03.1 | Cuentas externas separadas, invitación/activación, sesiones/revocación y consulta aislada con resúmenes PDF |
| V03.2 | Publicación explícita de documentos y acceso a originales fiscales/documentales autorizados; distinguir CFDI real, mock y resumen. Reutilizar V01/V02, sin exponer sus archivos internos automáticamente |
| V03.3 | Piloto con contactos verificados, política operativa/privacidad, recuperación y MFA propias evaluadas, despliegue HTTPS y revisión de seguridad del origen público. Requiere decisiones/recursos externos; no contratar ahora |

El catálogo público, la respuesta por enlace de V01 y el portal son accesos distintos. No hay alta automática por RFC/correo, conexión bancaria, cobro en línea o publicación del ERP. Node24; sin nuevas dependencias o gasto de hosting/dominio.

## Personal: habilitar acceso

Clientes → **Accesos al portal de clientes** (llave en tabla; **Portal** en móvil). Requiere `portal.gestionar`, inicialmente ADMIN y delegable con S01. Un autorizado administra cuentas de todos los clientes internos; el permiso no limita al empleado por sucursal/cartera.

1. Verificar identidad y autorización del contacto mediante el procedimiento del negocio. No basta conocer RFC, VIN, teléfono o correo.
2. Capturar alias único (3–80 caracteres: letras/números/punto/guion/guion bajo), nombre del contacto y motivo.
3. Crear invitación. Se muestra alias y enlace personal hasta24h. Entregarlos por un canal verificado; la aplicación **no envía mensajes**.
4. El contacto abre `/portal/activar#token=...`, define y confirma su contraseña y entra en `/portal`. El fragmento se retira de la barra/historial al iniciar la pantalla; no se guarda en Web Storage ni se envía en ruta/query/referer.
5. **Restablecer acceso** invalida contraseña, enlaces y sesiones y emite otra invitación; la cuenta queda Pendiente. **Suspender acceso** invalida todo sin emitir un enlace. Ambas acciones requieren motivo, versión vigente y confirmación.

Máximo10 accesos por cliente, incluidos suspendidos. Cada cuenta conserva cliente y alias: no se reasignan. Para otro contacto, crear otra cuenta y suspender la anterior. Una invitación usada/vencida/revocada no se reactiva al reintentar su UUID. La clave HMAC del servidor se separa por propósito de V01; cambiar JWT_SECRET requiere reemitir invitaciones aún pendientes. Nunca conservar enlaces completos en documentos/logs/capturas.

## Cliente: consulta

En `/portal`, alias y contraseña propios, independientes del personal. La pantalla restaura su sesión desde cookie HttpOnly; no utiliza el perfil ERP ni guarda JWT/tokens en localStorage/sessionStorage.

- **Pedidos:** estados distintos de Borrador, importes MXN y partidas. No se muestran notas, picking/ubicaciones internas, receptor, firmas o fotos de V02.
- **Cotizaciones:** última revisión sellada de cada familia V01 vinculada al mismo cliente tanto en documento como en snapshot. Se verifica huella. Propuestas no versionadas/borradores no se publican aquí. Consulta no equivale a aceptación ni genera reserva/pedido; V01 conserva su respuesta por enlace.
- **Documentos de venta:** tipos I/E, excluye serie global G y estado Pendiente. Estados Timbrada/Pagada/Cancelada registrados, importes y moneda original; no se agregan monedas ni se calculan deudas/cobros/utilidad. Los datos fiscales pueden ser mock.
- **Mis unidades:** VIN, ESN, económico, marca/modelo/año y motor del cliente. No expone notas, expediente D01, lecturas/mantenimiento, piezas D02 o adjuntos privados.
- **Garantías:** estado, producto, cantidad y fecha compromiso registrados para ventas del cliente. No muestra proveedores, motivo/resolución internos o evidencias; no certifica cobertura.

Páginas de20, búsqueda literal, detalle y **Descargar resumen PDF**. El PDF se genera desde la misma proyección aislada y es informativo; no es factura/CFDI, pago, aceptación, compatibilidad o cobertura. **Archivos compartidos** muestra las publicaciones V03.2; conserva su clasificación y huella y bloquea la descarga si cambió el origen. Habilitar una cuenta sigue permitiendo las consultas V03.1; publicar archivos es una autorización adicional, no un filtro de esas consultas.

La cuenta habilita lectura de los documentos incluidos de la empresa cliente, no sólo de los que creó un contacto. No hay perfiles financieros/compras por contacto, cuentas compartidas entre clientes o delegación a terceros. No es una cuenta para comprar, editar unidades, aprobar precios o tramitar garantías.

## Seguridad y persistencia

- Identidad separada de `auth_user`: `portal_acceso` fija cliente/alias/estado/version; `portal_credencial` guarda bcrypt, contador de fallos y bloqueo. Contraseña de12 caracteres como mínimo y72 bytes como máximo; el servidor limita longitud de entrada.
- Invitación HMAC de256bits, sólo hash en `portal_invitacion`,24h y un uso. Activación no inicia sesión y limpia la cookie del portal del navegador para exigir un login explícito. UUID/huella en altas/cambios, bloqueo y transacción; no duplicar una emisión ante un resultado incierto sin consultar la lista.
- `portal_sesion`: token opaco aleatorio de256bits, sólo hash,8h absolutas, revocable y ligado a versión. Máximo5 sesiones vigentes por cuenta; un nuevo login revoca las más antiguas. Salir revoca la actual; cambiar contraseña/restablecer/suspender revoca todas. No mide presencia física ni tiene vencimiento por inactividad.
- Cinco errores de contraseña bloquean15min de forma persistente, compartidos por ingreso/cambio de contraseña; respuesta de login genérica y comparación bcrypt también ante alias desconocido. Límites HTTP adicionales:5/minuto para ingreso, activación y cambio de contraseña por IP/handler; resto conserva límite global.
- Cookie `portal_session` en desarrollo, `__Host-portal_session` Secure en producción; HttpOnly, SameSite Strict y sin Domain. Path `/api/v1/portal` en desarrollo, `/` para prefijo __Host. Cookie ERP distinta y no consumida por el portal; el token externo tampoco autoriza endpoints del ERP. Un navegador que ya tenga una sesión válida del personal conserva sus permisos internos independientemente.
- Cabecera propia `X-Portal-Browser: 1`, origen exacto configurado en escrituras y rechazo cross-site. HTTPS obligatorio en producción; HTTP de desarrollo sólo loopback. El interceptor del portal no redirige al login ERP ni cierra la sesión del personal ante401.
- Cada lectura abre snapshot READ ONLY, obtiene cliente desde la sesión persistida vigente y filtra SQL por ese cliente antes de contar/paginar/detallar/exportar. IDs ajenos devuelven404 y parámetros adicionales como idCliente se rechazan. No es RLS PostgreSQL: el aislamiento es de aplicación, probado por HTTP; el rol propietario de BD conserva acceso.
- Personal revalidado bajo bloqueo (cuenta/rol/versión/permiso) dentro de sus escrituras. Operaciones externas limpian contexto del actor ERP, incluso si el navegador manda ambas cookies. Metadata/eventos auditados; credenciales, sesiones e invitaciones no se copian a auditoria_jsonb y hay un guard adicional que rechaza hacerlo. Eventos conservados con trigger ALWAYS; no es evidencia externa firmada ni protección contra DDL del propietario.
- Cambios de acceso y activación/cambio de contraseña se serializan por cuenta. Lecturas ya iniciadas pueden terminar con su snapshot mientras se revoca una sesión; las siguientes peticiones se rechazan. Cerrar el navegador no elimina automáticamente sesiones persistidas.

No activar contactos reales automáticamente ni asumir que un nombre declarado prueba identidad. La recuperación es asistida por personal autorizado y exige definir/ensayar identificación y canal de entrega antes de producción. MFA TOTP del personal no cubre estas cuentas externas. Retención/purga, avisos externos, monitoreo central y privilegios mínimos pertenecen a los pendientes operativos; no se aprueban por esta entrega.

## API

Prefijo `/api/v1`. Todas las respuestas del portal y la administración son `private, no-store`.

| Ruta | Autorización/contrato |
| --- | --- |
| GET/POST `/clientes/:cliente/portal-accesos` | Personal + portal.gestionar; listado20 o requestId/alias/nombre/motivo |
| POST `/clientes/:cliente/portal-accesos/:acceso/restablecer` o `/suspender` | Personal + permiso; requestId/version/motivo, cuenta ligada al cliente |
| POST `/portal/activar` | token/password; sin login ERP, transporte/origen/cabecera del portal |
| POST `/portal/login` | alias/password; devuelve vencimiento y cookie propia, ningún token en JSON |
| GET `/portal/sesion` | Cookie del portal; nombre/alias/cliente/vencimiento, sin idCliente |
| POST `/portal/salir` | Revoca la sesión propia |
| POST `/portal/password` | actual/nueva; revoca sesiones y exige entrar nuevamente |
| GET `/portal/documentos/:tipo` | Cookie propia, page/q; tipos pedidos/cotizaciones/facturas/unidades/garantias |
| GET `/portal/documentos/:tipo/:id` | Detalle del mismo cliente o404 |
| GET `/portal/documentos/:tipo/:id/resumen` | PDF informativo del mismo cliente, attachment/nosniff/no-store |

No hay bypass por bearer del ERP, auto-registro, cambio de cliente, impersonación administrativa, tokens en URL de API, rutas públicas de adjuntos o SQL suministrado por el usuario.

## Migración y validación

Nueva **104_portal_clientes.sql**, cinco tablas, índices de consulta por cliente/factura, permiso, guardas de identidad/eventos/secretos y auditoría de metadata. No modificar migraciones aplicadas. Respaldo previo → db:check → restauración/aceptación en copia → db:migrate → reiniciar backend/actualizar frontend. Origen sin cuentas/invitaciones/sesiones creadas automáticamente.

```
npm run db:backup
npm run db:check
npm --workspace backend run build
npm --workspace frontend run build
npm run test:customer-portal -- --backup=.backups/FECHA/database.dump
npm run db:migrate
```

`test:customer-portal` usa Node24, respaldo local y base desechable propia `verify_portal_<16hex>`. Restaura/aplica allí, crea dos empresas y contactos ficticios, usa AppModule/PostgreSQL/HTTP/Angular producción reales y elimina sólo su copia. Algunas pruebas de abuso/límite de sesiones llaman al servicio real para no desactivar el limitador HTTP; no equivalen a un ensayo de ataque distribuido. Exigir passed/cleanupPassed/copyRemoved en `.artifacts/v03-portal.json`. No imprimir contraseñas, cookies o enlaces de activación en errores/capturas. Pruebas UI con identidad personal y cliente, claro1280/oscuro390, acceso, PDFs, recarga/salida, separación de sesiones, axe/reflujo. Revisión local no equivale a piloto humano, pentest externo, TLS público o uso fiscal real.

## V03.2 — Publicación y descarga de archivos (20/10/2026)

### Personal: revisar, publicar y retirar

Clientes → **Documentos del portal** (icono de publicación en tabla; botón del mismo nombre en móvil). Requiere `portal.publicar`, independiente de `portal.gestionar`, inicialmente ADMIN y delegable con S01. Autoriza revisar/publicar para cualquier cliente interno; no restringe cartera o sucursal. No crea cuentas ni cambia las identidades existentes.

1. Elegir tipo y buscar folio. Los candidatos se filtran por cliente antes de paginar20; no es necesario conocer IDs internos.
2. **Descargar para revisar**. Abrir y revisar el archivo descargado, su destinatario y clasificación. La interfaz exige descargarlo antes de habilitar Publicar; esto no acredita que una persona lo leyó.
3. Capturar motivo. **Publicar archivo** muestra confirmación con cliente/título/ambiente y advierte que todos sus contactos activos podrán descargarlo. El servidor exige la huella del origen revisado; cambios posteriores producen409 y requieren actualizar/revisar.
4. En **Publicados y retirados**, ver estado/fecha/tamaño/huella. **Retirar archivo**, con motivo y confirmación, bloquea nuevas descargas y conserva el historial. Para reemplazarlo, retirar y publicar nuevamente con otro UUID. Reintentar el UUID original devuelve su registro, incluso retirado; nunca lo reactiva.
5. El cliente entra en **Archivos compartidos**, busca y descarga por cookie propia. No hay enlaces compartibles ni publicación en catálogo/Google. Si la fuente cambió, la tarjeta indica que requiere actualización y deshabilita Descargar.

### Qué se puede publicar

| Tipo | Origen y naturaleza | Clasificación |
| --- | --- | --- |
| XML | Bytes UTF-8 exactos de `fiscal_documento.xml_timbrado` para factura I/E del cliente, serie distinta de G, estado comercial Timbrada/Pagada/Cancelada y estado fiscal Timbrado/Cancelacion solicitada/Cancelado; UUID y XML presentes | `mock` → PRUEBA MOCK / sin validez fiscal; `sandbox` → PRUEBA PAC SANDBOX / sin validez fiscal; `production` → Producción registrada / sin consulta de vigencia SAT |
| Acuse | Bytes UTF-8 exactos de `fiscal_documento.acuse_cancelacion` conservado para esa factura; publicación separada, mismos controles de origen | Ambiente/proveedor del documento, no de la configuración actual del servidor |
| Cotización | Copia PDF generada de la última revisión sellada V01, snapshot del mismo cliente y SHA-256 verificada. Fecha/vencimiento/partidas/importes/subtotal/impuestos/retenciones/total conservados | Copia documental / no es CFDI. No es un PDF original recibido de un PAC ni acepta la propuesta |
| Entrega | Copia PDF para cliente basada en snapshot V02 verificado, pedido Entregado/Facturado del mismo cliente, folio/cliente/fecha/partidas | Copia documental / no es CFDI. Omite receptor, notas, motivo sin evidencia, autor, ubicación, firma y fotos |

No se ofrecen PDF fiscales reconstruidos como si fueran originales, REP, facturas globales, archivos arbitrarios, URLs externas, CSD, claves, payloads de proveedor, ni originales de firma/foto V02. Estos últimos permanecen en su expediente privado con sus permisos anteriores. Entregas históricas sin snapshot V02 y propuestas sin revisión V01 no generan originales ficticios. La publicación no verifica vigencia SAT, aceptación, pago, identidad o cobertura. Un documento cancelado se conserva como documento histórico, no como comprobante vigente.

### Conservación y seguridad

- Migración nueva **105_portal_publicaciones.sql**: metadata, archivo bytea separado y retiro append-only; tres tablas vacías al aplicar, sin publicaciones automáticas. Triggers ALWAYS bloquean UPDATE/DELETE/TRUNCATE; sólo metadata/retiro entran en auditoría con actor interno. Guard de auditoría rechaza archivos además de los secretos V03.1. No modifica migraciones104/anteriores.
- Cada archivo tiene SHA-256 y tamaño. Máximo **2MiB** por archivo y **500 publicaciones activas por cliente**; listar/contar20 por página. Retiros no borran bytes; el historial consume almacenamiento y requiere definir retención/backups en V03.3.
- Transacción con permiso/rol/versión vigente del personal bloqueado FOR SHARE, cliente bloqueado y UUID/huella global del flujo; una publicación activa por origen mediante serialización por cliente. Metadata y bytes se confirman juntos o se revierten juntos. Un UUID no identifica otra operación/cliente.
- XML sólo desde el módulo fiscal; no se interpreta, no se transforma ni se presenta inline. Rechaza DTD/ENTITY, ambiente/proveedor incompatible y marcas mock en un documento registrado como producción. El modo lo decide el servidor; la API no acepta una clasificación proporcionada por el navegador. Esto no es validación criptográfica del CFDI ni un antivirus.
- Cada lista/descarga valida sesión externa propia. La descarga vuelve a filtrar propietario/estado/revisión y compara la huella actual con la publicada antes de verificar los bytes guardados. Reasignar un origen no transfiere una publicación al nuevo cliente. Cambiar XML/ambiente/estado fiscal o sustituir la última revisión bloquea la descarga hasta retirar/republicar. Estado comercial de factura o pedido se vuelve a comprobar; no se suman monedas.
- `private, no-store`, attachment, nosniff, nombres técnicos sin nombres de personas; ninguna ruta de disco, token de URL o ID de cliente aceptado para ampliar alcance externo. Requests ya iniciados con snapshot válido pueden terminar durante un retiro/revocación; las siguientes descargas quedan bloqueadas. No se recuperan copias ya descargadas. No hay CDN ni caché de archivos compartidos.
- Vista previa10/min, publicación10/min, retiro10/min y descarga externa30/min por IP/handler, además del límite general. Las pruebas de concurrencia utilizan el servicio real para no desactivar estos límites.

### HTTP adicional (prefijo `/api/v1`)

| Método y ruta | Contrato |
| --- | --- |
| GET `/clientes/:cliente/portal-publicaciones` | Personal + portal.publicar; page, historial20, disponibilidad actual |
| GET `/clientes/:cliente/portal-publicaciones/candidatos/:tipo` | Tipo xml/acuse/cotizacion/entrega, page/q; metadata mínima/huella de origen |
| POST `/clientes/:cliente/portal-publicaciones/vista-previa` | tipo/origen; archivo attachment para revisar, sin guardar publicación |
| POST `/clientes/:cliente/portal-publicaciones` | tipo/origen/origenSha256/requestId/motivo;409 si cambió el origen o ya existe activo |
| POST `/clientes/:cliente/portal-publicaciones/:id/retirar` | requestId/motivo; publicación del cliente o404; conserva registro |
| GET `/portal/archivos` | Sesión propia, page/q; metadata mínima sin actor/motivo/IDs de cliente/origen; estado disponible |
| GET `/portal/archivos/:id/descarga` | Sesión propia + propietario/origen/huellas; ajeno/retirado/cambiado404; integridad503 |

### Validar V03.2

Con Node24 y builds terminados, `npm run test:portal-publications -- --backup=.backups/FECHA/database.dump`. Extiende el verificador V03.1 sobre su copia `verify_portal_<16hex>`; aplica105 allí, utiliza PAC **mock real**, AppModule/PostgreSQL/HTTP/Angular reales y elimina sólo su copia. Reporte `.artifacts/v032-publicaciones.json`; exigir `passed`, `cleanupPassed` y `copyRemoved`. Incluye regresión V03.1, dos clientes, archivos y metadatos aislados, retiro/idempotencia/concurrencia, guardas/auditoría/rollback, origen cambiado/reasignado, límite de XML/proveniencia y flujo UI personal/cliente claro1280/oscuro390 con axe/reflujo. PDF para cliente inspeccionado por separado; ninguna prueba equivale a timbrado PAC real, piloto humano o despliegue público. Resultados efectivos y respaldos en README.
