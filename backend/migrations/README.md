# Database Migrations

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
