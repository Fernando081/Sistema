# Database Migrations

## Reportes internos programados — C03.2,21/10/2026

CRM → Bandeja comercial → Reportes programados (`/crm/reportes-programados`): ADMIN propietario con permiso `crm.reportes.programar`, frecuencia diaria/semanal, hora Tampico en múltiplos de10min y filtros de origen/plazo. Snapshots de conteos completos reutilizan C03.1 en la misma transacción/snapshot, sin listas/contactos/importes. Definición conservada, suspensión/reanudación versionadas y corte nuevo sin periodos retroactivos; historial paginado protegido. Migración110 aplicada tras respaldo y db:check; no crea programaciones o resultados de ejemplo.

Nuevo proceso `crm_reports` cada10min, máximo50 elegibles/pasada, guardia PostgreSQL72410,5 y unicidad programa/horario. Reutiliza historial/estado/avisos O02 existentes, incluida recuperación del proceso; esa recuperación no repara resultados Error anteriores. Cuenta activa/ADMIN/permiso revalidados antes de generar; configuración/controles con actor humano, cron sin autor humano inventado. Error guarda sólo código fijo, sin snapshot/SQL ni reintento del periodo conservado. O01 conserva colas/reintentos generales; C03.3 piloto/retención/capacidad. No modifica horarios/cálculos de los procesos anteriores. Sin envíos o bancos.

Aceptación con copia propia restaurada y AppModule/SQL/HTTP/Angular/login reales, calendario adelantado sólo dentro del verificador y sin fixtures en origen. Separa reloj de disparo probado de una ejecución nocturna real. `npm run test:crm-reports -- --backup=.backups/FECHA/database.dump`; resultados definitivos/regresiones/respaldo y límites en README. [Manual, contratos y evidencia](../../docs/REPORTES_COMERCIALES_PROGRAMADOS.md).

This directory contains SQL migration scripts for the database schema.

## How to Apply Migrations

Run any new migration scripts in numerical order against your PostgreSQL database. Make sure you
track which migrations have already been applied (for example, in a dedicated migrations table)
and only run migrations that have not yet been applied, or use a migration management tool to
handle this for you:

```bash
# Example using psql to apply a specific new migration
psql -U your_username -d your_database -f 001_create_auth_user_table.sql
```

## Migration Files

- `001_create_auth_user_table.sql` - Creates the auth_user table for JWT authentication system
- `002_add_role_check_constraint.sql` - Adds CHECK constraint to enforce role values at database level
- `027_integridad_operativa.sql` - Bloqueos de inventario, folio único, índices y reverso de pagos
- `028_costo_historico_venta.sql` - Congela el costo conocido de cada venta y elimina costos supuestos
- `029_prediccion_demanda_consistente.sql` - Pronóstico con periodos sin venta y sin devoluciones
- `030_idempotencia_operaciones.sql` - Evita duplicados en reintentos de ventas y compras
- `031_crm_pipeline.sql` - Prospectos, oportunidades, seguimientos y demanda perdida
- `032_catalogo_diesel_y_garantias.sql` - Números OEM, aplicaciones y base de garantías
- `033_cancelaciones_devoluciones_seguras.sql` - Cancelaciones y devoluciones con bloqueos, límites y auditoría por usuario
- `034_garantias_operativas.sql` - Flujo de garantías por renglón, cantidad, destino, evidencia y responsable
- `035_integridad_cobros_y_devoluciones.sql` - Vínculos financieros de REP y notas de crédito, salidas a proveedores y guardas de cancelación
- `036_margen_neto_y_reembolso_exacto.sql` - Reembolsos acumulados por centavo y margen después de devoluciones y notas de crédito
- `040_crm_agenda.sql` - Control de edición concurrente e índices de agenda y ventas perdidas
- `045_sesiones_revocables.sql` - Invalida JWT previos al cambiar contraseña, rol o estado de usuario
- `046_caja_turnos_y_movimientos.sql` - Apertura/cierre de caja y bitácora inmutable de movimientos
- `060_contabilidad_libro_mayor.sql` - Catálogo de cuentas, pólizas automáticas/manuales y libro mayor
- `061_tesoreria_conciliacion.sql` - Cuentas bancarias propias y conciliación con movimientos del sistema
- `072_conciliacion_bancaria_automatica.sql` - Importación CSV idempotente, coincidencia automática y revisión bancaria
- `062_control_financiero.sql` - Periodos, cierre mensual, centros de costo y presupuestos
- `063_permisos_granulares.sql` - Permisos por operación, rol y excepciones por usuario
- `064_centro_notificaciones.sql` - Alertas internas deduplicadas y estado de lectura
- `065_proveedores_costos_devoluciones.sql` - Costos de recepción, devoluciones y evaluación de proveedores
- `066_almacen_conteos_kits_cascos.sql` - Conteos ciegos autorizables, armado de kits y trazabilidad de cascos
- `067_crm_operativo.sql` - Segmentos, campañas, plantillas, satisfacción y metas de vendedores
- `091_resolucion_solicitudes_web.sql` - Historial administrativo de decisiones ConservarOriginal, idempotencia/versiones y bloqueo de UPDATE/DELETE; no guarda contactos, piezas o huellas

