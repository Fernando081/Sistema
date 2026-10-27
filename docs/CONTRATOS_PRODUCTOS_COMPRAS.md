# Contratos del frontend: productos y compras

## Alcance — Q03.3.3, 30 de septiembre de 2026

`producto-api.types.ts` describe los resultados SQL de productos, precios,
equivalentes, números de parte, aplicaciones y cotizaciones de proveedores.
`compra-api.types.ts` describe la página de compras y el resultado de registro,
incluidos `idCompra` y `backordersAsignados`.

Los tipos se contrastaron con servicios/controladores, migraciones y firmas de
las funciones de la base actual. No se cambiaron rutas ni funciones SQL.

## Mapeo de productos

`ProductoService` convierte los campos SQL PascalCase a `Producto` en lista,
búsqueda, consulta individual y resultados de alta/edición. Los importes y
existencias se convierten con `Number`; los identificadores opcionales conservan
null. Disponible cero no se sustituye por existencia física. Imágenes y IDs de
equivalentes se conservan. Las alternativas normalizan precio y stock.

La lista ya no mantiene un segundo mapeo independiente. La ficha utiliza
`productImageUrl` para las vistas previas de archivos guardados; la lectura de
archivos nuevos comprueba que FileReader haya producido una cadena.

## Campos que consume la UI

- Cotización de proveedor: `proveedor_nombre`, `precio_cotizado`,
  `dias_entrega`, `fecha_registro`. La ficha y el comparativo comparten contrato.
- Equivalente: `id_producto_eq`, `codigo`, `descripcion`, `precio`, `existencia`.
- Detalle de compra: `descripcion`, `codigo`, `cantidad`, `costo_unitario`,
  `importe`; los numerics SQL pueden llegar como cadenas.
- Kardex devuelve un arreglo directamente, sin envoltorio `data`.

El comparativo conserva el historial en objetos propios de presentación,
sin agregar propiedades al resultado original de la API.

## Verificación y límites

Las pruebas verifican normalización, disponibilidad cero, imágenes/equivalentes,
paridad lista/buscador, envío del requestId de compra y visualización de campos
SQL en detalle de compra y ficha de producto.

Estos tipos no validan JSON en ejecución. Quedan formularios con el FormGroup
genérico de Angular y contratos de otros dominios; eliminar los any explícitos
no implica que toda la aplicación use formularios estrictamente tipados.
Se conserva la idempotencia, los datos de prueba y el modo fiscal mock.

## Q04.2.1 — productos, 30 de septiembre de 2026

La lista conserva su paginación y orden en servidor. Se agregó categoría a la búsqueda ofrecida por la UI; `%`, `_` y barras inversas se buscan literalmente en código, descripción, marca, categoría y aplicaciones. Números OEM/alternos siguen usando búsqueda normalizada, con guard para impedir que signos sin letras/números coincidan con todos los números de parte. Los `EXISTS` conservan una fila por producto. Columnas de orden restringidas a claves propias del mapa.

GET `/api/v1/producto/exportar` usa `term` (máximo 200 caracteres), `sort` (vacío, codigo, descripcion, categoriaNombre, marca, ubicacion, precioUnitario o existencia) y `order` (vacío, asc o desc). Autenticación existente conservada. Exporta todas las coincidencias en orden, hasta 5000 filas; exceder el límite produce error sin truncar. Campos: ID, código, descripción, categoría, marca, ubicación, precio unitario y existencia física. No incluye costo, reservas/disponibilidad, imágenes ni unidades de clientes. CSV UTF-8 BOM con escape de comillas y neutralización de fórmulas compartido con clientes/proveedores.

El campo de búsqueda muestra `?q=...`, escucha pegado/entrada y descarta un término pendiente si cambia el filtro por URL. La descarga toma el término visible incluso antes del debounce. Una última página vacía tras eliminación se corrige; errores de carga limpian filas anteriores. La búsqueda continúa esperando 400 ms. El listado legado conserva nombres y límites de parámetros; no se migraron todos los selectores ni documentos.

