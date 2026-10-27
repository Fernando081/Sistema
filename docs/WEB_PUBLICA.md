# Web pública: arquitectura y diseño

## Estado — 2026-10-05

WEB02.1 tiene una aplicación independiente y un prototipo usable. La aprobación visual del propietario sigue pendiente; WEB02.1 y WEB02 siguen parciales. WEB01.3b no tiene lote real aprobado. No hay despliegue público ni indexación, productos, precios o canales de contacto inventados. El catálogo operativo y las credenciales del ERP no se consultan desde este prototipo.

## Aplicación y comandos

Código en public-web/. Node.js 24, sin dependencias de producción ni JavaScript cliente. Es un paquete independiente, no otro bundle Angular ni un workspace del ERP. Las herramientas de pruebas visuales existentes del repositorio se reutilizan solo en desarrollo; no se distribuyen al navegador.

Desde C:\Sistema, con Node 24 en PATH:

```powershell
npm run build:web-publica
npm run start:web-publica
# http://127.0.0.1:4500
npm run test:web-publica
npm run test:web-publica-ui
npm run verify:web-publica
```

También se puede usar `powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify:web-publica`. PUBLIC_WEB_PORT permite otro puerto entre 1024 y 65535. El servidor siempre escucha en 127.0.0.1; no es un servidor de producción. npm run build incluye el build de esta aplicación. npm run verify incluye verify:web-publica al final; los checks específicos del ERP no sustituyen esa batería.

build.mjs genera HTML/CSS, robots.txt y routes.json en public-web/dist/. server.mjs usa una lista explícita de rutas: no sirve el directorio del repositorio, .env, manifiesto, uploads ni API privada. Responde 404 a desconocidos, 405 a métodos distintos de GET/HEAD y redirige slash final conocido con 308. Sin cookies, formularios de envío ni acceso a PostgreSQL.

## Decisión de arquitectura

| Criterio                               | SSG: generar HTML antes de publicar                     | SSR: generar HTML en cada solicitud                                    |
| -------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Contenido inicial                      | HTML completo sin depender de JavaScript                | HTML completo si el servidor responde correctamente                    |
| Dependencias en cada visita            | Archivos de la versión publicada                        | Servidor de aplicación/API y reglas de caché                           |
| Actualizaciones                        | Requieren regenerar e invalidar la versión/caché        | Pueden consultar datos recientes; requieren límites y control de caché |
| Disponibilidad                         | Se puede distribuir como archivos/CDN                   | Requiere operación y monitoreo del servidor                            |
| Catálogo muy grande/cambios frecuentes | Evaluar generación incremental y tiempos de publicación | Evaluar coste, caché y protección del API                              |

Se elige SSG para la base del sitio y páginas informativas. El prototipo comprueba HTML inicial, navegación sin JS y build reproducible con una infraestructura pequeña. No es una comparación de rendimiento medida contra un servidor SSR. WEB03 debe validar tamaño real del catálogo/tiempos de publicación antes de adoptar SSG para todas las fichas o añadir SSR para búsqueda. Usar HTML inicial es coherente con la [guía de JavaScript SEO de Google](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics); no garantiza indexación ni posiciones.

### Contrato futuro y publicación

WEB03 implementará una fuente pública de campos permitidos y un paso explícito de publicación de fichas aprobadas. El navegador y el generador no deben llamar endpoints administrativos autenticados con credenciales del ERP. No reutilizar consultas privadas ni entregar precios/costos/márgenes/clientes/VIN/ESN/documentos fiscales.

Propuesta para WEB03/04: generar una versión inmutable desde un manifiesto autorizado; escapar todo texto de producto; incorporar solo fotografías autorizadas seleccionadas; validar URL/canonical, enlaces y presupuesto; publicar atómicamente; retirar/invalidar fichas y cachés al cambiar aprobación; permitir rollback de la versión. La retirada debe tener tratamiento HTTP/SEO explícito. Ninguna de estas operaciones de publicación, CDN/invalidez o conexión con el ERP está implementada todavía. El build actual no limpia recursivamente directorios ni es un despliegue.

WEB04 decidirá dominio, HTTPS, alojamiento/CDN, staging protegido y backup/rollback real. No se compraron servicios ni se transfirieron datos a terceros. No hay integración bancaria.

## Diseño

Azul oscuro, papel claro y dorado; títulos grandes, jerarquía técnica, espacios amplios y controles con foco visible. El nombre muestra Refacciones y Tractorepuestos y debajo Tampico con el mismo tamaño. Tipografía del sistema sin fuentes externas. Ilustración geométrica CSS propia, no una foto ni una refacción real. Sin logos de proveedores ni afirmaciones de certificaciones, años de experiencia, stock o cobertura geográfica no confirmados.

Rutas actuales:

- /: propuesta de inicio e identidad.
- /catalogo: estado vacío real, sin fichas publicadas.
- /categorias: categorías pendientes de productos aprobados.
- /nosotros: negocio familiar de refacciones diésel y espacio para historia confirmada.
- /marcas: únicamente marcas confirmadas; actualmente vacío.
- /contacto: estructura sin teléfono/dirección/horarios inventados.
- /diseno/ficha: estructura de ficha con etiquetas de diseño, sin SKU de ejemplo ni producto real.
- /diseno/categoria: estructura de categoría sin productos ficticios.
- /404: página de error con estado HTTP 404.

Las rutas /diseno son para revisar la propuesta, no fichas comerciales. No hay buscador funcional, cotización, WhatsApp o conexión CRM; continúan en WEB03/05. No se publica marca/categoría inferida a partir de datos de prueba.

## Presupuesto y validación

Guard de build: máximo 50 000 bytes sin comprimir de HTML de una página + CSS compartido del prototipo; JavaScript cliente actual 0 bytes. Después de formato, máximo medido 14 354 bytes. No incluye fotografías futuras, cabeceras HTTP, compresión ni métricas reales de navegación/servidor. WEB02.3/04 ampliarán presupuesto por imágenes y medirán rendimiento real antes de publicar; no reutilizar el presupuesto Angular del ERP como si fuera el del sitio público.

Cinco pruebas Node validan HTML/enlaces, servidor, seguridad y rutas; usan archivos temporales propios y los eliminan con verificación de ruta. Dieciocho Playwright revisan ocho vistas y teclado/reflujo adicional en 390/1440, navegación con JavaScript deshabilitado, desbordamiento y axe WCAG A/AA. Sin infracciones serias/críticas en las vistas probadas. Capturas .artifacts/web021-*.png; inicio escritorio y ficha móvil revisados. No certifica fotos comerciales, datos de catálogo, SEO en Google ni disponibilidad de alojamiento.

Servidor local: CSP sin scripts y recursos externos, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, no-store, X-Robots-Tag noindex/nofollow; HTML noindex/nofollow y robots.txt Disallow /. Estas medidas evitan indexar el prototipo, pero no sustituyen autenticación para un staging publicado. No se quitarán al entregar una vista local; lanzamiento requiere WEB04.

## Pendientes que necesitan datos reales

WEB02.2: teléfono/WhatsApp público, dirección, horarios, historia familiar confirmada, alcance de servicio, marcas reales, logotipo/fotografías autorizadas y políticas. WEB01.3b: 5–10 números de parte iniciales, revisión técnica/equivalencias/fotos/licencias y aprobación del lote. No marcar esos pasos como completados por terminar un prototipo.

## WEB02.2 — páginas del negocio y configuración pública

WEB02.2a técnico implementado; WEB02.2b y la fase completa permanecen pendientes de contenido real. Las nueve rutas incluyen Nosotros y Marcas. Breadcrumbs en páginas interiores y navegación adaptable a móvil; títulos largos se ajustan sin desbordamiento. Las categorías y productos siguen vacíos hasta aprobar y publicar fichas. Las marcas actualmente no tienen filtros de productos: eso corresponde a WEB03.

`public-web/business.json` contiene exclusivamente información destinada a publicarse. Nunca guardar secretos, datos fiscales ni información privada del ERP. Contacto usa campos phone, whatsapp, email, address, hours y serviceArea con value y confirmed; historia usa story.confirmed y story.paragraphs; marcas usa una lista brands con name y confirmed. Solo campos confirmados se incorporan al HTML generado. El archivo de configuración no se sirve desde el preview.

El build valida claves permitidas, tipos, límites de texto, teléfonos con prefijo internacional (+ y entre 8 y 15 dígitos), correo, marcas duplicadas y valores confirmados vacíos. Escapa texto antes de incorporarlo al HTML. Los datos sin confirmar se excluyen del HTML; no se ocultan simplemente con CSS. Confirmed es una decisión editorial del propietario, no una comprobación externa de veracidad. No se extraen datos de PostgreSQL ni del ERP.

Al confirmar canales se generan enlaces tel, mailto y WhatsApp; solo actúan cuando el visitante los selecciona. No hay API de WhatsApp, mensajes automáticos, mapas externos, formulario ni conexión CRM. No se muestran logos o afirmaciones de distribución autorizada. Actualmente los campos están vacíos y sin confirmar.

Para actualizar contenido: editar los datos públicos confirmados, ejecutar build:web-publica y reiniciar el preview. El servidor carga el manifiesto al iniciar; añadir rutas requiere reinicio. Las pruebas UI usan un servidor propio en 4501 y no reutilizan el preview 4500 para evitar validar una versión anterior.

Validación de esta fase: cuatro pruebas Node (incluyen exclusión de datos sin confirmar, escape HTML y rechazo de configuración inválida) y dieciséis UI sobre ocho vistas en 390/1440. Los datos sintéticos de pruebas están solo en memoria. Capturas .artifacts/web021-*.png. Sin migraciones ni cambios al ERP. Siguiente desarrollo independiente: WEB02.3, rendimiento y experiencia; datos reales y aprobación visual siguen abiertos.


## WEB02.3 — experiencia y rendimiento de la base

WEB02.3a implementado; WEB02.3b pendiente de contenido y validación real. Navegación móvil visible en tres columnas sin scripts; enlaces principales, breadcrumbs y acciones de texto con mínimo de 44 px de altura. Reflujo adicional a 320/768, foco/salto al contenido comprobados con teclado y reglas para colores forzados. No hay carga remota del catálogo: los estados vacío/404 son reales, no se muestran indicadores de carga ficticios.

Los límites están centralizados en public-web/budget.mjs: 50 000 bytes HTML+CSS, 20 000 CSS, 15 000 por página+CSS con gzip y Brotli. Se verifican antes de escribir archivos; dist/budget-report.json registra medidas por ruta y no se sirve por HTTP. Máximo actual 14 354 bytes iniciales, 4 221 gzip, 3 438 Brotli; CSS 10 902 bytes. JS cliente cero. La compresión es un cálculo de build, no está activada en el preview. No son tiempos de carga, Core Web Vitals ni una medición en conexión móvil. Imágenes reales/transferencia total/cabeceras y métricas de navegación requieren WEB02.3b/WEB04.

Cinco pruebas Node y dieciocho UI aprobadas. Ocho vistas en 390/1440 y pruebas adicionales de reflujo/teclado en 320/768. Axe sin infracciones serias/críticas en vistas comprobadas; no equivale a certificación completa de accesibilidad. Capturas .artifacts/web021-*.png. No se implementó un buscador inoperante ni se inventaron productos/fotos. WEB03.1 es el siguiente desarrollo independiente; fotos optimizadas y búsqueda se validarán con sus datos reales autorizados.

## WEB03.1a — contrato inicial del catálogo público

public-web/catalog.json es un manifiesto editorial independiente, actualmente schemaVersion 1 y products vacío. No exportar aquí respuestas administrativas completas, snapshots sin revisar ni SELECT *. No existe sincronización automática con el ERP. Estado listo de web_producto_ficha NO equivale a publicado ni autoriza llenar el manifiesto automáticamente.

Cada producto exige únicamente slug, status (draft/published/retired), approved booleano, code, brand, category, title, description, applications, references y specifications (name/value/unit). Applications y references son listas de textos comerciales revisados; no incluyen identificadores privados ni fuentes internas. La versión inicial no admite precios, stock, clientes, VIN, ESN, tokens, imágenes o equivalencias por ID. Los campos desconocidos hacen fallar el build, incluso en registros no publicables. Solo published + approved true genera ficha. Approved es una decisión editorial manual, no autenticación ni evidencia automática de derechos/compatibilidad.

El generador valida límites, tipos, slugs y duplicados, reconstruye los campos permitidos y escapa texto. Genera /productos/<slug> con marca, código original, categoría, descripción, aplicaciones/restricciones, referencias y características/unidades en HTML inicial; enlaza desde /catalogo sin depender de JavaScript. No muestra fotografías ficticias ni disponibilidad/precio inferidos. El enlace a Contacto es general: no implementa aún la cotización contextual de WEB03.3. Canonical/metadatos por ficha y sitemap quedan en WEB03.4.

El servidor solo sirve el manifiesto de rutas generado, no catalog.json ni el repositorio. Una ficha excluida no tiene ruta en un build nuevo. Para retirar una ficha de un preview ya iniciado hay que regenerar y reiniciar (carga rutas al inicio). Los archivos anteriores pueden permanecer en dist, pero no se sirven si no están en routes.json. Esto no equivale todavía a invalidación inmediata de cachés, publicación atómica, rollback, autenticación editorial o retiro de un sitio público. No exponer dist entero mediante otro servidor sin implementar el publicador previsto.

Pruebas: exclusión de draft/retired/no aprobado, rechazo de campos privados y slugs ambiguos/duplicados, escape HTML, contenido inicial y enlaces. Fixtures únicamente en memoria; catalog.json continúa vacío. Ocho pruebas Node y dieciocho UI generales aprobadas. Las pruebas UI actuales no validan fichas comerciales pobladas ni fotos reales. WEB03.1 sigue parcial: exportador ERP controlado, medios autorizados/zoom, alternativas, flujo de publicación/retiro y validación integral del lote pendientes. Siguiente: completar WEB03.1b antes de declarar fichas listas para lanzamiento.

## WEB03.1b — exportación administrativa inicial

GET /api/v1/web-catalog/admin/products/:id/export-candidate, protegido por sesión y rol ADMIN, devuelve un manifiesto candidato schemaVersion 1. Consulta parametrizada en snapshot de solo lectura; exige estado listo y las tres confirmaciones (datos reales, derechos de imágenes y compatibilidad). Ficha inexistente: 404; preparación incompleta: 400. No modifica la ficha, no publica y no cambia confirmaciones.

Proyección explícita desde snapshot comercial: código, marca, categoría, título/descripcion, aplicaciones con restricciones, números de parte y especificaciones/unidades. Se omiten costos/precios, datos personales, fotos privadas, fuentes/notas internas, IDs de equivalentes y datos fiscales. Los campos obligatorios vacíos o listas inválidas se rechazan. La respuesta mantiene status draft y approved false: no aparece en la web aunque se copie tal cual al manifiesto. Solo un proceso editorial posterior puede decidir publicación; listo NO significa publicado.

Esta entrega no descarga ni copia respuestas operativas al sitio, no añade botón en el ERP, exportación masiva, aprobación persistida de publicación, imágenes/zoom ni sincronización de retiro. No exponer el endpoint en la web pública ni añadir credenciales del ERP al navegador/generador. Mantener catalog.json vacío hasta aprobar el lote. WEB03.1b sigue parcial: siguiente entrega debe completar flujo editorial/publicador y medios autorizados; lanzamiento y retiro con caché/rollback siguen pendientes. Pruebas actuales usan mocks, no exportaron datos operativos reales.

## WEB03.1b — descarga desde el editor ERP

Dentro de Producto → Editar producto → Ficha web (también accesible desde la revisión de /catalogo-web), usar Descargar candidata después de guardar la ficha como lista y confirmar los requisitos. El botón permanece deshabilitado durante carga/guardado/descarga, conflictos, cambios de formulario sin guardar o revisión incompleta. Solicita el endpoint administrativo con la sesión del ERP; la web pública no recibe credenciales.

El navegador descarga ficha-candidata-<id>.json usando un Blob local y libera su URL temporal. El archivo conserva draft/approved false. La descarga no instala contenido en catalog.json, no publica, no retira fichas ni sincroniza el sitio. El mensaje indica explícitamente este alcance. Durante la petición no se permite iniciar otra descarga/guardado/recarga. Si hay un error, muestra el mensaje y recupera el control para reintentar.

Pendientes de WEB03.1b: aprobación editorial persistida y auditable, publicador/retiro reproducibles, exportación de medios autorizados/zoom, alternativas y validación integral del lote real. No confundir el botón de descarga con publicación. Las pruebas de pantalla usan respuestas simuladas; no aprobaron productos operativos.

## WEB03.1b — activación local por versiones y aprobación vinculada

public-web/publish.mjs prepara una versión completa e independiente en dist/releases/<UUID técnico>. Solo cambia current-release.json mediante rename después de validar contrato/presupuesto y terminar archivos/registro de aprobación. Un lock exclusivo evita dos activaciones simultáneas. UUID identifica una versión técnica, no un timbre fiscal. No borra versiones anteriores ni despliega en Internet. Un fallo conserva el puntero anterior; pueden quedar versiones incompletas inactivas. No implementa todavía recuperación de lock tras caída ni limpieza/rollback con verificación de integridad.

Uso con Node 24: `node public-web/publish.mjs ruta-manifiesto.json ruta-aprobacion.json`. El archivo de aprobación exige sha256 (hash exacto del contenido UTF-8 del manifiesto), reviewer (identidad editorial, máximo 100 caracteres) y decision con valor approve-local-preview. Revisar manifiesto y evidencia de contenido antes de crear esa aprobación. No incluir contraseñas/tokens. No se genera ni infiere aprobación automáticamente. El registro persistido approval.json contiene hash, revisor, fecha y slugs. Es trazabilidad local declarativa: no firma digital, autenticación del revisor ni aprobación auditada dentro del ERP. Requiere acceso confiable al sistema de archivos; no es una API pública.

Exportar una candidata sigue produciendo draft/approved false. Para una activación local explícita, el responsable revisa el manifiesto y selecciona los productos con published/approved true; el publicador no cambia esos valores. Vaciar el manifiesto o pasar fichas a retired las excluye de la nueva versión. El servidor actualizado lee el puntero una vez por petición y usa archivos de esa versión, evitando mezclar páginas durante activación. El retiro responde 404 en nuevas peticiones sin reiniciar; una petición ya iniciada puede terminar con la versión anterior. Preview conserva no-store/noindex. CDN/HTTPS/cache de producción siguen pendientes en WEB04.

