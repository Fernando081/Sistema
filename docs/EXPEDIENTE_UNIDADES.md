# D01 — Expediente de unidades

Implementación local iniciada el 19/10/2026, cierre documental el 20/10/2026. Refacciones y Tractorepuestos Tampico. Requiere migración **100** y backend/frontend compatibles.

## Alcance y acceso

VIN/ESN, número económico, datos mecánicos y asociación de unidades con clientes, oportunidades y documentos comerciales ya existían. D01 añade lecturas de kilometraje/horas, seguimiento de mantenimiento y fotos/documentos privados sobre la misma unidad; no duplica su registro.

- **Clientes → Unidades → Expediente**: abre otra pestaña para conservar el formulario de unidades que se esté editando.
- La ficha de oportunidad ofrece el mismo enlace por unidad.
- **Cliente 360 → Unidades → Expediente**: navegación interna, con regreso al cliente.
- Ruta privada: `/crm/unidades/:id/expediente`. Debe usarse un ID existente; una respuesta del servidor Angular a esa ruta sólo confirma el enrutamiento, no la existencia de la unidad.

La página muestra identidad, últimos valores válidos, formularios, historiales paginados y evidencias. Estados vacíos y errores son explícitos. Los formularios son borradores en memoria; salir o recargar puede perder lo no enviado. No se guardan documentos, claves de solicitud o borradores en WebStorage. La imagen privada se carga sólo al pulsar **Ver foto** mediante HTTP autenticado; se liberan sus URL temporales al cambiar de expediente o destruir la vista.

## Permisos

| Permiso/control | Comportamiento |
| --- | --- |
| `crm.unidades.consultar` | Leer expedientes y descargar archivos vigentes |
| `crm.unidades.gestionar` más consulta | Añadir lecturas, programar/cerrar mantenimiento y subir archivos |
| ADMIN más ambos permisos | Anular lecturas y retirar archivos, con motivo |

La migración concede los dos permisos sólo al rol administrador. Un administrador puede delegarlos mediante perfiles/excepciones S01 en **Usuarios y acceso**. La UI usa permisos efectivos devueltos por el servidor; un operador de consulta no ve formularios de gestión. El backend comprueba cuenta activa, rol, versión de acceso y permisos dentro de la transacción; no confía en ocultar botones. Ser administrador no evita una denegación efectiva.

El permiso de consulta permite leer expedientes de unidades del ERP en general. **No implementa aislamiento por cliente, sucursal o propietario de oportunidad**, ni acceso de clientes al portal. La administración anterior de datos VIN/ESN conserva sus reglas; los permisos nuevos regulan este expediente.

## Lecturas de km y horas

Se captura fecha/hora y al menos una medición, con hasta dos decimales no negativos. **Cero es una lectura válida; desconocido se conserva como desconocido.** Una lectura parcial no borra la última medición del otro contador. Los últimos valores se determinan por fecha observada, no por orden de captura, y excluyen lecturas anuladas.

La API exige fecha ISO con zona horaria. Rechaza fechas futuras con tolerancia técnica de 60 segundos por desfase de reloj. El formulario incluye segundos y convierte la hora local a ISO. Una lectura intermedia debe respetar tanto las mediciones anteriores como las posteriores de cada contador; dos valores diferentes del mismo contador en el mismo instante se rechazan con409.

No se reescribe la lectura original. ADMIN puede anular un registro incorrecto con motivo, conservando historial y recalculando el último valor. Repetir la misma anulación no añade otra modificación; un motivo distinto produce409. **No se modelan reinicio/sustitución de odómetro, vuelta de contador, telemetría o conversión de millas.** Un reinicio legítimo requiere un flujo futuro de contadores por segmento; no se debe anular historia correcta para simularlo.

Lecturas e historial de mantenimiento usan páginas independientes de20 registros, con total. Una unidad con cualquier lectura, plan o archivo conserva su expediente: la eliminación devuelve409 y las FK RESTRICT también impiden borrados en cascada que lo destruirían.

