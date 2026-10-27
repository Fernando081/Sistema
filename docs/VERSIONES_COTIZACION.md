# V01 — Revisiones de cotización y respuesta por enlace

Refacciones y Tractorepuestos Tampico. Implementación técnica local del20/10/2026; requiere migración **102** y backend/frontend compatibles. El estado de aplicación, respaldos y resultados efectivos está en el registro del README.

## Qué añade y qué conserva

PDF, conversión parcial a factura, pedido desde cotización, seguimiento comercial y autorizaciones internas de precio/crédito ya existían. V01 añade una familia de revisiones con contenido conservado y respuesta comercial sobre una revisión concreta. No convierte una autorización interna en aprobación del cliente, ni una respuesta en pago o pedido.

Las cotizaciones históricas conservan su flujo anterior hasta activar revisiones **explícitamente por documento**. No se rellenan versiones o respuestas ficticias. Al activar, sólo la última revisión vigente y aceptada puede originar pedido/venta; documentos sustituidos quedan para consulta. Los controles comerciales S03.2 siguen vigentes al crear la propuesta y al usarla.

## Operación en el ERP

1. **Cotizaciones → Historial → Revisiones y respuesta** abre `/cotizacion/:id/versiones`.
2. Revisar el contenido y, con permiso, indicar motivo y pulsar **Activar revisiones**. La confirmación explica el cambio de flujo. La primera revisión guarda el documento actual; requiere vigencia y ausencia de renglones procesados, pedidos o facturas.
3. **Generar enlace de respuesta** crea un enlace privado de capacidad limitada: quien lo tenga puede ver la propuesta y comunicar su decisión. Se muestra sólo en memoria; copiarlo antes de salir. El sistema no envía correo/WhatsApp u otros mensajes.
4. El enlace dura como máximo24 horas, sin superar el vencimiento de la cotización. Generar otro reemplaza el anterior. La pantalla permite revocar con motivo y muestra los últimos20 enlaces de la revisión actual, incluidos revocados. Emitido no significa que siga vigente a esta hora: revisar su fecha.
5. El destinatario abre el formulario sin iniciar sesión: ve productos/cantidades/precios/impuestos/total MXN, selecciona Aceptar o Rechazar, indica nombre/comentario y marca una confirmación inicialmente desactivada. No se acepta automáticamente al abrir o consultar.
6. El ERP muestra decisión, fecha y **nombre declarado**. El enlace no verifica la identidad de quien lo usó, no es un certificado de firma avanzada y no realiza cargos. El negocio conserva la revisión humana antes de crear pedido/factura.
7. **Preparar nueva revisión** abre el editor existente con cliente bloqueado y renglones anteriores. Se pueden añadir/quitar productos y cambiar cantidades/precios. Indicar motivo; impuestos se recalculan con el catálogo actual. Guardar crea otra cotización con folio propio dentro de la misma familia, conserva la unidad y deja la respuesta pendiente. La revisión anterior, su contenido y respuesta permanecen.
8. La nueva revisión reemplaza a la anterior y revoca sus enlaces. Para corregir una respuesta o propuesta se crea una revisión nueva; no se edita la evidencia recibida. Una propuesta versionada vencida que aún no fue utilizada puede renovarse así. No se revisan documentos ya convertidos, con partidas procesadas o con pedidos/facturas, incluso si esos documentos se cancelaron después.

El historial de revisiones está paginado de20 en20 y conserva enlaces a cada contenido. Una versión anterior no se confunde con la actual. Borradores/claves de reintento/enlaces no se guardan en WebStorage: recargar o salir los pierde. Ante resultado incierto, consultar el historial y reintentar con los mismos datos; no recrear una propuesta modificada sin revisar si se guardó. El editor conserva el borrador ante rechazo.

## Integridad y conversiones

