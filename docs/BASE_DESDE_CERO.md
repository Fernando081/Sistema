# Base de datos desde cero (O05)

Implementado el 28/10/2026.

**Antes**, las migraciones `001`–`117` no bastaban para crear una base nueva. Las tablas originales (`producto`, `cliente`, `factura`, catálogos SAT…) y muchas funciones (`fn_get_proveedores`, `fn_crear_venta`…) venían de la base original y no estaban versionadas. Además, faltan las migraciones 013, 040 y 045.

**Ahora** el esquema completo queda congelado en `backend/schema/` y una base nueva se crea con un comando.

## Archivos

| Archivo | Contenido |
|---|---|
| `backend/schema/esquema-base.sql` | Estructura completa del esquema `public` (tablas, funciones, triggers, vistas, índices). Se genera con `pg_dump --schema-only`, más `CREATE EXTENSION pg_trgm`. |
| `backend/schema/datos-base.sql` | Sólo catálogos de sistema: SAT, geografía, cuentas contables, permisos y su asignación a roles, reglas de aprobación iniciales, jobs operativos, almacén y ubicación GENERAL, centro de costo general, lista "Precio público". Además, `saldos` con una fila en cero. **No incluye** clientes, proveedores, productos, documentos, usuarios, auditoría ni secretos. |
| `backend/schema/esquema-base.json` | Fecha, versión de PostgreSQL, sha256 de los dos `.sql`, filas por catálogo y la lista de migraciones incluidas con su checksum. |

Los `.sql` se versionan byte por byte (`.gitattributes`: `-text`). Algunas funciones se crearon con CRLF y su cuerpo debe quedar idéntico.

## Comandos

- `npm run db:init -- --database=NOMBRE`: crea la base **nueva** NOMBRE (se niega si ya existe). Hace lo siguiente:
  1. carga el esquema y los catálogos en una transacción cada uno;
  2. registra en `schema_migration` las migraciones incluidas;
  3. ejecuta `db:check` y `db:migrate` para las migraciones posteriores al esquema base.
- `npm run db:create-admin -- --username=USUARIO [--database=NOMBRE]`: crea el primer administrador.
  - La contraseña se pide sin mostrarla y se valida igual que en el ERP (10 caracteres a 72 bytes); se guarda con bcrypt.
  - Se niega si ya existe un administrador activo; los demás usuarios se crean desde el ERP.
  - Para automatizar se puede usar `CREATE_ADMIN_PASSWORD` sólo en esa ejecución.
- `npm run test:fresh-database`: crea una base temporal con `db:init` y la compara con la base configurada:
  - esquema equivalente;
  - catálogos con el mismo número de filas;
  - sin datos de negocio y con saldos en cero;
  - sin migraciones pendientes;
  - `create-admin` y su rechazo cuando ya hay administrador;
  - permisos del rol admin;
  - el arnés de operaciones de `verify:release`, con un cliente y un proveedor de prueba.

  Al terminar elimina la base temporal.
- `npm run db:schema:export`: **mantenimiento**. Vuelve a congelar el esquema base desde la base configurada, que debe estar migrada por completo. No es necesario por cada migración: `db:init` aplica las posteriores.

## Instalación nueva

1. Configura `backend/.env` con el servidor PostgreSQL (puede apuntar a la base `postgres` para crear la nueva).
2. `npm run db:init -- --database=sistema`
3. `npm run db:create-admin -- --database=sistema --username=TU_USUARIO`
4. Cambia `DB_NAME=sistema` en `backend/.env` y arranca el sistema.
5. Captura en el ERP los datos del emisor, clientes, proveedores, productos y saldos iniciales. Los saldos iniciales contables siguen en F02.

## Comparación de esquemas

Al restaurar, PostgreSQL vuelve a imprimir algunas expresiones de otra forma equivalente. Por ejemplo, `(ARRAY['a'::varchar])::text[]` se imprime como `ARRAY[('a'::varchar)::text]`, y en algunos `CHECK` cambia la agrupación de `AND` con paréntesis.

La verificación tolera **sólo** esas dos reescrituras (107 líneas al 28/10/2026) y reporta cualquier otra diferencia.

## Límites

- Las migraciones 001–117 siguen sin poder ejecutarse solas sobre una base vacía. El camino soportado es el esquema base más las migraciones posteriores.
- El catálogo `colonia` trae 2 registros con caracteres dañados (U+FFFD) desde la base original. Se conservan tal cual.
- Probado en PostgreSQL 18.2 local. Otra versión mayor puede imprimir el esquema distinto; en ese caso vuelve a ejecutar `db:schema:export` y luego `test:fresh-database`.
- No crea el emisor fiscal ni configura el CSD/PAC.