current-release.json, approval.json y directorios releases no se sirven por HTTP. Sin puntero se conserva el build local tradicional dist. El servidor debe reiniciarse una vez para cargar este código nuevo; posteriores activaciones no requieren reinicio. Build:web-publica no modifica un puntero activo. Activaciones pueden cambiar contenido de páginas informativas porque build usa la configuración pública vigente; la aprobación por hash cubre el manifiesto de productos, no firma todo el sitio.

Validación: nueve pruebas Node y dieciocho UI generales. Prueba HTTP con versión temporal: ficha aprobada 200, retiro 404 sin reinicio, archivos editoriales inaccesibles y fallo de validación conserva versión activa. Fixtures únicamente en temporales propios; no activó productos operativos. WEB03.1b parcial: aprobación autenticada/persistida en ERP, fotos/zoom, alternativas, rollback operativo y lote real/UI integral siguen abiertos.

## WEB03.1b — rollback local e integridad

Las versiones nuevas incluyen integrity.json con SHA-256 de todos los archivos servidos y routes.json, approval.json y budget-report.json. Su hash se guarda en el puntero. Rollback valida el UUID, el hash esperado de integrity.json, todos sus archivos y la permanencia de rutas resueltas dentro de la versión. Rechaza rutas con traversal y archivos ausentes/alterados. Versiones anteriores a esta entrega sin sello no son elegibles para rollback; deben regenerarse con nueva revisión.

Comando Node 24: `node public-web/publish.mjs --rollback UUID ruta-aprobacion-rollback.json`. Aprobación exige integrity (hash exacto del integrity.json de la versión revisada), reviewer y decision igual a approve-local-rollback. No reutilizar aprobación de publicación. Tras verificación usa el mismo lock exclusivo y cambio de puntero por rename; guarda rollback-UUID.json con revisor/fecha/destino. Los registros locales no son expuestos por HTTP. No elimina versiones ni crea aprobación automáticamente.

Rollback restaura toda la versión, incluidos productos retirados después: revisar su contenido antes de aprobarlo. Hashes son controles de integridad local, no firmas digitales ni autenticación del operador; quien puede alterar archivos y aprobaciones puede sustituirlos. El servidor no verifica todos los hashes por petición: mantener versiones inmutables mediante permisos de operación (aún no configurados aquí). Lock huérfano tras caída sigue pendiente: no se borra automáticamente porque podría haber publicador activo. Tampoco se implementa limpieza automática ni rollback de hosting/CDN.

Prueba temporal comprueba publicación/retiro, rollback con ficha 200 sin reinicio, rechazo de identificador traversal y de HTML alterado. Nueve pruebas Node y dieciocho UI generales aprobadas; no se restauró ni activó contenido operativo. WEB03.1b permanece parcial por medios autorizados, aprobación ERP y lote real.

## WEB03.1b — medios públicos seleccionados (base PNG)

Contrato v1 admite images opcional por producto: lista de hasta 8 objetos con file, sha256, alt, width, height y authorized true. Copiar manualmente solo PNG revisados y autorizados a public-web/media-approved; no apuntar a uploads del ERP ni copiar toda esa carpeta. Nombre de archivo simple sin rutas, URL remota o SVG. Alt obligatorio, dimensiones enteras 1–4096. La aprobación del manifiesto cubre el hash de cada imagen; authorized es confirmación editorial, no comprobación legal automática.

Build/publicador lee únicamente los archivos seleccionados de productos publicables, verifica ruta resuelta dentro de media-approved, firma PNG/IHDR, dimensiones declaradas, hash y límite 250 000 bytes por archivo/8 000 000 por versión. Solo estos archivos se copian como /media/<sha256>.png y se añaden al allowlist HTTP con image/png. Retiro elimina sus rutas de la nueva versión; sello/rollback incluye los medios. La carpeta fuente no se sirve.

Fichas muestran imagen con alt, dimensiones para reservar espacio, tamaño adaptable y decoding async; primera eager, posteriores lazy. Enlace permite abrir imagen completa sin scripts; no implementa aún zoom interactivo. No hay transformación, recompresión, srcset, AVIF/WebP, eliminación de metadatos o decodificación completa en build: validar imágenes reales/metadata antes de seleccionarlas; encabezado/hash no demuestran que todo PNG sea decodificable. No subir archivos sensibles. Estas tareas siguen pendientes antes de publicar.

Prueba sintética PNG 1x1 solo en temporal: lectura seleccionada, HTML/alt/dimensiones y rechazo por falta de autorización/traversal/dimensiones erróneas/archivo alterado. Diez pruebas Node y dieciocho UI generales aprobadas; UI no validó fotos comerciales reales. Catálogo operativo continúa vacío y no se copió imagen real del ERP. WEB03.1b y WEB02.3b permanecen parciales; siguiente: aprobación ERP, imágenes optimizadas/zoom y aceptación del lote.

## WEB03.1b — alternativas públicas revisadas

Contrato admite alternatives opcional: hasta 12 slugs públicos distintos por ficha, sin enlaces a sí misma ni rutas arbitrarias. Solo los productos publicados/aprobados pueden ser destinos. Se eligen editorialmente; no se extraen automáticamente IDs/equivalencias del ERP. La aprobación por hash del manifiesto cubre la selección. No es una comprobación mecánica de intercambiabilidad: revisar compatibilidad/restricciones con evidencia real antes de aprobarla.

El build rechaza alternativas que no existan en el conjunto publicable (incluyendo draft, retired o approved false). Al retirar una ficha, quitar también los enlaces hacia ella o el build falla antes de activar; conserva versión anterior. Ficha incluye tarjetas con título, marca/código original, enlace directo y recordatorio de revisar aplicaciones/restricciones. No infiere stock/precio ni oculta diferencias de números originales.

Once pruebas Node y diecinueve UI aprobadas: destino publicable, rechazo de borrador/retirado/no aprobado, duplicados/traversal/autorreferencia; prueba móvil con HTML de fichas interceptado y fixture solo en memoria, enlace hacia alternativa y axe sin problemas serios/críticos. No publica productos ficticios ni valida compatibilidad real. Catálogo operativo vacío. WEB03.1b sigue parcial por aprobación autenticada ERP, optimización/zoom, aceptación real y operación; siguiente prioridad técnica: aprobación ERP.

## WEB03.1b — aprobación autenticada inicial en ERP

POST /api/v1/web-catalog/admin/products/:id/approve-candidate con sesión ADMIN y cuerpo version (entero >=1), confirmed true. Exige usuario persistido, bloquea fila en transacción y compara versión; cambios posteriores a revisión: 409, ficha inexistente: 404, preparación/confirmación incompleta: 400. No activa el sitio ni cambia estado de preparación.

Proyecta campos comerciales, produce raw (JSON exacto con published/approved true), su sha256 y recibo id/fecha. Registra en auditoria_jsonb table_name web_catalog_approval/action APPROVE: usuario de sesión, producto, versión, slug y hash, sin notas internas/costos/clientes. Reutiliza la bitácora existente, sin migración nueva. No se invocó con productos operativos; pruebas unitarias/HTTP simulan base y autenticación.

El recibo es evidencia administrativa de esa versión y proyección, no una aprobación permanente de futuras ediciones. No incluye todavía imágenes/alternativas agregadas manualmente al manifiesto ni evidencia mecánica. Falta UI para revisar/aprobar/descargar, consulta de vigencia/revocación y conexión que verifique este recibo en el publicador. El publicador local conserva su aprobación declarativa por archivos; NO valida automáticamente la aprobación ERP. Cambiar el raw cambia el hash y requiere revisión posterior. Esta base no cierra WEB03.1b ni autoriza a publicar datos de prueba.

## WEB03.1b — pantalla de aprobación editorial

Producto → Editar producto → Ficha web incluye confirmación separada Revisé la versión guardada y autorizo registrar su aprobación editorial y botón Registrar aprobación y descargar. Requiere ficha lista, revisión completa, versión cargada sin cambios pendientes/conflicto y sin otra operación. POST autenticado envía version/confirmed; no crea aprobación por entrar al editor, guardar borrador o exportar candidata.

Descarga ficha-aprobada-<id>.json con raw exacto devuelto por backend, sin parsear/reformatear y alterar su SHA-256. Muestra recibo id/fecha/hash y aclara que no activó sitio. Edición de contenido, carga o guardado limpia confirmación/recibo visibles; no revoca automáticamente un evento histórico de auditoría. Conflicto 409 conserva texto y exige recargar. La sesión obtiene autoridad del endpoint ADMIN, no de la casilla por sí sola.

Pendientes: consulta de vigencia/revocación, evidencia persistida de medios/alternativas y verificación del recibo por publicador. Actualmente el publicador local no consulta ERP ni acepta automáticamente este recibo; descarga no activa versiones. Las pruebas UI usan API simulada, sin aprobar fichas operativas ni escribir base real.

## WEB03.1b — vigencia y revocación del backend

GET /api/v1/web-catalog/admin/products/:id/approvals/:receipt (ADMIN): recibo asociado a ficha, versión/hash/revoked/active. Active requiere ficha actual lista, tres confirmaciones, versión idéntica, SHA-256 de proyección actual idéntico y ausencia de revocación. Consulta en snapshot de solo lectura; no revela datos comerciales privados. Recibo inexistente/de otra ficha: 404. No verifica derechos/compatibilidad externamente ni cambios del maestro no guardados en snapshot; revisar el maestro antes de aprobar/publicar.

POST a la misma ruta con sufijo /revoke, cuerpo confirmed true (ADMIN). Bloquea ficha y verifica pertenencia del recibo; añade REVOKE en auditoria_jsonb con usuario/fecha y conserva APPROVE. Repetir revocación no duplica evento bajo ese bloqueo. No borra historia ni impide una nueva aprobación posterior. No retira automáticamente versiones ya activadas ni invalida CDN; falta conectar el publicador y el control editorial.

Quince unitarias dirigidas y nueve HTTP aprobadas: hash positivo/negativo, versiones anteriores, revocados, recibo de otra ficha, confirmación, revocación repetida y permisos/DTO. Base y autenticación simuladas; no se aprobó/revocó operación real. Sin migración nueva. Pendientes UI de vigencia/revocación, verificación de recibo por publicador, prueba SQL real aislada y tratamiento de retiro de contenido activo. WEB03.1b sigue parcial.

## WEB03.1b — controles de vigencia y revocación en el editor

Producto → Ficha web incorpora número de recibo y Consultar vigencia. Después de aprobar, el número se propone automáticamente; también permite consultar un recibo anterior del mismo producto. Resultado: versión/hash y vigente al consultar, no vigente o revocado. Es una consulta puntual, no monitoreo automático ni certificado para activar el sitio. Entrada inválida/no encontrada no conserva un resultado anterior.

Revocar recibo exige consultar primero y marcar Confirmo revocar este recibo; bloquea operaciones duplicadas y recibos ya revocados. Muestra explícitamente que el retiro de versiones activas se hace por separado. Cambiar número, editar, cargar o guardar limpia resultado/confirmación visibles; no borra eventos auditados. Error de revocación limpia resultado y exige volver a consultar. No revoca automáticamente por cerrar el editor.

Frontend con 64 unitarias aprobadas (12 del editor dirigidas también) y cuatro Playwright en claro/oscuro y móvil/escritorio: aprobación, consulta, confirmación y revocación con API simulada. No escritura operativa. La primera ejecución completa tuvo un fallo no reproducido en la repetición; la final pasó completa. WEB03.1b mantiene verificación de recibo por publicador y prueba SQL aislada pendientes, además del lote/medios optimizados.

## WEB03.1b — verificación opcional del recibo ERP en publicador local

Aprobación local puede incluir erpReceipt con productId y receiptId. Publicador consulta ruta administrativa de vigencia antes de construir y antes del cambio de puntero. Exige active true, revoked false, IDs/version válidos y SHA-256 del raw exacto; rechazo/error/redirección/timeout impide activar. PUBLIC_WEB_REQUIRE_ERP=1 hace obligatorio erpReceipt; sin esa política se conserva modo declarativo para previews de desarrollo. No afirmar que toda activación/rollback tiene verificación ERP: rollback local aún no consulta esos recibos.

PUBLIC_WEB_ERP_URL debe ser http://127.0.0.1:puerto/api/v1/ (predeterminado puerto 3100); no admite otros hosts, credenciales en URL, query/hash o redirecciones. PUBLIC_WEB_ERP_TOKEN contiene sesión administrativa temporal solo en entorno del proceso; no escribirla en JSON/README, argumentos CLI ni logs. Verificación ejecutada por el publicador, nunca navegador público. Limpiar variable al terminar. No conecta bancos ni servicios externos.

verifiedReceipt (IDs/version/hash) queda registrado en aprobación local, sin token. Por ahora un recibo cubre exactamente el manifiesto individual aprobado: combinar fichas o agregar fotos/alternativas cambia hash y falla; falta aprobación de lote completo. Existe ventana entre última comprobación y activación; no bloqueo distribuido ni revocación automática del sitio activo. Falta prueba SQL real aislada y conexión real con ERP; pruebas actuales simulan respuestas de fetch, no usaron token operativo. Esta implementación no cierra WEB03.1b ni lanzamiento.

## WEB03.1b — verificación SQL real aislada

Desde raíz, Node 24: npm run verify:web-approvals-sql. Compila backend y ejecuta backend/scratch/verify-web-approvals.js con configuración DB local existente (no imprime secretos). Exige permisos para crear esquema temporal. No agrega migración operativa ni cambia el catálogo real.

Crea esquema aleatorio dentro de BEGIN, search_path exclusivo sin public; aplica DDL 088 solo allí y crea auditoría mínima con identidad propia/FK a usuario temporal (sin usar secuencias operativas). Ejecuta métodos reales del servicio usando cliente PostgreSQL y savepoints para errores esperados. Lecturas de vigencia usan misma conexión/transacción aislada, no prueban la configuración READ ONLY/REPEATABLE READ de TypeORM en producción. Al terminar ROLLBACK y consulta pg_namespace para comprobar ausencia del esquema.

Casos: aprobación/recibo/hash vigente, campos privados excluidos, recibo de otra ficha, contenido cambiado con misma versión invalida hash, usuario inexistente falla FK, versión anterior inactiva/conflicto al aprobar, nueva aprobación, revocación repetida sin duplicado, usuario y eventos auditados conservados. Verificado con PostgreSQL real. No prueba triggers globales, concurrencia entre conexiones, HTTP/login real o activación de lote comercial; pruebas existentes cubren HTTP con mocks. Verificación real del publicador contra sesión operativa sigue pendiente. WEB03.1b mantiene aprobación integral de lote/medios/alternativas, optimización/zoom y operación pendientes.

## WEB03.1b — aprobación inicial de lote completo

POST /api/v1/web-catalog/admin/products/batch/approve (ADMIN). Body: raw (JSON exacto, máximo 200 000 caracteres), members [{productId,version}] y confirmed true. Entre 1 y 25 productos; miembros únicos, una ficha guardada por producto. Valida contrato permitido, estados published/approved true, medios PNG autorizados con hash/alt/dimensiones y alternativas dentro del lote, sin autorreferencias/duplicados. Campos privados/HTML/rutas arbitrarias se rechazan.

Bloquea fichas en orden de ID en una transacción, comprueba versión y preparación lista/confirmaciones; compara campos comerciales con proyección guardada. Una ficha cambiada devuelve conflicto; cualquier fallo revierte el lote. Imágenes/alternativas se revisan explícitamente en el raw: no se infieren del ERP, no se comprueban bytes/derechos o compatibilidad externamente. Hash cubre exactamente todo raw, incluidos metadatos de medios/alternativas.

Audita web_catalog_batch_approval/APPROVE con usuario, hash, IDs/versiones y hash de proyección base por miembro. Devuelve raw/hash/recibo; no activa sitio. No migración nueva. SQL aislado verifica registro con medios y rechazo de versión antigua; unitarias contrato y HTTP autorización/DTO también. No aprobó lote operativo. Falta consulta/revocación de recibo de lote, UI y conexión del publicador (que aún verifica solo recibos individuales). No utilizar el nuevo recibo como si fuera individual. WEB03.1b parcial.

## WEB03.1b — recibos de lote vigentes y revocables

GET /api/v1/web-catalog/admin/products/batch/approvals/:receipt (ADMIN) devuelve scope batch, receiptId, sha256, productCount, active y revoked. Comprueba todas las fichas guardadas: versión, estado listo, tres confirmaciones y hash de proyección comercial original. Una edición invalida el lote completo. No detecta cambios del maestro todavía no guardados en el snapshot.

POST a la misma ruta con /revoke y confirmed true: ADMIN, bloqueo del recibo APPROVE, evento REVOKE con usuario. Repetir no duplica evento; conserva historial y no retira sitios activos.

Aprobación local del publicador admite erpReceipt: {"scope":"batch","receiptId":9} (9 es ejemplo de estructura, sustituir por recibo auténtico). No lleva productId. Consulta antes del build y antes de activar; exige scope batch, 1–25 productos, hash exacto y estado vigente/no revocado. Recibos individuales siguen admitidos. PUBLIC_WEB_REQUIRE_ERP=1 exige verificación; sin esa política los previews declarativos siguen disponibles. No guardar sesiones en JSON ni documentación.

Validación: 11 HTTP con autenticación/servicio simulados; pruebas Node de ruta/hash/estado/alcance con fetch simulado; PostgreSQL real aislado para vigencia/cambio de versión/revocación repetida. Sin aprobación comercial ni conexión HTTP operativa. UI de lote pendiente; WEB03.1b parcial. Rollback no verifica ERP y revocación no retira automáticamente una versión activa.

## WEB03.1b — pantalla inicial de revisión de lotes

En /catalogo-web (ADMIN), panel Revisar y aprobar lote web. En tarjetas con estado listo, Agregar al lote agrega ID sin duplicarlo; selección permanece al cambiar filtros/página. También admite IDs separados por comas (1–25 únicos). Preparar lote consulta fichas/versiones y export-candidate; un error descarta preparación completa. Agregar otro ID obliga a preparar otra vez.

El manifiesto se muestra como JSON completo editable; datos comerciales deben coincidir con las fichas guardadas. Para medios/alternativas, seguir contrato documentado: metadatos PNG autorizados, alternativas dentro del lote. La edición limpia confirmación. Todavía no existe selector visual de archivos/alternativas ni verificación de bytes de imagen en esta pantalla. Revisar todos los campos antes de marcar confirmación y Aprobar y descargar lote. Se registra recibo/hash y descarga raw exacto; no activa versión. El servidor valida contrato, versiones y proyección; conflicto exige preparar versiones actuales.