## Creating New Migrations

When adding new migrations:
1. Create a new file with the next number in sequence: `00X_description.sql`
2. Add comments at the top describing what the migration does
3. Use `CREATE TABLE IF NOT EXISTS` and similar idempotent statements when possible
4. Document the migration in this README

## auth_user Table

The `auth_user` table stores authentication credentials for system users:

- `id_user` - Primary key, auto-incrementing
- `username` - Unique username for login
- `password_hash` - Hash bcrypt de la contraseña
- `role` - User role (must be 'admin' or 'user', enforced by CHECK constraint)
- `is_active` - Boolean flag to enable/disable access
- `created_at` - Timestamp when created
- `updated_at` - Timestamp when last updated (auto-updated by trigger)

### Creating Users from NestJS (recommended)

Use the registration endpoint `POST /api/v1/auth/register` from an authenticated administrator account. NestJS hashes the password with `AuthService.hashPassword()` before storing it. The endpoint is not public.

**Example request (Postman):**

```http
POST http://localhost:3000/api/v1/auth/register
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "username": "admin_principal",
  "password": "SuperSeguro123",
  "role": "admin"
}
```

**Response example:**

```json
{
  "idUser": 1,
  "username": "admin_principal",
  "role": "admin"
}
```

Allowed roles currently are `admin` and `user`. If no `role` is sent, `user` is used by default.

### Creating Users manually with SQL (not recommended)

If you choose SQL directly, **first generate** `password_hash` using backend code (`AuthService.hashPassword()`), then insert:

```sql
INSERT INTO auth_user (username, password_hash, role, is_active)
VALUES ('your_username', 'salt:hash_from_backend', 'admin', true);
```

El fallback de entorno solo se permite fuera de producción y con `ALLOW_ENV_AUTH=true`. Una caída de la base de datos no habilita el fallback: el login falla de forma segura.

## Ejecutor y respaldo

Desde la raíz del proyecto:

```bash
npm run db:status   # muestra aplicadas y pendientes
npm run db:check    # ejecuta las pendientes dentro de una transacción y revierte
npm run db:backup   # pg_dump custom + índice legible + uploads
npm run db:migrate  # aplica las pendientes con checksum y bloqueo exclusivo
```

`backend/verify-isolated-database.js` restaura un respaldo en una base temporal, aplica migraciones y prueba concurrencia, caja, devoluciones, REP, notas de crédito, márgenes y cotizaciones. La base temporal se elimina al terminar.

Las migraciones `067_crm_operativo.sql` y `068_crm_tareas_comunicaciones.sql` incorporan segmentos, campañas, satisfacción, metas, tareas asignables y bitácora de comunicaciones del CRM.

La migración `069_alertas_operativas.sql` incorpora la fecha compromiso de garantías y los índices usados por las alertas de cotizaciones y garantías.

### 077_indicadores_inventario_honestos.sql
Días exactos desde la última factura de ingreso Timbrada/Pagada. Sin ventas previas devuelve NULL. GMROI ficticio retirado (NULL) hasta contar con valoración histórica fiable. Verificar con npm run test:analytics; siempre revierte el esquema de prueba. No editar migraciones previas aplicadas.

### 078–080: analítica operativa y valoración

078 corrige surtido, conversión, pagos efectivos y utilidad por marca; fija search_path de funciones llamadas por vistas materializadas. 079 registra capturas reales diarias y calcula GMROI solo con 90 días completos. 080 elimina costos supuestos y aplica márgenes históricos netos. Ver docs/ANALITICA_DASHBOARD.md y ejecutar npm run test:analytics.


### 081_busqueda_directorios_trigram.sql

pg_trgm y función inmutable de concatenación específica text[], con índices GIN de expresión en cliente/proveedor/crm_unidad_cliente. Sin nuevas columnas, conserva NULL/vacíos/espacios. Código usa LIKE literal parametrizado, con ruta previa para términos cortos/amplios. Aplicada el 2026-10-01 tras respaldo, restauración aislada con equivalencia y db:check. Ver docs/RENDIMIENTO_LISTADOS.md; no modificar una migración aplicada.

### 082_busqueda_productos_trigram.sql

Aplicada el 2026-10-01 tras respaldo restaurado, validación aislada y db:check previo a db:migrate. Depende de pg_trgm instalado por 081. Seis GIN de código/descripción/marca/categoría/OEM/aplicaciones y B-tree de relación producto/categoría. Función inmutable product_application_text(text[]) conserva concatenación textual de aplicaciones. Sin nuevas columnas ni alteración de migraciones aplicadas. Siete índices comprobados en respaldo restaurado; evidencia y límites en docs/RENDIMIENTO_LISTADOS.md.

### 083_busqueda_documentos_trigram.sql

Aplicada el 2026-10-01 tras respaldo restaurado, validación aislada y db:check antes de db:migrate. Dos GIN de expresión para factura/cotizacion usando directory_search_document(text[]) de 081 y pg_trgm. Conserva folios/series, concatenación entre campos, nombre/RFC, NULL y espacios. Sin nuevas columnas ni modificación de migraciones previas. Ambos índices comprobados en base restaurada. Compras/proveedor permanece en Q04.5.2e2. Evidencia y límites en docs/RENDIMIENTO_LISTADOS.md.

