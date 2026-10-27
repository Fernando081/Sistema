# Piloto local con la BD de prueba — WEB03.1b-T1

Actualizado el 11 de octubre de 2026. El propietario autorizó continuar con los productos existentes en la BD de desarrollo. Este piloto técnico usa una instantánea de esos registros y copias de sus fotos; no requiere datos comerciales reales, dominio, hosting o bancos para ejercitar la funcionalidad.

## Estado actual

**Implementado y verificado en alcance técnico local.** URL: [catálogo del piloto](http://127.0.0.1:4600/catalogo). La web habitual permanece en 4500 y el ERP/CRM en 4300; el piloto conserva la instalación y los registros originales.

| Código tomado de la BD | Marca | Categoría registrada | Foto disponible en el piloto |
| --- | --- | --- | --- |
| CD40020W50 | Chevron | Aceite | Sí, copia PNG preparada de 320 × 434 |
| HM212049 | Timken | Balero | Sí, JPEG leído y copia PNG de 209 × 241 |
| 4300123 | eaton | Engrane | No; estado de foto pendiente |
| 8pk123 | Gates | Bandas | No; estado de foto pendiente |
| MX20W50 | MEXLUB | Aceite | No; estado de foto pendiente |
| SKF212049 | SKF | Bandas | No; estado de foto pendiente |

Se conservan código, marca, nombre/categoría registrados y las aplicaciones/referencias que existan. En esta selección no había aplicaciones/referencias incorporadas; tampoco se inventaron especificaciones, fotos o equivalencias. Se omitieron precios, costos, existencias, ubicaciones, clientes, VIN/ESN y documentos.

## Comandos con Node.js 24

Desde `C:\Sistema`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run prepare:web-test-pilot
# Opcional: seleccionar un máximo entre 5 y 10; sin argumento toma hasta 10.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run prepare:web-test-pilot -- --limit=5
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run start:web-test-pilot
```

El preparador exige al menos cinco productos elegibles con campos públicos válidos, inspecciona hasta 80 candidatos y toma hasta el límite. Usa `db-config.js` internamente sin imprimir claves; acepta sólo PostgreSQL local. Cada lectura usa `REPEATABLE READ READ ONLY`, verifica `transaction_read_only=on`, limita consultas a 10 s y cierra mediante ROLLBACK. No ejecuta UPDATE/INSERT, migraciones, guardado editorial o aprobaciones ERP. Si el mínimo, la conexión o una comprobación fallan, el reporte queda `not-completed` y no se reemplaza el puntero del último piloto exitoso.

Salida privada por ejecución: `.runtime/web-test-pilot-<runId>/`. Contiene manifiesto técnico, medios copiados y versiones del sitio. `.runtime/web-test-pilot-current.json` señala el último preparado; el servidor lo selecciona al iniciar. Para ver una nueva preparación hay que reiniciar únicamente ese servidor, después de comprobar su proceso; no matar procesos ajenos si 4600 está ocupado. La web pública 4500 y el ERP 4300 siguen independientes.

El servidor sólo escucha en `127.0.0.1:4600`, comprueba manifiesto/coordinación/versión y exige metadata de piloto técnico sin recibo comercial. Nunca carga credenciales de PostgreSQL o lee la BD al responder a un visitante.

## Contexto, fotos y presupuesto

`test-db-pilot` es un modo explícito validado en build/publicador/servidor. HTML estático, buscador, consulta y errores muestran **“Piloto técnico · Datos de prueba · Sin oferta comercial”**. Conserva `noindex`, robots bloqueante, CSP y cero JavaScript cliente. Rechaza dominio confirmado, captación configurada y recibos comerciales asociados al modo técnico. La política global `PUBLIC_WEB_REQUIRE_ERP=1` sigue vigente: no se desactiva para permitir el piloto; si se exige, el preparador no completa la publicación sin esa dependencia.

Los valores `published/approved` e `authorized` del manifiesto técnico permiten probar render e importación dentro del piloto, con autorización del propietario para usar sus datos de prueba. **No son confirmaciones de autenticidad, derechos comerciales o compatibilidad del ERP.** `commercialAccepted=false`, `erpApprovalRecorded=false` y `erpReceiptVerified=false` permanecen explícitos.

Se leen sólo archivos regulares de `backend/uploads`, sin enlaces/traversal/URLs remotas y hasta 8 MB. La preparación admite PNG/JPEG, usa Canvas en Chromium local para copias PNG y selecciona dimensiones bajo 250 kB/archivo; no retoca contenido, modifica etiquetas o reemplaza originales. Si corresponde genera una variante de 320 px más pequeña; las dos fotos actuales no requirieron otra variante. El contrato/importador PNG existente verifica hash, dimensiones y presupuesto. Las copias pueden cambiar perfil/color o perder detalle al reducir; fidelidad comercial pendiente. WebP no se procesa por esta herramienta y no se suplen medios inexistentes.

Medición de esta selección: máximo HTML+CSS **23 559 bytes**, presupuesto **50 000**; JavaScript cliente **0**. El build mantiene límites de imágenes iniciales y medios agregados existentes. No se elevaron presupuestos para acomodar las fotos de prueba.

## Versiones, respaldo y recuperación

1. Se publica localmente una versión técnica con seis piezas y sello de integridad.
2. Se publica otra con cinco para ensayar retirada; no cambia el registro de esa pieza en PostgreSQL.
3. Se respalda puntero y los archivos sellados de ambas versiones en `.backups/web-test-pilot-<runId>.json`. Formato exclusivo `local-test-db-pilot-versions`: 1–3 versiones, 10 000 archivos y 15 MB de contenido, nombres/bytes/hashes verificados. El lector de archivo guardado está confinado y acotado a 22 MB. No acepta una publicación normal/comercial como respaldo de prueba.
4. Una copia temporal pierde la portada de la versión activa y la verificación de integridad detecta el daño. Se relee el archivo guardado por su SHA original, se restaura en otro destino exclusivo y se comprueban integridad/HTTP. La restauración no mezcla o sobrescribe un directorio existente.
5. Se ensaya rollback hacia la primera versión en la copia, con verificación/HTTP posteriores. El sitio del piloto también vuelve a la primera versión para mostrar las seis piezas. Se conservan archivos/versiones originales; temporales propios se limpian después de validar su ruta física.

Sólo se restauran datos y contenido del piloto; no ERP/BD, fuentes/runtime histórico, historial de incidentes o publicación comercial. Hashes ligados verifican bytes, no autentican al revisor; no es auditoría inmutable, corte eléctrico, copia externa o SLA. Siguen los procedimientos de [recuperación manual](WEB_RECUPERACION_PUBLICACION.md) para otros incidentes.

## Evidencia de la sesión

Ejecución `4385d3f4-0dbb-4ae3-9344-dcffaecc5710`; archivo de respaldo **1 998 096 bytes**, SHA-256 `bd3c6a76b116bba44a96cb28620d0d6c6669b8645b1745ee03f9adb67343ff2b`. Se restauraron **79 archivos** de dos versiones. HTTP de versión retirada **45/45** y después de rollback **47/47**; daño detectado. Ensayo 1 898,87 ms en este equipo. PostgreSQL/medios de origen y preview habitual observados sin cambios al terminar la preparación.

Reportes: `.artifacts/web-test-pilot.json`, `web-test-pilot-preparation.log`, `web-test-pilot-directed.log`, `web-test-pilot-suite.log`, `web-test-pilot-public-ui.log` y `web-test-pilot-ui.json`.

Validación Node.js 24.19.0: **7/7 pruebas nuevas**, suite pública **278/278**, sin fallidas/omitidas/canceladas; suite visual existente **32/32**. Recorrido de datos del piloto **94/94 comprobaciones** a 390/1440 px: seis fichas, búsqueda exacta de cada código, ambas fotos cargadas, ampliación/cierre, placeholders, reflujo, aviso/noindex y navegación sin JavaScript. Inspección Axe en contexto separado con instrumentación: sin incidencias graves/críticas en catálogo y fichas con foto. Capturas reales del piloto inspeccionadas. Son pruebas técnicas, no aceptación del propietario ni validación en un dispositivo físico/red externa.

## Hallazgos de los datos de prueba y pendientes comerciales

- Foto de CD40020W50: etiqueta 15W40, registro 20W50. La discrepancia se conserva para revisar; no se alteró la fotografía ni la BD.
- SKF212049 figura como “BALERO SKF” dentro de “Bandas”; confirmar clasificación antes de publicar comercialmente.
- Cuatro piezas carecen de foto disponible; aplicaciones/referencias/especificaciones y derechos/fidelidad deben completarse/revisarse para el lote real.

WEB03.1b-T1 **terminado en alcance técnico de prueba**. WEB03.1b-P1 mantiene aceptación comercial con datos/fotos reales y recibo ERP vigente; sus herramientas ya existen. Dominio/hosting/lanzamiento, privacidad/captación y demás IDs conservan dependencias/prioridad. Fiscal mock, identificadores técnicos/idempotencia y exclusión de conexiones bancarias se mantienen.