## Mantenimiento reportado

Se registra título, notas y al menos un objetivo: fecha, km u horas. Máximo100 planes pendientes por unidad. No requiere que ya exista una lectura. Las condiciones se calculan al consultar:

| Condición | Regla |
| --- | --- |
| Realizado / Cancelado | El plan ya tiene ese cierre |
| Vencido | Cualquier fecha anterior a hoy o umbral de km/horas alcanzado |
| Vence hoy | Fecha objetivo de hoy, sin umbral ya alcanzado |
| Sin lectura suficiente | Falta una medición necesaria para evaluar un objetivo, sin vencimiento conocido |
| Programado | Objetivos conocidos aún no alcanzados |

La fecha de referencia usa `America/Mexico_City`. El cierre exige versión y detalle; **Realizado** también exige fecha/hora no futura, mientras **Cancelado** no admite fecha de realización. Dos cierres diferentes concurrentes producen una decisión y un409. Repetir el mismo cierre es seguro y no reabre el plan. Para corregir un plan pendiente se cancela y se crea otro; no hay edición ni reapertura de planes cerrados.

Es un seguimiento manual de información capturada o reportada. **No certifica trabajo de taller, instalación o compatibilidad, ni genera cargos, inventario, costos o facturas.** No hay recurrencia automática, cron de mantenimiento ni notificaciones automáticas de estos planes. Las alertas CRM preexistentes conservan su alcance.

## Fotos y documentos privados

- Formatos: **JPEG, PNG, WebP y PDF**, validados con MIME y comprobaciones básicas de firma/terminación. SVG y GIF no se admiten. Esto no equivale a antivirus, desarme de contenido o análisis completo de PDF/imágenes.
- Máximo **5MiB por archivo**, **50 archivos y50MiB por unidad**, incluyendo retirados. Subida limitada a10 solicitudes por minuto por el control de tasa de la ruta. El bloqueo de la unidad serializa las comprobaciones de cuota.
- Se normaliza el nombre recibido (sin rutas/caracteres de control, hasta200 caracteres); la descarga usa un nombre técnico fijo. Título hasta150 caracteres.
- Metadata en `crm_unidad_archivo`; bytes en `crm_unidad_archivo_contenido` (`bytea`), dentro de la misma transacción. **No se publican en `/uploads` ni en el catálogo web.** Los respaldos de PostgreSQL incluyen esos bytes.
- Sólo metadata se copia a auditoría; el contenido binario tiene tabla separada sin trigger JSONB. El actor mantiene nombre histórico aunque posteriormente desaparezca la cuenta.
- Descarga autenticada, `private, no-store`, `attachment`, `nosniff` y CSP restrictiva. La UI obtiene un Blob para foto o descarga; no expone una URL pública permanente. Los PDF se descargan como originales no confiables, no se ejecutan ni se previsualizan dentro del expediente.
- Se verifica SHA256 al descargar. Una discrepancia devuelve503 sin entregar bytes alterados. Detecta corrupción respecto a la metadata; **no es firma independiente ni protección frente a un administrador que cambie ambos valores**.
- Retiro ADMIN con motivo: conserva bytes, metadata e historial y bloquea descargas posteriores con404. No elimina copias ya descargadas ni devuelve cuota. No hay API de purga, restauración o sustitución del binario; se sube una evidencia nueva cuando proceda.

Retención, capacidad global, copias externas cifradas y restauración operativa siguen en O03 y decisiones de privacidad. No se aprueban plazos de conservación en esta fase. La retención de archivos retirados implica crecimiento de BD/respaldos que deberá dimensionarse antes de producción.

## Contratos HTTP

Prefijo `/api/v1/crm/unidades/:unidad`. Todas las rutas son privadas y validan que el recurso pertenece al ID de unidad de la URL.

