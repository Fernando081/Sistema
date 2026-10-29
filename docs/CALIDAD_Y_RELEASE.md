# Calidad y liberación

## Reportes internos programados — C03.2,21/10/2026

CRM → Bandeja comercial → Reportes programados (`/crm/reportes-programados`): ADMIN propietario con permiso `crm.reportes.programar`, frecuencia diaria/semanal, hora Tampico en múltiplos de10min y filtros de origen/plazo. Snapshots de conteos completos reutilizan C03.1 en la misma transacción/snapshot, sin listas/contactos/importes. Definición conservada, suspensión/reanudación versionadas y corte nuevo sin periodos retroactivos; historial paginado protegido. Migración110 aplicada tras respaldo y db:check; no crea programaciones o resultados de ejemplo.

Nuevo proceso `crm_reports` cada10min, máximo50 elegibles/pasada, guardia PostgreSQL72410,5 y unicidad programa/horario. Reutiliza historial/estado/avisos O02 existentes, incluida recuperación del proceso; esa recuperación no repara resultados Error anteriores. Cuenta activa/ADMIN/permiso revalidados antes de generar; configuración/controles con actor humano, cron sin autor humano inventado. Error guarda sólo código fijo, sin snapshot/SQL ni reintento del periodo conservado. O01 conserva colas/reintentos generales; C03.3 piloto/retención/capacidad. No modifica horarios/cálculos de los procesos anteriores. Sin envíos o bancos.

Aceptación con copia propia restaurada y AppModule/SQL/HTTP/Angular/login reales, calendario adelantado sólo dentro del verificador y sin fixtures en origen. Separa reloj de disparo probado de una ejecución nocturna real. `npm run test:crm-reports -- --backup=.backups/FECHA/database.dump`; resultados definitivos/regresiones/respaldo y límites en README. [Manual, contratos y evidencia](REPORTES_COMERCIALES_PROGRAMADOS.md).

## Bandeja comercial — C03.1, 21/10/2026

`npm run test:crm-inbox -- --backup=.backups/FECHA/database.dump` requiere Node24 y builds previos. Restaura/elimina sólo una copia propia `verify_inbox_*`, db:check antes de db:migrate dentro de esa copia, AppModule/SQL/HTTP/Angular de producción y login real. No activa recepción pública ni escribe fixtures en origen. **15 grupos**: ACL de creador/responsable/ADMIN, fuentes/estados/privacidad/plazos, búsqueda literal, páginas y resumen, pausa real C02, sesión/DTO/caché/bigint y lecturas concurrentes sin escrituras; UI claro1280/oscuro390 con fichas, tarea exacta/retirar foco, solicitudes y operador403/error/vacío/recarga, Axe/reflujo y ausencia de errores JS. [Reporte](../.artifacts/c031-bandeja.json), [manual](BANDEJA_COMERCIAL.md).

339 unitarias/64 suites backend,19 HTTP/3 suites,95 frontend;79 UI generales con API simulada separadas de la aceptación real. Builds y ESLint/controles aprobados; initial485.25kB/500kB. Se corrigieron etiquetas de selectores y contraste del encabezado del shell detectados durante la aceptación. Sin migración nueva; respaldo/check/procesos/limitaciones y enlaces de evidencia en README. C03.2 reportes programados sigue pendiente; no es piloto productivo o prueba de carga distribuida.

## Reglas de seguimiento — C02.2b, 21/10/2026

`npm run test:crm-sequence-rules -- --backup=RUTA_DEL_DUMP`, Node24 y builds terminados, restaura/elimina su copia propia y prueba AppModule/SQL/HTTP/Angular reales. **22 grupos**, incluidos los15 de C02.1/C02.2a, sin volver a sumarlos como aceptación independiente. Eventos de alta/etapa/asignación y no-op, cursor sin backfill, origen/cliente/responsable/vigencia, revisiones obsoletas, duplicados entre reglas/cadena pausada, concurrencia/reintento, rollback forzado, cuentas desactivadas/revocadas durante espera, páginas20+1/búsqueda literal, guardas/auditoría y origen enlazado. UI claro1280/oscuro390 crea regla; un evento se genera por API real de oportunidades (no se presenta como captura de formulario UI); revisa/confirma, consulta aplicaciones, navega por origen/secuencia, cancela y recarga. Axe/reflujo y errores JS.