- Snapshot JSONB del encabezado/receptor/unidad y renglones comerciales, con importes/cantidades en cadenas decimales, fechas UTC, autor, motivo y SHA256 con claves canónicas. Reordenar claves JSONB no altera su huella. El contenido no se reconstruye desde productos actuales al consultar una revisión anterior.
- Conserva la referencia de unidad por ID, no una copia del VIN/ESN/fotos de su maestro. No archiva el binario PDF ni firma su contenido: el PDF existente conserva su generación habitual; la evidencia V01 es el contenido comercial mostrado en el historial/formulario, no una promesa de PDF idéntico byte por byte.
- Triggers ALWAYS rechazan UPDATE/DELETE/TRUNCATE de revisiones y respuestas. Auditoría comparte transacción. No es firma/copia independiente: el propietario PostgreSQL puede cambiar controles por DDL o fabricar datos; siguen pendientes los controles operativos S03/O03.
- Nueva revisión y nueva cotización se confirman o revierten juntas, usando el mismo EntityManager y la validación comercial existente. No se duplica un documento si se repite UUID/huella; otro contenido con esa clave devuelve409. Los UUID son técnicos, no timbres fiscales.
- Bloqueo de la raíz de familia evita dos revisiones/decisiones incompatibles concurrentes. Una decisión diferente sobre una versión ya respondida devuelve409; repetición idéntica del mismo UUID confirma la respuesta sin añadir otra.
- Cambiar campos comerciales de la cotización después de sellarla se detecta al emitir/consultar/responder/convertir; el historial conserva el snapshot y muestra que no coincide. Preparar otra revisión permite corregir la propuesta.
- Pedido/conversión de documento versionado exige última revisión, aceptación, vigencia y contenido coincidente. Conversión no permite cambiar el precio de cierre aceptado. Un cambio actual de IVA que altera importes requiere otra revisión; se bloquean los productos durante la comprobación/uso.
- El pedido conserva la unidad de la propuesta y no acepta reemplazarla por otra. **Pedidos con retenciones no se generan por esta ruta:** se pide usar conversión directa a factura para conservarlas, porque el modelo de pedido anterior no las representa. No se ha extendido ese modelo en V01.
- Crear pedido directo con `idCotizacion` de una propuesta versionada no evita las reglas: debe utilizarse la ruta desde cotización. La conversión parcial mantiene sus reglas de renglones, stock, impuestos y autorización comercial, sin convertir dos veces una partida. Reintento de pedido existente conserva su resultado.
- Se serializa la asignación `MAX(folio)+1` del creador actual mediante advisory lock transaccional en **todas las creaciones de cotización por este servicio**, incluidas revisiones. No es una secuencia sin huecos ni un control universal de importaciones SQL directas u otros binarios anteriores.

La revisión nueva conserva cliente/unidad y familia, pero **no copia automáticamente la declaración de origen CRM** a su nueva cotización. Cuando corresponda, vincular explícitamente la revisión vigente con la oportunidad mediante WEB05.2b; el vínculo comercial original y sus métricas no se reescriben ni se atribuyen ventas nuevas por inferencia.

## Acceso y enlace

`cotizaciones.versionar` se concede inicialmente sólo al rol admin; puede delegarse con perfiles/excepciones S01. Permite activar, crear revisiones, emitir/revocar enlaces. La consulta privada está disponible para cuentas autenticadas vigentes que ya consultan cotizaciones; no añade aislamiento por cliente/sucursal. Escrituras revalidan actor/rol/versión/permiso dentro de la transacción y registran actor LOCAL.

El token de enlace lo deriva el servidor con HMAC-SHA256, clave JWT robusta configurada (al menos32 caracteres), dominio exclusivo de cotizaciones e ID de revisión/UUID de emisión. Se devuelve al emisor autorizado; en BD sólo se guarda SHA256. El mismo UUID puede recuperar el mismo resultado mientras siga utilizable y no cambie la clave. Si cambia la clave, emitir uno nuevo; los enlaces existentes no se revocan automáticamente por rotar JWT y deben revocarse si la rotación fue por compromiso.

La URL lleva la clave en el **fragmento**. El formulario la toma en memoria y la quita de la barra/historial; no va en ruta/query/referer, ni se guarda en localStorage/sessionStorage. El servidor recibe el token sólo en JSON por POST a rutas fijas, por lo que el logger actual de método/ruta no lo copia. No guardar enlaces completos en documentos, capturas o logs. Tras recargar sin fragmento debe abrirse otra vez el enlace original.