Después de compilar, `node backend/scratch/verify-product-list.js` verifica SQL sobre tablas temporales con ROLLBACK y comprueba compatibilidad con la función real en una transacción de lectura. No se requieren nuevas migraciones. Q04 sigue parcial; próximo bloque documentos (facturas/cotizaciones/compras), contrastando sus filtros y exportaciones existentes.

## Q04.2.2c — compras, 1 de octubre de 2026

Compras ya tenía página y orden en servidor. Se conserva `fn_get_compras()` y se comparte consulta entre conteo/listado y nuevo GET `/api/v1/compra/exportar`. Búsqueda literal por ID, folio de factura, proveedor y RFC: `%` y `_` dejan de actuar como comodines. El orden se restringe a claves propias permitidas y usa ID descendente como desempate.

GET `/compra` y `/compra/exportar` comparten `page` (1–100000, defecto 1), `limit` (1–100, defecto 10), `term` (máximo 200 caracteres), `sortBy` (vacío, id_compra, fecha_compra, total, estatus, folio_factura, nombre_proveedor) y `sortOrder` (vacío, asc, desc). Orden inicial ID descendente; valores inválidos HTTP 400. La respuesta mantiene `{data,total,page,totalPages}`. Autenticación existente conservada.

La UI comparte el estado remoto: URL `?q=...` visible, debounce 300 ms, descarte de respuestas anteriores, aviso/limpieza al fallar y corrección de página fuera de rango. Las cabeceras fecha/proveedor/folio/total conservan su mapeo a columnas SQL. El CSV toma el texto visible incluso antes del debounce y exporta todas las coincidencias del orden, independientemente de la página. Campos ID, fecha, nombre/RFC de proveedor, folio de factura, total y estatus; fechas Date ISO, precisión textual de importes, UTF-8 BOM, escape y protección de fórmulas. Máximo 5000 filas con error explícito, sin truncar. No incluye partidas, costos unitarios ni el detalle de deuda/pagos.

Pruebas unitarias de validación/SQL/CSV y Playwright con API simulada para página/orden/URL/descarga. `node backend/scratch/verify-purchase-list.js`, después de compilar, verifica SQL con tablas temporales y ROLLBACK, y compatibilidad de la función real en transacción READ ONLY. Sin migraciones ni escrituras operativas; alta de compra, idempotencia, asignación de backorders y detalle permanecen intactos.

Q04 sigue parcial: continúa Q04.3, persistencia de filtros/orden/página en URL de los listados revisados. Conteo y filas pueden diferir ante cambios concurrentes; no se implementaron filtros nuevos por rango/estado ni optimización de subcadenas para grandes volúmenes.

Q04.3.2 (1 de octubre de 2026): productos usa el estado remoto compartido y restaura q/page/limit/sort/order de la URL, manteniendo sort/order en API y las acciones de producto. Debounce unificado a 300 ms. Ver [Estado de listados en URL](ESTADO_LISTADOS_URL.md) para alcance y validación de los seis listados.


## Q04.4.3 — estado y rango de fechas, 1 de octubre de 2026

El historial y CSV admiten estado vacío/Todos o Pendiente, Completada o Pagada. Estados contrastados con código y registros actuales; se conservan los históricos sin transformar documentos. No representan certificación fiscal ni recalculan saldos.

GET del listado y /exportar comparten estado, desde y hasta. Fechas reales YYYY-MM-DD de 1900–9999, extremos opcionales, rango invertido o estado inválido reciben HTTP 400. Fechas de compra almacenadas como timestamptz; límites explícitos en America/Mexico_City. Hasta incluye el día completo con límite exclusivo del siguiente. Consulta parametrizada común para conteo, filas y CSV; se conserva búsqueda literal, orden y tope de 5000 filas.