Aceptación final desde respaldo posterior a109: `.artifacts/c022b-reglas.json`, passed/cleanupPassed/copyRemoved=true. **327 unitarias backend/63 suites**, **19 HTTP/3 suites**, **95 frontend**, **79 UI generales con API simulada** informadas por separado; ajustes posteriores de pasos/origen verificados por aceptación real ampliada. Regresión C01.1 **10 grupos reales**, copia eliminada, por compartir origen de oportunidades. Initial485.25kB/500kB, sin ampliar presupuesto/dependencias. Registro de respaldos/migración/procesos, comandos, evidencia y límites en README; [manual](REGLAS_SEGUIMIENTO.md). Piloto operativo/retención/ejecución desatendida no certificados.

## Controles de secuencias — C02.2a, 21/10/2026

`npm run test:crm-sequence-control -- --backup=RUTA_DEL_DUMP` amplía el arnés real de C02.1 con controles/avisos/plazos firmados, cuenta inactiva/antiguo asignado, carreras de controles/completado, rollback forzado de las tres acciones,22 controles reales para paginación/inmutabilidad, auditoría y revocación durante espera tanto en control como en PATCH heredado. UI real claro1280/oscuro390: pausa/recarga, Operación CRM sin estado vencido/botones para avanzar, retorno por enlace, reanudación/reasignación/historial, continuación/cancelación y Axe/reflujo/errores JS. Respeta los límites HTTP reales. Base temporal propia restaurada y eliminada; no se inscriben datos de origen.

Reporte separado `.artifacts/c022-control.json`: **15 grupos**, incluidos los9 de C02.1, sin sumarlos otra vez como aceptación independiente. Backend **309 unitarias/62 suites** y **19 HTTP/3 suites**; frontend **95**. Regresión general **79 UI con API simulada**, separada de la aceptación real; ajustes posteriores de presentación de pausa comprobados en la aceptación real ampliada. Builds sin ampliar presupuesto initial485.25kB/500kB, ESLint/controles de repositorio; resultados definitivos, respaldos y límites en README. Los resultados de C02.2b se detallan en la sección de reglas; no se certifica operación real/carga distribuida. [Manual](CRM_SECUENCIAS.md).

## Secuencias de tareas — C02.1, 21/10/2026

`npm run test:crm-sequences -- --backup=RUTA_DEL_DUMP` requiere Node24 y builds backend/frontend terminados. Restaura una copia PostgreSQL propia, db:check antes de db:migrate en ella, AppModule/HTTP/Angular reales y login con credenciales efímeras en memoria. Verifica DTO cerrados, permisos/ACL, idempotencia/inicio/cierre concurrentes, paso siguiente único, plazos, ruta heredada y tarea independiente, cancelación/responsable inactivo, inmutabilidad/auditoría/rollback forzado, revocación durante espera real y alertas existentes. UI claro1280/oscuro390 con creación de modelo/selección de cliente/confirmación/avance/cancelación/recarga por enlace, Axe/reflujo y ausencia de errores JS.

La aceptación final desde respaldo posterior a107 pasó **9 grupos**, `passed/cleanupPassed/copyRemoved=true`; [reporte](../.artifacts/c02-secuencias.json). Regresión C01.1 **10 grupos reales**, copia eliminada, [salida](../.artifacts/c02-c01-regression.log). **300 unitarias backend/62 suites**, **19 HTTP/3 suites**, **95 frontend** y **79 UI generales con API simulada**, informadas por separado. Build initial485.25kB/500kB, sin ampliar presupuestos. Registro final de respaldo/migración/procesos y límites en README; [manual](CRM_SECUENCIAS.md). No equivale a validación de reglas automáticas/pausa/reasignación C02.2 o piloto productivo.

## Revisiones de cotización V01 — 20/10/2026