Número de recibo permite consultar cualquier recibo de lote con permiso ADMIN; muestra estado puntual/cantidad/hash. Revocar exige consulta y casilla; cambiar número limpia estado, error exige consultar otra vez. Revocar no retira versiones activas. No mezclar recibos individuales con este panel.

68 unitarias finales (cuatro nuevas del panel); cuatro Playwright de página catálogo claro/oscuro móvil/escritorio con accesibilidad/reflujo, sin aprobación comercial y sin flujo UI completo del panel. Build final 475.29 kB inicial bajo 500 kB. WEB03.1b parcial: editor visual y prueba UI completa de lote pendientes, además de conexión real, optimización/zoom y aceptación del lote real.

## WEB03.1b — editor visual de imágenes y alternativas

El panel de lote incorpora tarjetas de ficha y selección local de PNG (máximo ocho/ficha, 250 000 bytes/archivo, 4096 × 4096). Nombre simple .png; rechaza duplicados en ficha. Comprueba firma/IHDR y decodificación del navegador; calcula SHA-256 de bytes y dimensiones. Muestra vista previa local, solicita texto alternativo y casilla explícita de derechos. No infiere derechos del nombre ni del contenido. Quitar limpia el medio y libera URL blob; al destruir componente libera las vistas previas.

No se sube ni copia el archivo. Conservarlo y copiar el mismo PNG a public-web/media-approved antes de usar el publicador; este valida hash/dimensiones nuevamente. Las vistas previas no persisten en JSON ni tras recargar/editar JSON. Un metadato importado no garantiza que exista el archivo fuente.

Alternativas seleccionables entre otras fichas preparadas; no ofrece la misma ficha como alternativa. Controles sincronizan manifiesto preservando campos comerciales y limpian confirmación de aprobación. JSON avanzado sigue disponible; inválido bloquea revisión/aprobación. Alt vacío o derechos sin confirmar bloquea aprobación visual; validación completa continúa en servidor. Seleccionar PNG no implica autorización comercial.

Verificado: 70 unitarias finales y cuatro Playwright del flujo completo con PNG válido/API simulada, en claro/oscuro y móvil/escritorio, accesibilidad/reflujo incluidos. Prueba descarga sin activar sitio. No hubo aprobación operativa. WEB03.1b mantiene optimización/zoom, transferencia controlada de medios, conexión real y aceptación del lote real pendientes.

## WEB03.1b / WEB02.3b — ampliación y preparación PNG

Una foto publicada abre ampliación dentro de la ficha mediante enlace a fragmento y CSS :target. Cerrar ampliación vuelve a miniatura; Abrir archivo a tamaño original permite controles nativos del navegador. Sin JavaScript cliente. Disparador mínimo 44 × 44 y vista adaptada al viewport. Es navegación de imágenes, no un diálogo modal con gestión de foco/Escape ni zoom progresivo.

Antes de seleccionar/aprobar medios, con Node 24 ejecutar desde raíz:

```powershell
node public-web/optimize-png.mjs ruta/origen.png ruta/destino-nuevo.png
```

No sobrescribe destinos existentes ni el origen. Valida CRC/firma/chunks/dimensiones/terminación, rechaza PNG animado; entrada hasta 8 MB, descompresión hasta 128 MB. Recomprime IDAT manteniendo bytes descomprimidos y selecciona compresión nueva solo si menor; elimina chunks tEXt, zTXt, iTXt, eXIf y tIME. Conserva otros chunks/perfiles; no promete eliminar metadatos desconocidos ni sustituye una decodificación/revisión visual completa. No cambia dimensiones ni crea WebP/AVIF/srcset.

Revisar el resultado en navegador, seleccionar el archivo nuevo en lote, confirmar derechos/alt, aprobar su hash y copiar ese mismo resultado a media-approved. Optimizar después de aprobar invalida hash; requiere nueva aprobación. Publicador sigue sin transformar bytes aprobados. Puede no reducir el peso si origen ya optimizado; límite publicable 250 000 bytes por imagen.

Pruebas usan fixtures temporales/interceptados, sin publicar contenido comercial. WEB03.1b/WEB02.3b parciales: variantes responsivas, transferencia controlada y aceptación real pendientes.
Validación final Node 24.19.0: 14 pruebas Node y 21 UI aprobadas; ampliación abre/cierra en 390/1440 con JavaScript desactivado y foto cargada. Prueba PNG compara bytes descomprimidos, ausencia de texto, CRC/truncado/trailing inválidos y salida estable. Nueve páginas actuales, máximo 15 095 bytes HTML+CSS bajo presupuesto 50 000, cero JS.

## WEB03.1b — importación controlada de medios

Con Node 24, desde raíz (crear previamente el directorio destino):

```powershell
node public-web/import-media.mjs ruta/catalogo-lote-aprobado.json ruta/fotos-seleccionadas public-web/media-approved
```

Valida contrato del manifiesto y prepara solo medios de fichas publicables. Comprueba fuente confinada, hash/dimensiones/encabezado PNG y límite por imagen; no altera bytes. Prevalida destinos: archivo coincidente se reutiliza, diferente se rechaza sin sobrescribir; rutas resueltas fuera de destino se rechazan. Nombre compartido con hashes distintos se rechaza. Crea nuevos archivos exclusivamente; ante fallo intenta retirar los creados durante la llamada. No borra archivos previos ni limpia archivos antiguos automáticamente.

No verifica firma/recibo ERP en esta importación ni activa sitio: solo prepara medios. Antes de publicar, usar aprobación auténtica y política de verificación ERP del publicador. No hay garantía transaccional ante caída del proceso ni coordinación entre importadores; ejecutar una sola importación y revisar destino tras interrupción. El build/publicador verifican nuevamente los archivos seleccionados. No redimensiona ni crea variantes responsivas; estas siguen pendientes.

Pruebas de copia/repetición/conflicto en directorios temporales, 14 Node aprobadas. Sin importación comercial ni cambios UI/ERP/migraciones; sus baterías no repetidas en esta sesión.

## WEB03.1b / WEB02.3b — variantes responsivas revisadas

Cada imagen admite variants opcional, máximo tres elementos. Cada variante tiene los mismos seis campos de imagen (file, sha256, alt, width, height, authorized), sin variants dentro. PNG simple, hash y autorización explícitos; ancho menor que original, anchos únicos y proporción del original con tolerancia de un píxel vertical. Variantes no redimensionan el archivo original ni se generan durante publicación.

Preparar PNG menores externamente, revisar visualmente que sean la misma foto, calcular dimensiones/hashes y añadirlos al JSON del lote antes de confirmarlo. El editor actual conserva estos datos en JSON avanzado; selector/generador visual pendiente. Aprobación backend valida el contrato y hash raw cubre todos los metadatos. Cambiar variantes requiere nueva aprobación. Derechos/compatibilidad no se certifican por dimensiones.

Import-media copia originales y variantes autorizadas; prepareMedia verifica cada hash/dimensiones y confinamiento. Cada archivo conserva límite 250 000 bytes; presupuesto agregado de build 8 MB incluye variantes. HTML genera srcset con descriptores de ancho y sizes para miniatura; navegador elige recurso. Ampliación conserva original, sin JS. Ni importador ni build transforman bytes aprobados.

Validación: 18 unitarias backend; 14 Node web y 21 UI generales. Medios prueba copia original+variante y rechazo de alteración; dos UI dirigidas ampliadas verifican currentSrc 400 px en móvil y 800 px en escritorio, archivo original en ampliación y cierre sin JS. Fixtures aislados, sin lote comercial. Sin migraciones, cambios de endpoints o editor ERP; sus pruebas HTTP/frontend/SQL no repetidas. WEB03.1b/WEB02.3b parciales: generador/selector visual, aceptación real y conexión controlada pendientes.

## WEB03.1b / WEB02.3b — generación visual antes de aprobar

En una imagen seleccionada localmente, Generar variantes crea PNG320/640/960 siempre menores que original, proporcionalmente con canvas. No sobrescribe variantes existentes: quitar previamente si se desea generar otra vez. Si original <=320 no crea variantes. Hasta 250 000 bytes por variante; error de tamaño/nombre no asigna generación parcial. Hash SHA-256 de cada Blob generado. Canvas puede cambiar perfiles/color; revisar fidelidad antes de autorizar.

Agregar variante admite PNG preparado externamente: mismo contrato, máximo tres, ancho único menor, proporción conservada y hash calculado; no certifica que sea la misma foto. Cada variante muestra archivo/dimensiones/vista, descripción/derechos independientes y acciones Descargar/Quitar. Generadas no autorizadas automáticamente; aprobación bloqueada si faltan derechos o alt. Editar JSON limpia vistas/archivos locales y permite metadata avanzada; variantes malformadas/anidadas bloquean revisión.

Descargar cada variante y conservar original antes de salir; después usar import-media con manifiesto aprobado y archivos exactos. Nada se sube ni activa desde esta pantalla. Preparar de nuevo, editar JSON o recargar pierde archivos generados en memoria; metadata no equivale a archivo disponible. Generar desde JSON importado exige volver a seleccionar original local, no descarga medios privados. Sin AVIF/WebP ni tamaños configurables en esta fase.

71 unitarias y cuatro UI de lote aprobadas con generación320 desde PNG390, derechos, descarga, raw aprobado con variante y gestión de recibo simulada. No aprobación comercial ni transferencia real. Sin migraciones/cambios backend; sus baterías no repetidas. WEB03.1b/WEB02.3b mantienen conexión real controlada, revisión de fidelidad/medición con fotos reales y aceptación comercial pendientes.

## WEB03.1b — conexión HTTP real dentro del verificador aislado

npm run verify:web-approvals-sql compila backend y ejecuta PostgreSQL temporal más servidor Nest en 127.0.0.1:puerto automático. Controlador, guards y validación reales; métodos reales del servicio contra esquema temporal. Autenticación sustituida por adaptador efímero con credenciales aleatorias en memoria: prueba roles ADMIN/operador, no AuthService/JWT/login operativos. No guardar ni imprimir credenciales.

Aprueba lote por HTTP (401/403/400/201 según sesión/DTO), invoca verifyErpReceipt usando fetch real, comprueba hash exacto y rechazo de raw alterado, revoca dos veces por HTTP y comprueba un evento SQL; verificador rechaza recibo revocado. Cierra servidor y revierte esquema/tablas/identidad temporal con ROLLBACK; confirma ausencia de esquema. No activa versión pública ni altera catálogo operativo. Adaptadores SQL usan conexión compartida/savepoints: no prueban concurrencia ni READ ONLY/REPEATABLE READ de TypeORM.

Build y recorrido real aislado aprobados, repetido tras ampliar auditoría. Sigue pendiente conexión con autenticación real y publicación/medios integral, además de revisión y aceptación del lote comercial. No afirmar que probar este arnés equivale a publicar contenido o usar una sesión operativa. WEB03.1b parcial.

## WEB03.1b — publicación y medios conectados a SQL/HTTP aislados

verify:web-approvals-sql amplía recorrido: genera dos PNG válidos, incorpora original/variante al raw aprobado por HTTP, copia medios exactos mediante importMedia, activa versión temporal con publishCatalog y sirve ficha/PNG mediante createPreviewServer en puerto local efímero. Comprueba HTML srcset, MIME/bytes de ambos PNG, recibo registrado sin credencial, bloqueo de medio alterado y recibo revocado con puntero conservado. Cierra servidores y limpia solo temporal confinado; revierte esquema SQL. No activa versión del negocio ni importa medios comerciales.

publishCatalog acepta cuarto argumento de opciones de proceso: mediaDirectory y erp (baseUrl/token para verifyErpReceipt). build acepta cuarto argumento mediaDirectory. Defaults conservan media-approved y entorno ERP existentes; CLI sin cambios. Las opciones son exclusivamente de proceso, no datos del manifiesto público ni archivos de aprobación; no escribir credenciales. URLs ERP conservan restricción local. Esta separación permite aislamiento sin cambiar variables ni directorios de operación.

Autenticación sigue efímera del arnés: SQL, controladores, guards, HTTP, publicador y medios reales; login/JWT/AuthService y concurrencia TypeORM no verificados. Integración y 14 Node/21 UI aprobadas. No hay garantía de retirada automática al revocar. Antes de declarar aceptación comercial usar [protocolo de lote](WEB_ACEPTACION_LOTE.md), con productos/fotos reales revisados. WEB03.1b/WEB02.3b parciales.

## WEB03.1b — autenticación real aislada

verify:web-approvals-sql ahora incluye AuthController/AuthService reales y repositorio TypeORM de AuthUser, junto con bcrypt/JWT reales. DataSource usa schema aleatorio, synchronize false y logging false; un QueryRunner conserva transacción exclusiva y search_path. Usuarios y contraseña/hash temporales en ese esquema; clave JWT aleatoria solo al construir servicio, entorno restaurado inmediatamente. No usa sesión/cuenta del negocio ni guarda secretos.

Comprueba login ADMIN/operador, contraseña errónea, rol sin permiso, firma alterada, desactivación de cuenta y logout/token_version que impide reutilizar sesión. Conserva aprobación/medios/publicación/HTTP público aislados y prueba de rechazo/puntero sin cambios. Build y ejecución integral aprobados, cierre/ROLLBACK/ausencia de esquema verificados. Sin migración ni cambio de AuthService productivo.

La autenticación real aislada sustituye el adaptador descrito en sesiones anteriores. No prueba throttler/middleware global completo ni despliegue, ni sustituye aceptación comercial. TypeORM de autenticación sí es real; transacciones de catálogo aún adaptadas a conexión compartida/savepoints, por lo que READ ONLY/REPEATABLE READ y concurrencia siguen pendientes. WEB03.1b/WEB02.3b parciales; protocolo de aceptación actualizado.

## WEB03.1b — prueba TypeORM real de aislamiento y concurrencia

Con Node 24: npm run verify:web-concurrency-sql. Compila backend y ejecuta servicio/readSnapshot sobre DataSource/EntityManager reales, conexiones independientes y esquema aleatorio exclusivo. synchronize false, logging false, timeout SQL10s, pool máximo seis. Crea tablas mínimas y confirma setup para que varias conexiones lo vean; al terminar elimina solo el esquema generado verificando patrón y ausencia. No es una migración operativa ni un rollback global. Una caída forzada puede dejar esquema temporal; no limpia esquemas de otras ejecuciones.

Casos comprobados: SHOW REPEATABLE READ/READ ONLY; escritura rechazada SQL25006 con rollback; cambio confirmado en otra conexión no altera snapshot, pero se ve al leer después; revocaciones concurrentes individuales/lote idempotentes; aprobación espera bloqueo de edición observado en pg_stat_activity, recibe 409 tras cambio de versión y no agrega recibo. QueryRunner/pool liberados y esquema eliminado, sin secretos en salida.

Ejecución directa y comando con build aprobados. No cambia código productivo; UI/publicación/login no repetidos. No prueba triggers globales, carga prolongada o todas las carreras. La validación aislada de transacciones reales sustituye el pendiente descrito en sesiones anteriores, sin sustituir aceptación comercial. WEB03.1b sigue parcial; verificación ERP del rollback y operación/aceptación del lote siguen pendientes.

## WEB03.1b — rollback verifica ERP

rollbackRelease primero verifica sello/archivos, lee approval.json de la versión y utiliza su verifiedReceipt y sha256. Exige que ambos hashes coincidan y que ERP confirme recibo vigente/no revocado. No utiliza un recibo alternativo suministrado para saltar la revocación de la versión original. Comprueba dos veces: antes del registro local y antes del cambio de puntero. Registro conserva metadata verificada sin credenciales.

Toda versión con recibo requiere ERP, independientemente de PUBLIC_WEB_REQUIRE_ERP. Con PUBLIC_WEB_REQUIRE_ERP=1 también rechaza versiones declarativas/antiguas sin recibo. Sin esa política, versiones de preview sin recibo conservan rollback declarativo. Tokens siguen en entorno o opciones exclusivamente de proceso; no JSON/CLI/logs. URLs locales y timeout/error bloquean restauración.

verifyErpReceiptHash permite verificar SHA-256 sellado sin reconstruir raw; se compara hash de publicación original con endpoint administrativo. No transforma contenido ni reemplaza verificaciones de integridad. verifyErpReceipt sigue funcionando para publicación por raw.

Pruebas: login/SQL/HTTP reales aislados restauran recibo vigente y rechazan revocado, puntero conservado; prueba Node bloquea falta de recibo bajo política y revocación entre consultas (fetch simulado). 15 Node finales y 21 UI aprobadas. Ninguna versión operativa restaurada. Un intento fallido tardío puede dejar registro local; no confundir registro con puntero activo. Sigue ventana última consulta/rename, sin bloqueo distribuido; no retirada automática y exige revisar reintroducción de productos retirados. Lock huérfano/hosting/aceptación real pendientes.

## WEB03.1b — recuperar bloqueo de publicación

Bloqueos nuevos tienen PID/host/nonce/fecha y schemaVersion. Publicación/rollback usan creación exclusiva y guard de recuperación; al liberar comprueban propiedad. Inspección con Node 24:

```powershell
node public-web/publication-lock.mjs --inspect public-web/dist
node public-web/publication-lock.mjs --recover public-web/dist ruta/revision-lock.json
```

revision-lock.json debe contener decision recover-local-lock, reviewer no vacío y sha256 exactamente igual al resultado inspeccionado. Revisión local explícita, no autenticación ERP. No incluir secretos. Recuperación exige metadata válida, mismo equipo y proceso ausente (ESRCH). No mata procesos; PID activo/reutilizado, permisos insuficientes u otro host se rechazan. No usa solo edad del archivo.

Mientras recupera, guard exclusivo bloquea otros recuperadores/publicadores. Archiva publish.lock como publish-orphan-UUID.lock y guarda lock-recovery-UUID.json; no activa ni elimina versiones/medios. Servidor público no expone estos archivos fuera de allowlist. Lock vacío/antiguo/corrupto y guard huérfano no se recuperan automáticamente; requieren revisión manual de procesos y directorio. Una caída intermedia puede dejar guard/archivo archivado sin registro final; revisar antes de volver a operar. No garantiza coordinación distribuida ni protege contra modificación externa del filesystem.