### 084_busqueda_compras_trigram.sql

Aplicada el 2026-10-01 tras respaldo restaurado, validación aislada y db:check antes de db:migrate operativo. GIN de ID/folio de compra con función de 081 y B-tree completo de id_proveedor. El índice previo proveedor/fecha/saldo era parcial; no sustituía esta relación. Reutiliza documento e índice de proveedor de 081. Sin columnas nuevas, triggers de sincronización ni cambios de migraciones aplicadas. Ambos índices comprobados en respaldo restaurado; equivalencia completa de lista/conteo/CSV/filtros en docs/RENDIMIENTO_LISTADOS.md.

### 086_estado_refresco_dashboard.sql

Aplicada el 2026-10-05 después de respaldo legible .backups/2026-10-05T19-28-35-683Z/database.dump y db:check previo a db:migrate. operational_job guarda fecha de instalación; operational_job_run conserva UUID/inicio/cierre/resultado e índices de última ejecución/éxito. fn_dashboard_refresh_status calcula horario de México, tolerancia de 30 minutos y últimos 20 intentos. No inventa historial ni omisiones anteriores a instalación. SQL validado en esquema transaccional con rollback, sin fallback public. Sin cambios a migraciones anteriores. O02.2, ver manual de analítica y sesión README.
### 087_estado_jobs_operativos.sql

Aplicada el 2026-10-05 después de respaldo legible/restaurado .backups/2026-10-05T19-52-26-235Z/database.dump, validación en copia y db:check antes de db:migrate operativo. Añade interval_seconds/grace_seconds al catálogo y registra los dos jobs de diez minutos. fn_scheduled_job_status entrega último intento/éxito, últimos 20 y atraso tras cinco minutos de tolerancia, sin omisiones anteriores a instalación. No fabrica historia ni modifica migraciones anteriores. O02.3; ver docs/OBSERVABILIDAD_JOBS.md.

### 088_preparacion_catalogo_web.sql

Aplicada el 2026-10-05 tras respaldo legible .backups/2026-10-05T20-14-00-637Z/database.dump y db:check antes de db:migrate; comprobación posterior sin pendientes. Crea web_producto_ficha con relación al producto, slug único, estados, confirmaciones, snapshot comercial, autor y versión. SQL y servicio verificados en esquema transaccional temporal con rollback. No publica productos ni cambia maestros o migraciones anteriores. WEB01.1 completo en backend, WEB01 parcial; ver docs/CATALOGO_WEB.md.

### 092_vinculos_comerciales_crm.sql

Aplicada en la sesión del2026-10-11 (hora local), después de respaldo legible .backups/2026-10-12T05-21-07-487Z/database.dump, db:check con rollback y luego db:migrate/db:status. Añade crm_oportunidad_cotizacion con PK de cotización, FK compuestas que exigen cliente común con oportunidad/cotización, autor/fecha, índice y auditoría existente. No crea/asigna relaciones o modifica maestros. SQL/HTTP/concurrencia verificados en schema propio; AppModule/login/operaciones y trigger verificados en copia restaurada y eliminada. WEB05.2b; ver docs/WEB_TRAZABILIDAD_COMERCIAL.md y registro de sesión del README. Migraciones previas conservadas.

### 093_gasto_reembolso_devolucion.sql

Aplicada el 2026-10-12, tras respaldo legible `.backups/2026-10-12T17-16-23-784Z/database.dump`, db:check con rollback y luego db:migrate/db:status. FK nullable de devolución a gasto, índice único parcial e índice del vínculo existente de notas. Nuevas devoluciones en efectivo capturan/enlazan su gasto en la misma transacción. Las rutinas de devolución/cancelación marcan su actualización de stock como gestionada y restauran el indicador anterior: un kardex por operación, sincronización por ubicación conservada y ajustes manuales posteriores activos. Históricos sin vínculo permanecen NULL; no se infieren gastos ni se recalculan movimientos anteriores. Migraciones 033/036/085 y demás aplicadas intactas. Verificado con AppModule/HTTP y consultas reales en copia restaurada/eliminada, centavos, caja, póliza, actor, stock/ubicaciones y rollback/rechazos; ver [WEB05.2e](../../docs/WEB_COBROS_NETOS_CRM.md) y sesión del README.

### 094_roles_personalizados.sql

Aplicada el2026-10-19 después del respaldo `.backups/2026-10-19T18-13-49-670Z/database.dump`, db:check con rollback y aceptación en copia restaurada antes de db:migrate. db:status posterior sin pendientes y checksums anteriores conservados. Crea perfiles de permisos, sus concesiones, asignaciones por usuario e índices; función de permiso efectivo con prioridad excepción individual → lista del perfil del operador → rol base sin perfil. No altera usuarios, concesiones anteriores ni entidad AuthUser; cero perfiles/asignaciones de ejemplo en la instalación. Backend/frontend nuevos requieren094. S01: [manual de seguridad](../../docs/SEGURIDAD_Y_PERMISOS.md), pruebas AppModule/login/SQL/Angular y registro al final del README. No implementa MFA ni auditoría inmutable.