| Método/ruta | Cuerpo o consulta |
| --- | --- |
| GET `expediente` | `lecturasPage`, `mantenimientosPage` (enteros desde1, predeterminado1) |
| POST `lecturas` | `requestId`, `fecha`, `kilometraje` y/o `horas`, `notas` opcionales |
| POST `lecturas/:lectura/anular` | `motivo` obligatorio; ADMIN |
| POST `mantenimientos` | `requestId`, `titulo`, objetivos `fechaObjetivo`/`kilometrajeObjetivo`/`horasObjetivo`, `notas` opcionales |
| POST `mantenimientos/:mantenimiento/cerrar` | `version`, `estado` Realizado/Cancelado, `motivo`, `fechaRealizada` cuando corresponde |
| POST `archivos` | multipart: `requestId`, `titulo`, un campo `archivo` |
| GET `archivos/:archivo` | Binario vigente autenticado |
| POST `archivos/:archivo/retirar` | `motivo` obligatorio; ADMIN |

Lecturas, planes y subidas usan UUID técnico y huella de intención por unidad. Reintentar con el mismo UUID/contenido devuelve el mismo identificador; cambiar contenido con esa clave devuelve409. Reintentar una creación posteriormente anulada/retirada devuelve su ID original sin reactivarla. Los UUID no son timbres fiscales simulados ni se deben eliminar.

La UI conserva la intención mientras la respuesta sea incierta; modificarla requiere revisar historial y confirmar su descarte. Errores definitivos4xx permiten corregir el formulario. Versiones controlan cierres; bloqueos y auditoría comparten transacción. Consultas de expediente usan snapshot repetible de solo lectura; operaciones tienen `statement_timeout` de5 segundos.

## Migración y verificación

100 se aplicó localmente el19/10/2026 después de respaldo legible `.backups/2026-10-20T01-29-55-439Z/database.dump`, `db:check` con rollback y aceptación sobre copia restaurada. Crea cuatro tablas y dos permisos, sin sembrar lecturas, mantenimiento o archivos. No modifica migraciones aplicadas ni historia fiscal. Los clientes con versión anterior no deben eliminar unidades que ya tengan expediente; recibirán409 o rechazo FK en vez de perder la historia.

```powershell
# Compilar backend/frontend primero, con Node24; después ejecutar sin otra compilación concurrente
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:unit-expediente -- --backup=.backups/FECHA/database.dump
```

El verificador restaura exclusivamente una copia propia `verify_units_*`, aplica/checkea migraciones allí, prepara usuarios/unidades/evidencias de prueba y elimina esa copia al terminar. Rechaza origen remoto y un respaldo fuera de `.backups`. No inserta fixtures en la BD operativa. Requiere PostgreSQL local, respaldo legible y navegador Playwright.

La aceptación comprueba API/SQL reales, permisos efectivos, cronología/lecturas parciales/cero, idempotencia/concurrencia, cierre versionado, integridad/cuotas/privacidad/retirada de archivos, rollback de auditoría y revocación durante espera transaccional. Angular de producción con login real verifica formularios, foto decodificada y descarga, claro1280/oscuro390, axe y ausencia de desbordamiento/errores JS. Un grupo adicional verifica operador de solo consulta. Las cuotas se preparan sólo en la copia. Ver resultados y conteos efectivos en el registro del README; no son un ensayo de carga/soak, antivirus, prueba de todos los archivos/dispositivos o certificación productiva.

**D01 queda implementado en este alcance local. D02 también implementado el20/10/2026:** [piezas instaladas reportadas, revisión manual de compatibilidad y vínculo con garantías](PIEZAS_INSTALADAS.md), sobre renglones vendidos por el ERP. Usa los mismos permisos, sin inferir instalaciones o aprobar compatibilidad/cobertura automáticamente. Los IDs D01–D09 del expediente WEB05 de privacidad son decisiones diferentes y permanecen sin aprobación.