18 Node/21 UI e integración SQL/HTTP real aislada aprobadas. Tres pruebas nuevas comprueban proceso activo, proceso hijo terminado, archivo archivado/hash y adquisición posterior, bloqueo inválido/recuperación presente. No retiró lock operativo. WEB03.1b parcial por aceptación/operación; siguiente WEB03.2 búsqueda pública.

## WEB03.2a — navegación pública paginada (2026-10-06)

El catálogo revisado genera /catalogo, /marcas y /categorias; cada marca/categoría tiene lista propia. Doce resultados por página, primera página en ruta base y siguientes /pagina/2, /pagina/3, etc. Anterior/siguiente permiten llegar a todas las fichas sin JavaScript. Los nombres se muestran originales y escapados; cada grupo usa SHA-256 del nombre exacto en su ruta, evitando colisiones al eliminar guiones/acentos. Un cambio de nombre cambia esa ruta; redirecciones editoriales/SEO quedan pendientes.

Solo recibe productos del contrato público aprobado. No consulta ERP al navegar, ni expone sus IDs/costos/clientes. Los nombres similares se mantienen separados; no infiere equivalencias. Directorios de grupos también paginados; un catálogo vacío conserva las pantallas preparatorias. Rutas se incluyen en el manifest y sello de la versión, sin servir archivos arbitrarios.

Validación: 20 pruebas Node; 21 pruebas UI existentes más navegación móvil sin JavaScript aprobadas (import del arnés corregido y caso repetido). Cobertura de enlaces para 31 fichas y presupuesto de 1 000 fixtures. Esto no mide carga HTTP concurrente ni acepta datos reales. WEB03.2 sigue parcial: búsqueda por código exacto/normalizado, OEM/alternos, descripción y filtros, medición de relevancia/rendimiento. Sin migraciones ni publicación comercial.

## WEB03.2b — búsqueda sin JavaScript (2026-10-06)

Acceso /buscar desde navegación principal. GET con q (máximo 100 caracteres), marca/categoria (nombre exacto opcional, máximo 200) y pagina (entero positivo hasta cuatro dígitos, dentro del total). Prioriza código exacto, código sin guiones/espacios, referencia exacta y todas las palabras en contenido público. Texto ignora acentos/mayúsculas; muestra código original. Referencias no afirman compatibilidad. Doce resultados por página, criterios preservados al navegar y aviso sin resultados. Parámetros repetidos/desconocidos o inválidos devuelven 400.

Cada build guarda search-catalog.json junto a su versión y lo incluye en el sello; no aparece en routes.json y HTTP directo devuelve 404. Servidor selecciona versión una vez por petición y valida contrato antes de buscar. Revocar recibo no retira una versión activa automáticamente: sigue aplicando publicación/retiro existente. Versiones previas sin buscador no se modifican. No hay llamadas al ERP ni acceso a clientes/costos. CSP form-action self permite GET local; no habilita scripts. Hosting puramente estático necesita adaptación para /buscar: aún no existe despliegue público.

WEB03.2 continúa parcial por aceptación y medición comercial/carga. Motor con 1 000 fixtures y 100 consultas ~213–349 ms local; lectura/validación de archivo por petición quedan fuera de esa medición. No se prometen tiempos de servidor ni equivalencias OEM verificadas. Sin migraciones ni cambios a backend/frontend ERP.
Validación final: verify:web-publica completo, 23 Node / 25 Playwright aprobados; guard repository y diff check aprobados.

## WEB03.3a — consulta contextual de una pieza (2026-10-06)

Desde ficha pública, Consultar cotización abre /cotizar?producto=slug. Cantidad por defecto 1, entero 1–9999; Actualizar consulta conserva pieza y prepara texto con nombre, número original, marca y cantidad. Aplicación/disponibilidad/precio se solicitan como confirmación, no como datos garantizados. Mensaje se puede seleccionar/copiar sin JavaScript. No solicita datos personales ni VIN/ESN y no guarda solicitud en CRM.

Solo configuración confirmada de business.json habilita enlaces WhatsApp/correo. WhatsApp usa prefijo internacional validado sin signo + en wa.me, con texto codificado; correo prepara asunto y cuerpo. Visitante decide enviar desde su aplicación. Configuración actual no tiene canales confirmados y muestra estado pendiente honesto. No se realizaron envíos ni se activaron contactos ficticios.

inquiry-business.json queda dentro de versión, fuera de allowlist y dentro del sello para nuevas versiones. El servidor usa la misma carpeta que el catálogo de esa petición. GET/HEAD; POST 405; parámetros repetidos/desconocidos/cantidad inválida 400; producto no publicado 404. Activar cambios de canal requiere reconstruir/publicar. Versiones antiguas no incorporan retrospectivamente el flujo. Hosting estático solo no resuelve /cotizar.

WEB03.3 parcial: confirmar canales reales y pruebas de aplicaciones externas; consulta multipieza/variantes si corresponde; recepción persistente protegida contra abuso y CRM en WEB05. El endpoint actual prepara información, no recibe solicitudes ni confirma pedidos. Sin migraciones. Fiscal mock/exclusión bancaria conservados.
Validación final: 25 Node y 26 UI aprobadas (25 regresiones más caso contextual repetido tras corregir el contexto del analizador Axe). Build diez páginas / 15 715 bytes máximo HTML+CSS, cero JS cliente. Presupuesto 50 000 bytes conservado. Guards repository/diff aprobados; no se probó envío a canales externos.

## WEB03.4a — metadatos iniciales de ficha (2026-10-07)

Título HTML: nombre comercial · número original · marca | negocio. H1 mantiene nombre original. Descripción HTML incluye número/marca y descripción revisada, normaliza espacios y limita 320 caracteres como regla interna. No es garantía de longitud de snippet ni posicionamiento. Textos se escapan antes de insertarse, incluidos comillas y caracteres HTML. No se crean precios/reseñas/certificaciones.

Breadcrumbs de ficha enlazan Inicio, Catálogo y categoría de la misma publicación; actual conserva aria-current. Helper solo acepta rutas internas de catálogo/categoría. Títulos de productos de mismo nombre y diferente código se distinguen; fichas comerciales completamente duplicadas requieren revisión editorial. Preview mantiene noindex/nofollow y robots Disallow. No se habilitó indexación ni se inventó dominio.

WEB03.4 parcial: canonical/dominio confirmado, sitemap, Product/Organization con datos reales y validadores, redirecciones y retirada editorial pendientes. Datos estructurados y lanzamiento no se certifican por cambiar títulos. WEB03.3 conserva sus pendientes comerciales y técnicos. Sin migraciones ni cambios de backend/frontend ERP.
Validación Node 24.19.0: verify:web-publica aprobado (27 Node / 26 UI), presupuesto de 1 000 fixtures y guards repository/diff aprobados. Build diez páginas / 15 715 bytes máximo inicial y cero JS cliente. No se validó indexación pública ni dominio.

## WEB03.4b — origen, canonical y sitemap (2026-10-07)

Configurar public-web/site.json con origin del dominio HTTPS real y confirmed true únicamente tras confirmación del propietario. Estado actual origin vacío/confirmed false; ningún dominio operativo inventado. Origin solo admite raíz HTTPS, sin credenciales, query/fragmento, puerto no estándar, ruta, IP literal o nombre local. Validación sintáctica no verifica DNS/propiedad. Cambiar configuración requiere reconstruir/publicar una nueva versión.

Con origen confirmado, canonical absoluto para rutas públicas existentes y sitemap.xml con las mismas URLs: inicio/nosotros/contacto/listados/paginaciones/fichas. No busca/cotiza/prototipos/404/admin/parámetros/archivos privados; no incluye productos retirados ausentes de versión. Cada paginación tiene canonical propio. Sitemap sin fechas de modificación ficticias. Manifest permite servir XML con application/xml y sello de versión permite detectar alteraciones en verificación/rollback.

Desactivar origen y reconstruir retira sitemap del manifest: residuo físico no es accesible. No se purgan automáticamente otros archivos ni se altera configuración real desde pruebas; arnés usa options.site (quinto argumento de build) y carpeta temporal. Fixture empresa.example solo existe en pruebas.

Preview permanece noindex/nofollow en HTML y HTTP, robots Disallow; configurar dominio no habilita indexación ni añade Sitemap a robots. No hay despliegue/validación Google. WEB03.4 parcial por datos estructurados/redirecciones/validadores/dominio real y WEB04 por operación/lanzamiento. Sin migraciones.
Validación: verify:web-publica aprobado 29 Node / 26 UI; suite SEO ampliada tres casos aprobados (nuevo caso HTTP/sello/retiro, 30 Node cubiertos en total). Build real 15 715 bytes máximo inicial, fixture con canonical 15 769 bytes; presupuesto 50 000 conservado. Guard repository y diff check aprobados.

## WEB03.4c — microdatos de ficha (2026-10-07)

Ficha publicable contiene scope https://schema.org/Product limitado a identificación y galería. Name/description coinciden con nombre/descripción revisados visibles; productID es número original, category texto visible, brand scope https://schema.org/Brand con nombre publicado. Image se toma del src de fotografía original autorizada, no de variantes inferidas ni placeholders. Alternativas/especificaciones/aplicaciones fuera del scope conservan su contenido sin afirmar relaciones que no estén modeladas.