Selector Estado comercial y controles Desde/Hasta con Aplicar fechas y Limpiar fechas. Aplicar toma texto visible y vuelve a página 1, conservando filtros/orden/tamaño. Rango inválido avisa y conserva consulta previa; CSV usa rango aplicado, no fechas editadas sin aplicar. Estado y rango se guardan en URL y se restauran al abrir/recargar. Entradas inválidas se normalizan; rango invertido limpia ambos extremos. La limpieza de fechas conserva estado y búsqueda.

Validación DTO/SQL y CSV, pruebas de navegador con API simulada y verificador PostgreSQL ampliados. Fixtures temporales timestamptz y ROLLBACK, sesión UTC para probar límites de Tampico, y compatibilidad real READ ONLY. Sin nuevas migraciones ni escrituras operativas. Q04.4 completado en facturas/cotizaciones/compras; Q04 sigue parcial: otros módulos y optimización de búsqueda pendientes.

Q04.5.1: listado de productos calcula Reservada/Disponible con una suma de reservas por fila tras paginar. Misma búsqueda, orden y disponibilidad. Evidencia y límites en [Rendimiento de listados](RENDIMIENTO_LISTADOS.md); no se promete reducción general de latencia ni se cambia la consulta individual.


Q04.5.2a: listado/conteo/CSV de compras consultan directamente compra JOIN proveedor con la misma proyección de siete columnas y filtros. fn_get_compras permanece intacta; equivalencia de página y CSV comprobada contra ella en READ ONLY. Se retira Function Scan en el listado. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md) para mediciones y límites.


Q04.5.2d1: listado/conteo/CSV de productos consulta la misma proyección y LEFT JOIN directamente; fn_get_productos permanece intacta. Imágenes/SAT/equivalentes/IVA/retenciones y reservas conservados; 120 comparaciones de página/CSV aprobadas. No incluye nuevos índices OEM/aplicaciones. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md).

Q04.5.2d2: búsqueda de productos indexable por código/descripción/marca/categoría/OEM/aplicaciones, migración 082. IDs reunidos por UNION conservan una fila por producto, filtros literales y normalización OEM. Términos sin tres letras/números consecutivos siguen ruta previa; página/conteo/CSV y proyección anterior se conservan. Equivalencia verificada en respaldo restaurado y base operativa. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md) para comandos, reportes y límites de rendimiento.

Q04.5.2e2a: prototipo temporal de búsqueda indexable de compras/proveedor, todavía sin cambios al API. Conserva concatenación entre campos, JOIN a proveedor actual y resultados después de cambiar nombre/RFC/folio. Ganancia selectiva y regresión frecuente medidas; integración pendiente en Q04.5.2e2b con elección de consulta anterior para términos amplios y validación completa de CSV/filtros. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md).

Q04.5.2e2b: integración operativa de búsqueda de compras/proveedor, migración 084. Se conserva concatenación completa y proveedor actual; candidato indexable para términos selectivos sin espacios, con filtro final que elimina extras del documento de proveedor. Ruta anterior para términos cortos/signos/con espacios o sondeo de 257 coincidencias. Conteo/página/CSV/filtros conservados, 174 comparaciones exactas por ejecución sobre respaldo restaurado y operación. Sondeo añade costo y no garantiza consistencia entre lecturas concurrentes. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md).

Q04.5.3b (2026-10-01): listado paginado usa una transacción REPEATABLE READ READ ONLY sobre la misma conexión para sondeo/conteo/página. Evita discrepancias de total y filas ante cambios confirmados entre esas consultas. Facturas incluye enriquecimiento fiscal; productos incluye reservas/disponibilidad. Contratos de filtro/orden/página y CSV se conservan; CSV no se envuelve en nueva transacción. La validación de carreras y errores con TypeORM/PostgreSQL está en [Rendimiento de listados](RENDIMIENTO_LISTADOS.md). Carga HTTP sostenida/recursos pendiente; no certifica todas las escrituras del ERP ni SLA.
