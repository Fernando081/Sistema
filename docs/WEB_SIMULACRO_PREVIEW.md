# Recuperación del preview instalado — WEB04.1d

Actualizado el 11 de octubre de 2026. Este procedimiento permite ensayar la pérdida de un archivo en una copia del sitio instalado y recuperarla desde un respaldo guardado. No requiere dominio, hosting ni acceso a bancos.

## Qué ya existía y qué se añade

`verify:web-preview-backup` crea un respaldo nuevo y prueba su restauración con cuatro sondeos HTTP. `verify:web-saved-backup` comprueba un archivo ya guardado contra el SHA-256 registrado. Esas capacidades se reutilizan; no son funciones nuevas de esta entrega.

`drill:web-preview-recovery` añade la comprobación de correspondencia con la instalación actual, una pérdida controlada únicamente en una copia, restauración desde una segunda lectura del respaldo guardado, verificación de todos los archivos y rutas del manifiesto y tiempos del ensayo. Conserva un reporte por ejecución y vuelve a comprobar fuente y respaldo al terminar.

## Alcance y requisitos

- Node.js 24 y código/runtime actual del repositorio conservados.
- `public-web/dist` regular, sin enlace/unión de directorio, sin publicación activa y con coordinación `ready`. Los casos `needs-review`, `changed`, `invalid` o con proceso/control presente no se intervienen.
- Respaldo en `.backups/web-preview-UUID.json`, SHA-256 original conservado por separado y bytes correspondientes a la vista previa actual. Un respaldo antiguo válido puede comprobarse con `verify:web-saved-backup`, pero no representa el estado actual para este ensayo.
- No ejecutar build, publicación, importación o recuperación simultáneos. La doble comprobación detecta cambios observados; no bloquea escritores externos ni constituye una transacción del filesystem.
- El respaldo usa la allowlist existente: archivos públicos del manifiesto y seis configuraciones/reportes internos. No contiene fuentes, runtime, ERP/BD, uploads completos, secretos, historial de recuperaciones, puntero o versiones aprobadas.

El lector compartido exige archivo regular, ruta confinada, hash exacto y lectura máxima de 22 MB, incluso si el archivo crece mientras se lee. El contrato limita los archivos decodificados a 15 MB y 10 000 entradas, rechaza traversal, duplicados, faltantes, archivos ajenos al manifiesto y hashes distintos. Las rutas del ensayo deben ser locales/canónicas; no se siguen redirecciones ni se hacen peticiones a Internet.

## Ejecución