### 095_sesiones_por_navegador.sql

Aplicada el2026-10-19 tras respaldo legible `.backups/2026-10-19T18-33-17-986Z/database.dump`, db:check con rollback y aceptación AppModule/SQL/Angular en copia restaurada antes de db:migrate local. db:status posterior sin pendientes/checksums íntegros. Añade auth_session e índices, UUID técnico por login, versión, etiqueta reducida, fechas/vencimiento/revocación; no guarda JWT/IP/User-Agent completo ni cambia usuarios/permisos. Backend nuevo requiere095 y rechaza JWT anteriores sin sid de cuentas persistidas: volver a iniciar sesión. Logout pasa a cierre individual; logout-all conserva cierre global explícito. S02.1 implementado, S02 parcial: [reglas, compatibilidad y pruebas](../../docs/SEGURIDAD_Y_PERMISOS.md#s021--sesiones-por-navegador-19102026). Migraciones anteriores conservadas.

### 096_autenticacion_dos_pasos.sql

Aplicada el2026-10-19 tras respaldo legible `.backups/2026-10-19T19-33-33-294Z/database.dump`, db:check con rollback y aceptación AppModule/PostgreSQL/Angular real en copia restaurada/eliminada antes de db:migrate local. db:status posterior con096 aplicada. Añade MFA opcional (`auth_mfa`), retos de login (`auth_mfa_challenge`) y respaldos de un uso (`auth_mfa_recovery`), FK e índice. No modifica cuentas actuales ni094/095/checksums anteriores, no inscribe autenticadores de ejemplo ni altera datos fiscales. Secreto cifrado AES-GCM requiere clave externa estable en backend; los retos y respaldos solo guardan hashes. [S02.3: configuración/clave y pruebas](../../docs/AUTENTICACION_DOS_PASOS.md). S02 sigue parcial por recuperación de contraseña/cuenta.

### 097_recuperacion_cuenta_local.sql

Aplicada el2026-10-19 después del respaldo legible `.backups/2026-10-19T23-41-37-020Z/database.dump`, db:check con rollback y aceptación AppModule/PostgreSQL/Angular real en copia restaurada/eliminada antes de db:migrate local. db:status posterior con097 vigente; migraciones/checksums anteriores conservados. Añade `auth_password_recovery`, FK y checks de estado completo; sin inscribir cuentas, cambiar contraseñas o sembrar claves. Claves aleatorias offline guardadas solo como SHA-256, pendiente10min y clave confirmada365d/un uso, vinculada por huella a la credencial. Sin trigger que copie hashes a auditoría ni nuevo cron. Avisos internos usan la tabla existente. [S02.4: método local, política, pruebas y límites](../../docs/RECUPERACION_DE_CUENTA.md); soporte asistido/identificación real y notificaciones externas permanecen pendientes.

### 098_auditoria_append_only.sql

Aplicada el2026-10-19 (hora local), tras respaldo legible `.backups/2026-10-20T00-06-11-003Z/database.dump`, db:check con rollback y aceptación real en copia restaurada/eliminada antes de db:migrate local. db:status posterior con098 aplicada/checksums anteriores conservados. Añade nombre del actor, versión de protección e indicador de cambio de credencial; conserva columnas originales de históricos sin identidad retroactiva. Retira FK de actor con SET NULL para no reescribir historia al eliminar usuarios. Triggers ALWAYS de enriquecimiento y rechazo de UPDATE/DELETE/TRUNCATE sobre auditoría, revocación de esos privilegios de PUBLIC y auditoría de fila de siete tablas de acceso. Whitelist excluye hashes/secretos; rechaza copiar tablas secretas de autenticación. Sin modificar usuarios, fiscal mock o migraciones previas. No protege frente a DDL del propietario/superusuario ni certifica integridad criptográfica. [Manual S03.1 y pendientes S03.2](../../docs/AUDITORIA_Y_APROBACIONES.md).

### 099_aprobaciones_por_operacion.sql

Aplicada el2026-10-19 (hora local) tras respaldo legible `.backups/2026-10-20T00-44-40-972Z/database.dump`, db:check con rollback y aceptación AppModule/PostgreSQL/Angular producción en copia antes de db:migrate local; db:status posterior con099/checksums anteriores conservados. Crea matriz de nueve combinaciones de operación/tipo, versiones/motivo/vigencia y límite por aprobador/operación; auditoría de ambas tablas usando protección098. Añade alcance nullable de destino/monto y snapshot/versión de decisión a solicitudes, sin inventar datos históricos. Semillas iniciales sin topes nuevos/separación obligatoria, vigencia máxima24h; sin límites individuales o autorizaciones ficticias. Nuevo permiso comercial.configurar_aprobaciones, solo rol admin inicialmente. Conserva migraciones anteriores/fiscal mock/identificadores técnicos. Backend/frontend nuevos requieren099; clientes API de solicitudes nuevas deben enviar destino/monto. [S03.2: procedimiento, contratos, compatibilidad y pruebas](../../docs/POLITICA_COMERCIAL.md#s032--matriz-y-límites-de-aprobación-19102026).

## 100 — Expediente de unidades (D01)

Aplicada el2026-10-19 (hora local) después del respaldo legible `.backups/2026-10-20T01-29-55-439Z/database.dump`, db:check con rollback y aceptación real en copia antes de db:migrate. db:status posterior confirma100 y checksums previos conservados. Crea lecturas, mantenimiento, metadata de archivos y contenido bytea separado; FK RESTRICT conserva expediente, UUID/huella por unidad, índices de historial y auditoría de metadata con nombre del actor. No copia binarios a auditoría JSONB. Añade permisos crm.unidades.consultar/gestionar, sólo admin inicialmente. Cero lecturas/planes/archivos de ejemplo en el origen; VIN/ESN, fiscal mock e identificadores técnicos conservados.

Backend/frontend D01 requieren100. La eliminación de unidades con expediente se rechaza (409 API/FK); retirada de archivos y anulación son lógicas. Los respaldos incluyen binarios; retención/capacidad operativa pendientes. Respaldo posterior `.backups/2026-10-20T01-38-13-312Z/database.dump` restaurado/verificado el20/10 con14 grupos reales y limpieza de copia, además de los13 previos al aplicar. [Manual D01](../../docs/EXPEDIENTE_UNIDADES.md).

## 101 — Piezas instaladas y vínculo a garantías (D02)

Aplicada el20/10/2026 tras respaldo legible `.backups/2026-10-20T15-24-33-536Z/database.dump`, db:check con rollback y aceptación AppModule/PostgreSQL/Angular de producción en copia antes de db:migrate. db:status posterior confirma101 y migraciones previas conservadas. Crea crm_unidad_pieza y crm_unidad_pieza_garantia: reporte con cantidad numeric, fecha, snapshot de código/descripción/VIN/ESN, revisión manual versionada y vínculos idempotentes a garantías existentes. FK RESTRICT preserva fuentes/unidad, índice único parcial impide dos vínculos activos para una garantía y triggers auditan metadata/actor mediante098. No añade permisos: reutiliza consulta/gestión de100; sin instalar piezas de ejemplo o inferir historia de facturas.

Backend/frontend D02 requieren101; la consulta general de garantías añade su enlace privado condicionado al permiso efectivo. No modifica migraciones aplicadas, catálogo de aplicaciones, stock, fiscal mock o identificadores técnicos. Respaldo posterior `.backups/2026-10-20T15-41-39-711Z/database.dump` también restaurado/verificado,14 grupos reales y copia eliminada. [Contrato, cantidades, concurrencia, correcciones y límites D02](../../docs/PIEZAS_INSTALADAS.md).

## 102 — Revisiones de cotización y respuesta por enlace (V01)

Aplicada el20/10/2026 después del respaldo legible `.backups/2026-10-20T16-34-05-620Z/database.dump`, db:check con rollback y aceptación real desde respaldo previo `.backups/2026-10-20T16-10-21-093Z/database.dump` en copia restaurada/eliminada. db:status posterior confirma102 y migraciones anteriores conservadas. Crea cotizacion_revision, cotizacion_invitacion y cotizacion_respuesta con FK RESTRICT, versión/UUID/huella por familia, snapshot/hash, token sólo hash/vencimiento/revocación y respuesta única. Triggers ALWAYS impiden UPDATE/DELETE/TRUNCATE de revisiones/respuestas; auditoría de las tres tablas. Añade cotizaciones.versionar sólo al rol admin inicialmente; no rellena versiones/aceptaciones de históricos.

Backend/frontend V01 requieren102 y todos los procesos deben conocer la regla de última revisión aceptada antes de activar versiones. Creador de cotización reutilizable en la misma transacción y advisory lock del folio se incorporan en código; no modifica fn_crear_cotizacion o migraciones anteriores. Cotizaciones no activadas conservan flujo previo. Respaldo posterior `.backups/2026-10-20T16-35-04-915Z/database.dump` también restaurado/verificado:14 grupos reales, copia eliminada. No publica el ERP, envía enlaces, verifica identidad o certifica firma avanzada/fiscal. [Contratos, despliegue, corrección, claves y límites](../../docs/VERSIONES_COTIZACION.md).

## 103 - Evidencias de entrega V02 (20/10/2026)

Añade pedido_entrega_evidencia (snapshot/huella/request/autor) y pedido_entrega_archivo (bytes fuera de auditoria_jsonb). FK restrictivas, UUID global, originales limitados, hashes y triggers ALWAYS de conservación; entrega_pedido vinculada protegida ante UPDATE/DELETE. Metadata auditada con actor LOCAL. Permiso pedidos.entregas sólo ADMIN inicialmente, delegable S01, también para ruta anterior. No modifica050, no rellena entregas antiguas ni inventa evidencias.

Respaldo previo `.backups/2026-10-20T23-01-29-964Z/database.dump`, db:check con rollback, aceptación en copia y aplicación103 en origen; backend reiniciado faseV02. Respaldo posterior `.backups/2026-10-20T23-12-58-387Z/database.dump` restaurado/migrado y operaciones generales verificadas en copia eliminada. El origen conserva vacías las dos tablas nuevas. [Uso, contratos, despliegue y límites](../../docs/ENTREGAS_EVIDENCIADAS.md).

## 104 - Acceso externo y portal V03.1 (20/10/2026)

Cinco tablas portal_acceso/credencial/invitacion/sesion/evento, cliente/alias fijos, UUID de invitación, hashes/versión/caducidad, eventos ALWAYS, auditoría de metadata y guard que rechaza auditar tablas secretas. Nuevo permiso portal.gestionar sólo ADMIN inicialmente/delegable. Índices por cliente en cotizaciones y por factura en garantías, reutilizando existentes en otros dominios. No modifica098/anteriores ni inscribe clientes del origen.

Respaldo previo `.backups/2026-10-20T23-45-40-484Z/database.dump`, db:check con rollback, aceptación en copia,104 aplicada y backend reiniciado faseV03.1. Posterior `.backups/2026-10-21T00-00-16-142Z/database.dump` restaurado y validado por aceptación final, copia eliminada. Cinco tablas nuevas vacías en origen. [Contratos, despliegue y límites](../../docs/PORTAL_CLIENTES.md).

## 105 - Publicaciones del portal V03.2 (20/10/2026)

Añade portal_publicacion, portal_publicacion_archivo y portal_publicacion_retiro con FKs restrictivas, UUID/huella/tamaño/SHA-256, metadata auditada y bytes separados, guardas ALWAYS append-only y permiso portal.publicar ADMIN inicial/delegable. Amplía fn_portal_proteger_secretos para rechazar auditar archivos preservando la protección de credenciales/invitaciones/sesiones. No modifica104/anteriores, no rellena originales ausentes ni publica adjuntos existentes.

Respaldo previo `.backups/2026-10-21T00-21-11-370Z/database.dump`, db:check con rollback, aceptación real en copia,105 aplicada y backend reiniciado faseV03.2. Respaldo posterior `.backups/2026-10-21T00-29-48-226Z/database.dump`; resultados de restauración y pruebas en README. Las tres tablas nuevas y las cinco de identidad permanecen vacías en origen. [Uso, fuentes, HTTP, seguridad y límites](../../docs/PORTAL_CLIENTES.md#v032--publicación-y-descarga-de-archivos-20102026).

## 106 - Consentimiento y preparación de campañas C01.1 (20/10/2026)

Añade crm_consentimiento_comercial y crm_campana_preparacion: referencias de contacto/cliente/canal/finalidad, hash de destino, manifestación/vigencia/referencia/motivo, versiones e idempotencia; preparaciones acotadas con decisiones técnicas/huellas sin duplicar automáticamente nombres/direcciones. FKs restrictivas de cliente/campaña/actor; referencia histórica de contacto sin cascada para preservar bajas al borrar su ficha. Índices, permiso crm.campanas.gestionar ADMIN inicial/delegable, auditoría nominal de metadata y guardas ALWAYS UPDATE/DELETE/TRUNCATE. No modifica053/067/anteriores ni inscribe contactos existentes.

Respaldo previo `.backups/2026-10-21T01-07-00-316Z/database.dump` → db:check con rollback → aceptación real en copia →106 aplicada → backend Node24 reiniciado faseC01.1. Posterior `.backups/2026-10-21T01-19-26-197Z/database.dump` restaurado y aceptación completa verificada en copia eliminada. Las dos tablas permanecen vacías en origen; no envía mensajes, activa campañas o aprueba evidencia/privacidad. [Manual y límites](../../docs/CAMPANAS_CONSENTIMIENTO.md).

## 107 - Secuencias internas CRM C02.1 (21/10/2026)

Añade crm_secuencia_modelo, crm_secuencia y crm_secuencia_evento, con modelos/pasos conservados, ejecución explícita por cliente/responsable, UUID/huella/motivo, estado/paso/cierre e historial nominal. crm_tarea incorpora vínculo/paso único; trigger de actualización serializa y crea el paso siguiente o cierre/cancelación en la misma transacción. FKs restrictivas, índices, auditoría y guardas ALWAYS de modelo/evento. Permiso crm.secuencias.gestionar ADMIN inicial/delegable. No modifica106/anteriores, no inscribe tareas/clientes ni inserta comunicaciones o modelos de ejemplo.

Respaldo previo `.backups/2026-10-21T06-12-22-771Z/database.dump` → db:check revertido → aceptación en copia → db:check previo repetido →107 aplicada → backend Node24 reiniciado faseC02.1. Respaldo posterior `.backups/2026-10-21T06-26-47-803Z/database.dump` restaurado y aceptación real9 grupos, copia eliminada. Tablas nuevas vacías en origen y tareas anteriores no inscritas. C02 sigue parcial por C02.2. [Manual, contratos y límites](../../docs/CRM_SECUENCIAS.md).

## 108 - Control de secuencias CRM C02.2a (21/10/2026)

Amplía crm_secuencia con versión, estado Pausada, instante de pausa e intervalo firmado de plazo restante. El índice único abarca Activa/Pausada. Añade crm_secuencia_control con UUID/huella/actor/motivo, versiones, responsables y vencimientos anterior/nuevo, FKs restrictivas, índice de historia, auditoría y guarda ALWAYS de conservación. Reemplaza la función de tarea por una que bloquea el avance durante pausa, admite cancelación y contexto transaccional de control, y versiona el avance. No modifica107/anteriores ni inventa controles históricos; las ejecuciones previas comienzan en versión1 para el nuevo control. Sin backfill de inscripciones, tareas, comunicaciones o disparadores por eventos.

Respaldo previo legible `.backups/2026-10-21T07-49-39-609Z/database.dump` → db:check revertido → aceptación aislada → db:check previo repetido →108 aplicada → backend Node24 reiniciado faseC02.2a. Respaldo posterior `.backups/2026-10-21T08-09-04-434Z/database.dump` restaurado y aceptación ampliada15 grupos reales, copia eliminada. Control nuevo vacío y tablas C02 anteriores observadas vacías en origen. C02/C02.2 siguen parciales por C02.2b. [Manual, reglas y límites](../../docs/CRM_SECUENCIAS.md#c022a--pausa-reanudación-y-reasignación).

## 109 - Reglas supervisadas por eventos CRM C02.2b (21/10/2026)

Añade crm_etapa_evento, crm_secuencia_regla y crm_secuencia_aplicacion. Trigger registra eventos nuevos de alta/cambio real de etapa/cliente/responsable; no-op no genera otro evento. Cursor/fecha por regla excluyen historia previa. Modelo/etapa/configuración conservados; aplicación UUID/huella/actor/motivo/evaluación, vínculo validado a secuencia/origen y unicidad evento/modelo entre reglas. FKs restrictivas, índices por etapa y origen/historial, tres guardas ALWAYS de conservación y auditoría nominal de reglas/aplicaciones. No modifica107/108/anteriores ni hace backfill. No agrega ejecutor desatendido, envío o permiso nuevo.

Respaldo previo legible `.backups/2026-10-21T14-28-55-108Z/database.dump` → db:check revertido → aceptación aislada → db:check repetido →109 aplicada → backend Node24 reiniciado faseC02.2b. Posterior legible `.backups/2026-10-21T14-48-43-803Z/database.dump` restaurado y aceptación22 grupos reales, copia eliminada. Tres tablas nuevas observadas vacías en origen; checksum107/108 conservados. C02 mantiene piloto/retención y O01 ejecución desatendida. [Manual, alcance y límites](../../docs/REGLAS_SEGUIMIENTO.md).

## 111 — Escaneo complementario de picking A01.1 (21/10/2026)

Añade permiso inventario.escanear ADMIN inicial/delegable y almacen_picking_verificacion con UUID/huella/actor/snapshot, cantidad numeric(18,6), acción Verificar/Anular y vínculo compensatorio único. FKs restrictivas, índices de historia/picking, trigger ALWAYS de pedido/partida/estado/cantidad y conservación contra UPDATE/DELETE/TRUNCATE, auditoría nominal. Sin cambios en stock, reservas, picking existente o migraciones anteriores; no siembra verificaciones históricas.

Respaldo previo legible `.backups/2026-10-21T17-40-44-113Z/database.dump` → db:check con rollback →111 aplicada, tras aceptación real en copia del respaldo anterior17:05. Backend Node24 reiniciado A01.1 en3100. Posterior legible `.backups/2026-10-21T17-41-06-916Z/database.dump` restaurado y aceptación12 grupos repetida en copia propia eliminada. Tabla nueva observada vacía, checksum111 coincide y asignación base sólo ADMIN. A01.2 mantiene hardware/impresión/procedimiento real; no bloquea facturación/entrega anteriores. [Manual](../../docs/ESCANEO_ALMACEN.md).

## 112 — Recuperación durable de reportes O01.1 (21/10/2026)

Agrega crm_reporte_reintento, crm_reporte_intento_evento y crm_reporte_recuperacion. Una cola por Error original, hasta tres intentos, disponibilidad/reserva/token/versión, índices parciales, FKs restrictivas/unicidad y snapshots acotados. Guardas ALWAYS de vínculo (Error/reserva vigente), transiciones/terminal/conservación y auditoría. No modifica110/111, no reescribe Error/snapshots ni siembra trabajos históricos; Error nuevo+cola comparten transacción del servicio. Recuperación posterior separada del resultado original.

Respaldo previo legible `.backups/2026-10-22T05-38-01-973Z/database.dump` → db:check con rollback →112 aplicada, tras aceptación real en copia del respaldo18:05. Backend Node24 reiniciado faseO01.1 en3100. Posterior legible `.backups/2026-10-22T05-38-15-882Z/database.dump` restaurado y aceptación11 grupos reales repetida en copia propia eliminada. Tres tablas nuevas observadas vacías en origen, checksums111/112 coincidentes y trigger de transiciones ALWAYS. Nombres de respaldo en UTC; sesión local21/10/2026. O01 parcial por otros consumidores/operación; no nuevos permisos, cron, dependencias o efectos externos. [Manual y límites](../../docs/COLA_REPORTES.md).

## 113 — Solicitudes privadas de documentos locales O01.2a (22/10/2026)

Permiso ventas.correo.gestionar ADMIN inicial/delegable y documento_salida/archivo/cierre, con UUID/huella/referencia de origen/bytes/PDF/hash/actor, clasificador fiscal y modo Local fijo. Cierre único Simulado/Cancelado/Obsoleto, FKs restrictivas, índices/constraints y guardas ALWAYS de vínculo/tamaño/cabeceraPDF/conservación/privacidad de archivo en auditoría. Metadatos/cierres auditados sin destinatario/cuerpo/bytes. No cambia112/anteriores, función histórica de correo o contenido de facturas; sin backfill, SMTP, consumidor automático o siembra de ejemplos.

Previo legible `.backups/2026-10-22T15-46-14-271Z/database.dump` → db:check revertido →113 aplicada tras aceptación real aislada desde respaldo15:36. Backend Node24 reiniciado faseO01.2a. Posterior legible `.backups/2026-10-22T15-46-37-897Z/database.dump` restaurado y aceptación13 grupos reales; copias propias eliminadas. Tres tablas nuevas vacías en origen y checksums112/113 conservados. O01.2 sigue parcial por ejecutor/transporte O01.2b y otros consumidores O01.2c. [Manual y límites](../../docs/SALIDA_DOCUMENTOS.md).

## 114 — Permisos de surtido y cancelación de pedidos H01 (27/10/2026)

Agrega `pedidos.surtir` y `pedidos.cancelar` y los concede a `admin` y `user` para conservar el comportamiento previo; desde ahora pueden negarse por usuario o perfil S01. `POST /pedido/:id/surtir` y `/cancelar` los exigen. No crea tablas, no cambia datos de pedidos ni otros permisos.

Previo legible `.backups/2026-10-27T06-15-52-057Z` → db:check revertido → 114 aplicada. Posterior legible `.backups/2026-10-27T06-16-14-798Z`. Verificado en origen: cinco concesiones `pedidos.*` (entregas sigue sólo admin) y permiso efectivo del administrador existente. Sin aceptación HTTP real en copia aislada (ver sesión H01 del README).

## 115 — Permisos de cobranza y trazabilidad H02-a (27/10/2026)

Agrega `cobranza.registrar` (`POST /pago`, `POST /pago/rep`) e `inventario.trazabilidad` (lotes, series y cascos), concedidos a `admin` y `user` para conservar el acceso; negables por usuario o perfil. Sin tablas ni cambios de datos.

Previo legible `.backups/2026-10-27T07-27-29-729Z` → db:check revertido → 115 aplicada. Posterior legible `.backups/2026-10-27T07-27-33-959Z`, usado por la aceptación `test:route-permissions` (copia eliminada).

### Checksums independientes del fin de línea (H02-e)

`run-migrations.js` usa `migration-checksum.js`: las migraciones nuevas guardan el SHA-256 del contenido con LF y la validación acepta además los checksums históricos de bytes crudos (CRLF o LF). En una ejecución normal (no `--check`/`--status`) re-sella al checksum canónico **sólo** las migraciones cuyo archivo actual coincide con lo registrado. Motivo: 019, 077, 080, 081, 082 y 085 tenían checksum de bytes con finales mezclados que ningún clon nuevo podía reproducir (git guarda LF), así que `db:migrate` habría rechazado la base en staging u otro equipo. En esta base se re-sellaron esas seis al aplicar 115; las 109 aplicadas validan ahora con el blob de git en LF y en CRLF. Un cambio de contenido sigue siendo rechazado.
- `116_compra_directa_flujo_formal.sql` - H02-b: `orden_compra.origen` ('Abastecimiento' | 'Compra directa') para las compras de "Nueva compra" registradas como orden, recepción y factura de proveedor
- `117_iva_acreditable_compras.sql` - H03: cuentas 1160/1170, `proveedor."DiasCredito"` y pólizas de factura/pago/aplicación de proveedor con IVA acreditable pendiente → pagado

**O05 (28/10/2026):** `backend/schema/` congela el esquema completo con las migraciones 001–117. Una base nueva se crea con `npm run db:init -- --database=NOMBRE`, que carga ese esquema y luego aplica sólo las migraciones posteriores. Las migraciones nuevas se siguen agregando aquí igual que antes. Después de cada una, `npm run test:fresh-database` confirma que una base nueva queda equivalente. Opcionalmente se puede volver a congelar con `npm run db:schema:export`. Ver [docs/BASE_DESDE_CERO.md](../../docs/BASE_DESDE_CERO.md).
- `118_vistas_guardadas.sql` - U02.2: `vista_guardada` (filtros propios por usuario y listado; rutas permitidas por CHECK, nombre único, ON DELETE CASCADE)
- `119_salida_documentos_correo.sql` - O01.2b: modo Correo, cierres Aceptado/Fallido con coherencia por modo, `documento_salida_envio` (estado de trabajo), `documento_salida_intento` y `documento_salida_conciliacion` (inmutables) y job `document_mail`
