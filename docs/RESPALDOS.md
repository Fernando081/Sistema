# Respaldos protegidos (O03.1)

Implementado el 28/10/2026. Se construye sobre `npm run db:backup`, que no cambia: sigue creando `.backups/<fecha>/` con `database.dump` (pg_dump custom), su índice leído con `pg_restore --list` y una copia de `backend/uploads`. Las pruebas de aceptación siguen usando esas carpetas.

## Qué agrega

| Comando | Qué hace |
|---|---|
| `npm run backup:key` | Crea la clave de cifrado (32 bytes aleatorios, base64) en `BACKUP_ENCRYPTION_KEY_FILE` o, por defecto, en `%USERPROFILE%\.sistema-respaldos\clave-respaldos.key`. **Nunca reemplaza** una clave existente. No imprime la clave. |
| `npm run backup:protect` | Cifra la carpeta de respaldo más reciente (o `-- --backup=.backups/<fecha>`) en `.backups/cifrados/<fecha>.sbk`, la descifra completa para comprobarla y la copia a cada carpeta de `BACKUP_EXTERNAL_DIRS`. Cada copia se escribe como temporal, se compara por sha256 y luego se renombra. Si un destino no está conectado, lo informa y termina con código 2. |
| `npm run backup:verify -- --archive=RUTA.sbk` | Descifra en memoria y comprueba la etiqueta GCM y la huella de cada archivo, sin escribir nada. Sirve para revisar la memoria USB. |
| `npm run backup:restore-test [-- --archive=RUTA.sbk]` | Prueba de restauración completa: descifra (por defecto el último de `.backups/cifrados`) en una carpeta temporal y ejecuta `verify-isolated-database.js`. Esto restaura en una base temporal, ejecuta `db:check` y `db:migrate` y las pruebas de operación aisladas, y elimina la base y la carpeta al terminar. No toca la base de trabajo. |
| `npm run backup:prune [-- --apply]` | Retención en `.backups/<fecha>`, `.backups/cifrados` y cada destino externo. Sin `--apply` sólo muestra qué se eliminaría. |
| `npm run backup:status` | Indica si la clave está configurada, si hay destinos externos y si están conectados, y cuántos respaldos hay con la antigüedad del último en cada lugar. Avisa (código 3) si falta algo o si el último tiene más de 48 h. |
| `npm run backup:daily` | `db:backup` → `backup:protect` → retención (sólo aplica si `BACKUP_RETENTION_APPLY=true`) → `backup:status`. |
| `npm run test:backup-protect` | Pruebas unitarias (carpeta temporal). |

## Formato del archivo `.sbk`

El archivo se compone de un encabezado (`SISTEMA-RESPALDO` + versión, 8 bytes de identificador de la clave y IV de 12 bytes), seguido del contenido cifrado con AES-256-GCM y de la etiqueta de autenticación de 16 bytes. El encabezado se autentica como AAD.

El contenido cifrado incluye un manifiesto JSON (ruta, bytes y sha256 de cada archivo) y, a continuación, los archivos. Al extraer se rechazan rutas absolutas o con `..`. Si la etiqueta o una huella no coinciden, lo extraído se borra. El identificador de la clave detecta una clave equivocada antes de descifrar. Es SHA-256 truncado y no revela la clave.

## Retención por defecto

Se usan `BACKUP_KEEP_DAYS=14`, `BACKUP_KEEP_WEEKS=8` y `BACKUP_KEEP_MONTHS=12`:

- se conserva todo lo de los últimos 14 días;
- además, el más reciente de cada semana durante 8 semanas y el más reciente de cada mes durante 12 meses;
- siempre se conserva el último.

En `.backups` sólo se consideran las carpetas con nombre de fecha. Los demás archivos de la carpeta (vistas previas web, bitácoras) no se tocan.

## Puesta en marcha (la hace el propietario)

1. `npm run backup:key`. Guarda una copia de la clave **fuera del equipo y separada de los respaldos**, por ejemplo en un gestor de contraseñas. Sin la clave, los `.sbk` no se pueden abrir. Si se pierde, los respaldos anteriores quedan inutilizables.
2. En `backend/.env`, define `BACKUP_EXTERNAL_DIRS` con una o más carpetas en un USB o disco externo, separadas por `;`. Ejemplo: `E:\RespaldosSistema`.
3. Prueba manual: `npm run backup:daily`, luego `npm run backup:restore-test`.
4. Opcional: `powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1 -Hora 21:30` registra la tarea diaria de Windows. Corre con la cuenta actual y deja la salida en `.backups\respaldo-diario.log`.
5. Cuando estés conforme con la vista previa de `backup:prune`, define `BACKUP_RETENTION_APPLY=true`.

## Restauración real (procedimiento manual)

1. Descifra a una carpeta dentro de `.backups` con una prueba de restauración, o extrae con `decryptArchive` del módulo.
2. Restaura en una base **nueva**: `pg_restore --no-owner --no-acl --dbname NUEVA database.dump`.
3. Ejecuta `npm run db:check` y luego `npm run db:migrate` apuntando a esa base.
4. Cambia `DB_NAME` sólo cuando la verificación esté bien. Restaura `uploads` en `backend/uploads`.

No se automatiza la sustitución de la base de trabajo.

## Límites

- Las carpetas `.backups/<fecha>/` siguen sin cifrar en el equipo, porque las pruebas de aceptación las usan. La protección cifrada cubre las copias que salen del equipo.
- La clave vive en el mismo equipo para poder automatizar. Su copia aparte depende del propietario.
- No hay copia en la nube ni envío fuera de la oficina. Una carpeta sincronizada configurada como destino funcionaría, pero no se probó.
- El aviso de antigüedad se ve en `backup:status` y en la bitácora; no aparece en el ERP.
- La prueba de restauración usa la base PostgreSQL configurada para crear la base temporal, igual que `verify:release`.
