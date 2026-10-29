# Versiones, staging, despliegue y rollback (O04.1)

Implementado el 28/10/2026. Sirve para instalar en este equipo una versión del sistema ya probada, en lugar de correr `ng serve` y `nest start` desde la carpeta de desarrollo. Cada versión queda empaquetada e inmutable. Antes de instalarla se prueba en **staging**, que usa una copia de los datos. Si algo falla se puede regresar a la versión anterior.

Todo es local: usa sólo `127.0.0.1` y no contrata servidores ni dominios. El acceso desde otros equipos de la red requiere HTTPS, que queda para O04.2.

## Conceptos

| Término | Qué es |
|---|---|
| **Versión** (`releases/<fecha>-<hora>-<commit>`) | Copia del backend compilado, de la interfaz compilada, de las migraciones y de sus dependencias de producción (`npm ci --omit=dev`). Incluye un `manifest.json` con el commit, la marca "sin commit", la lista de migraciones y la huella sha256 de cada archivo. |
| **Producción local** | La versión en marcha que usa el personal. El backend corre en el puerto 3100 y la interfaz en http://127.0.0.1:4300. Usa la base y los archivos de trabajo (`backend/uploads`). |
| **Staging** | La misma versión sobre una **copia** del último respaldo, en la base `<DB_NAME>_staging`, con los puertos 3210 y 4310. Siempre corre con fiscal mock, correo desactivado y el puente web cerrado, aunque `backend/.env` diga otra cosa. |
| **Estado** (`releases/state.json`) | Registra la versión actual, la anterior, el resultado de staging y el historial de movimientos: respaldo previo y migraciones aplicadas en cada despliegue. |

`releases/` no se versiona en git.

## Flujo normal

```powershell
# 0. Trabajo terminado y con commit (una versión con cambios sin commit queda marcada y se rechaza al desplegar).
# 1. Generar la versión: compila backend e interfaz, copia y comprueba las dependencias de producción.
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run release:build

# 2. Staging: copia fresca del último respaldo y prueba de la versión.
npm run db:backup
npm run staging:refresh
npm run staging:deploy -- --release=<id>
#    Revisa a mano en http://127.0.0.1:4310 (tus usuarios de siempre; los datos son una copia).
npm run staging:stop

# 3. Despliegue: respaldo previo → db:check → db:migrate → cambio de versión → pruebas de humo.
npm run release:deploy -- --release=<id>
```

`release:list` muestra las versiones con su marca (`ACTUAL`, `anterior`, `staging OK`, `sin commit`). `release:status` indica qué corre en cada ambiente.

## Qué comprueba cada paso

- **`release:build`**
  - Rechaza el árbol con cambios sin commit, salvo con `--permitir-sucio`.
  - Usa Node 24.
  - Después de instalar, revisa que cada paquete que requiere el backend compilado exista en la versión. Así se detecta una dependencia que sólo está en desarrollo; esta comprobación encontró `@nestjs/mapped-types`, que ya se corrigió.
- **`release:verify --release=<id>`** recalcula las huellas: un archivo alterado, faltante o agregado invalida la versión. `deploy`, `rollback`, `start` y `staging:deploy` hacen esta comprobación antes de arrancar.
- **`staging:refresh`**
  - Detiene staging.
  - Borra y recrea únicamente la base que termina en `_staging`; el nombre se valida y nunca puede ser la base de trabajo.
  - Restaura el respaldo con `pg_restore --exit-on-error` y copia sus `uploads` a `releases/staging-data/uploads`.
- **`staging:deploy`**
  - Ejecuta `db:check` y `db:migrate` de la versión sobre la copia.
  - Arranca y corre las **pruebas de humo**:
    - `/health` del backend;
    - la interfaz sirve la versión esperada (`/__version`);
    - página inicial y rutas internas de la aplicación;
    - un archivo inexistente responde 404;
    - el proxy `/api` funciona;
    - las rutas privadas exigen sesión (401);
    - no quedan migraciones pendientes.
  - Guarda el resultado atado a la huella exacta del manifiesto.
- **`release:deploy`** sólo acepta una versión que pasó staging con la misma huella. En una urgencia, `--omitir-staging --motivo="…"` (al menos 10 caracteres) deja el motivo en el historial. Pasos:
  1. Comprueba que la base no tenga migraciones que la versión desconoce, y que los puertos estén libres o sean de la producción anterior.
  2. `db:backup`; anota el respaldo en el historial.
  3. `db:check` y `db:migrate` con el ejecutor de la versión.
  4. Detiene la versión anterior y arranca la nueva.
  5. Pruebas de humo. Si fallan, **vuelve sola a la versión anterior** y lo registra como `fallo-revertido`.

