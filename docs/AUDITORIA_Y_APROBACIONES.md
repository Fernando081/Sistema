# Auditoría y aprobaciones — S03

Actualizado: 19/10/2026. **S03.1 implementa controles locales de PostgreSQL y trazabilidad administrativa; S03.2 añade matriz, límites y separación configurable de aprobaciones. S03 sigue parcial por privilegios operativos, retención e integridad externa.** No requiere dominio, hosting ni servicios bancarios. Conserva datos de prueba y facturación mock.

## Qué existía y qué añade esta fase

La auditoría JSONB de movimientos y sus triggers ya existían, así como la bitácora protegida de caja. Las autorizaciones comerciales también existen: descuento, margen bajo y exceso de crédito, solicitante, motivo, aprobador, resolución y vigencia. Se validan en cotización y se consumen de forma atómica al crear pedido o venta, vinculadas a esa operación. S03.1 no vuelve a construir esas capacidades ni cambia sus reglas.

S03.1 protege `auditoria_jsonb` frente a UPDATE, DELETE y TRUNCATE; conserva nombres de actores nuevos y añade auditoría de cambios de usuarios, perfiles y permisos. Una operación administrativa y sus eventos se confirman o revierten en la misma transacción. No se registran intentos rechazados como si fueran cambios confirmados.

## Pantalla y API

Con administrador persistido, abrir **Reportes → Auditoría** (`/reportes/auditoria`). La pantalla muestra estado de controles, procedencia de usuario, cambios, actualización manual y errores de carga diferenciados de una lista vacía. Usa colores del tema, tabla con desplazamiento propio y altura acotada, y paginador accesible.

- GET `/api/v1/auditoria`: últimos **500** eventos, ordenados por fecha e ID descendentes; las páginas se calculan sobre esa ventana, no sobre todo el historial.
- GET `/api/v1/auditoria/estado`: estado estructural del bloqueo y enriquecimiento, número de tablas de acceso cubiertas y advertencia si el rol de conexión es propietario/superusuario o hereda el rol propietario.
- Ambos requieren ADMIN, con `Cache-Control: private, no-store`. No hay nuevo endpoint de edición/borrado de eventos, exportación integral, búsqueda histórica o retención automática.

La inspección comprueba tabla, función, tipo y habilitación de triggers. **No compara el cuerpo de funciones, verifica firmas o certifica que nadie haya alterado la base.** El estado puede detectar un trigger desactivado; no sustituye supervisión externa.

## Migración 098

`098_auditoria_append_only.sql` añade `actor_name`, `protection_version` y `credential_changed`. Los registros previos conservan sus columnas originales, quedan con versión0 y sin nombre retroactivo. Todos quedan sujetos al bloqueo actual; versión0 no significa que hoy puedan borrarse.

El enriquecimiento BEFORE INSERT y el bloqueo BEFORE STATEMENT UPDATE/DELETE/TRUNCATE se habilitan con **ENABLE ALWAYS**. El bloqueo también rechaza sentencias sin filas afectadas y, cuando procede, modo réplica. Se revocan esos privilegios de PUBLIC. La aplicación no ofrece purga: una política futura de retención exige diseño y revisión explícitos.

Se retira la FK de `app_user_id` cuyo SET NULL reescribía el historial al eliminar usuarios. Los eventos conservan ID y nombre capturado aunque posteriormente se renombre/elimine la cuenta. Al insertar, un ID inexistente no se atribuye a una identidad inventada. El actor histórico anterior sin instantánea puede mostrar el nombre actual enlazado o el usuario de PostgreSQL, identificado expresamente como histórico sin instantánea.

Los triggers administrativos AFTER ROW INSERT/UPDATE/DELETE cubren estas tablas con lista de campos permitidos:

| Tabla | Datos conservados en OLD/NEW |
| --- | --- |
| `auth_user` | ID, usuario, rol, activo, versión de sesiones |
| `app_permission` | Código y descripción |
| `app_role_permission` | Rol y código de permiso |
| `app_user_permission` | Usuario, permiso y concesión/denegación |
| `app_access_profile` | ID, nombre, descripción, versión y fechas |
| `app_access_profile_permission` | Perfil y permiso |
| `app_user_access_profile` | Usuario y perfil |

`credential_changed` indica únicamente que un UPDATE cambió la credencial; no conserva su contenido. No se copian contraseñas, hashes, códigos TOTP, claves de recuperación, JWT ni secretos de sesión. Se rechaza insertar en esta auditoría registros identificados como tablas `auth_session`, `auth_mfa`, `auth_mfa_challenge`, `auth_mfa_recovery` o `auth_password_recovery`. Los snapshots de negocio anteriores mantienen sus campos; esto no es un saneamiento retroactivo de todo el contenido de negocio.