`npm run test:quote-versions -- --backup=.backups/FECHA/database.dump` requiere Node24/builds previos. Usa AppModule/PostgreSQL/HTTP/Angular producción y restaura/elimina sólo su copia verify_quotes_*. Sus14 grupos prueban activación explícita, evidencia protegida, permisos, HMAC/hash/proyección pública/transporte, respuesta única concurrente/idempotente, versiones/rollback de cotización+snapshot, expiración/revocación/drift, precio/IVA/venta/pedido y flujo legado, rechazo corregido,23 revisiones paginadas, actor revocado durante bloqueo y ocho folios simultáneos. Login ERP real y destinatario anónimo comprueban sello/enlace/aceptación/editor, privacidad de fragmento, claro1280/oscuro390/axe/reflujo/errores JS. No inserta ejemplos en origen o certifica identidad/TLS externo/PAC/carga. [Manual V01](VERSIONES_COTIZACION.md); resultados efectivos y regresiones separados en README.

## Piezas instaladas D02 — 20/10/2026

`npm run test:unit-parts -- --backup=.backups/FECHA/database.dump` usa Node24, builds previos y copia PostgreSQL propia verify_parts_* que elimina al terminar. Sus14 grupos usan API/SQL/Angular producción con login real: asignación global decimal y concurrente, snapshots, revisión versionada, vínculo único de garantía, permisos/correcciones, origen cancelado/devuelto, paginación completa de vínculos, rollback/revocación durante bloqueo y UI claro1280/oscuro390/axe/reflujo/error con borrador/operador de consulta. No escribe fixtures en origen. La devolución se prueba con saldo liquidado sintético y garantías cerradas sólo en copia; no es aceptación de pago/REP. [Manual D02](PIEZAS_INSTALADAS.md). Baterías generales y regresión D01 se informan separadas en README; no se repitió liberación integral/carga/soak ni validación física de taller.

## Expediente de unidades D01 — 19–20/10/2026

`npm run test:unit-expediente -- --backup=.backups/FECHA/database.dump` exige Node24, builds backend/frontend previos y PostgreSQL local. Restaura una copia propia, aplica/checkea migraciones allí y crea usuarios/unidades/archivos únicamente en esa copia. AppModule, SQL, HTTP y Angular de producción con login real verifican permisos efectivos, cero/desconocido, cronología/lecturas parciales, anulación, idempotencia, cierres concurrentes/versionados, archivo privado y SHA, cuotas/paginación, rollback de auditoría y revocación durante espera de bloqueo. Dos sesiones ADMIN prueban claro1280/oscuro390, formularios/subida/foto realmente decodificada/descarga, axe/reflujo/errores JS; una sesión de operador comprueba consulta sin controles de escritura.

La primera aceptación antes de aplicar100 pasó13 grupos; la final desde respaldo posterior a100 pasó14 al añadir el operador de consulta. Ambas eliminaron su copia. La batería general de79 UI usa API simulada y se informa por separado; las263 unitarias backend,19 HTTP y82 frontend tampoco se suman como si fueran escenarios de aceptación independientes. Resultados verificables en el registro del README. [Manual D01](EXPEDIENTE_UNIDADES.md), [reporte final](../.artifacts/d01-expediente-current-backup.json). No demuestra antivirus, carga/soak, retención aprobada, trabajo físico de taller o despliegue productivo.

## Capas de prueba

El proyecto usa controles complementarios. Ninguno escribe sobre la base operativa durante las pruebas automatizadas de interfaz.

1. **Unitarias backend y frontend**: validan reglas y componentes aislados.
2. **HTTP**: valida autenticación, autorización, revocación, límites y contratos de error.
3. **Playwright UI**: inicia Angular en el puerto 4400 y usa un estado API nuevo por prueba. Verifica autenticación, navegación, búsqueda por VIN/ESN, pedidos, abastecimiento, accesibilidad WCAG A/AA y diseño móvil.
4. **PostgreSQL aislado**: restaura el respaldo más reciente en una base temporal, aplica migraciones y ejecuta transacciones reales. La base temporal se elimina al terminar.

## Comandos

```powershell
# Control habitual de código y UI
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify

# Antes de una liberación o migración importante
npm run db:backup
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify:release
```

`verify:release` cubre adicionalmente:

- concurrencia de apertura y cierre de caja;
- idempotencia de ventas y compras;
- devoluciones exactas, notas de crédito y REP;
- timbrado y cancelación fiscal mock de facturas y REP, incluido el reverso local sólo después de la confirmación fiscal;
- cotizaciones sin conversión duplicada;
- pedido con VIN/ESN, reserva, surtido, entrega, factura y garantía;
- backorder, solicitud, orden de compra, recepción y apartado automático.
- conciliación de factura de proveedor contra orden y recepción, documentos protegidos, anticipos, notas de crédito y pago sin duplicar inventario.
- importación bancaria idempotente, coincidencia automática única, reversión y revisión de movimientos sin tocar la base operativa.