La consulta pública devuelve una proyección explícita sin RFC, ID de cliente/unidad, IDs de producto, costos, existencias, permisos o resto del ERP. Exige JSON/cabecera propia, límites30 consultas/minuto y10 respuestas/minuto y respuesta no-store. Producción rechaza HTTP en estas rutas; HTTPS/CORS/proxy confiable y despliegue siguen requiriendo configuración/ensayo real. No se desplegó en Internet ni se contrataron servicios en esta fase.

La respuesta se audita como externa, sin atribuirla al administrador cuya cookie pudiera acompañar la petición. Nombre/comentario se conservan como declaración, no como identidad autenticada. Tokens vencidos/revocados no consultan ni responden; si un resultado queda incierto después de vencer, el personal debe consultar el historial privado. Revocar un enlace impide accesos posteriores, **no retira una respuesta ya registrada**; una nueva revisión reemplaza su propuesta sin borrarla.

## API

Prefijo privado `/api/v1/cotizacion/:id/versiones`:

| Método/ruta | Cuerpo/resultado |
| --- | --- |
| GET raíz | `page`; snapshot seleccionado, revisión actual, historial20 y últimos20 enlaces sin tokens |
| POST `sellar` | `requestId`, `motivo`; activa la primera revisión |
| POST raíz | DTO de cotización más `requestId`, `revisionAnterior`, `motivo`; crea otra cotización en familia |
| POST `enlaces` | `requestId`; token/ID/vencimiento sólo para emisor autorizado |
| POST `enlaces/:enlace/revocar` | `motivo`; corrección trazada |

Rutas de respuesta sin sesión, con `Content-Type: application/json` y `X-Cotizacion-Respuesta: 1`:

- POST `/api/v1/cotizacion-respuesta/consultar`: `token`; contenido seleccionado/recibo.
- POST `/api/v1/cotizacion-respuesta`: `token`, `requestId`, `decision` Aceptada/Rechazada, `nombre`, `comentario`, `confirmacion:true`.

Página del destinatario: `/cotizaciones/responder` con fragmento emitido. No se incluye un token de ejemplo en este manual.

## Instalación, pruebas y límites

Respaldo legible → `db:check` con rollback → aceptación en copia → `db:migrate` → `db:status` → actualizar todos los procesos compatibles. **No usar binarios antiguos para convertir cotizaciones después de activar revisiones:** no conocen la regla de aceptación. El rollback de código necesita un procedimiento que conserve esos controles/datos; O04 permanece pendiente. No editar102 después de aplicarla.

```powershell
# Builds backend/frontend con Node24 antes; no recompilar durante la aceptación
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:quote-versions -- --backup=.backups/FECHA/database.dump
```

El verificador restaura exclusivamente una copia propia `verify_quotes_*`, aplica migraciones, crea fixtures de negocio/usuarios allí y elimina la copia. AppModule/PostgreSQL/API y Angular producción con login real y destinatario anónimo prueban idempotencia/concurrencia, snapshots, rechazo/aceptación, expiración/revocación, conversión/pedido/stock, impuestos/precio cambiados, rollback de revisión+cotización, permiso revocado durante bloqueo,23 revisiones paginadas y ocho cotizaciones simultáneas con folios distintos. Claro1280/oscuro390, editor, formularios, privacidad del fragmento, axe y reflujo; no se guardan tokens en los reportes. Resultados/conteos efectivos en README.

No certifica identidad/firma avanzada, instalación física, validez fiscal/PAC, pagos, entrega de mensajes, HTTPS externo, carga/soak o todos los dispositivos. No aprueba plazos de retención, datos comerciales reales o las decisiones WEB05 D01–D09. Publicación/privacidad/operación requieren sus revisiones pendientes; bancos excluidos e IA sin nueva prioridad. **Siguiente ID del plan: V02**, cuyo alcance se debe contrastar con entrega/receptor/notas existentes antes de implementar.