## Identidad y transacciones

Los flujos de registro administrativo, estado/rol de usuario, perfiles/asignaciones, excepciones, cambio de contraseña, cierre global de sesiones y cambios de credencial vinculados a MFA/recuperación fijan el actor con `set_config(..., true)` dentro de su transacción. El contexto LOCAL se libera al terminar; no se reutiliza como identidad de otro empleado en el pool. Las mutaciones administrativas revalidan al administrador vigente dentro de su transacción. S03.2 extiende la revalidación a configuración de crédito/precios, solicitudes/decisiones y HTTP de creación de venta, cotización, pedido, pedido desde cotización, facturación de pedido y conversión parcial de cotización. No garantiza cada otra acción de documentos/ERP.

En recuperación offline, el actor representa la cuenta cuyos factores fueron comprobados; no equivale a identificación humana presencial. Operaciones SQL, bootstrap o procesos sin contexto de aplicación pueden quedar sin actor de aplicación, con usuario PostgreSQL. No se inventa identidad para esos casos. Los servicios comerciales conservan la cobertura/contexto que ya tenían: S03.1 no garantiza atribución en cada ruta o tabla del ERP.

## Límites y pendientes

- Un propietario/superusuario de PostgreSQL puede deshabilitar controles por DDL, reemplazar funciones o insertar eventos falsos. **No hay protección frente a ese administrador privilegiado**, cadena criptográfica, firma o copia externa sellada. Separar credenciales de migración y operación con privilegios mínimos es un pendiente operativo, no se cambia silenciosamente la cuenta de conexión local.
- Los nuevos triggers cubren cambios de fila en las siete tablas, no un registro de todo DDL, SELECT, intento fallido, login o TRUNCATE de cada tabla de negocio. No hay auditoría universal de solicitudes.
- **S03.2 implementado localmente:** nueve combinaciones de operación/tipo, topes de documento, límites por aprobador/operación, vigencia, separación configurable, versiones y comprobación al decidir/usar. Sin topes inventados o separación obligatoria inicial. [Procedimiento y contrato completos](POLITICA_COMERCIAL.md#s032--matriz-y-límites-de-aprobación-19102026).
- Retención, acceso al historial completo, restauración y supervisión externa requieren fases propias. No se declara S03 completo ni preparación productiva integral.

## Verificación reproducible

Node24, PostgreSQL local con CREATE DATABASE, backend/frontend compilados y respaldo bajo `.backups`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:audit -- --backup=.backups/FECHA/database.dump
```

El verificador restaura una copia propia, ejecuta db:check y migraciones allí, inicia AppModule real y detiene cron. Comprueba preservación del historial, acceso ADMIN/401/403, redacción de credenciales, bloqueo SQL, rollback ante fallo de auditoría, contexto LOCAL, actor renombrado/eliminado y Angular de producción con login real. Ensaya estado degradado desactivando un trigger solo en su copia; restaura el control y elimina exclusivamente esa base al cerrar. Temas claro1280/oscuro390, reflujo y axe cubren esta pantalla, no todo el ERP. Nunca publica credenciales de fixtures.

Para instalar: respaldo legible → `db:check` → aceptación en copia → `db:migrate` → `db:status` → desplegar backend/frontend compatibles. No editar migraciones aplicadas. Los resultados efectivos de cada sesión se registran en el README.

S03.2 usa `npm run test:commercial-approvals -- --backup=.backups/FECHA/database.dump` con los mismos requisitos. Restaura una copia, migra y prepara allí una baseline declarada de reglas/roles/solicitudes antes de crear fixtures; admite respaldos anteriores/posteriores a099. Verifica los tres tipos, topes/destino/MXN, permisos y versiones, decisiones y configuración concurrentes, expiración, transacción que espera una revocación, rollback de regla ante fallo de auditoría, venta neta después de descuento/stock/reintento y cotización/pedido por HTTP. Angular producción prueba reglas/límites, solicitud completa y rechazo de autoaprobación con borrador conservado en claro1280/oscuro390, axe/reflujo y UI de operador. Ninguna baseline o fixture se aplica al origen; elimina exclusivamente su copia.

Referencias técnicas: [triggers PostgreSQL](https://www.postgresql.org/docs/18/sql-createtrigger.html), [registro seguro de eventos OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