## Datos de las pruebas UI

S01 dispone además de `npm run test:access-profiles -- --backup=RUTA_DEL_DUMP`: requiere compilar backend/frontend y restaura PostgreSQL en una base propia. Usa AppModule completo, Angular producción y login real, sin API simulada, con cron detenido únicamente en la copia. Verifica autorización, herencia, excepciones, conflictos, revocación y pantalla claro/oscuro/móvil; elimina su base al terminar. No cambia cuentas de origen ni forma parte de CI sin PostgreSQL/respaldo. [Manual y evidencia](SEGURIDAD_Y_PERMISOS.md).

S02.1: `npm run test:account-sessions -- --backup=RUTA_DEL_DUMP`, con los mismos requisitos de builds/Node24 y copia propia. AppModule/SQL/Angular reales prueban sesiones privadas, cierres, versión/contraseña/perfiles, expiración, límite20 con24 logins concurrentes y limpieza oportunista30 días. Dos contextos con login por formulario validan UI claro/oscuro, móvil y accesibilidad. El verificador no guarda credenciales, no cambia cuentas de origen y elimina su copia. Los verificadores aislados de jobs/métricas/comercial/finanzas/aprobaciones crean095 en su propio esquema para conservar el contrato nuevo de login; nunca la aplican a la operación como parte de esas pruebas.

El verificador de aprobaciones registra su transacción exterior con `QueryRunner.startTransaction/rollbackTransaction`: los logins nuevos abren transacciones anidadas y deben usar savepoints, conservando el rollback exterior de fixtures. Comprueba que su esquema ya no existe y libera la conexión aun si falla la comprobación. No ejecutar varios comandos que recompilan backend al mismo tiempo: compilar una vez y luego ejecutar los verificadores Node independientes sobre sus propios esquemas/copias.

S02.2: `npm run test:browser-auth -- --backup=RUTA_DEL_DUMP` reutiliza el arnés SQL/HTTP/browser de sesiones con reporte independiente `.artifacts/s022-browser-auth.json`. Dos logins por formulario real prueban cookie HttpOnly/Strict, respuesta sin JWT, limpieza de almacenamiento anterior, restauración al recargar, CSRF por origen/cabecera y limpieza de cookie. Los verificadores S01/sesiones/web-CRM declaran su origen temporal solo dentro del proceso aislado y lo restauran al terminar. La batería general de UI usa metadata pública simulada en lugar de fabricar JWT; sigue siendo una prueba con API simulada, distinta de las copias autenticadas reales.

`frontend/tests/helpers/erp-api.mock.ts` mantiene los datos dentro del proceso de Playwright. Cada prueba recibe un estado limpio con un cliente, una unidad VIN/ESN, un producto y un proveedor. Estos datos no se insertan en PostgreSQL y nunca aparecen en la operación real.

S03.1 añade `npm run test:audit -- --backup=RUTA_DEL_DUMP` con Node24/builds previos y copia PostgreSQL propia. Ocho grupos cubren conservación del historial anterior, API privada ADMIN, whitelist/actor, bloqueo SQL incluyendo TRUNCATE, rollback ante fallo de auditoría, liberación de contexto LOCAL y nombre retenido después de renombrar/eliminar. Angular producción usa login y respuestas reales en claro1280/oscuro390, paginador por área táctil y teclado, reflujo/axe y estado degradado al desactivar un control solo dentro de la copia. No verifica criptografía, retención, privilegios mínimos productivos ni todas las rutas comerciales. [Manual de auditoría](AUDITORIA_Y_APROBACIONES.md). Resultados y regresiones de MFA/recuperación/perfiles/sesiones en la sesión del README.

## CI

GitHub Actions usa Node.js 24, instala Chromium, ejecuta build, lint, pruebas unitarias, pruebas HTTP, Playwright y auditoría de dependencias. La restauración de respaldo se conserva como control local de liberación porque los respaldos operativos no deben copiarse a GitHub Actions.

## Criterio de liberación