No asigna GTIN/MPN/fabricante, precios/ofertas/stock/ratings/reseñas/certificaciones. No interpreta marca como distribución autorizada. Sin scripts, compatible con CSP y cero JavaScript. Textos escapados en contenido/atributos; borradores y retirados siguen excluidos por contrato público. Definiciones contrastadas con [Product](https://schema.org/Product) y [Brand](https://schema.org/Brand).

WEB03.4 parcial por Organization y datos comerciales confirmados, validadores externos, redirecciones, dominio real/activación SEO. Noindex/nofollow y robots Disallow conservados. Marcado básico no certifica resultados enriquecidos ni publicación/indexación. Sin migraciones y sin cambios ERP.
Validación Node 24.19.0: verify:web-publica completo aprobado (31 Node / 26 UI), guards repository/diff y presupuesto de 1 000 fixtures aprobados. Build real diez páginas / 15 715 bytes máximo inicial / cero JS cliente. Validación externa de resultados enriquecidos pendiente.

## WEB03.4d — Organization en Contacto (2026-10-07)

Artículo del negocio en /contacto usa microdatos Organization y name Refacciones y Tractorepuestos Tampico. Telephone/email mediante meta con valor del canal visible; solo confirmed true. Address y areaServed en texto visible confirmado. Dirección libre no se divide en componentes inventados. Horarios no se convierten automáticamente en openingHours; WhatsApp no se afirma sameAs. No legalName/RFC/taxID/logos/ratings/coordenadas/certificaciones inferidos.

Helper valida contrato y escapa textos. Configuración real vacía conserva solo identidad del negocio; pruebas usan fixtures aisladas, sin editar canales operativos. Cero JavaScript y noindex conservados. Referencia oficial: [Organization](https://schema.org/Organization). Marcado no garantiza resultado enriquecido ni lanzamiento.

WEB03.4 parcial: redirecciones, datos comerciales/dominio real, activación y validación externa pendientes. Sin migraciones ni cambios backend/frontend ERP; no se envían mensajes. WEB03.3 sigue parcial.
Validación final Node 24.19.0: verify:web-publica aprobado (32 Node / 26 UI), guards repository/diff y presupuesto de 1 000 fixtures aprobados; diez páginas / 15 715 bytes máximo inicial / cero JS cliente. Validación externa pendiente.

## WEB03.4e — redirecciones internas (2026-10-07)

Configurar redirects.json con schemaVersion 1 y entries [{from,to}]. Rutas admitidas /productos/slug o /marcas/hash y /categorias/hash. Mismo tipo de ruta; origen ausente del catálogo activo, destino publicado, sin origen duplicado, autorreferencia, cadena/ciclo o URL externa. Hasta 1 000 reglas. Revisar que sea el mismo contenido renombrado: validador técnico no certifica equivalencias comerciales. Configuración operativa vacía, sin renombres inventados.

Build valida antes de escribir versión y genera redirect-routes.json sellado/no servido públicamente. Servidor obtiene reglas junto al manifest de misma versión; responde 308 con Location relativo, no propaga query y admite slash final de alias. GET/HEAD, reglas no afectan destinos /buscar o /cotizar. Noindex sigue activo. Alias no se incluye en sitemap; canonical pertenece al destino.

Si se retira el destino, build exige corregir/quitar regla. Tras quitarla y publicar, origen 404. Versiones anteriores sin archivo siguen compatibles. Rollback restaura las reglas selladas de su versión, sujeto a comprobaciones existentes; no reevalúa identidad comercial. No coordina cachés externas. Reiniciar preview tras modificar código del servidor. WEB03.4 parcial por revisión real/validación externa/dominio/lanzamiento. Sin migraciones ni cambios ERP.
Validación Node 24.19.0: verify:web-publica aprobado (34 Node / 26 UI), guards repository/diff y presupuesto de 1 000 fixtures aprobados. Preview 4500 reiniciado y HTTP 200. Sin validación de CDN/hosting externo.

## WEB03.4f — auditoría local bloqueante (2026-10-07)

build ejecuta auditPages antes de escribir. Reglas: un title no vacío, una descripción no vacía, un H1, noindex exacto de preview, enlaces internos existentes o alias válido, medios preparados, producto existente para consulta y anclas con id. Títulos iguales entre productos producen advertencia editorial. Canales tel/mailto/wa.me no se comprueban por red; validez/confirmación permanece en contrato público.

Errores detienen generación/publicación. content-audit.json queda privado por allowlist y sellado por versión; leer localmente para revisar advertencias. Versiones previas sin reporte siguen compatibles. Regla implementada para formato generado por plantillas, no parser/validador HTML general ni validator Schema.org/Google. No certifica contenido comercial, indexación o todas las respuestas dinámicas; suites HTTP/UI complementan el control.

WEB03.4 sigue parcial por validadores externos y aceptación/dominio/lanzamiento. Sin migraciones ni cambios ERP. Noindex conservado. No accede a bancos ni modifica fiscal mock.
Validación Node 24.19.0: verify:web-publica aprobado (36 Node / 26 UI), guards repository/diff y presupuesto de 1 000 fixtures aprobados. Reporte actual diez páginas, cero errores/advertencias; build máximo inicial 15 715 bytes, cero JS cliente.

## WEB04.2a — reporte de preparación (2026-10-07)

Ejecutar npm run check:web-readiness con Node 24. Reporte .artifacts/web-readiness.json privado, generado desde archivos fuente actuales, sin modificar dist/punteros/versiones/configuración. Revalida catálogo/contactos/origen/medios/hash/redirecciones, auditoría HTML y presupuesto. No representa automáticamente la publicación activa.

Checks: lote publicable, fotos autorizadas para todas sus fichas, WhatsApp/correo confirmado, dominio HTTPS confirmado; aceptación comercial, operación/hosting/recuperación y validación externa quedan como pendientes no automatizados. Estado pending por diseño mientras no exista flujo de evidencias; no se autoaprueba lanzamiento por llenar datos de prueba. Reporte actual cero fichas/siete pendientes. No confirma DNS/propiedad, entrega de mensajes ni datos comerciales reales.

npm run check:web-readiness -- --strict devuelve código 1 con pendientes. Modo inspección devuelve 0 si comprobaciones locales pasan; contratos/medios/auditoría/presupuesto inválidos fallan. No incluir reporte como prueba de lanzamiento. Protocolo comercial en WEB_ACEPTACION_LOTE.md sigue obligatorio. WEB04.2 parcial, sin migraciones ni cambios ERP/UI. No requiere ni usa bancos.
Validación: 38 Node aprobadas, ejecución real y strict código 1 esperado verificados; guards repository/diff aprobados. Sin suites UI/ERP repetidas. Estado local sin advertencias, máximo inicial 15 715 bytes/cero JS cliente.

## WEB03.3b — consulta multipieza (2026-10-07)

Otras piezas acepta hasta nueve líneas además del producto principal: número original | cantidad | marca opcional. Cantidad 1–9999, lista máximo 1200 caracteres. Solo números exactos publicados (ignora mayúsculas) y marca exacta para desambiguar. No usa referencias cruzadas como equivalencias. Repeticiones suman cantidad por producto, sin superar 9999.

Inexistencia/ambigüedad/formato inválido muestra corrección accesible y conserva texto, no genera mensaje/enlace de envío. Respuesta de corrección 200, no solicitud recibida. Parámetros inválidos o cantidad principal inválida siguen 400. Lista válida incluye todas las identidades/cantidades en WhatsApp/correo preparados, solo canales confirmados, envío decidido por visitante.

GET sin almacenamiento/carrito/cookies ni datos personales: lista en URL, usar solo números/marcas/cantidades, no secretos. No modela variantes inexistentes ni confirma disponibilidad/precio/compatibilidad. WEB03.3 parcial por canales comerciales, selección de variantes si necesaria y recepción protegida/CRM. Sin migraciones ni cambios ERP. Reiniciar servidor local para cargar módulo nuevo.
Validación: 40 Node / 26 UI aprobadas y recorrido móvil ampliado repetido aprobado; guards repository/diff y presupuesto de 1 000 fixtures aprobados. Preview 4500 reiniciado HTTP 200. Máximo inicial 15 917 bytes/cero JS cliente. No se enviaron mensajes ni se certificaron canales externos.

## WEB04.2b — límites públicos locales (2026-10-07)

Servidor Node limita /buscar y /cotizar (también slash final) a 60 GET/HEAD por ventana fija de 60 segundos, compartida por dirección remota de socket. HTTP 429 y Retry-After para exceso. URL de más de 8192 bytes devuelve 414 antes de snapshot/lectura. No usa X-Forwarded-For proporcionado por visitante. Métodos no admitidos 405.

Mapa de contadores solo en memoria, máximo 1000 direcciones; dirección nueva sin espacio devuelve 503/Retry-After. Ventanas vencidas liberan espacio al consultar. Reinicio borra cuota; no se guarda IP/consulta en archivo ni cookie. No es protección DDoS/distribuida. IP compartida comparte cuota; reverse proxy necesita controles de borde/política explícita antes de publicación. No configurar confianza universal en cabeceras.

Páginas y medios fuera de endpoints dinámicos no tienen cuota, mantienen límite de URL. No implementa recepción/almacenamiento de consultas ni integra CRM. WEB04.2 parcial por operación/carga/aceptación real; WEB03.3 recepción protegida pendiente. Sin migraciones ni cambios ERP/UI. Reiniciar servidor local para aplicar.
Validación final: 42 Node / 26 UI aprobadas, guards repository/diff y presupuesto 1 000 fixtures aprobados. Preview 4500 reiniciado, buscar HTTP 200. Sin certificación de DDoS/hosting distribuido; no se repitieron suites ERP.

## WEB04.2c — respuesta dinámica y enlaces preparados (2026-10-07)

Buscar/cotizar cuentan bytes UTF-8 de HTML y CSS de misma versión, máximo 50 000 inicial y 20 000 CSS. Exceso HTTP 503 con mensaje para reducir consulta; HEAD sin cuerpo. Se reutiliza presupuesto existente, sin aumentarlo. No mide gzip/brotli de cada consulta en runtime; build conserva sus controles comprimidos. No certifica SLA ni toda carga comercial.

Si mensaje codificado para URL supera 6 000 caracteres, no genera enlaces preparados WhatsApp/correo; conserva texto copiable y sugiere dividir piezas. Límite interno elegido, no garantía de compatibilidad universal con apps externas. No trunca identidades/cantidades ni afirma envío/recepción. Si HTML aún excede presupuesto, servidor devuelve respuesta breve. Sin almacenamiento/CRM.

WEB04.2 sigue parcial por operación/carga/aceptación real. Sin migraciones ni cambios ERP. Reiniciar servidor para aplicar código; noindex y exclusión bancaria conservados.
Validación: verify:web-publica 44 Node / 26 UI aprobadas; suite ampliada tres casos dinámicos aprobados (45 Node cubiertos en total), guards repository/diff y presupuesto 1 000 fixtures aprobados. Preview 4500 reiniciado y buscar HTTP 200. Sin pruebas de envío externo o hosting.

## WEB04.2d — pantallas de error (2026-10-07)

Errores 400/405/414/429/503 usan HTML con marca/H1, explicación y enlaces de recuperación a catálogo/búsqueda. Fs E* usa 500 sin exponer paths/stack. 404 mantiene página existente. Status, Allow/Retry-After y HEAD sin cuerpo conservados, Content-Length explícito. Tiempo de espera visible solo para entero positivo. No refleja entradas ni reintenta/envía/redirige automáticamente.

Errores de presupuesto piden reducir consulta, cuota/ocupación esperar y 400 revisar formato. No se registra cotización ni CRM. CSS compartido puede faltar/estar dañado: mensaje mantiene HTML pero no garantiza estilo/recuperación operativa. Clasificación de fallo interno no exhaustiva. WEB04.2 parcial por operación/carga/aceptación real, sin migraciones ni cambios ERP. Reiniciar servidor local para código nuevo.
Corrección UI encontrada por prueba móvil: botones secundarios en .empty y .contact-actions usan color/borde ink sobre fondo claro; evita heredar estilo de hero oscuro. Prueba de recuperación HTTP400/Axe/reflujo/enlace aprobada tras corrección.
Validación final: 46 Node / 27 UI aprobadas tras corregir contraste; guards repository/diff y presupuesto 1 000 fixtures aprobados. Preview 4500 reiniciado HTTP200, frontend4300/salud3100 HTTP200. Máximo inicial 16 032 bytes/cero JS cliente. Sin certificación de hosting externo.

## WEB04.2e — barra final en consultas (2026-10-07)

/buscar/ y /cotizar/ responden 308 a ruta sin barra final, conservando query codificada en Location relativo. Corrige búsqueda que perdía criterios y cotización que daba 404. Solo en versiones que ofrecen búsqueda; destino valida parámetros/catálogo de forma habitual. No cambia redirecciones editoriales, que siguen descartando query.

Cuota se aplica antes de redirigir: URL con slash y destino consumen peticiones separadas y comparten contador. No acepta destino arbitrario, no interpreta parámetros como rutas de filesystem. GET conserva piezas/cantidades/filtros; evitar datos personales/secretos en URL. WEB04.2 sigue parcial por aceptación/operación/carga, sin migraciones ni cambios ERP. Reiniciar servidor local tras actualizar.
Validación final: 47 Node / 27 UI aprobadas, guards repository/diff y presupuesto 1 000 fixtures aprobados. Preview reiniciado; búsqueda con slash HTTP200 tras redirección. Sin migraciones ni suites ERP repetidas.

## WEB04.2f — medición HTTP aislada (2026-10-07)

npm run perf:web-http usa Node 24, 1 000 fichas sintéticas en carpeta temporal, servidor loopback puerto efímero, dos calentamientos y 40 consultas a concurrencia cuatro. Veinte búsquedas exactas y veinte cotizaciones de tres piezas. Comprueba HTTP200/número/cantidades/noindex; cuota normal sin elevar, canales externos deshabilitados solo en copia temporal. No opera sobre dist/ERP/catálogos comerciales.

.artifacts/web-http-performance.json: p50/p95/máximo por escenario, bytes HTML, duración, CPU/RSS. Cliente y servidor comparten proceso: no separa recursos ni certifica rendimiento externo/SLA. Build/calentamiento fuera de ventana. Timeout 10 s por consulta; errores fallan comando. Cleanup confina carpeta propia, cierra servidor y elimina fixtures; caída forzada puede dejar carpeta temporal, no se eliminan otras.

Reporte no autoriza publicación/aceptación ni demuestra dispositivos/navegador/carga prolongada. WEB04.2 parcial por hosting/aceptación comercial y medición en entorno real. Sin migraciones ni cambios UI/ERP.
Última ejecución Node 24.19.0 aprobada: 40 consultas/concurrencia4/lote1000, ventana284.93 ms; búsqueda p95 49.43 ms y cotización p95 58.75 ms, HTML máximo4990/3671 bytes. Build1261 páginas máximo inicial19649 bytes/cero JS. Dos ejecuciones aprobadas, segunda con configuración aislada. Guards repository/diff aprobados; sin suites UI/ERP repetidas. Métricas loopback/proceso combinado, no SLA.

## WEB04.1a — inspección de publicación activa (2026-10-07)

Ejecuta con Node.js 24: `npm run check:web-active`. Para exigir una versión local sellada: `npm run check:web-active -- --strict`.

Lee `public-web/dist/current-release.json`, valida el identificador y el directorio real de la versión, comprueba el sello mediante hashes y exige que cada archivo de las rutas figure en él. Comprueba nuevamente el puntero al terminar para detectar cambios concurrentes. No activa, publica ni revierte versiones.

El reporte privado `.artifacts/web-active-release.json` distingue `pending`/`unversioned-preview`, `verified-local`/`versioned-preview` e `invalid`. Sin puntero, el modo normal permite revisar la vista previa y el estricto termina con código 1; los errores de integridad fallan en ambos modos y reemplazan cualquier reporte positivo anterior. No incluye secretos ni identidad del revisor. Comprobado con archivos temporales: versión válida, manipulación, rutas sin sello e identificador inválido. La instalación actual permanece sin publicación activa.

Esta evidencia es puntual y local: no prueba vigencia del recibo ERP, aprobación del lote comercial, propiedad del dominio, HTTPS ni recuperación en hosting. No es una firma resistente a un operador que pueda reescribir archivos y puntero; tampoco bloquea solicitudes del servidor después de la inspección. WEB04.1 permanece parcial. Sin migraciones.
Validación final: suite Node de web pública 48/48; guardia de repositorio y diff sin errores. No hubo cambios de interfaz o servidor que requirieran repetir la suite visual.

## WEB04.2g — comprobación HTTP del servidor local (2026-10-07)

Actualización WEB04.2i: el comando comprueba ahora 29 respuestas. Además del alcance original, incluye `/consulta`, HEAD de consulta, logo JPEG (MIME, firma y máximo 350 000 bytes), cantidad inválida con alerta y sin acciones de envío, parámetros duplicados, paginación inválida, cotización sin producto, redirecciones de consulta/búsqueda con sus criterios, rechazo POST con Allow GET/HEAD y bloqueo de business.json/routes.json. Los redirects se inspeccionan sin seguirlos. POST no contiene cuerpo y debe rechazarse; no crea solicitudes ni transmite mensajes. Las respuestas de texto mantienen límite 64 KiB. Los párrafos originales siguientes registran el alcance histórico de WEB04.2g.

Con el preview iniciado en 127.0.0.1:4500, ejecutar `npm run check:web-http` con Node.js 24. No inicia ni reinicia servicios. Comprueba 17 respuestas: inicio, catálogo, categorías, marcas, Nosotros, Contacto, Buscar, CSS, robots, siete rutas privadas/inexistentes y HEAD de inicio. Exige HTTP esperado, MIME, identidad HTML, noindex, no-store, nosniff, política de referrer y directivas CSP. No sigue redirects y exige robots bloqueado para esta etapa de preview.

Reporte privado `.artifacts/web-http-check.json`: fecha, origen local, resultados, status HTTP, bytes y nombres de controles fallidos. No guarda cuerpos, datos comerciales, credenciales ni mensajes de excepciones. Timeout cinco segundos por solicitud, lectura máxima 64 KiB. Todas las solicitudes son GET/HEAD; sin envío a clientes ni acceso al ERP. CLI no acepta argumentos; función de pruebas solo permite HTTP loopback 127.0.0.1.

Un fallo termina con código 1 y sustituye cualquier reporte positivo anterior. No confundir `passed-local` con lanzamiento o aceptación: es una observación puntual del HTTP, no demuestra que una versión permanezca íntegra, que las imágenes comerciales estén correctas ni accesibilidad visual/dispositivos/HTTPS. Usar check:web-active para sello y check:web-readiness para pendientes fuente; ninguna sustituye la revisión comercial. Comprobación real actual 17/17 aprobada; prueba negativa aislada del servidor sin protecciones aprobada. WEB04.2 parcial, sin migraciones.
Verificación final de sesión: 49/49 pruebas Node aprobadas, check:repository y diff sin errores. Sin cambios visuales o de ERP que requieran repetir esas suites.

### 2026-10-07 — WEB02.3c: jerarquía de ficha comercial

- Revisadas en navegador las dos fichas de Amatruck compartidas por el propietario: foto destacada, identificación/referencia, aplicaciones, referencias cruzadas, tabla técnica y acciones de compra. Adaptación propia al flujo actual de consulta, sin reutilizar fotos/textos/marca ni promesas de precio, envío o garantía de terceros.
- Fichas reales generadas: galería izquierda y resumen derecha en escritorio; foto antes del resumen en móvil; cantidad GET al preparar consulta; navegación por anclas; especificaciones en tabla con encabezados semánticos; alternativas revisadas al final. Conserva ampliación sin JavaScript, escaping y microdatos, sin añadir carrito/pagos ni valores ficticios.
- El catálogo operativo sigue vacío. Las capturas y productos de pruebas son fixtures aisladas, no lote comercial. WEB02.3 sigue parcial por revisión del propietario y fotos/datos reales. Sin migraciones ni cambios ERP/fiscal/bancos.
Validación WEB02.3c: 49 Node / 27 UI aprobadas, prueba dirigida ampliada aprobada, captura móvil revisada, guards aprobados. Build operativo máximo inicial 18 287 bytes/cero JS. Fixture sin fotografía en captura privada .artifacts/public-product-mobile.png; no se incorporó al catálogo operativo.

### 2026-10-07 — WEB02.2c: datos de contacto confirmados

- Incorporados por confirmación del propietario: dirección Sor Juana Inés de la Cruz #201-A, Nuevo Progreso, C.P. 89318, Tampico; fijo +528332261772; móvil/WhatsApp +528333095845; refaccionesytractorepuestos@hotmail.com; lunes a viernes 9:00–18:00, sábado 9:00–14:00, domingo cerrado; venta en mostrador, entregas locales y envíos por paquetería por cobrar a toda la República Mexicana.
- Contacto muestra llamadas fijo/móvil, WhatsApp, correo y enlace Google Maps aportado por el propietario. Maps es campo opcional compatible con versiones anteriores, restringido a enlaces cortos HTTPS de maps.app.goo.gl sin query/fragmento; no mapa embebido ni geolocalización. La URL no certifica coordenadas verificadas por el agente.
- Build conserva canales para consultas en la copia pública por versión; versiones ya publicadas requieren volver a publicar para incorporar cambios. No se enviaron mensajes ni correos. WhatsApp normal sirve para el enlace; cambio a Business pendiente del propietario.
- WEB02.2 parcial: historia, marcas, logo/fotos reales y políticas siguen pendientes; dominio, hosting y catálogo comercial no cambian. Sin migraciones ni modificaciones al ERP/fiscal mock/bancos.
Validación final WEB02.2c: 50 Node y 27 UI aprobadas; HTTP17/17 y guards aprobados. Contacto verificado en navegador/capturas, presupuesto18641 bytes/cero JS. Readiness conserva seis pendientes; canales de consulta confirmados. Tests de enlaces/mapa/compatibilidad revisados; sin migraciones.

### 2026-10-07 — WEB02.2d: logo aportado por el propietario

- Incorporado el JPEG original autorizado mediante el adjunto del propietario, sin redibujar, recortar ni sustituir textos: public-web/assets/logo-rtt.jpg. Encabezado y pie reemplazan monograma; portada muestra logo completo sobre blanco. Nombre accesible del enlace conservado, alt descriptivo en portada y dimensiones explícitas.
- Build copia únicamente el asset seleccionado a la allowlist; servidor usa image/jpeg; publicación lo incluye en el sello por rutas. Límite independiente de logo 350 000 bytes y comprobación de firma JPEG; original 298 735 bytes. El presupuesto HTML+CSS no incluye imágenes: no presentar ese indicador como peso total de página. La misma URL se reutiliza dentro de cada página, sin nuevas dependencias/JS.
- Catálogo operativo sin productos; dominio/hosting, historia, marcas, fotografías del negocio y políticas siguen pendientes. Logo recibido no equivale a vector/transparencia/variantes optimizadas. Sin migraciones ni cambios ERP/fiscal/bancos.
Validación WEB02.2d: 50 Node/27 UI aprobadas; comprobación dirigida de bytes/MIME aprobada, preview reiniciado y logo observado en navegador. HTML+CSS19084 bytes más logo298735 bytes; cero JS. Guards aprobados, sin migraciones.

### 2026-10-07 — WEB04.2h: presupuesto de imágenes de carga inicial

- Nuevo public-web/image-budget.mjs calcula por ruta HTML+CSS sin comprimir más unión de URLs de imágenes no lazy y sus candidatos srcset. Deduplica logo repetido en portada/encabezado/pie. Exige bytes presentes en assets aprobados; no consulta URLs externas.
- Límite independiente inicialAssetBytes=750 000 bytes en imageBudgetLimits. Conserva límites HTML+CSS50 000, CSS20 000 y compresión15 000. Build bloquea faltantes/exceso antes de escribir o activar una versión; presupuesto sellado en budget-report.json incluye imageBudget. Readiness expone máximo con imágenes y alcance de medición.
- Medición conservadora de candidatos srcset: un navegador normalmente elige uno, pero se cuentan todos para no subestimar ese grupo. No es medición de transferencia real, caché, velocidad ni imágenes lazy que el navegador decida descargar inicialmente. El tamaño total de todas las imágenes mantiene su límite independiente de 8 MB, y el logo su límite350 000.
- Pendientes: optimización de variantes del logo, fotos comerciales y medición en hosting/dispositivos reales. WEB04.2 parcial. Sin cambios visuales, servidor, ERP, fiscal mock o conexiones bancarias; sin migraciones.
Validación WEB04.2h: 52 Node aprobadas, build y guards aprobados; máximo317819 bytes con imágenes frente a750000. HTML+CSS19084 frente a50000. Readiness conserva seis pendientes. Sin cambios UI/servidor/ERP que requieran repetir esas suites; sin migraciones.

### 2026-10-07 — WEB04.1b: respaldo y simulacro local sin hosting

- Por decisión del propietario no hay presupuesto actual para dominio/hosting. Se mantienen pendientes externos; se prioriza desarrollo/pruebas locales, sin compras, cuentas nuevas ni exposición pública.
- Nuevo npm run verify:web-preview-backup: respalda la vista previa dist sin versión activa en .backups/web-preview-UUID.json, comprueba hashes, lee nuevamente el archivo guardado y restaura en carpeta temporal exclusiva. Verifica bytes restaurados y HTTP raíz/buscador/logo/configuración interna protegida en puerto loopback efímero; limpia únicamente su carpeta temporal.
- Incluye archivos allowlisted del sitio, logo/fotos seleccionadas y seis configuraciones/reportes internos necesarios. Excluye .env, fuentes, ERP/BD, uploads indiscriminados, aprobaciones/credenciales y puntero de publicación. Rechaza si existe publicación activa: no confundir este respaldo con recuperación de versiones ERP aprobadas. Respaldo permanece local e ignorado por Git.
- Restauración verifica contrato, nombres sin traversal, hashes, archivos del manifiesto, máximo15 MB de contenido y10000 archivos; destino existente falla sin sobrescribir. Recuperación usa código Node24 actual del repositorio, que debe conservarse por separado; no garantiza reproducibilidad de runtime histórico, firma independiente, copia externa ni recuperación ante pérdida del disco.
- Reporte privado .artifacts/web-preview-recovery.json. Primera ejecución real:19 archivos,4 comprobaciones HTTP, archivo465208 bytes; verified-local. No activación ni modificación del ERP o catálogo comercial. WEB04.1 parcial; sin migraciones.

Uso WEB04.1b: primero npm run build:web-publica y luego npm run verify:web-preview-backup, con Node24. No ejecutar durante un build/publicación; si los archivos cambian durante el respaldo, el comando falla y hay que repetir. Cada ejecución conserva un archivo nuevo en .backups; no hay borrado automático ni retención configurada. El reporte no guarda los cuerpos HTTP ni el contenido del respaldo.

Para restauración manual en desarrollo, restorePreview(archivoJSON, directorioNuevo) está exportado desde public-web/preview-backup.mjs; acepta únicamente un destino nuevo y el contrato verificado. No restaura sobre dist ni cambia el puntero por sí mismo. Conservar código/runtime correspondiente y comprobar la copia antes de reemplazar una vista previa. Datos de negocio ya públicos quedan dentro del respaldo; nunca añadir secretos a configuración pública. Respaldo fuente/ERP y copias externas son procedimientos distintos.
Validación final WEB04.1b: 53 Node aprobadas; simulacro real y pruebas de corrupción, traversal, destino existente y publicación activa aprobadas. Guards aprobados. Sin cambios de UI/ERP y sin migraciones.

### 2026-10-07 — WEB03.2c: miniaturas en catálogo y búsqueda

- Listados de catálogo/marcas/categorías y resultados de búsqueda muestran primera fotografía autorizada del contrato, con encuadre contain sin recorte. Usa la variante más pequeña de al menos320 px si está disponible, o imagen original; conserva rutas públicas por hash y dimensiones explícitas. Sin archivos privados ni URLs externas.
- Foto y título comparten un solo enlace a ficha; imagen decorativa para evitar repetir el nombre accesible. Carga lazy, espacio reservado de200 px y fallback Fotografía pendiente. Número original, marca, categoría y motivo de coincidencia conservados; no se añade precio/existencia supuestos.
- Catálogo operativo sigue vacío: miniaturas se validan con fixtures aisladas; no se insertaron productos ficticios comerciales. Las imágenes lazy pueden descargarse al iniciar si están cerca del viewport, por lo que el presupuesto de WEB04.2h no representa transferencia completa de listados. Medición con catálogo real/hosting sigue pendiente.
- WEB03.2 permanece parcial por aceptación de relevancia/lote real. Sin migraciones ni cambios ERP/fiscal/bancos; no gastos ni dominio/hosting.
Validación WEB03.2c: 54 Node/27 UI aprobadas, dos pruebas ampliadas de miniatura/navegación sin JS a390/1440 aprobadas. Captura de fixture PNG blanco técnico revisada; no fotografía de producto real. Preview reiniciado, HTTP17/17, guards aprobados, HTML+CSS19753 bytes. Sin migraciones.

### 2026-10-07 — WEB03.2d: filtros guiados y salida sin resultados

- Buscador ofrece datalist nativo de marcas/categorías únicas del catálogo publicado, ordenadas, hasta40 por filtro para mantener HTML acotado. Al recibir filtro escrito, las sugerencias se restringen a valores que contienen ese texto; filtro sigue siendo exacto y el usuario puede escribir nombres fuera de las sugerencias. No cambia ranking ni equivalencias.
- Conserva valores escapados y parámetros GET, añade limpiar búsqueda/filtros y orientación por número/referencia/descripción. Sin resultados muestra enlace Contacto y aclara que buscar no envía una solicitud; no crea leads ni promete atención/stock de forma automática.
- Sin JS, servicios externos, costo, migraciones o cambios ERP/fiscal/bancos. Catálogo vacío conserva listas vacías, no inventa marcas. WEB03.2 parcial por relevancia con lote real; compatibilidad del desplegable datalist depende del navegador, escritura manual siempre disponible.
Validación WEB03.2d: suite54 Node más prueba nueva de filtros aprobadas, 27 UI más escenario GET ampliado aprobado; captura móvil revisada, HTTP17/17 y guards aprobados. Preview reiniciado. Sin migraciones, gasto o productos ficticios operativos.

### 2026-10-07 — WEB03.3c: revisión estructurada de consulta

- Cotización multipieza muestra resumen semántico con producto/número original, marca, cantidad acumulada y enlace a cada ficha; texto preparado para copiar/abrir WhatsApp/correo permanece completo. El conteo corresponde a referencias distintas, no a pedidos registrados.
- Corrige estado engañoso: lista inválida no afirma canales sin confirmar; pide corregir/actualizar y explica que no hubo envío. No muestra resumen ni acciones de envío mientras exista error. Tamaño excesivo y canales realmente pendientes conservan sus estados distintos.
- Tabla con encabezados/fila, enlaces y texto escapado, reflujo móvil y controles sin JS. Conserva validación/idempotencia técnica existente; no crea solicitudes persistidas ni clientes/leads. WEB03.3 permanece parcial por recepción protegida/CRM y variantes; catálogo real vacío.
- Sin costos, migraciones, cambios ERP/fiscal/bancos o publicación externa. Dominio/hosting siguen pendientes por presupuesto del propietario.
Validación WEB03.3c: suite55 Node, tres pruebas dirigidas multipieza y27 UI aprobadas; escenario móvil con resumen/tabla/accesibilidad/cantidades repetido y aprobado. Captura revisada, HTTP17/17 y guards aprobados. Sin migraciones.

### 2026-10-07 — WEB03.3d: consulta sin ficha publicada

- Nuevo /consulta con número indicado, marca/aplicación opcionales y cantidad1–9999. Disponible desde navegación; prepara texto copiable y WhatsApp/correo confirmados sin depender de catálogo publicado, útil mientras el lote real se prepara.
- Referencia indicada por visitante no se convierte en producto aprobado ni equivalencia. Campos acotados100/100/200 caracteres, parámetros únicos/whitelist y HTML escapado; error conserva captura acotada y bloquea acciones. Mensaje distingue datos por confirmar. GET: no incluir datos personales/series, visible en URL/historial; sin persistencia ni envío automático.
- Ruta usa canales de la versión seleccionada, presupuesto dinámico, cabeceras noindex y cuota compartida con buscar/cotizar. /consulta/ conserva parámetros al redirigir. Solo versiones que incorporen esta ruta la ofrecen. No CRM automático; WEB03.3 sigue parcial por recepción protegida/variantes/CRM.
- Sin gastos, migraciones ni cambios ERP/fiscal/bancos. Ahora11 páginas base; catálogo operativo continúa vacío. Dominio/hosting siguen pendientes por presupuesto.
Validación WEB03.3d: suite56 Node más prueba nueva dirigida aprobadas; 27 UI más nueva prueba sin JS/Axe/consulta con query aprobadas. Captura móvil revisada, HTTP17/17 y /consulta HTTP200, guards aprobados. Preview reiniciado. Sin migraciones ni registros de productos/clientes de prueba.

### 2026-10-07 — WEB04.1c: comprobar un respaldo ya guardado

- Nuevo npm run verify:web-saved-backup -- --file=web-preview-UUID.json --sha256=HASH_ORIGINAL. Solo archivos de .backups con nombre esperado, ruta real confinada y tamaño máximo22 MB; exige hash SHA256 proporcionado antes de interpretar/restaurar contenido.
- Restaura copia guardada en carpeta temporal y verifica hashes internos/HTTP mediante simulacro existente, sin generar nuevo respaldo ni activar/reemplazar dist. Reporte privado separado .artifacts/web-saved-backup-check.json; fallo reemplaza reporte previo y sale1. Archivo faltante/corrupto no se considera válido. Conservar el hash original separado de la copia; no es firma digital ni protección frente a quien puede reescribir ambos.
- Ejecutado contra respaldo local anterior: verified-local,19 archivos y4 comprobaciones HTTP. Permite revisar copias guardadas sin gasto/hosting; no respalda ERP/fuentes/runtime histórico ni verifica copia externa automáticamente. WEB04.1 parcial, sin migraciones/cambios visuales/fiscales/bancos.
- Validación: pruebas dirigidas de recuperación y verificación de archivo guardado aprobadas; rechazo de traversal, hash distinto, digest inválido y formato inválido. Check:repository y diff aprobados. No se repitieron UI/ERP porque cambia únicamente herramienta local de mantenimiento.

### 2026-10-07 — WEB02.2e: preguntas frecuentes de atención

- Contacto añade preguntas expandibles nativas sobre información para consultar una pieza, entregas/envíos, horario y ubicación. Respuestas derivadas de configuración confirmada; preguntas de entrega/horario/dirección desaparecen si se retira confirmación. Maps mantiene validación existente.
- Enlace a consulta sin ficha; no promete tiempos de paquetería, tarifas, stock, garantía, devoluciones o distribución autorizada. Estas políticas requieren definición del propietario. Sin scripts, FAQPage promocional ni datos personales nuevos.
- Preguntas accesibles con summary/details, controles44px, reflujo móvil y color de tema existente. WEB02.2 parcial por historia/marcas/fotos/políticas. Sin gastos, migraciones o cambios ERP/fiscal/bancos.
Validación WEB02.2e: build/suite Node y28 UI aprobados; escenarios de Contacto móvil/escritorio con preguntas abiertas sin JS aprobados, captura revisada, HTTP17/17 y guards aprobados. Máximo HTML+CSS22012 bytes. Sin migraciones.

### 2026-10-07 — WEB04.2i: aceptación HTTP de consulta y recursos reales

- Ampliado check:web-http de 17 a 29 comprobaciones: consulta libre y HEAD, logo JPEG con MIME/firma/presupuesto, errores de cantidad y parámetros, cotización sin producto, redirecciones que conservan criterios, rechazo POST y dos archivos privados adicionales. Una cantidad inválida debe mostrar alerta sin acciones preparadas de envío.
- Prueba positiva contra servidor real en carpeta temporal y prueba negativa contra servidor sin protecciones. Reportes conservan únicamente controles/estado/bytes; no almacenan cuerpos ni información introducida por visitantes.
- Validación: 59/59 pruebas Node y 29/29 comprobaciones HTTP del preview activo aprobadas; check:repository y git diff --check aprobados. Sin cambios visuales, no se repitió UI ni ERP. Sin migraciones, cambios de base de datos, compras, hosting o APIs bancarias.
- WEB04.2 permanece parcial: esto refuerza aceptación técnica local; siguen pendientes lote comercial real, revisión del propietario y entorno público. La recepción persistente de consultas y su integración CRM siguen en WEB05.1.

### 2026-10-07 — WEB05.1a: contrato interno de solicitudes comerciales

- Revisadas rutas/DTO/servicio de oportunidades y manual CRM operativo: oportunidades y comunicaciones ya existen. Nuevo public-web/lead-contract.mjs prepara el contrato del puente; no abre rutas administrativas ni consulta clientes.
- Validación estricta de contacto mínimo, UUID de reintento, 1–10 piezas/cantidades y aceptación de versión de privacidad. Identidad de piezas del catálogo derivada de publicación autorizada; referencias libres conservadas como indicadas. Huella HMAC con clave privada suministrada permite comparar contenidos, sin implementar todavía unicidad ni guardar contactos.
- WEB05.1 parcial: siguiente WEB05.1b recepción/bandeja privada transaccional y aviso real aprobado; WEB05.1c revisión/asignación/conversión auditable a oportunidades. Detalle: [Solicitudes públicas y CRM](docs/WEB_SOLICITUDES_CRM.md).
- Sin endpoint público, captura/persistencia CRM, migraciones ni gastos. Las consultas actuales siguen preparando mensajes; no muestran una confirmación de recepción inexistente. Sin cambios visuales o ERP; esas suites no se repitieron.
- Validación: 62/62 pruebas Node aprobadas; check:repository y git diff --check aprobados.

### 2026-10-07 — WEB05.1b: bandeja privada persistente (parcial)

- Nueva tabla crm_solicitud_web (089), servicio interno transaccional con requestId único/huella, reintentos sin duplicar, rechazo de contenido diferente, estados/versiones/revisor y expiración técnica inicial de 90 días. Listado privado no devuelve contactos vencidos; purga manual elimina payload conservando huella/UUID y no permite restaurarlos por reintento. No declara política legal aprobada ni elimina respaldos históricos.
- Rutas privadas ADMIN para listado, revisión y purga bajo guards globales; ingreso interno no expuesto en controlador. Contrato WEB05.1a debe validarse y huella calcularse por componente confiable antes de invocar receive. Sin recepción pública ni envío a terceros.
- Respaldo creado y validado: .backups/2026-10-07T23-29-20-009Z. db:check correcto antes de aplicar 089; db:migrate y db:status confirman aplicada. Migraciones anteriores intactas.
- Detectado y corregido retorno UPDATE de TypeORM durante prueba real: consultas de revisión/purga usan CTE SELECT para devolver filas correctamente y detectar versiones desactualizadas.
- Validación Node 24: build backend, lint dirigido sin advertencias, 3/3 pruebas Jest de roles/validación y composición CRM, test:web-inbox-db aprobado con servicio/PostgreSQL real en esquema aislado (concurrencia/reintentos/conflicto/revisión/purga); check:repository y diff aprobados. Prueba de roles usa identidad simulada, no certifica login JWT real. Sin cambios visuales, UI/web no se repitieron.
- Pendientes: aviso real aprobado, recepción protegida y puente autenticado, política/automatización de retención, UI privada y conversión auditable WEB05.1c. Procesos backend anteriores requieren reinicio para cargar nuevas rutas. No recopila contactos operativos ni cambia fiscal mock/bancos. Manual: docs/WEB_SOLICITUDES_CRM.md.

### 2026-10-10 — estado actual de solicitudes y perfil local

Las secciones fechadas anteriores son históricas. Ya existen formulario nativo multipieza/referencias, puente firmado v2 con huella estable, bandeja ADMIN, diagnóstico, resolución conservadora, conversión y snapshot privado; detalle vigente en [Solicitudes públicas y CRM](WEB_SOLICITUDES_CRM.md).

El preview ahora acepta exclusivamente un perfil local explícito mediante `start:web-publica -- --capture-profile=ARCHIVO`. Valida aviso/revisiones declaradas/retenciones y comprueba ambas claves/versión contra el receptor mediante HTTP firmado sin guardar solicitudes, antes de abrir el puerto. `check:web-intake` inspecciona el perfil incluido cerrado; `--profile=ARCHIVO --online` comprueba sin iniciar captura. Arranque habitual sin argumentos permanece cerrado aunque haya variables privadas; perfil incluido tampoco activa. Perfil no publicado por HTTP y claves fuera del archivo; cambios requieren reinicio.

La comprobación no certifica aprobación real, disponibilidad de BD o lanzamiento. Perfil exclusivo HTTP/loopback, sin arquitectura entre hosts ni HTTPS público. Retención90 días refleja valor técnico actual, no política aprobada; CRM/metadatos/respaldos se declaran por separado sin borrado nuevo. WEB05.1 sigue parcial por revisión/provisión/aceptación comerciales; noindex y alcance local permanecen. Sin migraciones nuevas; web Node79/79, UI pública32/32 e integración AppModule/login/Angular/PostgreSQL real en copia desechable aprobadas. No activa contactos operativos, fiscal real o bancos, ni requiere dominio/hosting. Procedimiento y límites: [perfil local](WEB_SOLICITUDES_CRM.md#perfil-local-y-comprobación-previa-sin-persistencia--2026-10-10).

### 2026-10-10 — WEB03.1b: diagnóstico de recuperaciones interrumpidas

Pendiente técnico local atendido mientras el aviso/retenciones de WEB05.1 espera datos/revisión del negocio. Nuevo `check:web-recovery` observa bloqueo/guarda y pares de evidencia, con estado/PID/fecha/hash de metadata válida y códigos de modo estricto. Lectura acotada, archivos regulares, sin datos crudos o digest de archivos inválidos; doble recorrido detecta cambios. Recuperaciones nuevas identifican su guarda y comprueban propiedad antes de retirarla. No añade recuperación automática, borra evidencia o modifica puntero/versiones.

Estados ready/publishing/recovering/needs-review/changed/invalid. Ready solo significa coordinación libre en la observación; comprobar sello/recibo/aceptación por separado. Guarda antigua/inactiva y archivo/registro faltante o alterado quedan para revisión. El publicador no incorpora automáticamente el chequeo; modo estricto permite usarlo en un procedimiento/pipeline. Modificaciones externas y ventanas del filesystem no tienen garantía transaccional/distribuida.

Pruebas con procesos propios interrumpidos antes/después de archivar y guarda cambiada, evidencia completa/alterada y CLI. Sin cambios de UI/backend o migraciones, captura habitual cerrada. Procedimiento, límites y recuperación pendiente: [WEB_RECUPERACION_PUBLICACION.md](WEB_RECUPERACION_PUBLICACION.md). No se recuperó un bloqueo operativo ni se publicó un lote.

### 2026-10-11 — WEB03.1b: reconciliación explícita de guarda local válida

Implementados `plan:web-recovery` y `reconcile:web-recovery`: propuesta por hash ligada al directorio físico, guarda, bloqueo de publicación, puntero y hasta20 archivos sin registro; aplicación con revisión/ID explícitos y mantenimiento exclusivo. Archiva la guarda válida del equipo local solo con PID ausente y conserva sus bytes. Publicadores/recuperadores cooperantes comprueban mantenimiento antes y después de adquirir su bloqueo. Revalidación de propiedad/evidencia antes de retirar y después; conserva bloqueo ante cambio o fallo parcial.

Intención actual, guarda archivada y recibo final se crean sin sobrescribir. El diagnóstico valida el conjunto y distingue archives.acknowledged de archives.complete: reconoce un archivo histórico sin registro sin fabricar el registro ausente. Repetición de revisión idéntica sobre operación completada intacta es idempotente. Estados incluyen reconciling; mantenimiento huérfano, intención parcial, guardas antiguas/corruptas, proceso activo/ajeno y evidencia divergente requieren revisión. El CLI fallido informa resultConfirmed=false: no afirma que no haya habido mutaciones.

Ensayos en directorios temporales con procesos propios e interrupciones antes/después de enlazar y después de retirar la guarda. No se intervino en bloqueos de la instalación, no se activó una versión y captura habitual permanece cerrada. Requiere enlaces duros locales y operadores cooperantes de esta versión; no sustituye autenticación/firma del revisor, durabilidad ante corte eléctrico, recibo ERP o aceptación comercial. Sin UI/backend/BD/migraciones nuevas. Resultados actuales en README; uso, evidencia y pendientes: [manual de recuperación](WEB_RECUPERACION_PUBLICACION.md#preparar-y-aplicar-una-reconciliación--2026-10-11).

### 2026-10-11 — WEB03.1b: revisión y cierre de mantenimiento interrumpido

`check:web-maintenance` distingue ausencia, propietario activo/ajeno/inválido, mantenimiento sin vínculo, intención sola, guarda archivada, guarda retirada y resultado completado antes de liberar mantenimiento. Inspección sin intervención y doble observación. Nuevas intenciones de reconciliación v2 incluyen hash del mantenimiento propio; v1 sigue legible sin alteración, con cierre no elegible si falta ese vínculo.

`plan:web-maintenance` propone cierre solo de resultado completado/intacto con mantenimiento local inactivo ligado por hash; liga directorio, puntero, bloqueo ordinario y todo el historial observado. `finalize:web-maintenance` requiere revisión/ID nuevos, usa la guarda de recuperación existente para exclusión, conserva mantenimiento en archivo exclusivo y registra intención/recibo actuales. Los registros originales permanecen intactos; repetición idéntica es idempotente. No activa versiones, reanuda intenciones parciales o inventa registros finales. Cierres incompletos/alterados se inventarían en maintenanceReviews.pending y no permiten diagnóstico ready.

Pruebas temporales con procesos propios: cierre completo, etapas parciales sin intervención, vínculo v2/lectura v1, revisores concurrentes, cambios de propietario/historial/puntero/directorio, fallos de E/S y cortes antes/después de archivar/retirar mantenimiento y antes de liberar la guarda. Un cierre cuyo recibo ya está completo permite revisar la guarda residual con la reconciliación existente. Sin intervención en bloqueos operativos, compras, UI/backend o migraciones. Resultados actuales en README. Siguen pendientes intenciones/cierres parciales, mantenimiento sin vínculo, guardas antiguas/corruptas, simulacro operativo y lote real. Procedimiento: [revisión de mantenimiento](WEB_RECUPERACION_PUBLICACION.md#revisar-mantenimiento-interrumpido-y-cerrar-una-operación-terminada).

### 2026-10-11 — WEB03.1b: reanudación revisada de reconciliación parcial v2

Implementados `check:web-resume`, `plan:web-resume` y `resume:web-recovery`. Admite intención sola, guarda archivada o guarda retirada sin recibo, con mantenimiento original local inactivo ligado exactamente mediante intención v2. Comprueba cada archivo reconocido y ausencia de su registro histórico, publicación/puntero originales, historial estable y ausencia de operaciones pendientes ajenas. No selecciona intenciones ambiguas ni sobrescribe evidencia. V1 permanece legible sin inventar vínculos.

Revisión e ID nuevos ligados al hash de etapa/directorio/evidencia/historial. La guarda exclusiva publish-resume.lock es respetada por publicador, rollback, recuperador, reconciliador y cierre. Continúa sólo pasos pendientes, conserva bytes originales, registra intención nueva, recibo original v2 con fecha actual y referencia a la continuación, y recibo nuevo enlazado. Diagnóstico valida ambos conjuntos, incluidos el ID original y hash exacto de intención para impedir que una operación utilice la completitud de otra. Mantenimiento original queda para plan/cierre revisados por separado.

Replay idéntico con evidencia intacta es histórico y funciona tras cierre/cambio posterior válido del puntero; no declara coordinación actual libre. Fallo desde intento de intención conserva guarda/evidencia; CLI informa resultConfirmed=false. Si vuelve a interrumpirse, incluso tras ambos recibos antes de liberar guarda, no se limpia automáticamente ni se admite replay sobre esa guarda residual. `resumptions.completed/pending` y estado resuming amplían el diagnóstico; metadatos privados no se sirven por HTTP.

Verificación en temporales con procesos propios; no se aplicó a la instalación, no se publicaron productos ni se cambió captura. Sin UI/backend/BD/migraciones nuevas, compras o servicios externos. WEB03.1b permanece parcial: aborto revisado, cierres/reanudaciones incompletos o con guarda residual, mantenimiento sin vínculo, guardas antiguas/corruptas/evidencia divergente, simulacro operativo con respaldo y aceptación/medición de lote real. Resultados ejecutados en README; procedimiento y límites: [reanudación revisada](WEB_RECUPERACION_PUBLICACION.md#reanudar-una-reconciliación-parcial-válida-con-revisión-nueva).

### 2026-10-11 — WEB03.1b: cierre revisado de guarda residual tras reanudación completa

WEB03.1b agrupa entregas distintas; el inventario del README ahora distingue capacidades ya implementadas y casos realmente pendientes. Continúa exclusivamente el cierre de una guarda residual cuando la reanudación ya terminó, distinto de continuar operaciones parciales o cerrar mantenimiento. Nuevos comandos `check:web-resume-guard`, `plan:web-resume-guard`, `finalize:web-resume-guard` y herramienta `resumption-guard-review.mjs`.

Intenciones nuevas de reanudación v2 ligan resumptionSha256 a su bloqueo propio; v1 permanece legible sin modificación y no elegible para este cierre si falta ese vínculo. Elegibilidad exige ambos recibos/conjuntos completos e intactos, bloqueo local inactivo ligado exactamente, publicación/puntero originales, mantenimiento original local/inactivo e historial sin pendientes ajenos. Plan por hash de directorio, guarda, ambas operaciones/recibos/archivo original, mantenimiento, puntero e historial. Revisión/ID nuevos, exclusión con guarda de recuperación existente, enlace duro exclusivo de fuente y registro actual de intención/archivo/recibo. Libera solo guarda propia; mantenimiento sigue para cierre separado. Reanudador comprueba recuperación antes/después de adquirir su bloqueo para respetar el intervalo posterior a retirar fuente.

`resumptionReviews.completed/pending` amplía diagnóstico; cierre incompleto/alterado no permite ready aunque falte fuente o después se retire mantenimiento. Replay idéntico es histórico incluso tras mantenimiento cerrado/puntero cambiado válidamente; no interviene en versiones. Falla conserva recuperación/evidencia y CLI invalida resultado sin errores privados. Si este propio cierre vuelve a interrumpirse, su guarda residual o evidencia parcial todavía requieren revisión pendiente; no inventa vínculo v1, recibos o aprobación comercial.

Ensayos temporales con procesos propios, incluyendo cortes antes/después de archivar/retirar fuente y antes de liberar recuperación, cambios de propietario/historial/puntero, concurrencia, compatibilidad v1 y fallos de E/S. Sin intervención en bloqueos instalados, compras, UI/backend, BD o migraciones. Resultados actuales en README. WEB03.1b sigue parcial por aborto, cierres/reanudaciones incompletos, guardas residuales del propio cierre o sin vínculo v2, metadata antigua/corrupta/divergente, simulacro operativo con respaldo y aceptación/medición de lote real. Procedimiento: [cierre de guarda de reanudación](WEB_RECUPERACION_PUBLICACION.md#cerrar-la-guarda-residual-de-una-reanudación-completada).

### 2026-10-11 — WEB03.1b: continuación revisada de cierres interrumpidos

Implementados `check:web-closure-resume`, `plan:web-closure-resume` y `resume:web-closure` en `closure-resumption.mjs`. Continúan cierres de mantenimiento o de guarda de reanudación en cuatro etapas válidas. Nuevas intenciones de esos cierres v2 ligan recoverySha256 a su guarda propia; registros v1 conservan lectura histórica sin inventar ese vínculo. Exigen conjuntos originales completos/intactos, recuperación local inactiva ligada exactamente, origen/historial estables y revisión/ID nuevos.

Guarda exclusiva publish-finalization.lock respetada antes/después de adquirir bloqueos en las herramientas cooperantes; diagnóstico añade finalization, estado finalizing y closureResumptions.completed/pending. Fuente/recuperación archivadas con enlaces duros exclusivos, solo pasos faltantes y revalidación entre cambios. Intenciones/recibos/archivos existentes conservados; recibos faltantes v2 con fecha actual y vínculo exacto a la continuación. Recibo de continuación ligado al original y archivo de recuperación; comprobación en dos pasadas impide atribuir recibos ajenos. Replay histórico sin duplicar; cierre de guarda conserva mantenimiento original para revisión separada.

Suite final145/145 aprobadas con Node24.19.0;12 pruebas nuevas, ocho escenarios de continuación, seis cortes de la propia revisión, concurrencia, cambios de propietario/evidencia, vínculos alterados, compatibilidad v1, límites y fallo de E/S. Build11 páginas, máximo HTML+CSS23093 bytes, JS cliente0; HTTP29/29 y sondeos locales9/9. Coordinación instalada ready, sin guardas/historial; no se aplicó recuperación/cierre en la instalación. Web4500, ERP4300 y backend3100 responden200; solicitudes/puente503 y captación closed. Sin UI/backend, escrituras de negocio o migraciones.

WEB03.1b continúa parcial: aborto revisado, reanudaciones incompletas, continuación de cierre nuevamente interrumpida, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro operativo y aceptación/medición de lote real. Una interrupción de la propia continuación conserva su guarda/evidencia para revisión manual, sin reintento por edad o limpieza automática. No requiere compras ni conexión bancaria. Procedimiento y límites: [continuación de cierre](WEB_RECUPERACION_PUBLICACION.md#reanudar-un-cierre-interrumpido-y-su-guarda-de-recuperación-vinculada).

### 2026-10-11 — WEB03.1b: cancelación revisada de reconciliaciones parciales válidas

Implementados `check:web-reconciliation-abort`, `plan:web-reconciliation-abort` y `abort:web-reconciliation` en `reconciliation-abort.mjs`. Admite reconciliación original v2 válida sin recibo en tres etapas: intención sola, guarda archivada o guarda retirada. Exige mantenimiento local inactivo vinculado exactamente, origen/puntero/publicación/historial intactos, ausencia de pendientes ajenos y revisión con responsable, motivo, UUID nuevo y hash del plan. Rechaza recibos existentes, vínculos ausentes, ambigüedad, cambios y traslado de directorio.

Reutiliza `publish-finalization.lock`, persiste intención antes de intervenir, conserva mantenimiento/fuente mediante enlaces duros exclusivos y revalida entre cambios. Mantiene intención/archivo originales y no fabrica su recibo de éxito. Registra cancelación actual `aborted` y libera únicamente su guarda intacta tras confirmar cadena completa. `reconciliations.aborted` separa cancelación de éxito; `reconciliationAborts.completed/pending` diagnostica integridad y pendientes que bloquean ready incluso sin guardas. Replay idéntico es histórico; cancelación interrumpida conserva guarda/evidencia y requiere revisión manual. Recuperación ordinaria del publicador residual sigue separada.

Pruebas dirigidas nuevas12/12 y suite pública completa157/157 aprobadas con Node24.19.0. Matrices de tres etapas, seis cortes, exclusión, concurrencia, preservación, alteraciones, ambigüedad, límites y fallo de E/S. Build11 páginas, máximo HTML+CSS23093 bytes, JS cliente0; HTTP29/29 y sondeos actuales9/9. Web4500, ERP4300/login y backend3100/health responden200; formulario/puente503 y rutas privadas404. Reportes/log actuales enlazados en README.

Instalación ready con cinco guardas ausentes e historial vacío; diagnóstico de cancelación maintenance-absent. No se aplicó cancelación/recuperación a la instalación ni se activó una versión. Captura closed/captureStarted=false y versión pending/unversioned-preview. Sin UI/backend, escrituras de negocio o migraciones nuevas/aplicadas;088–091 conservadas. Ensayos locales con procesos propios y herramientas cooperantes, sin certificar corte eléctrico, simulacro operativo o aceptación comercial.

WEB03.1b continúa parcial: reanudaciones originales incompletas, cancelación de otros tipos, cancelación/continuación de cierre nuevamente interrumpidas, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro operativo y lote real. Siguiente pendiente técnico local: revisión y resolución conservadora de reanudaciones originales interrumpidas. Privacidad/configuración/aceptación y despliegue público conservan dependencias; IA sin cambio de prioridad, sin gastos ni bancos. Procedimiento: [cancelación revisada](WEB_RECUPERACION_PUBLICACION.md#cancelar-una-reconciliación-parcial-válida-con-revisión-nueva).

### 2026-10-11 — WEB03.1b: continuación revisada de reanudaciones originales interrumpidas

Implementados `check:web-resumption-continuation`, `plan:web-resumption-continuation` y `continue:web-resumption` en `resumption-continuation.mjs`. Continúan una reanudación original v2 cuyo recibo está ausente: intención sola, guarda archivada, guarda retirada o recibo de reconciliación completo. Exigen guarda de reanudación local inactiva vinculada exactamente, intención/origen/mantenimiento/historial intactos, etapa compatible con el plan original, puntero/publicación originales y revisión/ID nuevos por hash. Resultado ya terminado se remite al cierre de guarda existente; no se recrea esa capacidad.

Reutilizan finalización exclusiva y registran intención antes de intervenir. Recibos/archivos/intenciones existentes se conservan; solo pasos faltantes, recibos con fecha actual y vínculo exacto de continuación. Guarda de reanudación conservada por enlace duro exclusivo y retirada tras revalidar; mantenimiento sigue para cierre separado. `resumptionContinuations.completed/pending` y recibo de reanudación v2 se validan en dos pasadas antes de certificar ambas operaciones. Recibo aislado o vínculo prestado no permiten ready. Replay histórico íntegro no duplica archivos; nueva continuación interrumpida conserva guarda/evidencia y requiere revisión manual.

Pruebas dirigidas13/13 y suite pública completa170/170 aprobadas con Node24.19.0, sin fallidas/omitidas/canceladas. Cuatro etapas, tres partidas originales, nueve cortes de la continuación, concurrencia, exclusión de herramientas cooperantes, alteraciones, límites, CLI y fallo de resultado tras retirar guarda. Build11 páginas, máximo HTML+CSS23093 bytes, JS cliente0; HTTP29/29 y sondeos actuales9/9. Web4500, ERP4300/login y salud backend3100 responden200; formulario/puente503 y rutas privadas404. Evidencia actual en README.

Instalación ready, cinco bloqueos ausentes e historial vacío; diagnóstico nuevo resumption-guard-absent. Captación closed/captureStarted=false y versión pending/unversioned-preview. No se aplicó continuación/recuperación a la instalación ni se activó una versión. Sin UI/backend, escrituras de negocio o migraciones nuevas/aplicadas;088–091 conservadas. Pruebas temporales con procesos propios; no certifican simulacro operativo, corte eléctrico, filesystem remoto o aceptación comercial.

WEB03.1b permanece parcial: cancelación de otros tipos, cancelación y nuevas continuaciones de reanudación/cierre interrumpidas, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro operativo y lote real. Siguiente pendiente técnico local: cancelación revisada de otros tipos de operación, empezando por reanudaciones parciales válidas. Privacidad/configuración/aceptación, despliegue público e IA mantienen dependencias/prioridad; sin compras ni bancos. Procedimiento: [continuación revisada](WEB_RECUPERACION_PUBLICACION.md#continuar-una-reanudación-original-interrumpida-con-revisión-nueva).

## WEB03.1b — cancelación revisada de reanudaciones parciales, 2026-10-11

Implementados `check:web-resumption-abort`, `plan:web-resumption-abort` y `abort:web-resumption` para la reanudación original v2 interrumpida en cuatro etapas antes de terminar su recibo. Revisión/motivo/responsable/ID nuevos y plan por hash de directorio, guarda/origen/mantenimiento, recibo previo, publicación/puntero e historial. Intenciones ambiguas, antiguos sin vínculo, guardas activas/ajenas/indeterminadas o evidencia divergente siguen manuales. Reanudación ya completada utiliza el cierre de guarda existente.

Finalización exclusiva, intención persistida antes de intervenir y tres destinos reservados dentro del límite histórico. Conserva todos los originales y archiva únicamente la guarda de reanudación antes de retirarla. No crea recibos originales faltantes: en tres etapas la reconciliación queda pendiente para cancelación/reanudación independientes; en la cuarta reconoce su recibo previo íntegro con marcador de evidencia, sin declarar exitosa la reanudación cancelada. Mantenimiento conserva su cierre separado. Diagnóstico `resumptionAborts.completed/pending` y `resumptions.aborted`; cancelación incompleta/alterada bloquea ready/preparaciones aun sin guardas.

Una sucesora válida incluso nuevamente interrumpida conserva la cancelación histórica, sin completar prematuramente la reconciliación. Replay idéntico e íntegro no duplica pasos, responsable/motivo distintos se rechazan; la propia cancelación interrumpida sigue manual. Fallos conservan evidencia/guarda y el CLI informa resultado no confirmado, sin errores privados. Procedimiento detallado: [cancelación de reanudación](WEB_RECUPERACION_PUBLICACION.md#cancelar-una-reanudación-parcial-válida-con-revisión-nueva).

Pruebas dirigidas15/15 y suite pública completa final185/185 con Node24.19.0, sin fallidas/omitidas/canceladas. Cuatro etapas/tres partidas, resolución independiente por dos rutas, recibos preservados, sucesora parcial, cinco cortes/exclusión de diez herramientas, concurrencia/replay, alteraciones/ambigüedad/límites/CLI y fallo de resultado tras retirar guarda. Build11 páginas, máximo HTML+CSS23093 bytes, JS cliente0; HTTP29/29 y sondeos actuales9/9. Web4500, ERP4300/login y salud backend3100 responden200; solicitar/puente503 y nuevas herramientas/reportes/journals privados404. Evidencia y tiempos en la última sesión del README.

Instalación ready, cinco bloqueos ausentes e historial vacío; diagnóstico nuevo resumption-guard-absent. Versión pending/unversioned-preview; captación closed/captureStarted=false. No se aplicó cancelación/recuperación en la instalación ni se activó versión/captación. Sin cambios UI/backend, escrituras de negocio o migraciones nuevas/aplicadas;088–091 conservadas. Ensayos temporales con procesos propios; no prueban recuperación comercial, corte eléctrico o filesystem remoto.

WEB03.1b permanece parcial: cancelación revisada de cierres interrumpidos, resolución de cancelaciones/nuevas continuaciones nuevamente interrumpidas, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro operativo y lote real. Siguiente pendiente local: cancelación revisada de cierres de mantenimiento o de guarda de reanudación, conservando recibos existentes. Despliegue público, privacidad/aceptación e IA mantienen sus dependencias/prioridad; sin compras ni bancos.

## WEB03.1b — cancelación revisada de cierres originales parciales, 2026-10-11

Implementados `check:web-closure-abort`, `plan:web-closure-abort` y `abort:web-closure` para el cierre original v2 de mantenimiento o de guarda de reanudación, interrumpido antes de su recibo. Tres etapas por tipo: intención sola, fuente archivada y fuente retirada. Recuperación exacta local/inactiva vinculada al cierre, origen completado/íntegro, contexto/historial estable y responsable/motivo/ID/revisión nuevos por hash. Cierre ya completado utiliza la continuación existente conservando su recibo; antiguos/sin vínculo, activos/ajenos/indeterminados, ambiguos, corruptos y divergentes permanecen manuales.

Inspección compartida con la continuación, decisión/hash propios y tres destinos reservados sin truncar historial. Finalización exclusiva e intención antes de intervenir; conserva todos los archivos/recibos originales y archiva únicamente la recuperación del cierre. No crea recibo del cierre cancelado ni restaura fuente retirada. Fuente de mantenimiento/reanudación presente queda para cierre nuevo independiente; mantenimiento tras cierre de reanudación sigue separado. Publicación residual conserva recuperación ordinaria. `closureAborts.completed/pending` y `maintenanceReviews.aborted`/`resumptionReviews.aborted` separan cancelación de éxito; pendiente bloquea ready/preparaciones aun sin guardas.

Replay idéntico e íntegro no duplica pasos tras revisión posterior/cambio válido de puntero. Cierre sucesor nuevamente interrumpido conserva la cancelación histórica sin certificar terminación de ese sucesor. Alteraciones, recibo añadido al cierre cancelado o dos cancelaciones del mismo cierre/tipo invalidan la cadena. La propia cancelación nuevamente interrumpida conserva guarda/evidencia y sigue manual; CLI reemplaza éxito previo por resultado no confirmado y no expone valores privados. Procedimiento: [cancelación de cierre](WEB_RECUPERACION_PUBLICACION.md#cancelar-un-cierre-parcial-válido-con-revisión-nueva).

Pruebas dirigidas14/14 y suite pública completa199/199 aprobadas con Node24.19.0, sin fallidas/omitidas/canceladas. Seis casos, fuentes/recibos/archivos preservados, revisiones independientes, sucesor interrumpido, cinco cortes por tipo y exclusión de once herramientas, concurrencia/replay, alteraciones/ambigüedad/límites/CLI y fallo tras retirar recuperación. Build11 páginas, máximo HTML+CSS23093 bytes, JS cliente0; HTTP29/29 y sondeos actuales9/9. Web4500, ERP4300/login y salud backend3100 devuelven200; solicitar/puente503 y nuevas herramientas/reportes/journals privados404. Evidencias/tiempos en la última sesión del README.

Instalación ready, cinco bloqueos ausentes e historial vacío; nuevo diagnóstico recovery-guard-absent. Versión pending/unversioned-preview y captación closed/captureStarted=false. No se aplicó cancelación/recuperación a la instalación ni se activó versión/captación. Sin UI/backend, escrituras de negocio o migraciones nuevas/aplicadas;088–091 conservadas. Pruebas en temporales con procesos propios; sin certificar simulacro operativo, aceptación comercial, filesystem remoto o corte eléctrico.

WEB03.1b permanece parcial en esta entrega histórica: resolución de cancelaciones/nuevas continuaciones nuevamente interrumpidas, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro con respaldo y lote real. El pendiente identificado aquí de cancelaciones de reconciliación interrumpidas se implementó en la siguiente entrega documentada abajo. Otros tipos interrumpidos mantienen revisión separada; privacidad/aceptación, despliegue público e IA mantienen sus dependencias/prioridad. Sin compras ni bancos.

## WEB03.1b — continuación revisada de cancelación original de reconciliación, 2026-10-11

Implementados `check:web-reconciliation-abort-continuation`, `plan:web-reconciliation-abort-continuation` y `continue:web-reconciliation-abort` para la cancelación original interrumpida. Seis etapas desde intención sola hasta recibo completo antes de liberar finalización; cuatro si la recuperación ya estaba retirada al iniciar la cancelación. Una intención exacta liga finalización local válida/inactiva, origen v2 sin recibo de éxito, archivos/contexto/historial íntegros y revisión/responsable/ID nuevos por hash. Doble observación sin mutación y reserva de todos los archivos faltantes sin truncar.

Conserva intenciones/archivos/recibo v1 previo byte por byte; sólo crea archivos y recibo de cancelación faltantes. Recibo nuevo v2 conserva outcome=aborted y liga la auditoría nueva, sin fabricar éxito de reconciliación o registro histórico de recuperación. Mantiene finalización original hasta adquirir `publish-resume.lock` existente; bajo esa exclusión archiva/retira únicamente finalización exacta. Publicación residual queda para recuperación ordinaria independiente. No incorpora un sexto control.

`reconciliationAbortContinuations.completed/pending` y validación en dos pasadas impiden certificar cancelación v2 mientras su auditoría esté incompleta/alterada. Recibo v1 previo conserva su cancelación aunque la nueva auditoría quede pendiente; ese pendiente bloquea ready/preparaciones aun sin guardas. Replay íntegro no repite pasos tras cambio válido de puntero; ambigüedad, cambios y recibos prestados invalidan reconocimiento. Fallos conservan reanudación/evidencia y CLI reemplaza éxito anterior por resultado no confirmado sin valores privados. Procedimiento: [continuación de cancelación](WEB_RECUPERACION_PUBLICACION.md#continuar-una-cancelación-original-de-reconciliación-interrumpida-con-revisión-nueva).

WEB03.1b sigue parcial: cancelaciones interrumpidas de reanudación/cierre, nueva continuación nuevamente interrumpida, guardas sin vínculo/antiguas/corruptas/divergencias, simulacro con respaldo y lote comercial real. Siguiente pendiente técnico local: revisión y continuación de cancelaciones originales de reanudación interrumpidas, conservando recibos previos y decisiones de cancelación. Privacidad/aceptación, despliegue público e IA mantienen dependencias/prioridad; sin compras ni bancos.

Pruebas dirigidas15/15 y suite pública completa214/214 aprobadas con Node24.19.0, sin fallidas/omitidas/canceladas. Dieciséis combinaciones válidas, nueve cortes, exclusión de once herramientas y otra continuación, conservación de recibos/bytes, vínculos, concurrencia/replay, cambios/ambigüedad/límites/CLI y fallo de E/S tras retirar finalización. Build11 páginas, máximo HTML+CSS23093 bytes, JS cliente0; HTTP29/29 y sondeos actuales9/9. Instalación ready, cinco controles ausentes e historial vacío; diagnóstico nuevo finalization-absent. Versión pending/unversioned-preview y captación closed/captureStarted=false. No se aplicó intervención a la instalación ni se activó versión/captación. Sin cambios UI/backend, escrituras de negocio o migraciones nuevas/aplicadas;088–091 conservadas. Evidencias y tiempos en la sesión correspondiente del README; los ensayos temporales no son simulacro operativo ni aceptación comercial.


## WEB03.1b — continuación revisada de cancelación original de reanudación, 2026-10-11

Implementados `check:web-resumption-abort-continuation`, `plan:web-resumption-abort-continuation` y `continue:web-resumption-abort`. Cuatro etapas de cancelación desde intención sola hasta recibo completo antes de liberar finalización, aplicables a cuatro partidas de reanudación: 16 combinaciones. Una intención exacta liga finalización local válida/inactiva; ambas intenciones originales v2, fuentes/archivos/recibo previo o ausencia, contexto e historial íntegros; revisión/responsable/ID nuevos y propuesta por hash. Doble observación sin mutación y reserva de todos los destinos dentro del límite sin truncar.

Conserva el recibo v1 previo o crea sólo cancelación v2 faltante ligada a auditoría nueva completa. Mantiene reanudación aborted sin fabricar su recibo de éxito. Recibo de reconciliación previo se conserva; si faltaba, la reconciliación sigue pendiente. Mantenimiento, recuperación y publicación residual conservan sus decisiones independientes. La finalización original permanece intacta durante todas las escrituras; reserva exclusiva por ID de cancelación original impide que IDs nuevos distintos permitan dos revisores. Sólo retira finalización tras validar ambas cadenas, sin reescribir propietarios o agregar un sexto control fijo.

`resumptionAbortContinuations.completed/pending` y validación en dos pasadas impiden confirmar recibo v2 aislado. Reserva sin intención válida y auditoría parcial/alterada/ambigua bloquean ready/preparaciones aun sin controles. Recibo v1 previo conserva su cancelación, pero auditoría pendiente mantiene coordinación bloqueada. Replay es sólo lectura: reconoce historia completa sin duplicar pasos o liberar controles residuales, también tras resolución independiente del origen y cambio válido de puntero. Fallos desde el intento de intención conservan finalización/reserva/evidencia; CLI sustituye éxito previo por resultado no confirmado sin valores privados. [Procedimiento](WEB_RECUPERACION_PUBLICACION.md#continuar-una-cancelación-original-de-reanudación-interrumpida-con-revisión-nueva).

Validación de esta entrega con Node.js 24.19.0: **15/15 pruebas dirigidas** y suite pública completa **229/229**, sin fallidas, omitidas o canceladas. Build posterior de 11 páginas, máximo HTML+CSS 23093 bytes y JavaScript cliente 0; HTTP **29/29** y sondeos locales **9/9**, incluidos ERP/backend disponibles y archivos nuevos privados inaccesibles. Diagnósticos actuales ready, cinco controles ausentes e historial vacío; continuación nueva finalization-absent. Versión pending/unversioned-preview y captación closed/captureStarted=false. Sin intervención de cancelación/recuperación en la instalación, migraciones ni escrituras de negocio; evidencia y límites de ensayos temporales en la última sesión del README.

WEB03.1b sigue parcial: cancelaciones interrumpidas de cierre, nuevas continuaciones nuevamente interrumpidas, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro con respaldo y lote real. Siguiente pendiente técnico local: revisión y continuación de cancelaciones originales de cierre interrumpidas, conservando recibos y fuentes residuales para revisión independiente. Privacidad/aceptación, despliegue público e IA mantienen dependencias/prioridad; sin compras ni bancos.

## WEB03.1b — continuación revisada de cancelación original de cierre, 2026-10-11

Implementados `check:web-closure-abort-continuation`, `plan:web-closure-abort-continuation` y `continue:web-closure-abort`. Cuatro etapas de cancelación, desde intención sola hasta recibo completo antes de liberar finalización, para cierres de mantenimiento o guarda de reanudación; tres partidas originales de cada cierre antes de su recibo, **24 combinaciones válidas**. Exige finalización exacta local/inactiva ligada a intención original única, origen v2 completado/íntegro, fuentes/archivos/ausencia del recibo de cierre, contexto e historial intactos. Revisión/responsable/ID nuevos y propuesta por hash; doble observación sin intervención.

Mantiene finalización original durante todas las escrituras y reserva exclusiva por ID de cancelación original, incluso con los cinco controles existentes ocupados. Preserva recibo previo v1 o crea sólo cancelación v2 faltante ligada a auditoría nueva completa; mantiene el cierre aborted sin fabricar su recibo de éxito. Fuentes residuales permanecen para cierres nuevos independientes; mantenimiento/publicación residual conservan revisión separada. Sólo retira finalización después de validar las dos cadenas y revalidar contexto/propiedad.

`closureAbortContinuations.completed/pending` impide confirmar recibo v2 aislado. Reserva sin intención válida y auditoría parcial/alterada/ambigua bloquean ready/preparaciones aun sin controles. Cancelación v1 previa sigue reconocida, pero el pendiente nuevo mantiene coordinación bloqueada. Replay es sólo lectura, sin liberar controles residuales, incluso después de un cierre sucesor nuevamente interrumpido, cierres independientes o cambio válido del puntero. Fallos desde el intento de intención conservan finalización/reserva/evidencia; CLI reemplaza éxito previo por resultado no confirmado sin valores privados. [Procedimiento](WEB_RECUPERACION_PUBLICACION.md#continuar-una-cancelación-original-de-cierre-interrumpida-con-revisión-nueva).

Validación Node.js 24.19.0: **17/17 pruebas dirigidas** y suite pública completa **246/246**, sin fallidas, omitidas o canceladas. Build posterior de 11 páginas, máximo HTML+CSS 23093 bytes y JavaScript cliente 0; HTTP **29/29** y sondeos locales **9/9**, incluidos ERP/backend disponibles y archivos nuevos privados inaccesibles. Diagnósticos actuales ready, cinco controles ausentes e historial vacío; nueva inspección finalization-absent. Versión pending/unversioned-preview y captación closed/captureStarted=false. Sin intervención de cancelación/recuperación en la instalación, migraciones ni escrituras de negocio; evidencias y límites de ensayos temporales en la última sesión del README.

WEB03.1b sigue parcial: nuevas continuaciones nuevamente interrumpidas, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro con respaldo y aceptación/medición del lote real. Siguiente pendiente técnico local: revisión y cierre de controles residuales tras continuaciones de cancelación ya completadas, conservando recibos y separando casos parciales o alterados. Privacidad/aceptación, despliegue público e IA mantienen sus dependencias y prioridad; sin compras de dominio/hosting ni conexiones bancarias.

## WEB03.1b — cierre revisado de controles residuales de continuaciones completadas, 2026-10-11

Implementados `check:web-abort-continuation-finalization`, `plan:web-abort-continuation-finalization` y `finalize:web-abort-continuation`. Para continuaciones de cancelación de reconciliación, reanudación y cierre: exige ambas cadenas completas/intactas y únicas, proceso local terminado, control residual exacto, controles independientes/contexto/historial estables y revisión/responsable/ID nuevos por hash. Recibo completo con proceso activo, ajeno o indeterminado no permite cierre.

Reutiliza un control existente libre distinto del residual: finalización para reconciliación, reanudación para reanudación y recuperación para cierre. Registra intención propia, archiva por enlace duro exclusivo sólo el control residual, revalida, retira su fuente y registra recibo actual; conserva recibos/intenciones/archivos anteriores y todas las decisiones independientes. `abortContinuationFinalizations.completed/pending` valida cadena y bloquea ready/preparaciones ante evidencia parcial/alterada/ambigua o archivo huérfano, aun sin controles.

Replay histórico es sólo lectura: no duplica pasos ni retira una guarda posterior, incluso tras resolver fuentes independientes y cambiar válidamente el puntero. Desde el intento de intención, fallos conservan exclusión/evidencia y CLI reemplaza éxito previo por resultado no confirmado sin valores privados. Si el cierre queda completado antes de liberar su propio control, ese control conserva revisión manual separada. [Procedimiento](WEB_RECUPERACION_PUBLICACION.md#cerrar-el-control-residual-de-una-continuación-de-cancelación-completada).

Validación Node.js 24.19.0: **15/15 pruebas dirigidas** y suite pública completa **261/261**, sin fallidas, omitidas o canceladas; 26 contextos válidos. Build posterior de 11 páginas, máximo HTML+CSS 23093 bytes y JavaScript cliente 0; HTTP **29/29** y sondeos locales **9/9** con ERP/backend disponibles y archivos nuevos privados inaccesibles. Diagnósticos actuales ready, cinco controles ausentes e historial vacío; nueva inspección residual-control-absent. Versión pending/unversioned-preview y captación closed/captureStarted=false. Sin cierre/cancelación/recuperación en la instalación, migraciones o escrituras de negocio; evidencias y límites en la última sesión del README.

WEB03.1b sigue parcial: cierres de controles nuevamente interrumpidos, continuaciones sin auditoría completa, guardas sin vínculo/antiguas/corruptas/evidencia divergente, simulacro con respaldo y aceptación/medición del lote real. Siguiente pendiente técnico local: revisión y resolución de cierres de controles residuales interrumpidos, conservando fuentes/archivos/recibos y separando etapas incompletas de resultados terminados. Privacidad/aceptación, despliegue público e IA mantienen sus dependencias/prioridad; sin compras de dominio/hosting ni bancos.

### 2026-10-11 — WEB04.1d y cierre acotado de WEB03.1b

- Reutilizados los respaldos/verificación existentes de WEB04.1b/c. Nuevo `drill:web-preview-recovery`: selección por nombre/hash original, correspondencia con el preview instalado y coordinación libre, pérdida de portada sólo en una copia temporal, segunda lectura del archivo guardado, restauración en destino nuevo, integridad/HTTP y reobservación de fuente/respaldo. Reporte actual y por ejecución, sin cuerpos/errores privados y con tiempos locales.
- Lector compartido de respaldo regular/confinado, tamaño y lectura acotados a 22 MB. Contrato de restauración existente de 15 MB/10 000 archivos reutilizado. Rutas sólo locales/canónicas, servidor efímero loopback sin captación, cuerpos estáticos iguales al respaldo, recursos/404/cabeceras comprobados y temporales propios retirados.
- Simulacro sobre instalación actual: 20/20 archivos y 29/29 HTTP, 477 761 bytes de archivo, fuente observada intacta. Ejecución final `cea2b556-10ef-4d9c-b134-1265cc0ad638`; restauración más comprobaciones 458,01 ms. Reporte `.artifacts/web-preview-drill.json` y copia por ID. No es SLA, recuperación de publicación sellada, ERP/BD, pérdida de disco o aceptación comercial.
- Regresión Node24.19.0: suite pública 271/271, sin fallidas/omitidas/canceladas; dirigido final 12/12. CLI inválida rechazada con reporte actual `not-completed`; CLI final válida verificada. Preview en servicio HTTP29/29, sondeos web/ERP/API/privados9/9, runtime/repositorio/diff correctos. Sin cambios UI/backend, pruebas visuales nuevas, migraciones o escrituras de negocio.
- WEB03.1b-M1 documenta incidentes fuera de automatización, conservando coordinación bloqueada/evidencia; no afirma resolución automática de metadata incierta. Bloque local restante WEB03.1b-P1: 5–10 piezas/fotos reales, aprobación/recorrido/medición y ensayo de su publicación sellada. WEB03.1b y WEB04.1 siguen parciales; dominio/hosting, privacidad/captación e IA mantienen sus condiciones/prioridad. Fiscal mock, UUID/idempotencia y exclusión bancaria conservados.
- Procedimientos: [simulacro del preview instalado](WEB_SIMULACRO_PREVIEW.md), [incidentes manuales](WEB_RECUPERACION_PUBLICACION.md#incidentes-fuera-del-alcance-automatizado--web031b-m1) y [aceptación finita](WEB_ACEPTACION_LOTE.md#cierre-finito-web031b-p1). Las sesiones anteriores son evidencia histórica, no el orden vigente del siguiente pendiente.

### 2026-10-11 — WEB03.1b-T1: piloto con datos existentes de prueba

Por autorización del propietario, `prepare:web-test-pilot` crea un sitio aislado desde lecturas READ ONLY de PostgreSQL y copias de medios. `start:web-test-pilot` lo sirve en 127.0.0.1:4600. Aviso explícito de datos de prueba en HTML estático/dinámico/errores, noindex y captación cerrada; editor/confirmaciones/recibos comerciales conservados. No cambia catálogo público 4500 o ERP 4300.

Seis piezas existentes, dos con foto; no se inventan imágenes/aplicaciones/referencias/especificaciones. Dos versiones selladas y respaldo por hash: pérdida simulada en copia, 79 archivos restaurados, 45/45 HTTP y rollback 47/47. Reporte `.artifacts/web-test-pilot.json`; las discrepancias de foto/clasificación se documentan para revisión real.

Regresión 278/278 Node, 7/7 nuevas y 32/32 UI; recorrido de ese piloto 94/94 a 390/1440 px con fotos/zoom/búsqueda y capturas inspeccionadas, sin JS cliente. Sin cambios de BD/migraciones/roles editoriales. **T1 completado en alcance técnico; WEB03.1b-P1 conserva aceptación comercial real**, dominio/hosting/privacidad/IA mantienen sus prioridades. [Detalle y comandos](WEB_PILOTO_PRUEBAS.md).
