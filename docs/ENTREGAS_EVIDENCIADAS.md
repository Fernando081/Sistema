# V02 - Evidencias privadas de entrega

Implementación: 20/10/2026. Alcance local; resultados efectivos en la sesión V02 del README.

## Uso

Pedidos ya tenía reserva, picking, surtido, entrega con receptor/notas y facturación. V02 amplía esa entrega sin crear otra salida de inventario.

1. ERP → Pedidos → abrir un pedido **Surtido** → **Registrar entrega**.
2. Capturar nombre de quien recibe y notas. Dibujar firma con mouse/dedo o adjuntar PNG; agregar foto si está disponible.
3. Sin firma ni foto, escribir el motivo. No se inventan evidencias para cumplir el formulario.
4. Opcionalmente pulsar **Agregar ubicación del dispositivo**. Requiere permiso del navegador. Se puede quitar y continuar sin ella; no hay seguimiento automático ni mapas externos.
5. Confirmar recepción/captura autorizada y guardar. Se conservan receptor, notas, autor autenticado, fecha del servidor, partidas, archivos y ubicación reportada.
6. **Evidencias de entrega** permite descargar PDF y originales. Continúa disponible después de facturar el pedido.

La firma es una imagen capturada/declarada: no verifica identidad, facultades del receptor ni constituye firma electrónica avanzada. La ubicación procede del dispositivo y puede ser imprecisa o manipulada. La confirmación registra una declaración del operador, no sustituye el procedimiento de autorización/privacidad del negocio.

## Integridad y compatibilidad

- Una entrega por pedido. Nuevo expediente sólo en Surtido y versión vigente. Si otra acción cambió el pedido, actualizar antes de guardar.
- Transacción única: entrega existente, metadata, bytes, estado/version e historial. Fallo, incluso de auditoría, revierte todo. No descuenta stock otra vez; conserva reserva/picking/facturación previos.
- UUID técnico global y huella de contenido. Reintento idéntico devuelve el mismo registro; UUID con datos/pedido distintos devuelve409. Frontend conserva UUID mientras conserva contenido; corrección genera otro. Solicitudes concurrentes serializadas. Ante respuesta de red perdida, reintentar con los mismos datos.
- Ubicación completa: latitud, longitud, precisión en metros y fecha ISO con zona. Alta exige captura dentro de una ventana de ±10 minutos respecto al servidor (tolerancia al reloj del dispositivo); un reintento idéntico ya registrado no caduca por ese plazo. Entregar sin ubicación está permitido.
- `pedido_entrega_evidencia`: snapshot JSONB, SHA-256 de su texto canónico PostgreSQL, autor nominal y request/huella. `pedido_entrega_archivo`: bytes separados, hasta una firma PNG de512KiB y una foto JPEG/PNG/WebP de5MiB. Máximo5.5MiB por comprobante.
- MIME/firma/terminación básica y tamaño; no es decodificación completa, antivirus ni limpieza de EXIF. Original conservado. No subir contenido innecesario o ajeno a la entrega.
- Triggers ALWAYS bloquean UPDATE/DELETE/TRUNCATE de tablas nuevas; entrega vinculada protegida frente a UPDATE/DELETE. Cambios al cliente/catálogo no reescriben snapshot. Hash detecta inconsistencias internas; no es sello externo y el propietario PostgreSQL puede alterar DDL/controles.
- Bytes no se duplican en auditoria_jsonb; metadata auditada con actor LOCAL. Descargas verifican hash/MIME/tamaño contra snapshot; inconsistencia devuelve503.
- Entregas anteriores: receptor/notas/fecha, sin generar firma/ubicación/PDF V02 retroactivos. Ruta anterior conservada para compatibilidad, ahora con permiso/revalidación; no produce expediente V02. Integraciones nuevas que necesitan evidencia deben usar el endpoint nuevo.
- Sin edición/reemplazo/retirada en esta fase: errores conservados requieren procedimiento de aclaración/conservación antes de operación real. No corregir por SQL. Retención, exportación independiente, cuotas globales y antivirus siguen como pendientes operativos/O03.

## Acceso y HTTP

Permiso **pedidos.entregas**, inicialmente sólo ADMIN, delegable con S01. Permite registrar/consultar todos los pedidos internos; no es aislamiento por cliente/sucursal. Escritura revalida cuenta activa, rol, token_version y permiso con bloqueo compartido de cuenta dentro de la transacción. Cookie/CSRF o bearer conservan reglas generales. Ruta anterior `POST /pedidos/:id/entregar` también exige este permiso.

Prefijo `/api/v1`:

| Método/ruta | Contrato |
| --- | --- |
| GET `/pedidos/:id/entrega` | estado/version, evidencia o receptor/notas de entrega anterior |
| POST `/pedidos/:id/entrega/evidencia` | multipart: requestId UUID, version, recibidoPor(1–200), notas(0–1000), motivoSinEvidencia(0–1000), confirmacion literal `true`; opcionales firma/foto y latitud/longitud/precision/ubicacionFecha |
| GET `/pedidos/:id/entrega/archivos/firma` o `/foto` | original privado ligado a ese pedido; attachment/nosniff/no-store |
| GET `/pedidos/:id/entrega/comprobante` | PDF interno desde snapshot; attachment/no-store;404 sin expediente V02 |

Consulta/descargas `private, no-store`; POST `no-store`. Registro limitado a10 solicitudes/minuto por IP/handler además del límite global. Multipart máximo2 archivos/11 campos/13 partes y campos4KiB. Sin rutas públicas de evidencia, enlaces compartibles ni bytes en listados. Otros permisos de pedidos conservados.

## Comprobante

PDF carta: negocio, folio de pedido/comprobante, cliente, receptor declarado, fecha UTC del servidor, operador, partidas/cantidades, notas, ubicación y huellas de archivos/snapshot. Índice del expediente: originales descargables por separado con permiso; imágenes no incrustadas. No es factura, constancia de pago ni timbre fiscal; modo fiscal mock conservado.

## Migración y pruebas

Node24. Nueva **103_entrega_evidencia.sql**; no editar migraciones aplicadas. Respaldo legible → db:check → restauración/aceptación aislada → db:migrate → reiniciar backend/actualizar frontend. No genera ejemplos/firmas/ubicaciones en origen ni requiere dominio/hosting/bancos.

```
npm run db:backup
npm run db:check
npm --workspace backend run build
npm --workspace frontend run build
npm run test:delivery-evidence -- --backup=.backups/FECHA/database.dump
npm run db:migrate
```

Verificador restaura respaldo local en una base propia `verify_deliveries_<16hex>`, aplica migraciones allí y usa AppModule/API/Angular reales. Elimina sólo esa copia. Cuentas/contraseñas efímeras en memoria. Comprueba permisos/DTO, ubicación completa/reciente, archivos, estado/version, reintentos/concurrencia, hashes/descargas/PDF/auditoría, inmutabilidad, rollback y revocación mientras espera bloqueo. UI: login real, firma con mouse, foto, geolocalización **simulada** explícita, claro1280/oscuro390, axe/reflujo y PDF. Respeta ventanas reales del limitador. Reporte `.artifacts/v02-entregas.json`: exigir passed, cleanupPassed y copyRemoved.

Sin prueba física de GPS/cámara/táctil/impresora. Coordenadas simuladas no prueban presencia real. Unitarias, UI general con API simulada y aceptación real son evidencias distintas. Bootstrap O05, publicación/TLS, conservación y certificación PAC siguen pendientes.