Una versión se puede etiquetar cuando:

- `npm run verify` termina sin errores;
- `npm run verify:release` restaura y elimina correctamente la base temporal;
- no existen migraciones pendientes;
- el bundle inicial permanece dentro del presupuesto configurado;
- los documentos fiscales se marcan como prueba mientras `FISCAL_MODE=mock`;
- para una liberación fiscal, el emisor, CSD y credenciales deben validarse además contra el PAC sandbox según [la guía fiscal](FISCAL_PAC_SANDBOX.md).

## Control de repositorio y analítica (29/09/2026)

verify incluye check:repository: rechaza .orig/.rej, marcadores de conflicto y plantillas Angular vacías. test:analytics prueba migración 077 con datos controlados en un esquema transaccional y revierte todos los cambios. Requiere conexión PostgreSQL y permiso CREATE SCHEMA; no forma parte de la CI sin base. Playwright cubre GMROI desconocido, cero y valor numérico. Consultar README.md para estado y resultados de cada sesión.

## Contratos de producción — Q03.3.4 (30/09/2026)

`npm run check:no-any` forma parte de verify y de la CI que ejecuta ese comando.
Recorre backend/src y frontend/src: rechaza nodos TypeScript AnyKeyword y escapes
$any de plantillas. Excluye specs, tests y declaraciones .d.ts; no mide los any
implícitos de bibliotecas ni sustituye la compilación o la validación de JSON.

Los contratos restantes de proveedores/categorías, gastos/saldos, auditoría,
pedidos y reabastecimiento están descritos en el registro del README. Proveedores
y categorías normalizan resultados SQL PascalCase a modelos camelCase.
La auditoría compara JSON por contenido, conserva campos eliminados y muestra
valores estructurados con su tipo; no modifica el registro almacenado.

## Aprobaciones comerciales S03.2 (19/10/2026)