Desde `C:\Sistema`, conservar/revisar primero el resultado de la preparación. Ningún comando de este procedimiento activa una versión comercial o la captación CRM.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --strict
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-active
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify:web-preview-backup
```

En este alcance `check:web-active` informa `pending/unversioned-preview`; no se interpreta como versión sellada/aprobada. Si existe una publicación activa, detener este procedimiento y seguir el manual de versiones. Revisar `.artifacts/web-preview-recovery.json`: nombre, SHA-256, tamaño y resultado. Registrar el hash original separado del archivo antes del siguiente paso. No seleccionar automáticamente el archivo más reciente ni recalcular un hash nuevo para aceptar una copia que cambió.

Sustituir los dos valores siguientes por el respaldo y hash **revisados**:

```powershell
$archivoRevisado = 'web-preview-UUID.json'
$shaRevisado = 'SHA256_ORIGINAL_DE_64_CARACTERES'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify:web-saved-backup -- "--file=$archivoRevisado" "--sha256=$shaRevisado"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run drill:web-preview-recovery -- "--file=$archivoRevisado" "--sha256=$shaRevisado"
```

## Escenario y evidencia

1. Lee el archivo guardado, comprueba su hash/contrato y compara los nombres/hashes del contenido con la fuente actual. Observa también directorio físico, puntero y controles/historial reconocidos por el diagnóstico.
2. Restaura el respaldo en un temporal propio y exclusivo. Retira **solo** el archivo regular de portada dentro de esa copia, después de comprobar su ruta física; confirma exactamente un archivo faltante.
3. Vuelve a leer el respaldo guardado con su hash original. Restaura en un segundo destino nuevo; no mezcla archivos ni regenera el sitio a partir de fuentes.
4. Compara todos los bytes y prueba GET de todas las rutas/medios del manifiesto, HEAD de portada, búsqueda, 404 de rutas privadas/desconocidas y captación cerrada. Valida MIME, CSP, `nosniff`, `noindex`, `no-store` y `no-referrer`. Los cuerpos estáticos deben corresponder al respaldo; búsqueda/consulta se generan con el runtime actual.
5. Relee el respaldo y observa de nuevo fuente/coordinación. Un cambio impide éxito y no se revierte. Cierra su servidor efímero en `127.0.0.1` y limpia únicamente sus temporales después de resolver y comprobar la ruta.

Reportes privados: `.artifacts/web-preview-drill.json` y `.artifacts/web-preview-drill-<drillId>.json`. No contienen cuerpos HTTP, catálogo, contactos, errores crudos, contraseñas, datos de propietario de bloqueos ni rutas absolutas. Incluyen hash/nombre del respaldo, controles de integridad/HTTP, huellas de la fuente, escenario y tiempos. No se sirven por la allowlist pública. La copia guardada permanece en `.backups`; no se aplica retención/borrado automático.

`verified-installed-preview` requiere integridad/HTTP correctos, respaldo y fuente observados sin cambios y temporales retirados. `not-completed` sale con código 1 y registra la etapa fallida; argumentos inválidos también sustituyen el reporte anterior cuando puede escribirse. Si no se puede conservar el reporte, el comando sale 1 e informa resultado no confirmado sin imprimir el error crudo; un reporte anterior no es evidencia de esa ejecución. `sourceUnchanged` se limita al directorio observado, puntero ausente, allowlist respaldada y controles/historial conocidos; no certifica cada archivo del disco. SHA-256 liga bytes, no firma ni autentica al revisor.

## Resultado de esta sesión

Ensayo sobre la instalación existente, no un catálogo comercial inventado: respaldo de 20 archivos y 477 761 bytes. SHA-256 registrado: `1a8e288ac985752cad58dc3840e50253570898e6cdf3716bd5dcb89b6998b6ac`.

Ejecución final `cea2b556-10ef-4d9c-b134-1265cc0ad638`: pérdida de un archivo detectada, 20/20 archivos restaurados y 29/29 comprobaciones HTTP aprobadas; fuente observada intacta y temporales retirados. Restauración 43,90 ms; restauración más integridad/HTTP 458,01 ms; ensayo completo 640,66 ms. Evidencia conservada en `.artifacts/web-preview-drill-cea2b556-10ef-4d9c-b134-1265cc0ad638.json`. Son tiempos locales de este equipo, no SLA, RTO garantizado o prueba de durabilidad ante corte eléctrico. La primera ejecución `20fc232e-54eb-4ce6-9d60-83051d776049` también se conserva, sin sobrescribir su evidencia.

## Qué no cierra

No prueba recuperación de una publicación comercial versionada/sellada, historial de guardas, ERP/BD, pérdida del disco, copia externa, runtime histórico, hosting/HTTPS o aceptación del propietario. `commercialAccepted=false` y `versionedRecoveryVerified=false` permanecen explícitos.

WEB03.1b-P1 requiere el piloto de 5–10 piezas/fotos reales y un ensayo separado sobre su publicación sellada, además de revisión visual/medición y aceptación. Los incidentes no elegibles se conservan bloqueados según [el procedimiento manual](WEB_RECUPERACION_PUBLICACION.md#incidentes-fuera-del-alcance-automatizado--web031b-m1). WEB04.1 sigue parcial por operación pública y sus dependencias externas. Fiscal mock, UUID/idempotencia y exclusión bancaria se conservan.