## Rollback

```powershell
npm run release:rollback                 # a la versión anterior registrada
npm run release:rollback -- --release=<id>
```

- El rollback cambia **sólo el código**. Antes de hacerlo compara las migraciones de la versión destino con las aplicadas en la base.
  - Si la base tiene migraciones posteriores, se detiene, las lista y sugiere el respaldo previo al despliegue que las aplicó.
  - Las migraciones de este proyecto sólo agregan, así que el código anterior suele funcionar con el esquema nuevo. Se confirma con `--aceptar-esquema-nuevo`.
- Para regresar también el esquema y los datos al momento previo al despliegue:
  1. Detén producción con `npm run release:stop`.
  2. Restaura el respaldo anotado en el historial siguiendo [RESPALDOS](RESPALDOS.md#restauración-real-procedimiento-manual), en una base **nueva** y verificada.
  3. Cambia `DB_NAME`.
  4. Inicia la versión anterior con `release:rollback`. Se pierde lo capturado después del respaldo.

  No se automatiza la sustitución de la base de trabajo.

## Arranque y paro

`npm run release:start` inicia la versión actual y corre las pruebas de humo; `npm run release:stop` la detiene. Los procesos quedan en segundo plano y no se cierran al cerrar la terminal. Las bitácoras van a `releases/logs/<ambiente>-backend.log` y `-frontend.log`.

Producción local y el entorno de desarrollo comparten el puerto 3100. Si el backend de desarrollo está encendido, `deploy` y `start` se niegan antes de tocar nada. Para cambiar los puertos: `RELEASE_BACKEND_PORT`, `RELEASE_FRONTEND_PORT`, `STAGING_BACKEND_PORT` y `STAGING_FRONTEND_PORT`. `STAGING_DB_NAME` cambia el nombre de la base de staging, que debe terminar en `_staging`.

`npm run release:prune [-- --conservar=5] [--apply]` retira versiones antiguas. Siempre conserva la actual, la anterior y la última probada en staging. Sin `--apply` sólo muestra lo que eliminaría.

## Servidor de la interfaz

`scripts/release-server.js` va copiado dentro de cada versión:

- sirve el build de Angular, con caché inmutable para los archivos con huella y `no-cache` para `index.html` y el service worker;
- agrega cabeceras de seguridad;
- responde con `index.html` a las rutas internas de la aplicación;
- reenvía `/api` y `/uploads` al backend de la misma versión. Reemplaza `X-Forwarded-For` y `X-Forwarded-Proto` para que un cliente no pueda suplantarlos.

**Sólo escucha en loopback**: el backend permite HTTP sin TLS únicamente desde el propio equipo, y un servidor abierto a la red rompería esa garantía.

El backend recibe `UPLOAD_DIRECTORY` como variable del proceso para compartir `backend/uploads` entre versiones. Sin esa variable conserva la ruta de siempre.

## Verificación

- `npm run test:release`: pruebas unitarias de la biblioteca y del servidor (archivos, rutas, proxy, cabeceras, recorrido de rutas y backend caído).
- `npm run test:release-deploy`: aceptación de punta a punta sin tocar la operación. Usa un directorio de versiones temporal, puertos 3150/4350/3260/4360 y dos copias del último respaldo (`o04_verificacion_prod` y `o04_verificacion_staging`). Recorre:
  - build;
  - integridad y alteración;
  - bloqueos;
  - refresco y prueba de staging;
  - login por el proxy;
  - despliegue con migraciones;
  - segundo despliegue;
  - rollback;
  - fallo simulado con regreso automático;
  - `status`, `stop`, `start` y `prune`.

  Al terminar elimina las bases, los procesos, las versiones y los respaldos de la copia, y escribe `.artifacts/o04-despliegue.json`.

## Límites (O04.2 pendiente)

- No hay servidor de staging ni de producción separados, ni HTTPS, dominio o acceso desde otros equipos. `NODE_ENV=production` exige HTTPS y orígenes públicos, así que el despliegue local lo rechaza.
- Los procesos no son un servicio de Windows: no arrancan solos al encender el equipo. Para eso se puede registrar `npm run release:start` como tarea al iniciar sesión, igual que el respaldo diario. No se dejó registrada.
- Al detener un proceso en Windows se termina sin apagado ordenado. Las transacciones abiertas se revierten en PostgreSQL y los procesos automáticos vuelven a tomar su trabajo.
- El rollback no revierte migraciones; para eso está la restauración manual del respaldo previo.
- La revisión manual en staging es responsabilidad de quien despliega; las pruebas de humo no sustituyen las pruebas de negocio.