`npm run test:commercial-approvals -- --backup=.backups/FECHA/database.dump` requiere builds y Node24. Restaura copia propia, aplica migraciones y prepara baseline/fixtures únicamente en esa copia, incluido cuando el respaldo ya tiene099. AppModule/SQL/HTTP/Angular producción sin API simulada prueban matriz/topes/permisos/roles/versiones/separación/vigencia, reducción posterior de autoridad, moneda no comparable, consumo/reintento/stock de venta con descuento neto, cotización y pedido, historial compatible, dos resoluciones/ediciones concurrentes, rollback ante fallo de auditoría y actor revocado mientras espera el bloqueo. Dos logins reales de administrador y uno de operador comprueban reglas/límites/formulario/error con borrador y UI claro1280/oscuro390/axe/reflujo. Son14 grupos de aceptación, distintos de la batería general de UI con API simulada. Elimina exclusivamente su copia; no configura límites reales del origen. [Manual de política comercial](POLITICA_COMERCIAL.md#s032--matriz-y-límites-de-aprobación-19102026). Resultados efectivos en el registro del README.

## V02 - Entregas con evidencias (20/10/2026)

Con Node24/builds terminados, ejecutar `npm run test:delivery-evidence -- --backup=.backups/FECHA/database.dump`. AppModule/PostgreSQL/API/Angular producción reales en copia propia eliminada: permisos/DTO/archivos/ubicación, transacción/estado/version, reintento/concurrencia, descargas/PDF/hash/auditoría, triggers, rollback y revocación bajo bloqueo. UI claro1280/oscuro390 con login, firma, foto, coordenadas simuladas, PDF/recarga, axe y reflujo. No sustituye GPS/cámara/táctil/impresora físicos. Resultados efectivos y migración103 en README; [manual](ENTREGAS_EVIDENCIADAS.md).

## V03.1 - Portal aislado (20/10/2026)

Con Node24/builds terminados: `npm run test:customer-portal -- --backup=.backups/FECHA/database.dump`. Restaura copia propia verify_portal_<16hex>,104, AppModule/SQL/HTTP/Angular reales; dos clientes y pruebas de ID ajeno/listas/detalle/PDF, sesión ERP/portal, emisión/activación/revocación/bloqueo/versiones/guardas/auditoría/rollback. UI claro1280/oscuro390 con contactos ficticios sólo en copia; sin credenciales en salida/capturas y esperando inicialización real. Exigir passed/cleanupPassed/copyRemoved; no sustituye piloto humano, recuperación/privacidad aprobada, MFA externo o pentest/TLS público. [Manual y límites](PORTAL_CLIENTES.md).

## V03.2 — Publicaciones y originales autorizados (20/10/2026)

`npm run test:portal-publications -- --backup=.backups/FECHA/database.dump` añade aceptación de publicación/retiro/archivos a la regresión real V03.1 sobre copia propia eliminada. Exigir passed/cleanupPassed/copyRemoved en `.artifacts/v032-publicaciones.json`; verificar también build/presupuesto/lint y suites generales. API/SQL/Angular reales, XML mock exacto y copias PDF V01/V02, aislamiento entre dos clientes, fuente cambiada/reasignada, idempotencia/concurrencia, guardas/auditoría/rollback y personal revocado mientras espera. UI claro1280/oscuro390, descarga previa, confirmación, portal y retiro con axe/reflujo. No ejecutar builds mientras el verificador usa dist. Resultados efectivos en README; límites operativos y fiscales en [manual](PORTAL_CLIENTES.md).

## C01.1 — Consentimiento y preparaciones (20/10/2026)

Node24/builds completos: `npm run test:campaign-consent -- --backup=.backups/FECHA/database.dump`. Base propia verify_campaigns_<16hex>, restauración/check/migrate, AppModule/SQL/HTTP/Angular producción reales, contactos y varios clientes (Correo en integración; Correo/WhatsApp/Llamada en normalización de política), permisos/DTO/cliente, versión/idempotencia, fecha de segmentación Tampico, baja compartida/vencimiento/deduplicación/cambio/borrado de contacto, configuración/obsolescencia/preparación concurrente, límites/guardas/rollback y personal revocado esperando bloqueo. UI claro1280/oscuro390 con captura de decisión, historial, revisión/confirmación/recarga/baja; axe/reflujo y desplazamiento de scroll interno. Respeta ventana real del limitador10/min sin ampliarla; casos de concurrencia por servicio real. Reporte `.artifacts/c01-consentimiento.json`, exigir passed/cleanupPassed/copyRemoved; sólo se elimina su copia. Resultados efectivos y limitaciones en README/[manual](CAMPANAS_CONSENTIMIENTO.md). No sustituye evidencia humana, proveedor real ni métricas de envío.

## A01.1 — Escaneo de almacén (21/10/2026)

Con Node24/builds terminados: `npm run test:warehouse-mobile -- --backup=.backups/FECHA/database.dump`. Copia propia restaurada y eliminada con check/migrate, AppModule/PostgreSQL/HTTP/Angular reales: permisos/delegación/revocación bajo bloqueo, códigos/DTO/decimales, UUID/evaluación/concurrencia, anulación/autoría/historial, estados/ubicación inactiva, stock intacto, auditoría/rollback/guardas y páginas20+2/20+1. Navegador claro1280/oscuro390, login/revisión/confirmación/recarga/descarga, Axe/reflujo y reintento después de guardar sin recibir respuesta. Service worker bloqueado sólo en ese contexto para interceptar el transporte; no certifica PWA/offline. MediaStream/BarcodeDetector simulados, sin activar cámara física; QR PDF se renderiza/inspecciona/decodifica por separado. Exigir passed/cleanupPassed/copyRemoved en `.artifacts/a01-mobile.json`; apiMocked=false, hardware=false. No ejecutar builds mientras el verificador usa dist. Resultados y migración111 en README; [manual y piloto pendiente](ESCANEO_ALMACEN.md).

## O01.1 — Recuperación durable de reportes (21/10/2026)

Node24/builds terminados: `npm run test:report-retries -- --backup=.backups/FECHA/database.dump`. Restaura copia verify_retries_<16hex>, check/migrate, AppModule/PostgreSQL/HTTP/Angular/login reales; espera10/20min y lease5min adelantados sólo en la copia con trigger de transición reactivado ALWAYS en finally. Comprueba contrato/ACL/confirmación/versiones, deduplicación y consumidores concurrentes, tres intentos/agotado, interrupción/token antiguo, cancelación y resultado tardío, suspensión/revocación antes/durante bloqueo, auditoría/rollback/guardas y cron existente. UI claro1280/oscuro390 con cola/cancelación/bitácora/recarga/recuperación/agotado, pérdida de respuesta tras commit, Axe y reflujo. Service worker bloqueado sólo para interceptar transporte; no certifica PWA/offline. Exigir passed/cleanupPassed/copyRemoved=true y apiMocked=false en `.artifacts/o011-reintentos.json`; no ejecutar builds durante esa aceptación. Regresión C03.2 conserva historial previo del respaldo mediante baseline; resultados generales/migración112/respaldo/limitaciones en README y [manual](COLA_REPORTES.md). Sin envíos ni certificación de capacidad productiva.

## O01.2a — Salida privada y consumidor local (22/10/2026)

Node24/builds terminados: `npm run test:document-outbox -- --backup=.backups/FECHA/database.dump`. Copia propia verify_outbox_<16hex>, check/migrate, AppModule/PostgreSQL/HTTP/Angular/login y venta reales. Revisión pura sin insertar historial SMTP, DTO/confirmación/permiso/ACL/UUID/huella, PDF privado exacto, documento/destinatario cambiados, cierres únicos/cancelación/concurrencia, cuota20/rollback/guardas/privacidad de auditoría y revocación esperando bloqueo. UI claro1280/oscuro390 con revisar/preparar/confirmar, respuesta perdida sin duplicar, descarga/simulación/cancelación/recarga/acceso desde Facturas, Axe/reflujo. SMTP vigilado: cero llamadas; estados locales no prueban entrega. Exigir passed/cleanupPassed/copyRemoved=true, apiMocked=false, smtpCalls=0 y externalDeliveryEnabled=false en `.artifacts/o012a-outbox.json`. Service worker bloqueado sólo para interceptar transporte; no acredita PWA/offline. Regresión V03.2/V03.1 relevante por reutilización del PDF; resultados efectivos/migración113/respaldos/límites en README y [manual](SALIDA_DOCUMENTOS.md).

## H02 — Controles de calidad del repositorio (27/10/2026)

- **Lint del frontend:** `frontend/eslint.config.mjs` (typescript-eslint recomendado, sin dependencias nuevas; las plantillas HTML no se analizan sin angular-eslint). `npm run lint` raíz ejecuta backend + frontend con `--max-warnings=0` y `format:check`.
- **Formateo gradual:** `.prettierignore` en cada workspace ignora todo TypeScript salvo las rutas ya formateadas (frontend `src/app/shared/**`, `src/app/pago/**`; backend `src/common/**`, `src/pago-proveedor/**`, `src/venta/salida-documentos.*`). Para incorporar una carpeta: agregar su línea `!`, `npm --workspace <ws> run format`, revisar el diff (Prettier puede requerir una segunda pasada) y correr pruebas. `endOfLine: auto` evita falsos positivos con CRLF en Windows.
- **Finales de línea:** `.gitattributes` con `* text=auto` (índice en LF sin depender de `core.autocrlf`). Las migraciones validan su checksum sin importar el fin de línea (ver backend/migrations/README.md).
- **Presupuesto Angular:** error en 525 kB (antes 1 MB; aviso sigue en 500 kB). Análisis: el JS inicial ya es el mínimo del framework (core/router/http/locale); el CSS global suma Material ~50 kB y Tailwind ~26 kB con 385 utilidades en uso. Reducirlo exige migrar utilidades Tailwind o temas Material por pantalla; no se hizo.
- **Aceptación de permisos:** `npm run test:route-permissions -- --backup=RUTA_DEL_DUMP`; exigir `passed=true`, `copyRemoved=true`, `apiMocked=false` en `.artifacts/h02-route-permissions.json`.
- **H02-c, capturas:** las pruebas UI escriben PNG en `.artifacts/local/` (ignorada). `.gitignore` excluye imágenes nuevas en `.artifacts/`; los reportes JSON/log sí se versionan y las 906 rutas ya registradas se conservan como evidencia. No subir capturas nuevas al repositorio; adjuntarlas por separado si un cambio necesita evidencia visual.
- **Compra directa (H02-b):** `npm run test:direct-purchase` compila el backend y ejecuta `POST /compra` a nivel servicio contra la base configurada dentro de una transacción revertida; exige 22/22 comprobaciones (incluye IVA acreditable 1160/1170 y días de crédito del proveedor desde H03) y que no queden datos.
- **Respaldos protegidos (O03.1):** `npm run test:backup-protect` (5 pruebas en carpeta temporal) y, con clave configurada, `npm run backup:restore-test` sobre el último `.sbk`, o sobre la copia del USB con `-- --archive=`. Este último descifra, restaura en base aislada, migra, corre las operaciones aisladas y lo elimina todo. La verificación aislada que usa `verify:release` vuelve a pasar tras corregir el arnés de operaciones con la compra directa de H02-b (comprobado vía `backup:restore-test`; `verify:release` completo no se ejecutó). [Manual](RESPALDOS.md).
- **Base desde cero (O05):** `npm run test:fresh-database` crea una base temporal con `db:init` (esquema base + catálogos + migraciones posteriores), la compara con la base configurada, prueba `db:create-admin` y corre el arnés de operaciones; exige 12/12 y elimina la base. Ejecutarlo tras cada migración nueva para confirmar que una instalación nueva sigue siendo equivalente. [Manual](BASE_DESDE_CERO.md).
- **Navegación y vistas (U02.1/U02.2):** `tests/navigation-saved-views.spec.ts` (Ctrl K, roles, recientes, vistas guardadas) dentro de `test:e2e-ui`. El mock por defecto responde `[]` a `/vistas-guardadas`; las pruebas que necesiten vistas registran su propia ruta después de `installErpApiMock`. [Manual](NAVEGACION_Y_VISTAS.md).
- **Acciones en lote (U02.3):** `npm run test:bulk-actions` (precios/categoría y pago agrupado contra la base configurada en una transacción revertida; exige 17/17) y `tests/bulk-actions.spec.ts` en `test:e2e-ui`. Las casillas de `mat-checkbox` deben usar el input `aria-label`, no `[attr.aria-label]`.
- **Correo (O01.2b):** `npm run test:mail-outbox` (base aislada restaurada del último respaldo, ejecutor real y SMTP local en 127.0.0.1; exige 31/31 y que la base se elimine). `npm run test:document-outbox -- --backup=…` (O01.2a) debe seguir en `passed=true`, `smtpCalls=0`. Ninguna prueba envía correo a terceros: los destinatarios son `example.invalid`.
- **PAC y campañas (O01.2c):** `npm run test:pac-campaigns` (base aislada del último respaldo con AppModule y HTTP reales; timbra en mock, prueba confirmación/rechazo/falla/conciliación manual de cancelaciones, timbrado interrumpido y la simulación de campañas con bajas y cambios posteriores al inicio; exige 32/32 y que la base se elimine; reporte `.artifacts/o012c-pac-campanas.json`).
- **DPO (F03):** `tests/dpo-contable.spec.ts` y la prueba unitaria `dpo-contable.service.spec.ts`. Cualquier pantalla que agregue una consulta al `forkJoin` de Contabilidad debe simularse también en `ui-showcase`.
- **Salud de las salidas (O01.3a):** `npm run test:outputs-health` (copia aislada del último respaldo; exige 17/17 y que la copia se elimine; reporte `.artifacts/o013a-salud-salidas.json`) y `tests/outputs-health.spec.ts` en `test:e2e-ui`. Las pruebas de Inicio que simulen `/dashboard/**` con una respuesta genérica no rompen el panel: ignora respuestas sin `areas`/`metricas`.
- **Ajuste de Proveedores (F02a):** `npm run test:supplier-adjustment` (copia aislada; detección, rechazos, dos solicitudes simultáneas, borrador cuadrado y conciliación F03 sólo tras contabilizar; exige 15/15; reporte `.artifacts/f02a-ajuste-proveedores.json`) y la segunda prueba de `tests/dpo-contable.spec.ts`.
- **Versiones y despliegue (O04.1):** `npm run test:release` (13 pruebas unitarias) y `npm run test:release-deploy` (punta a punta con copias `o04_*`, versiones temporales y puertos propios; reporte `.artifacts/o04-despliegue.json`). No ejecutar este último a la vez que otros verificadores: compila backend e interfaz y `nest build` borra `backend/dist`. Liberar con `release:build` → `staging:refresh` → `staging:deploy` → `release:deploy`. [Manual](DESPLIEGUE_Y_ROLLBACK.md).
