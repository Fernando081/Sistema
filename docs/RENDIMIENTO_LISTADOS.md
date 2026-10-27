# Rendimiento de listados — Q04.5.1

1 de octubre de 2026. Seis listados: clientes, proveedores, productos, facturas, cotizaciones y compras.

## Herramienta reproducible

Después de compilar backend, ejecutar con Node 24 desde la raíz:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists
```

Para guardar una medición posterior en el reporte permitido:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists -- q0452-after.json
```

`backend/scratch/benchmark-lists.js` captura el SQL de los métodos reales de listado y ejecuta EXPLAIN ANALYZE/BUFFERS/JSON. No copia las consultas de negocio a una implementación paralela. En Q04.5.1 eran 72 planes. Q04.5.2a amplía la herramienta a 222 casos y tres repeticiones (666 planes), descritos abajo.

La base actual se consulta dentro de BEGIN READ ONLY. Los otros volúmenes usan tablas temporales generadas, índices de relación y estadísticas ANALYZE, y terminan en ROLLBACK. No se insertan registros operativos ni se cambian índices reales. Cada consulta tiene statement_timeout de 30 segundos; un error aborta el diagnóstico y revierte la transacción. Esto ejecuta consultas reales y consume recursos mientras corre: usar fuera de horas de mayor actividad si el volumen aumenta.

Reportes [antes](q045-baseline.json) y [después](q045-after.json): fecha, versión Node, tiempos, filas de salida, tipos de nodo y ciclos agregados. No contienen filas de clientes, SQL crudo, parámetros privados, credenciales ni rutas de imágenes. La herramienta actual restringe la salida a q0452-baseline.json y q0452-after.json dentro de docs; los reportes Q04.5.1 se conservan como evidencia histórica.

## Hallazgo y corrección

Productos ejecutaba dos subconsultas idénticas por fila para calcular Reservada/Disponible. La página se selecciona ahora primero y una unión LATERAL suma reservas una sola vez por producto. Se mantiene el mismo orden exterior, filtros, paginación, valores nulos/cero, estados Activa/Surtida y disponible mínimo cero. No modifica el cálculo en la consulta individual, que queda fuera de este bloque.

Con 20000 productos sintéticos y página de diez, ambos escenarios pasaron de 20 ciclos Aggregate a 10. Las 72 parejas de planes conservaron cardinalidad de salida. El verificador PostgreSQL de productos comprobó página/orden, signos, categoría, OEM/aplicaciones sin duplicados, reservas liberadas/canceladas, sobre-reserva con disponible cero y CSV; contrato real compatible en READ ONLY.

Los tiempos de una sola ejecución varían por caché y carga. Por ejemplo, página selectiva de productos: 19.641 ms antes y 23.937 ms después; sin filtro: 0.121 ms y 0.100 ms. Estos datos no permiten afirmar una reducción general de latencia. La mejora demostrada es eliminar un cálculo duplicado. El conteo selectivo de productos continúa recorriendo el conjunto y costó alrededor de 37 ms en los fixtures de 20000; búsquedas de otros dominios también escanean filas.

## Límites y siguiente bloque

Q04.5 permanece parcial. Sigue Q04.5.2: revisar planes/funciones e índices existentes, ampliar escenarios (VIN/ESN, OEM, signos, filtros de fecha/estado, texto frecuente y página profunda), medir repetidamente y diseñar búsqueda indexable con equivalencia semántica. Cualquier migración real exige respaldo, db:check antes de db:migrate y regresión. No se incorporan índices sin evidencia de beneficio y costo.

Fixtures sintéticos no reproducen tamaño de filas, distribución, concurrencia ni equipos de producción. No hay SLA ni prueba de carga concurrente. No se declara optimización de toda la aplicación, CSV masivo, selectores ni módulos distintos de los seis listados. No se cambian datos de prueba, fiscal mock ni idempotencia; conexiones bancarias excluidas.


## Q04.5.2a — mediciones ampliadas y compras, 1 de octubre de 2026

### Diagnóstico contrastado

Los índices revisados de cliente/proveedor/producto/unidades/documentos son B-tree: ayudan a igualdad, relaciones y algunos órdenes, pero no resuelven las subcadenas concatenadas actuales. pg_trgm está disponible en PostgreSQL y no está instalado en esta base; no se instala en este bloque.

fn_get_compras es PL/pgSQL: proyecta siete columnas mediante compra JOIN proveedor y ordena todo por ID. El plan externo conserva Function Scan, impidiendo aplicar directamente filtro/límite a las tablas. fn_get_productos también es PL/pgSQL y construye categorías/SAT/equivalentes antes del filtro externo: esa barrera de productos queda pendiente.

### Implementación

El listado/conteo/CSV de compras utiliza una proyección SQL directa de las mismas siete columnas y el mismo JOIN interno, con alias folio_factura conservado. El plan puede aplicar filtros, orden y límite directamente sobre las tablas. fn_get_compras permanece intacta para otros consumidores; no se modifican migraciones aplicadas, recepción, pagos ni contratos HTTP.

La herramienta incorpora texto frecuente, signo literal %, página 100, VIN/ESN (clientes), OEM/aplicación (productos) y fecha/estado (documentos), además de los casos originales. Son 222 casos, tres muestras por caso; reporta mediana y todas las muestras. Los fixtures de documentos distribuyen fechas en 90 días. La línea base de compras modela explícitamente la materialización/orden de una función PL/pgSQL temporal; el plan directo posterior consulta la misma tabla de fixtures. Los fixtures no reproducen el JOIN proveedor ni su costo: el resultado sintético mide la barrera de la función, no toda la operación real.

Reportes [antes](q0452-baseline.json) y [después](q0452-after.json). Las 222 parejas conservaron filas de salida; no sustituyen validación de contenido. Por separado, verify-purchase-list compara respuestas paginadas y CSV completos contra fn_get_compras en READ ONLY para orden por proveedor, signo literal, estado/fecha, página y consulta general, además de fixtures de negocio.

Con 20000 fixtures, mediana de página sin filtro: 6.156 → 0.019 ms; página selectiva: 12.956 → 6.309 ms; página 100: 7.008 → 0.328 ms. El conteo con fecha/estado no mejoró (34.294 → 36.626 ms); no se afirma mejora en todos los casos. En la base actual, página sin filtro: 0.074 → 0.035 ms y Function Scan 1 → 0. Son datos de este equipo, tres repeticiones y sin concurrencia; no son SLA.

### Diseño del siguiente bloque Q04.5.2b

1. Prototipar búsqueda trigram en una base aislada: documento textual que reproduzca exactamente lower(concat_ws(...)), con NULL, campos vacíos y espacios; probar coincidencias que cruzan campos. No sustituirlo por OR sobre campos independientes, porque cambiaría resultados.
2. Convertir búsqueda literal strpos a LIKE parametrizado con escape de %, _ y barra inversa, preservando lower y la semántica actual. Evaluar GIN/pg_trgm sobre la misma expresión textual, usando una función inmutable específica para argumentos text o una columna mantenida de forma transaccional; no declarar concat_ws genérico inmutable por conveniencia.
3. Medir términos cortos/frecuentes, signos y VIN/ESN, costo de insertar/actualizar, espacio de índices y mantenimiento. Conservar ruta exacta para términos sin trigram útil. Probar interacciones con relación de unidades, OEM, aplicaciones y límites CSV.
4. Retirar la barrera de fn_get_productos sin perder imágenes, SAT, categorías ni equivalentes y comprobar equivalencia contra la función existente. Revisar índices de fecha/estado/ID para documentos y sort antes de proponerlos.
5. Cuando el prototipo demuestre beneficio y equivalencia, agregar la siguiente migración (081), respaldar, ejecutar db:check antes de db:migrate y validar regresión. No hay migraciones ni índices operativos nuevos en Q04.5.2a.

Q04.5.2 y Q04 siguen parciales. Faltan el prototipo, índices/búsqueda indexable y evaluación de concurrencia. Los datos de prueba, fiscal mock e idempotencia se conservan; APIs bancarias excluidas.


## Q04.5.2b — prototipo aislado de búsqueda trigram, 1 de octubre de 2026

### Uso y aislamiento

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:search-prototype
```

El comando crea una base nueva con prefijo sistema_search_verify, nombre aleatorio validado y distinto de la base operativa. Instala pg_trgm únicamente allí y genera 20005 filas sintéticas, un documento textual almacenado y su índice GIN. Cierra la conexión y elimina su propia base en finally; el reporte se escribe únicamente después de esa limpieza. Verificación final: ninguna base con ese prefijo quedó existente y la base operativa continúa sin pg_trgm. No es restauración de un respaldo ni valida datos reales de los seis dominios.

La conexión requiere permiso para crear/eliminar esa base y crear la extensión allí. Ante fallo, el comando termina con error; no intenta instalar la extensión en la base operativa. Cada consulta tiene timeout de 30 segundos.

### Semántica validada

Documento generado con función inmutable específica de text[]: lower(array_to_string(array_remove(parts,NULL),' ')). Solo recibe texto; no convierte fechas ni otros tipos a texto y no redefine concat_ws genérico. Conserva campos vacíos, omite NULL y mantiene espacios entre campos. Cambios de collation o reglas de lower requieren reevaluar columnas e índices como en cualquier índice de texto.

La consulta candidata usa LIKE con parámetro y escape explícito de %, _ y barra inversa, con lower aplicado por PostgreSQL. Evita cambiar el comportamiento por diferencias de minúsculas entre JavaScript y PostgreSQL. Se comparan IDs ordenados contra strpos(lower(concat_ws(...)),lower(term)), antes y después del índice, y tras actualización de filas.

39 comparaciones exactas aprobadas: términos selectivos/frecuentes, VIN/ESN sintéticos, coincidencias entre campos, NULL, cadenas vacías, uno/dos espacios, %, _, barras, acentos, Ñ, İ, ß, texto corto/vacío y resultados vacíos. Son 19 escenarios × cinco repeticiones × dos consultas = 190 planes; se registran medianas y muestras. No se fuerza enable_seqscan=off: el planificador decide cuándo usar GIN y cuándo recorrer filas.

### Resultados y costos

Reporte [Prototipo trigram](q0452b-trigram.json), sin credenciales, filas privadas ni nombre real de base.

| Escenario | Mediana actual ms | Mediana candidata ms | Plan GIN |
| --- | ---: | ---: | --- |
| Q04TARGET | 8.862 | 0.042 | Sí |
| Cliente | 12.171 | 3.509 | No |
| VIN1000 | 9.122 | 0.122 | Sí |
| ESN1000 | 9.159 | 0.129 | Sí |
| % | 10.736 | 1.954 | No |
| (vacio) | 10.983 | 3.917 | No |

Para 1000 inserciones: 16.986 ms sin GIN y 40.744 ms con GIN. Para 1000 actualizaciones: 13.232 ms y 42.903 ms. Construcción del índice: 154.764 ms. Índice tras escrituras: 2793472 bytes; limpieza de lista pendiente GIN: 24.505 ms. Son muestras únicas de escritura con caché y orden distintos, no un benchmark estadístico de escritura. La mejora de lectura proviene tanto del documento precalculado como del índice; los casos que no usan GIN evidencian esa diferencia.

Se verificó que la columna generada actualiza el documento en altas/cambios y conserva equivalencia después de actualizar. No se midieron latencia concurrente, bloqueo, espacio WAL, autovacuum ni evolución de la lista pendiente en operación sostenida. Términos cortos/frecuentes pueden usar recorrido secuencial sin perder coincidencias; no se impone un mínimo de tres caracteres que cambie la búsqueda existente.

### Cierre y siguiente integración

Q04.5.2b completado en el alcance del prototipo y sus costos/equivalencia textual. No se integró esta consulta ni ningún índice en endpoints operativos. Q04.5.2 sigue parcial: siguiente Q04.5.2c, integrar clientes/proveedores y unidades VIN/ESN en una base aislada/restaurada, demostrar equivalencia de lista/conteo/CSV y costo de actualizar, después preparar migración y aplicar con respaldo y db:check previo a db:migrate. Productos/OEM/aplicaciones, la barrera PL/pgSQL de productos y documentos siguen pendientes; no se declara validación de esas relaciones por el documento genérico.

Node 24.19.0, comando del prototipo, 39 comparaciones y 190 planes aprobados. Guards runtime/repository/no-any y git diff --check aprobados. Sin cambios de código de aplicación: no se repiten build ni suites backend/frontend/UI en este bloque de herramientas. No hay migraciones operativas aplicadas ni certificación PAC.


## Q04.5.2c — integración de directorios y unidades, 1 de octubre de 2026

Migración aplicada: **081_busqueda_directorios_trigram.sql**, después de respaldo y db:check. Instala pg_trgm en public y crea función inmutable específica text[] que calcula lower(concat_ws(' ',VARIADIC parts)). Su inmutabilidad se limita a texto ya convertido: no redefine concat_ws genérico ni convierte fechas dentro de la función.

Índices GIN de expresión: idx_cliente_busqueda_trgm (ID/RFC/razón social/CP), idx_proveedor_busqueda_trgm (los mismos campos) e idx_crm_unidad_busqueda_trgm (VIN/ESN/número económico/placas). No agrega columnas a tablas ni al API; SELECT d.* conserva sus campos anteriores. Los índices se mantienen al insertar/actualizar; no hay sincronización manual de documentos.

Clientes reúne IDs que coinciden en el directorio o en unidades mediante UNION y luego consulta esas entidades. Conserva una fila por cliente aunque varias unidades coincidan o el directorio también coincida. Proveedores usa el documento de expresión directamente. Patrón LIKE parametrizado con escape de %, _ y barra inversa y lower de PostgreSQL. Página, conteo y CSV comparten estrategia y límites; sin búsqueda sigue la consulta sin filtros.

Para términos sin tres letras/números consecutivos se conserva strpos/EXISTS original. Para otros términos, un sondeo UNION ALL devuelve como máximo 257 coincidencias (incluidas posibles repeticiones de unidades). Si llega a 257, se usa la consulta original; si no, la ruta indexada. El sondeo no cambia qué filas coinciden, solo la estrategia; se ejecuta una vez por petición de listado o CSV. Limita filas retornadas, no garantiza un máximo de trabajo del planificador. Añade una consulta y puede costar más para entradas frecuentes: no se promete mejora universal.

### Validación reproducible

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:directories -- --backup=C:\Sistema\.backups6-10-01T20-59-01-281Z\database.dump
```

El verificador exige un dump existente dentro de .backups. Crea base propia sistema_directory_verify, restaura con pg_restore, ejecuta db:check y db:migrate allí, y compara lista/conteo/CSV completos con la consulta previa. Luego prueba fixtures temporales/indexados: 20005 clientes, 20000 proveedores, unidades múltiples, coincidencias por ambos lados, NULL/vacíos/espacios, signos, caracteres Unicode, CSV excedido, página/orden y altas/cambios. Finaliza con ROLLBACK y eliminación de su base. Reporte [Directorios indexados](q0452c-directories.json), escrito tras limpieza y sin filas privadas/credenciales.

256 comparaciones aprobadas; 64 sobre respaldo restaurado, el resto sobre fixtures antes/después de cambios. Tiempos de conteo incluyen sondeo y consulta final, cinco muestras. El reporte no equivale a validación concurrente; costos de actualizar tres entidades son una muestra, complementada por los costos GIN del prototipo anterior.

| Conteo sintético | Antes ms | Después ms (sondeo incluido) |
| --- | ---: | ---: |
| cliente / Q04TARGET | 19.947 | 0.195 |
| cliente / Cliente | 23.650 | 28.085 |
| cliente / VIN1000 | 27.383 | 0.364 |
| cliente / % | 20.238 | 20.324 |
| proveedor / Q04TARGET | 10.116 | 0.250 |
| proveedor / Cliente | 13.983 | 11.369 |
| proveedor / VIN1000 | 12.400 | 0.080 |
| proveedor / % | 10.503 | 10.236 |

Índices GIN de fixtures: 3547136 bytes. Actualización indexada de cliente/proveedor/unidades: 16.187 ms en una muestra. Algunos tiempos empeoran o fluctúan incluso usando la consulta previa; no se afirma mejora general de latencia. Ganancia demostrada en términos selectivos y VIN, con contenido equivalente.

Regresión PostgreSQL de directorios aprobada después de aplicar 081; benchmark de seis dominios adaptado para medir sondeos y elegir estrategia con resultados reales: 240 operaciones/720 planes aprobados. No se sobrescriben reportes históricos Q04.5.1/Q04.5.2a. Suites finales: 171 backend, 5 HTTP, 45 frontend, 25 Playwright; auditoría producción 0 vulnerabilidades y bundle 474.93 kB dentro de 500 kB.

Q04.5.2c completado para clientes/proveedores/unidades. Sigue Q04.5.2d: retirar barrera de productos e integrar su búsqueda (categoría/OEM/aplicaciones) sin perder imágenes/SAT/equivalentes; documentos y medición concurrente pendientes. Q04.5.2/Q04 parciales. Fiscal mock, identificadores e idempotencia permanecen; APIs bancarias excluidas.


## Q04.5.2d1 — consulta directa de productos, 1 de octubre de 2026

Listado/conteo/CSV sustituye fn_get_productos(NULL,NULL,'') por la misma proyección SQL de producto y LEFT JOIN de categoría, claveproductooservicio y claveunidad. Preserva las 23 columnas de la función, incluidas imágenes y EquivalentesJSON, sus tipos, NULL, agrupación de equivalentes, IVA y retenciones. La función legada permanece intacta para consumidores existentes. No se modifica consulta individual, altas/ediciones ni inventario.

Filtro por código/descripción/marca/categoría, normalización OEM y EXISTS de aplicaciones se conservan. Sigue búsqueda literal de signos y descarte de OEM cuando el término normalizado está vacío; relaciones no duplican productos. Reserva/disponibilidad siguen calculándose una vez después de paginar. Orden y CSV permanecen compartidos, con límite explícito de 5000 filas.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:products-projection
```

Verificador: 120 comparaciones exactas de página completa y CSV (60 READ ONLY contra base real, 60 con tablas temporales/ROLLBACK). Compara con una fuente que reutiliza la función antigua y los mismos filtros. Corpus cubre categoría, OEM, aplicación duplicada, signos, término normalizado vacío, página/orden, imágenes múltiples/vacías/NULL, SAT presente/ausente, categoría inexistente, equivalentes múltiples y reservas activas/liberadas/canceladas/sobre-reserva. Verifica además los valores concretos de imágenes, equivalentes, claves SAT y disponible. Imágenes de fixture son datos sintéticos; no acredita existencia ni renderizado de esos archivos.

[Reporte de proyección de productos](q0452d1-products.json): cinco muestras en base actual. Conteo sin filtro 0.279 → 0.052 ms; página 0.241 → 0.187 ms. Function Scan pasa de 1 a 0 en ambos planes. Estos tiempos de base pequeña no son SLA ni prueba de carga; evidencian la retirada de la barrera de la función. Regresión de productos y benchmark de seis dominios (240 operaciones/720 planes) aprobados.

Sin nuevas migraciones ni índices; no se escriben registros operativos. npm run verify: 171 backend, 5 HTTP, 45 frontend y 25 Playwright; auditoría producción 0 vulnerabilidades, bundle inicial 474.93 kB dentro de 500 kB. Node 24.19.0 y git diff --check aprobados.

Q04.5.2d parcial: siguiente Q04.5.2d2, prototipo/integración de índices de código/descripción/marca/categoría, OEM y aplicaciones, equivalencia de resultados y costo de mantenimiento, con respaldo/db:check antes de cualquier nueva migración. Búsqueda indexada de productos aún no implementada. Documentos y concurrencia permanecen pendientes; fiscal mock e identificadores/idempotencia conservados, APIs bancarias excluidas.

## Q04.5.2d2 — índices de productos, 1 de octubre de 2026

Migración **082_busqueda_productos_trigram.sql** aplicada tras respaldo restaurado, validación aislada, db:check y db:migrate. Seis índices GIN sobre código/descripción/marca/categoría/OEM/aplicaciones y B-tree de IdCategoria. La función product_application_text(text[]) conserva concat_ws y NULL, sin convertir el ILIKE original en comparación lower/strpos. No modifica columnas ni la función legada.

ProductoService reúne IDs por UNION, evitando duplicados de relaciones. Página/conteo/CSV comparten estrategia y parámetros: texto escapado para ILIKE y normalización OEM separada, descartada cuando queda vacía. Las aplicaciones conservan concatenación entre campos. La proyección directa conserva imágenes, equivalentes, SAT, impuestos y reservas/disponibilidad. Términos sin tres letras/números Unicode consecutivos conservan consulta anterior; los demás usan candidato indexable sin sondeo. No se promete mejora universal para búsquedas frecuentes.

### Reproducción y evidencia

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:products-search-prototype
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:products-indexes -- --backup=C:\Sistema\.backups\2026-10-01T21-32-54-627Z\database.dump
$env:PRODUCT_SEARCH_REPORT='q0452d2-products.json'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:products-projection
```

El validador exige dump dentro de .backups, crea base propia, restaura, ejecuta check/migrate, verifica siete índices y elimina su base en finally. 120 comparaciones exactas de página/CSV aprobadas allí y otras 120 en operación: cada ejecución compara 60 combinaciones sobre datos existentes/restaurados y 60 fixtures temporales. Fixtures verifican contenido de imágenes/SAT/equivalentes/reservas, no existencia ni renderizado de archivos. [Reporte operativo](q0452d2-products.json).

[Prototipo](q0452d2a-product-search.json): 20004 productos, 58 comparaciones, 180 planes, cinco muestras. Se verifican cambios indexados de producto, categoría, OEM y aplicaciones. Construcción de seis GIN: 761.534 ms; actualización medida: 2.332 ms; tamaño: 2678784 bytes. Muestras únicas de escritura no constituyen benchmark estadístico ni medición de autovacuum/WAL/concurrencia.

| Conteo sintético | Antes ms | Después ms |
| --- | ---: | ---: |
| Q04TARGET | 41.171 | 0.167 |
| OEM-1000 | 40.276 | 0.528 |
| ISX | 31.763 | 0.228 |
| Especial | 31.610 | 0.175 |
| Filtros | 34.906 | 7.754 |
| Filtro | 24.960 | 20.913 |

Signos y términos cortos empeoraron en el prototipo, por eso operación conserva ruta previa para ellos. Términos amplios con tres letras pueden seguir costando más; no hay garantía de latencia ni SLA. Benchmark general: 240 operaciones/720 planes, tablas temporales revertidas y lectura operativa READ ONLY. Los planes sin filtro del reporte operativo prueban eliminación de Function Scan, no uso de GIN: la evidencia de uso indexado corresponde al prototipo.

Q04.5.2d completo para productos. Próximo Q04.5.2e: documentos (facturas/cotizaciones/compras); Q04 y Q04.5.2 parciales, concurrencia pendiente. Fiscal mock y exclusión bancaria conservados.

Validación final: npm run verify aprobado con Node 24.19.0; 171 backend, 5 HTTP, 45 frontend, 25 Playwright, auditoría producción 0 vulnerabilidades. Bundle 474.93 kB dentro de 500 kB. Backend reiniciado tras migrar; salud y productos frontend HTTP 200 en 3100/4300.

## Q04.5.2e1 — facturas y cotizaciones, 1 de octubre de 2026

Migración **083_busqueda_documentos_trigram.sql**: GIN de expresión en factura y cotizacion. Reutiliza directory_search_document(text[]) de 081, que conserva lower(concat_ws) con NULL omitidos y espacios/campos vacíos intactos. Facturas indexan folio, serie+folio, serie-guion-folio, nombre y RFC; cotizaciones folio, C-folio, nombre y RFC. No incluye UUID ni conceptos.

Servicio comparte búsqueda entre página/conteo/CSV. Para términos sin tres letras/números Unicode consecutivos conserva strpos original. Otros términos usan sondeo de hasta 257 filas y patrón LIKE escapado (barra inversa, % y _), parametrizado y con lower de PostgreSQL. Si sondeo alcanza umbral, usa consulta anterior; en caso contrario usa expresión indexable. CTE MATERIALIZED en el sondeo separa su evaluación del límite exterior. No fuerza índices ni garantiza máximo de trabajo; añade una consulta por petición y puede aumentar costo de búsquedas frecuentes. Filtros de estado/tipo/fechas, zona Tampico, último pedido/estado fiscal y orden/CSV permanecen.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:documents-indexes -- --backup=C:\Sistema\.backups\2026-10-01T21-42-04-006Z\database.dump
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:documents
```

Primero restaura dump validado dentro de .backups en base propia; db:check/db:migrate y ambos índices comprobados allí. Elimina base en finally. Verificador compara respuestas exactas contra consulta anterior, no solo cardinalidad: **352 comparaciones** por ejecución (36 sobre datos existentes/restaurados, 316 fixtures temporales) y **110 planes**, cinco muestras. Temporales de 20004 documentos por tipo; prueba tipos I/E, estado/rango, folios/series, signos/Unicode, NULL/vacíos, coincidencias entre campos, 256/257 coincidencias, errores CSV >5000, último pedido y estado fiscal, altas/cambios después de indexar. Todo se revierte.

[Reporte operativo](q0452e1-documents.json) incluye costo de construcción (con ANALYZE), altas/cambios indexados y tamaño. Costos de escritura son muestra única sin comparación estadística anterior, no prueba de WAL/autovacuum/concurrencia. Tiempos posteriores suman sondeo y conteo; no incluyen transporte HTTP ni renderizado. Equivalencia aprobada en respaldo restaurado y operación. No se afirma SLA ni mejora para todos los términos. Las primeras iteraciones detectaron regresión en términos amplios; se agregó elección de ruta previa. Los fixtures del umbral se generan directamente al insertar para evitar confundir restricciones de uso de índices creados tras actualizaciones HOT en la misma transacción con el comportamiento operativo después del commit de migración.

083 aplicada operativamente después de respaldo/restauración y db:check seguido de db:migrate. No cambia documentos del negocio ni modo fiscal. Q04.5.2e1 completo para facturas/cotizaciones; sigue **Q04.5.2e2, compras/proveedor**: su concatenación cruza tablas y no puede sustituirse por OR entre campos sin alterar coincidencias. Q04.5.2e/Q04 parciales; concurrencia pendiente y APIs bancarias excluidas.

### Resultados finales operativos con fixtures

| Conteo sintético | Antes ms | Después ms (sondeo incluido) |
| --- | ---: | ---: |
| factura / Q04TARGET | 17.815 | 0.201 |
| factura / Cliente | 18.333 | 22.814 |
| factura / RFC1000 | 19.206 | 0.648 |
| cotización / Q04TARGET | 13.984 | 0.165 |
| cotización / Cliente | 13.598 | 13.547 |
| cotización / RFC1000 | 14.760 | 0.435 |

Índice usado en los cuatro casos selectivos; no se fuerza. Factura frecuente empeora por costo del sondeo/variación de las muestras; no se afirma optimización universal. Construcción con ANALYZE: 913.715 ms; muestra de dos actualizaciones y dos inserciones indexadas: 19.892 ms; tamaño de los dos índices temporales después de escrituras: 2416640 bytes. No son métricas de escritura bajo carga.

Regresiones PostgreSQL de facturas/cotizaciones y benchmark general de seis dominios aprobados: 252 casos/756 planes; fixtures revertidos, datos operativos READ ONLY, reportes históricos conservados. Dos índices operativos presentes y cero bases aisladas restantes. npm run verify final: 175 backend, 5 HTTP, 45 frontend, 25 Playwright; build/lint aprobados, auditoría producción 0 vulnerabilidades y bundle 474.93 kB dentro de 500 kB. Node 24.19.0. Backend reiniciado después de migrar; salud y ambos historiales HTTP 200 en 3100/4300.

## Q04.5.2e2a — prototipo de compras/proveedor, 1 de octubre de 2026

Comando: `npm run perf:purchases-search-prototype` bajo scripts/node24.ps1. Tablas temporales propias con 20006 compras y 20004 proveedores, dos GIN de expresión y B-tree de relación, ROLLBACK en finally. No altera endpoints ni esquema operativo; no necesita migración. Reutiliza directory_search_document(text[]) de 081.

Documento de compra: ID/folio. Documento de proveedor: ID/RFC/nombre/CP (superconjunto del índice operativo existente). UNION reúne candidatos; consulta final mantiene exactamente strpos/lower/concat_ws original y JOIN a proveedor actual. El filtro final elimina coincidencias extra por ID/CP de proveedor. Solo se ensaya candidato para términos con tres letras/números consecutivos y sin espacios; los que pueden cruzar separadores usan consulta anterior. No se congela el proveedor ni se mantiene documento duplicado mediante triggers. Lower y patrones literales escapados se calculan en PostgreSQL.

[Reporte](q0452e2a-purchases.json): 88 comparaciones exactas de IDs y páginas/orden antes/después de índices y después de cambios de proveedor/folio y alta. Cubre proveedor compartido, huérfano excluido por JOIN, NULL/vacíos, signos/Unicode, candidatos por CP y coincidencias entre campos. 50 planes, cinco muestras; no fuerza índices. No acredita todavía el servicio real, CSV, estado/fecha ni concurrencia.

| Consulta sintética | Antes ms | Después ms |
| --- | ---: | ---: |
| Q04TARGET | 16.122 | 0.170 |
| RFC1000 | 22.018 | 0.477 |
| F1000 | 18.918 | 0.110 |
| Proveedor | 17.728 | 76.504 |
| F1000 Q04TARGET | 17.121 | 16.275 |

Ganancia selectiva y regresión frecuente detectadas. Se conserva consulta operativa existente; integración requiere sondeo/elección de ruta previa para términos amplios. Costos de construir (incluye ANALYZE), escritura y tamaño están en reporte; son muestras únicas, no benchmark estadístico ni costo de WAL/autovacuum. No se mide HTTP/renderizado ni SLA.

Node 24.19.0 y guards runtime/repository/no-any aprobados. Sin cambios de aplicación, no se repiten sus suites. Q04.5.2e2a terminado solo como prototipo. Sigue Q04.5.2e2b: integración de servicio, equivalencia lista/conteo/CSV/filtros, mantenimiento y migración validada en respaldo restaurado antes de aplicar. Q04.5.2e2/e/Q04 parciales; fiscal mock y exclusión bancaria conservados.

## Q04.5.2e2b — integración de compras/proveedor, 1 de octubre de 2026

Migración **084_busqueda_compras_trigram.sql** aplicada tras respaldo restaurado y db:check/db:migrate aislados y operativos. GIN sobre directory_search_document(ARRAY[id_compra::text,folio_factura_proveedor::text]) y B-tree completo de id_proveedor; índice previo por saldo era parcial. Reutiliza índice de proveedor de 081. Sin columnas ni copias de nombre/RFC; proveedor actual se consulta por JOIN.

Página/conteo/CSV comparten compraSearch. Candidato UNION de compra o proveedor es superconjunto; filtro original strpos/lower/concat_ws elimina ID/CP extra del proveedor. Términos cortos/signos/con espacios mantienen consulta anterior. Otros usan sondeo UNION ALL de hasta 257 coincidencias, con relación LATERAL limitada por proveedor y B-tree para evitar materializar toda la unión; si llega a umbral, usa consulta anterior. Repetidos pueden seleccionar esa ruta conservadoramente. Sondeo añade consulta y no garantiza límite total de trabajo. IDs del sondeo no se reutilizan: consulta final recalcula candidatos y datos actuales. No se promete snapshot común ni consistencia bajo escrituras concurrentes; pendiente Q04.5.3.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:purchases-indexes -- --backup=C:\Sistema\.backups\2026-10-01T22-10-32-167Z\database.dump
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:purchases
```

[Reporte](q0452e2b-purchases.json): **174 comparaciones exactas** por ejecución (18 existentes/restauradas, 156 temporales), **70 planes**, cinco muestras. Valida objetos completos de listado y CSV/error >5000, orden/página, estado/rango de Tampico con sesión UTC, umbral 256/257, signos/Unicode/NULL, huérfano excluido, proveedor compartido, candidato extra CP, coincidencias entre campos y cambios de nombre/RFC/folio/alta después de indexar. Temporales revertidos, base restaurada propia eliminada. Después repite en operación READ ONLY con fixtures temporales.

| Conteo sintético | Antes ms | Después ms, sondeo incluido |
| --- | ---: | ---: |
| Q04TARGET | 17.203 | 0.391 |
| RFC1000 | 19.573 | 1.217 |
| F1000 | 17.645 | 0.275 |
| Proveedor | 18.541 | 23.245 |
| F1000 Q04TARGET | 21.374 | 19.412 |

Selectivos usan índices; frecuente usa filtro anterior tras sondeo y conserva un costo adicional. Ganancias no son SLA ni mejora universal. Costos de mantenimiento del prototipo e índices son muestras sintéticas; no se declara costo de WAL/autovacuum o carga sostenida. Regresión de compras contra función legada y benchmark de seis dominios: 258 casos/774 planes aprobados, sin sobrescribir históricos.

Q04.5.2e2/e cerrado en búsquedas de facturas/cotizaciones/compras. Q04 sigue parcial; siguiente Q04.5.3 concurrente/sostenido en base aislada, incluidos efectos sobre conteo/página y costos. Fiscal mock, identificadores/idempotencia y exclusión bancaria conservados.

Verificación final con Node 24.19.0: npm run verify aprobado (177 backend, 5 HTTP, 45 frontend, 25 Playwright; build/lint, auditoría producción 0 vulnerabilidades). Nueva prueba explícita de filtros/CSV añadida después: backend completo repetido, 178 aprobadas; lint final sin advertencias. Bundle inicial 474.93 kB dentro de 500 kB. Backend/frontend levantados, salud y compras HTTP 200 en 3100/4300; dos índices operativos confirmados y cero bases aisladas restantes. git diff --check aprobado.

## Q04.5.3a — concurrencia acotada y consistencia, 1 de octubre de 2026

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-concurrency -- --backup=C:\Sistema\.backups\2026-10-01T22-22-18-761Z\database.dump
```

El comando exige dump existente dentro de .backups. Crea base propia sistema_load con sufijo validado, distinta de la operativa, restaura y ejecuta db:check/db:migrate solo allí. Fixtures compartidos en q04_load con 20000 filas por dominio; commit de preparación permite índices y lecturas de múltiples conexiones. No modifica tablas operativas ni migraciones. Clientes/proveedores/productos/facturas/cotizaciones/compras invocan métodos reales; productos/compras sustituyen su proyección por fixture sintético como el benchmark previo. No es carga HTTP ni representación completa del costo de todos los JOIN.

24 casos de calentamiento: cuatro escenarios (vacío, selectivo, frecuente, signo) por dominio. Grupos de 1/4/8 lectores, conexión dedicada por lector y cola para serializar consultas internas de ese lector. Carga cerrada: cada lector espera respuesta antes de siguiente solicitud. Hasta seis segundos o 512 peticiones por lector/grupo; última solicitud puede superar ligeramente la ventana. Timeout SQL 15 s y lock 2 s. Se espera finalización de todos los lectores antes de cerrar conexiones/eliminar base, incluso ante error. Reporte publicado tras limpieza; contiene métricas y conteos, no filas, parámetros privados ni credenciales.

[Reporte reproducible](q0453a-concurrency.json): 4733 respuestas idénticas a referencia sin escritores durante la carga. Percentil por rango más cercano; p95 por dominio también incluido. Son ventanas cortas con caché caliente, no evidencia de capacidad máxima, horas de carga, recursos, WAL/autovacuum ni SLA.

| Lectores | Peticiones | Duración ms | p50 ms | p95 ms | Máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 411 | 6086.768 | 10.490 | 48.554 | 97.123 |
| 4 | 1395 | 6028.468 | 2.466 | 49.625 | 105.567 |
| 8 | 2927 | 6028.616 | 2.901 | 40.595 | 122.530 |

Los grupos se ejecutan en orden; calentamiento, mezcla y variación explican diferencias y no permiten afirmar mejora monotónica. Latencia del método incluye sondeo/conteo/página y cola del lector, excluye transporte HTTP/autenticación/UI. La concurrencia equivale a lectores de esta herramienta, no usuarios finales ni tamaño de pool operativo.

### Hallazgo de consistencia

Después de carga estable, una prueba de cliente inserta determinísticamente desde otra conexión entre conteo y página. READ COMMITTED: total 0, filas 1. Un snapshot REPEATABLE READ READ ONLY abarca sondeo/conteo/página y produce total 0, filas 0, pese a la misma escritura externa. Son asserts reales, no resultados simulados. Esta prueba cubre cliente y una intercalación; no todas las escrituras/flujos del ERP. El snapshot solo se probó en herramienta: los endpoints todavía requieren integración.

Siguiente **Q04.5.3b**: integrar snapshot compartido en los seis listados conservando DTO/respuesta y validando carreras y cierre de transacción/conexión. Después, ampliar carga HTTP sostenida, distribución y recursos bajo lectura/escritura. Q04.5.3/Q04 permanecen parciales.

Backup restaurado y base de carga eliminada; cero bases restantes. Benchmark temporal original aprobado nuevamente: 258 casos/774 planes; Node 24.19.0, guards runtime/repository/no-any y git diff --check aprobados. Sin cambios de aplicación, no se repiten suites UI/backend ni se reinician servicios. Sin nuevas migraciones operativas, conexiones bancarias ni certificación PAC; fiscal mock e identificadores/idempotencia conservados.

## Q04.5.3b — snapshot de seis listados, 1 de octubre de 2026

Helper readSnapshot invoca transacción TypeORM REPEATABLE READ y SET TRANSACTION READ ONLY. Dentro del callback se usa exclusivamente manager de esa conexión. El contexto devuelve solo query: llamadas internas no abren transacciones/savepoints anidados. Sondeo/conteo/página secuenciales ven el mismo snapshot; evita Promise.all sobre una conexión y queries pendientes después de error. TypeORM conserva error original, rollback y release en finally (implementación local contrastada). Esto no modifica las transacciones de escritura.

Clientes/proveedores usan directoryPage; facturas/cotizaciones/compras sus helpers Page; productos findAll. ConsultasVentaService envuelve también el enriquecimiento de estado fiscal. Productos incluye reserva/disponibilidad en la página estable. DTO/respuesta/orden/fechas/filtros permanecen. CSV conserva implementación existente; no adquiere nueva transacción. Adaptadores QueryExecutor sin transaction usados por mocks/verificadores no reciben snapshot automático; los endpoints usan DataSource real.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-snapshots -- --backup=C:\Sistema\.backups\2026-10-01T22-37-06-188Z\database.dump
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-concurrency -- --snapshots --backup=C:\Sistema\.backups\2026-10-01T22-37-06-188Z\database.dump
```

[Carreras y transacciones](q0453b-snapshots.json): base propia restaurada, TypeORM/PostgreSQL real, 1000 fixtures por dominio y escrituras desde otra conexión. Seis intercalaciones tras conteo: control sin transacción muestra total 0/una fila; snapshot integrado muestra 0/0; siguiente petición muestra 1/1. Estado fiscal actualizado después de página conserva Borrador del snapshot aunque escritor confirmó Timbrado. Aislamiento/readOnly comprobados con SHOW; escritura rechazada 25006, división por cero 22012 recuperada y consulta posterior exitosa. Cero transacciones ociosas. Base eliminada antes de publicar reporte.

[Carga con snapshots](q0453b-concurrency.json): 4776 respuestas completas iguales a referencia, escenarios y límites de Q04.5.3a. Adaptador PostgreSQL por lector abre transacción repetible que el helper marca read-only; transacciones TypeORM verificadas aparte. Se conserva reporte histórico q0453a-concurrency.json. La carga estable no incluye escritores: las carreras se comprueban en prueba separada determinista. Proyección de productos/compras sintética, sin HTTP/autenticación/UI.

| Lectores | Peticiones | p95 ms | Máximo ms |
| --- | ---: | ---: | ---: |
| 1 | 420 | 47.136 | 76.750 |
| 4 | 1445 | 44.318 | 103.873 |
| 8 | 2911 | 41.685 | 97.453 |

Ventanas cortas, caché caliente y sesiones distintas impiden atribuir mejoras a snapshots o certificar capacidad máxima. Transacción ocupa conexión durante toda la petición; carga HTTP sostenida/pool/recursos, antigüedad de snapshots y efectos sobre autovacuum quedan pendientes. No se cambian límites operativos de pool ni se declara SLA.

Sin nuevas migraciones operativas; respaldo restaurado y bases propias eliminadas. Q04.5.3b completo para seis listados y enriquecimiento fiscal. Sigue **Q04.5.3c**: HTTP sostenido, escrituras controladas, recursos/pool. Q04.5.3/Q04 parciales; mock fiscal e identificadores/idempotencia conservados y APIs bancarias excluidas.

Validación final: Node 24.19.0, npm run verify aprobado: 181 backend, 5 HTTP, 45 frontend, 25 Playwright; build/lint sin advertencias, auditoría producción 0 vulnerabilidades y bundle 474.93 kB dentro de 500 kB. Benchmark anterior repetido: 258 casos/774 planes. Cero bases snapshot/carga restantes. Backend reiniciado, salud e historial frontend HTTP 200 en 3100/4300. git diff --check aprobado; manuales/README actualizados, sin nuevas migraciones operativas.

## Q04.5.3c1 — HTTP con escrituras y pool, 1 de octubre de 2026

Ejecutar después de compilar backend con Node 24:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-http -- --backup=C:\Sistema\.backups\2026-10-01T22-37-06-188Z\database.dump
```

Solo acepta dump existente dentro de .backups. Crea/restaura base propia con nombre validado distinto al operativo y aplica db:check antes de migrar exclusivamente allí. 20000 fixtures por dominio compartidos entre lectores/escritor, búsqueda/indexación real; proyecciones de productos/compras sintéticas como verificadores anteriores. finally cierra servidor/pool/escritor y elimina base; reporte se publica después de limpieza. No nuevas migraciones operativas.

Servidor Nest de prueba con controladores/servicios reales, DTO/configureApp, JWT con repositorio TypeORM y cuenta efímera, RolesGuard/PermissionsGuard. No AppModule/scheduler/integraciones/ThrottlerGuard: no mide rate limiting ni aplicación completa. GET cliente/pagina, proveedores/pagina, producto, cotizacion, compra, venta. Comprueba también 401, DTO inválidos 400 y seis CSV filtrados de 20 filas. Cuenta/secretos aleatorios no aparecen en reporte.

[Reporte](q0453c1-http-load.json): 9403 HTTP con 1250 commits concurrentes, cero errores. Cada commit alterna nombres/descripciones de id=1 en tablas sintéticas, incluidas relaciones/proyecciones. Búsqueda Q04HTTPONLY debe tener total=filas=0 o 1 con snapshot; otros términos mantienen 20000/20 resultados. IDs únicos, página/totalPages correctos, headers requestId/no-store. Tres ventanas de 15 segundos; lectores cerrados esperan respuesta antes de siguiente petición. Fetch/espera por conexión limitados a 5 segundos; SQL a 15 segundos y lock a 2.

| Lectores | HTTP | Commits escritor | p95 ms | Máximo ms | Conexiones pico | Espera pico | RSS pico MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 703 | 382 | 57.104 | 154.424 | 1 | 0 | 185.45 |
| 4 | 3780 | 427 | 57.234 | 160.626 | 4 | 0 | 301.77 |
| 8 | 4920 | 441 | 64.905 | 118.530 | 4 | 4 | 353.97 |

Pool máximo 4 exclusivo de herramienta; escritor usa una conexión externa adicional. Muestras cada 100 ms pueden omitir picos breves. Con 8 lectores se observó cola, sin superar máximo del pool. Cero transacciones ociosas al cierre de cada grupo. CPU, heap/RSS y event loop son del proceso que contiene servidor y generador: crecimiento entre grupos no permite concluir fuga del servidor. Recursos de PostgreSQL no medidos. No cambiar límites operativos con estos resultados ni inferir capacidad máxima/SLA.

Regresión snapshot determinista y guards runtime/repository/no-any aprobados; bases HTTP/snapshot eliminadas, servicios existentes HTTP 200 en 3100/4300. No cambios de aplicación ni nuevas migraciones; no se repiten suites funcionales/UI. Q04.5.3c1 completo como prueba acotada; Q04.5.3c/Q04 parciales. Siguiente **Q04.5.3c2**: esquema/proyecciones relacionales completas, generador separado, recursos PostgreSQL y carga prolongada con flujos transaccionales de escritura y recuperación/snapshots/autovacuum. Mantener restauración/aislamiento y límites explícitos.

## Q04.5.3c2a — tablas/proyecciones reales, 2 de octubre de 2026

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-http -- --relational --backup=C:\Sistema\.backups\2026-10-01T22-37-06-188Z\database.dump
```

Modo adicional del mismo verificador; preserva modo/reporte c1 y guarda [reporte relacional](q0453c2a-http-relational.json). Requiere backend compilado y Node 24. Restauración, validación de migraciones y eliminación siguen aisladas. list-relational-fixtures valida nombre propio/current_database antes de truncar tablas de negocio y dependientes exclusivamente en la copia. Mantiene catálogos, carga 20000 filas por dominio en public con índices/FK/triggers reales, asigna ID con OVERRIDING SYSTEM VALUE y respeta razones sociales únicas. No altera migraciones ni desactiva restricciones. Tablas auxiliares q04_load son fuente de generación; consultas del servidor solo usan public.

Productos/compras ejecutan SQL original sin sustitución de proyecciones. Relaciones cliente/cotización/factura, proveedor/compra, producto/categoría/SAT/equivalentes presentes. Productos devuelven dos rutas de imágenes y un equivalente, SAT no vacío y disponibilidad igual a existencia sin reservas: asserts por página. Solo metadatos de imagen; no archivos ni render. Este dataset no incluye reservas activas, VIN/ESN/OEM/aplicaciones ni cada relación posible.

17631 HTTP y 2455 commits externos; seis dominios/cuatro escenarios y CSV/validación/JWT/headers como c1. En este modo escritor actualiza únicamente tablas public; proveedor determina nombre proyectado de compra. Tres ventanas de 30 segundos, cierre con cero transacciones ociosas y errores.

| Lectores | HTTP | Commits escritor | p95 ms | Máximo ms | Conexiones pico | Espera pico |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1068 | 739 | 63.740 | 103.534 | 1 | 0 |
| 4 | 6926 | 841 | 55.084 | 130.639 | 4 | 0 |
| 8 | 9637 | 875 | 59.090 | 124.671 | 4 | 4 |

Pool/CPU/RSS/event loop siguen incluidos en reporte y con las limitaciones de c1: servidor/generador en mismo proceso, pool 4 exclusivo de herramienta, muestreo puede perder picos y recursos de PostgreSQL pendientes. No inferir mejora por comparación entre sesiones, SLA ni capacidad máxima; 90 segundos no son soak prolongado. Escritor SQL no valida flujos de ventas/compras/pagos.

Node 24.19.0, syntax/prettier, repository/no-any y diff aprobados. Ejecuciones de ajuste por identity/unicidad limpiaron copias; carga final aprobada. Sin cambios de aplicación ni nuevas migraciones operativas; suites funcionales/UI no repetidas. Q04.5.3c2a completo en este alcance; c2/Q04 parciales. Siguiente **Q04.5.3c2b**: separar generador/servidor y métricas PostgreSQL con recuperación/cierre; luego flujos financieros, carga prolongada y snapshots/autovacuum.

## Q04.5.3c2b: generador separado, PostgreSQL y recuperación

- perf:lists-http -- --relational --separate --backup=RUTA_DEL_DUMP separa generador en proceso hijo Node 24 por grupo. JWT solo por IPC, nunca archivo/argumentos/reportes; validación HTTP compartida mediante list-http-contract.js. El padre conserva NestJS, escritor SQL y monitor; CPU/RSS/event loop del generador se reportan aparte. Timeout del hijo = ventana + 15 segundos; fallo/salida detiene carga y permite finally limpiar.
- Métricas PostgreSQL de copia por nombre validado: contadores commit/rollback, blocks hit/read, temp_bytes y deadlocks; muestras de actividad cada 500 ms con sesiones, activas, espera Lock y antigüedad máxima de transacciones. pg_stat_database es acumulado/eventual, no conteo exacto de HTTP; actividad incluye backends auxiliares. No mide CPU/RSS del SO para PostgreSQL, WAL ni costo de autovacuum.
- Modo separado usa 2000 fixtures por dominio, declarados en reporte, y consultas/esquema reales como c2a. Intento con 20000 agotó statement_timeout durante carga de fixtures; base limpiada. Ajustes de tamaño conservaron FK/identity/unicidad y contratos, sin cambiar datos operativos ni desactivar restricciones. No comparar latencias con reportes anteriores de 20000.
- Respaldo existente .backups/2026-10-01T22-37-06-188Z/database.dump restaurado; db:check antes de migrar únicamente en copia. Sin nuevas migraciones. 39146 HTTP válidos y 2551 commits concurrentes, ventanas de 30 segundos para 1/4/8 lectores; CSV filtrado (2 filas), JWT/DTO/headers/IDs, imágenes/SAT/equivalentes/disponibilidad y consistencia comprobados. Reporte independiente [q0453c2b-http-separated.json](q0453c2b-http-separated.json); evidencia c1/c2a preservada.

| Lectores | HTTP | Commits | p95 ms | RSS padre MiB | RSS generador MiB | Muestras PG |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1820 | 788 | 27.705 | 180.86 | 108.39 | 60 |
| 4 | 15597 | 896 | 13.683 | 239.61 | 217.95 | 60 |
| 8 | 21729 | 867 | 19.237 | 242.61 | 221.81 | 61 |

- Cero errores HTTP, deadlocks, delta rollback/temp_bytes y transacciones ociosas al cierre; cero esperas Lock observadas, sin excluir picos entre muestras. Pool no supera 4; sesiones PG incluyen escritor y posibles auxiliares. Antigüedad máxima observada 0.518034 s.
- Caída deliberada --generator-failure termina hijo con 23 y herramienta con 1 esperado. No publica nuevo reporte exitoso; finally cierra servidor/pool/escritor y elimina base. [Recuperación](q0453c2b-recovery.json): cero bases HTTP restantes y verificación de procesos hijos cero. Esto valida limpieza ante fallo del generador, no reinicio/recuperación transaccional de producción.
- Node 24.19.0; prettier/sintaxis, runtime/repository/no-any y git diff --check aprobados. Cambios solo en herramientas/documentación: sin repetir suites funcionales/UI ni reiniciar aplicación. Se conserva fiscal mock, identificadores/idempotencia, datos de prueba y exclusión bancaria.
- Q04.5.3c2b completo en este alcance; c2/Q04 parciales. Siguiente Q04.5.3c2c: flujos transaccionales de negocio concurrentes y recuperación/idempotencia en copia; después carga prolongada, snapshots/autovacuum y recursos PostgreSQL del SO. 90 segundos con escritor SQL no certifican SLA/capacidad ni todos los procesos financieros.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-http -- --relational --separate --backup=C:\Sistema\.backups\2026-10-01T22-37-06-188Z\database.dump
# Fallo deliberado: código 1 esperado; verificar limpieza, no usar como ejecución exitosa.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run perf:lists-http -- --relational --separate --generator-failure --backup=C:\Sistema\.backups\2026-10-01T22-37-06-188Z\database.dump
```

## Q04.5.3c2c1: transacciones reales de abastecimiento

- Contrastados manual/rutas, servicio y triggers PostgreSQL. Se detectaron dos fallos: lectura de request_id anterior a locks permite carrera de inserción (23505); UPDATE directo de existencia genera ajuste manual del trigger además del movimiento explícito de recepción/devolución. No se consideran capacidades nuevas: correcciones de integridad en flujos existentes.
- AbastecimientoService toma advisory lock transaccional por operación/requestId normalizado antes de consultar repetición en solicitud, orden, recepción, costo y devolución. Se libera con commit/rollback. Conserva UUID técnicos y contratos existentes. No incorpora fingerprints del payload: reutilizar clave con contenido diferente sigue pendiente de revisión.
- Nueva 085_kardex_movimiento_gestionado.sql conserva auditoría de cambios de precio y ajustes manuales. Solo omite ajuste automático cuando app.stock_movement_managed indica movimiento explícito. updateStock de abastecimiento establece indicador local, actualiza existencia y restaura valor previo; continúa sincronización física de 057 y registro explícito. No desactiva triggers. No corrige movimientos duplicados históricos ni otros servicios que escriben existencia directamente.
- Respaldo nuevo .backups/2026-10-02T17-25-50-266Z/database.dump creado y legible. Restaurado en base propia; db:check antes de db:migrate allí y pruebas aprobadas. Después db:check operativo (revertido) y db:migrate: 085 aplicada. Migraciones anteriores intactas.
- Nuevo npm run perf:business-concurrency -- --backup=RUTA_DEL_DUMP. Base propia validada distinta de operación, servicio TypeORM/PostgreSQL real y fixtures pequeños con restricciones existentes. Control sin advisory lock fuerza dos lecturas de inexistencia: un éxito/un 23505. Con corrección, ocho llamadas simultáneas por cada solicitud/orden/recepción/costo/devolución devuelven un solo ID/efecto.
- Fallo controlado P0001 antes del detalle, después de modificar stock/Kardex: rollback revierte recepción, cantidad recibida, producto, ubicaciones y Kardex; misma clave reintentada ocho veces confirma una sola operación. Dos recepciones distintas que excederían pendiente: un éxito y un 400, sin sobreentrada. Cuatro recepciones suman 10 unidades; reintento tras cerrar orden no duplica. Costo de 3 en primera recepción de 3 aumenta costo unitario de 10 a 11 una vez; devolución de 1 deja stock 9, recibido 10, cuatro recepciones y cinco movimientos nuevos. UPDATE manual posterior de stock/precio agrega los dos movimientos correspondientes y ubicaciones siguen alineadas.
- [Reporte](q0453c2c1-business.json): cero transacciones ociosas; base eliminada antes de publicarlo. Fixtures fallidos por longitud y control inicial de Kardex también limpiaron copias. Build/lint, 181 backend y 5 HTTP aprobados; Node 24.19.0, runtime/repository/no-any, sintaxis/prettier de herramienta y git diff --check aprobados. Sin cambios frontend; no repetir suites UI. No había backend escuchando en 3100 al finalizar comprobación de migración; no se afirma validación HTTP del flujo empresarial.
- Q04.5.3c2c1 completo para abastecimiento y estos escenarios; c2c/Q04 parciales. Sigue Q04.5.3c2c2: ventas/pagos y auditoría de otros cambios directos de stock, rechazo de reintentos con payload distinto; luego carga prolongada con lecturas/escrituras, snapshots/autovacuum y recursos PostgreSQL. No prueba HTTP de abastecimiento, backorders concurrentes, interrupción física PostgreSQL ni PAC. Mantiene fiscal mock, identificadores/idempotencia, datos de prueba y exclusión bancaria.

## Q04.5.3c2c2a: reintentos de cobros de clientes

- Contrastados RegistroVentaService/CompraService, CobranzaService, DTO, servicio frontend y manuales. Venta/compra ya consultan huella y resultado de idempotencia: no se vuelven a declarar faltantes. Cobro simple bloqueaba factura para saldo pero no identificaba reintento, por lo que podía registrar otro pago válido después de pérdida de respuesta.
- RegistrarPagoDto y PagoDto frontend admiten requestId opcional UUID. CobranzaService serializa por clave normalizada mediante advisory lock y consulta operation_idempotency antes de validar saldo; permite recuperar respuesta de factura ya liquidada. Huella SHA-256 de campos explícitos (factura/importe/forma/referencia/notas) con opcionales vacíos normalizados; independiente del orden de propiedades. Misma clave con factura/importe distintos devuelve 409. Registro de pago/caja/saldo y resultado de idempotencia comparten transacción. Sin clave conserva compatibilidad previa y no adquiere protección contra duplicados.
- Sin nuevas tablas/migraciones: reutiliza 030. Frontend cambia solo tipo de payload; no incorpora formulario, generación automática ni persistencia de claves. Quien integra API debe conservar clave y datos en el reintento, y usar una clave nueva para un pago nuevo. REP/pagos a proveedores y fingerprints de abastecimiento siguen pendientes de revisión específica.
- Nuevo npm run perf:payment-concurrency -- --backup=RUTA_DEL_DUMP. Respaldo existente .backups/2026-10-02T17-25-50-266Z/database.dump restaurado en base propia validada/distinta a operación, db:check antes de migrar allí; servicio TypeORM/PostgreSQL real. Ocho llamadas equivalentes con distinto orden de propiedades/UUID mayúsculas producen un solo pago; misma clave con importe/factura distintos 409 sin cambiar caja/saldo.
- Fallo P0001 al guardar resultado, después del registro financiero: rollback revierte pago, caja, saldo y clave; misma clave reintentada ocho veces confirma una vez. Pagos concurrentes distintos de 45 contra saldo 80: un éxito y un 400. Reintento tras liquidar factura devuelve pago existente. Resultado final: saldo 0, cuatro pagos efectivos e incremento de caja 100, cero transacciones ociosas; base eliminada antes de [reporte](q0453c2c2a-payments.json). Prueba de métodos, no HTTP del flujo de cobro ni recuperación física de PostgreSQL.
- db:verify también agrega db:check antes de migrar copia. Regresión real integral aprobada: caja, ventas/compras idempotentes, devoluciones, NC/REP, fiscal mock, pedidos/backorder, abastecimiento, cuenta por pagar y tesorería local; base eliminada. Este verificador aporta regresión existente, no certifica toda concurrencia/carga de esos módulos. Ninguna escritura financiera operativa ni nueva migración operativa.
- Verificación: Node 24.19.0, build backend/frontend, lint sin advertencias, 181 backend y 5 HTTP autenticación aprobados; bundle 474.93 kB dentro de 500 kB. Runtime/repository/no-any, sintaxis/prettier y git diff --check aprobados. Sin cambios visuales; suites UI no repetidas ni servicios reiniciados.
- Q04.5.3c2c2a completo en este alcance; c2c2/Q04 parciales. Sigue Q04.5.3c2c2b: auditar otros cambios directos de stock, reintentos con contenido distinto en abastecimiento/REP y consumidores de API; después carga prolongada con flujos reales y snapshots/autovacuum. Conservar datos de prueba, fiscal mock, UUID/idempotencia y exclusión de conexiones bancarias.

## Q04.5.3c2c2b1: huella de reintentos de abastecimiento

- Contrastados README/manuales, servicio/DTO/controlador de abastecimiento, RegistroRepService y actualizaciones directas de almacén/garantías. Abastecimiento tenía locks pero devolvía el ID por UUID sin contrastar datos/documento. REP aún no integra requestId; almacén/garantías mantienen UPDATE directo seguido de Kardex explícito para revisión posterior. No se declaran esos dos últimos resueltos.
- transactionRequest engloba cinco operaciones (solicitud/orden/recepción/costo/devolución). Advisory lock transaccional previo a consulta, huella SHA-256 de campos explícitos con defaults/opcionales normalizados, propiedades canónicas y partidas ordenadas por ID. Documento asociado incluido en recepción/costo. Reutiliza operation_idempotency de 030 para guardar tipo/actor/huella/respuesta dentro de la misma transacción que el negocio. Reintento equivalente devuelve respuesta original; cambio de contenido, documento o tipo de operación devuelve 409 antes de efectos. UUID mayúsculas y orden de propiedades equivalentes admitidos.
- Compatibilidad histórica explícita: si existe registro de negocio con esa clave pero sin huella almacenada, devuelve 409 indicando consultar original. No reconstruye ni inventa huella desde datos que pudieron cambiar; no debe enviarse una clave nueva para duplicar una operación ya registrada. Registros históricos conservados, sin reparación ni borrado operativos. Misma clave no puede compartirse entre tipos de operación.
- Nuevo npm run perf:supply-payload -- --backup=RUTA_DEL_DUMP; preserva verificadores/reportes previos y publica [q0453c2c2b1-supply-payload.json](q0453c2c2b1-supply-payload.json). Respaldo existente .backups/2026-10-02T17-25-50-266Z/database.dump restaurado en base propia validada/distinta a operación; db:check antes de migrar allí. Sin nuevas migraciones ni cambios de datos operativos.
- Prueba real TypeORM/PostgreSQL: ocho reintentos en cada una de cinco operaciones, control de carrera 23505 sin lock, contenido distinto en los cinco tipos, documento distinto en recepción/costo/devolución y UUID cruzado entre tipos: 409 sin cambios de stock/Kardex. Reordenar propiedades/UUID mayúsculas conserva ID. Simulación de registro histórico eliminando solo huella en copia: 409, registro original intacto y ninguna huella nueva creada.
- Conserva pruebas de rollback de stock/Kardex/ubicaciones, reintento tras fallo, recepción concurrente que excedería pendiente, cierre de orden, costo/devolución únicos y auditoría manual stock/precio. Final: recibido 10, devolución 1, stock 9, cuatro recepciones y cinco movimientos nuevos; cero transacciones ociosas. Base eliminada antes de reporte. db:verify integral aprobada y copia eliminada. No prueba HTTP/UI, backorders concurrentes ni caída física de PostgreSQL/PAC.
- Build backend y lint aprobados; 181 backend/5 HTTP autenticación, Node 24.19.0, runtime/repository/no-any, sintaxis/prettier de herramienta y git diff --check aprobados. Sin cambios frontend: suites UI no repetidas, servicios no reiniciados.
- Q04.5.3c2c2b1 completo en este alcance; c2c2b/Q04 parciales. Sigue Q04.5.3c2c2b2: reintentos de REP y consumidores, auditoría/corrección de movimientos gestionados en almacén/garantías y demás servicios; después carga prolongada con flujos reales, snapshots/autovacuum y recursos PostgreSQL. Se mantienen fiscal mock, datos de prueba, UUID/idempotencia y exclusión bancaria.

## 2026-10-02 — Q04.5.3c2c3a: concurrencia de almacén y carga mixta acotada

- Contrastados README, manual de almacén/rendimiento, rutas/controlador/DTO, AlmacenService y tablas existentes. Transferencias, conteos directos/capturados y kits consultaban requestId antes de locks y no comparaban contenido. No se añade otro módulo: se protegen operaciones existentes.
- Cuatro operaciones usan bloqueo transaccional por UUID normalizado antes de consulta, SHA-256 de campos explícitos y respuesta en operation_idempotency. Conteos normalizan notas/defaults y ordenan partidas por producto; kit incluye documento y Armado/Desarmado. Misma clave/datos devuelve respuesta original; cambio de contenido/documento/tipo produce 409. Claves históricas sin huella producen 409 para consultar original: no se inventa huella ni se borran registros. Cambios de negocio y resultado idempotente comparten commit/rollback.
- Conteos directos/autorizados bloquean todos los productos por ID antes de ubicaciones; transferencias bloquean producto antes de ubicaciones ordenadas y validan que existan ambas. Esto evita leer cantidad física antes de esperar el producto, reduce inversión de locks y protege ubicaciones inicialmente vacías. Guardado de composición y movimiento de kit comparten advisory lock por kit para evitar editar composición durante armado/desarmado. No garantiza ausencia de cualquier interbloqueo en toda la aplicación.
- Nuevo comando `perf:warehouse-concurrency -- --duration=120 --backup=RUTA_DEL_DUMP`; acepta 5–600 segundos y usa 120 por defecto. Base propia restaurada, comprobación de migraciones previa a aplicar 085 exclusivamente en copia; ninguna migración nueva ni cambio operativo. Copia eliminada antes del [reporte](q0453c2c3a-warehouse.json).
- Validación real: ocho reintentos simultáneos en los cuatro flujos, UUID mayúscula/propiedades equivalentes, conflictos por datos/documento/tipo; dos aprobaciones concurrentes producen un éxito/un 409. Fallo al guardar idempotencia después de movimientos en transferencias/conteos/kits revierte ubicaciones, stock y Kardex. Reintento de transferencia vuelve a confirmar una sola vez. Carrera conteo/kit conserva existencia física/global. Se mantienen Kardex único y auditoría manual.
- Carga: dos escritores (transferencias y armado/desarmado), cuatro lectores de snapshots REPEATABLE READ READ ONLY y muestreo PG cada segundo, pool 8. En 121 s: 183515 lecturas y 32548 movimientos; p95 combinado 7.43 ms (servicios/lecturas, no HTTP). Cero diferencias de snapshots, interbloqueos o transacciones ociosas al finalizar. Máximos observados: 8 conexiones, 1 en espera Lock, 5.84 s de antigüedad transaccional, 3995 tuplas muertas estimadas y 28 autovacuum acumulados de tablas de la copia. Estadísticas PG eventuales; no son umbrales ni SLA. Pico RSS del proceso de prueba 240.0 MiB.
- Node 24.19.0: build backend, lint sin advertencias, 181 pruebas backend y cinco HTTP autenticación aprobados; db:verify integral aprobado con copia eliminada. Runtime/repository/no-any/git diff --check aprobados. Sin cambios frontend, no se repiten suites visuales ni se afirma HTTP de almacén.
- Q04.5.3c2c3a completo en este alcance; Q04/c3 parciales. Sigue Q04.5.3c2c3b: integrar flujos reales en carga HTTP sostenida de los seis listados, generador separado, recursos del proceso PostgreSQL/IO/WAL y snapshots/autovacuum con volumen representativo. Esta prueba usa dos productos y generador/lectores en un mismo proceso; no certifica capacidad empresarial, todos los procesos financieros ni caída física PostgreSQL/PAC. Consumidores deben conservar clave y contenido ante respuesta incierta; persistencia frontend de reintentos de almacén no añadida en esta sesión. Se mantienen fiscal mock, datos de prueba y exclusión bancaria.

## Herramienta Q04.5.3c2c3b: HTTP con negocio y recursos

`npm run perf:business-http -- --backup=RUTA_DEL_DUMP` restaura una copia propia, comprueba migraciones antes de aplicarlas allí y prepara seis dominios con proyecciones reales. Por defecto: 20000 registros por dominio, 120 segundos por grupo de 4/8 lectores HTTP en hijo separado; `--duration=` admite 5–600 s y `--fixtures=` admite múltiplos de 1000 entre 1000–100000. `--generator-failure` provoca una caída del generador para verificar limpieza, no publica un reporte de éxito. No usar contra la base operativa: el programa solo acepta bases que crea con nombre validado.

Un escritor SQL modifica nombres para comprobar la consistencia de total/página. Otro realiza transferencias de ida/vuelta, armado/desarmado y cobros de 0.01 por HTTP con JWT y controladores/servicios reales. Reintentos conservan clave y se verifica el mismo ID. Al finalizar cada grupo se contrastan producto/ubicaciones y abonos/saldo/caja, además de errores, contratos de los seis listados y transacciones ociosas.

El muestreo PostgreSQL incluye actividad/locks/contadores por base y tuplas/autovacuum de tablas públicas. CIM Windows recoge CPU/working set/bytes transferidos de procesos asociados a la copia, con muestras no disponibles explícitas y protección ante reutilización de PID. La consulta Windows es asíncrona. Working sets sumados cuentan páginas compartidas; I/O de proceso puede incluir red y no equivale a acceso físico al disco. WAL se mide por LSN global del cluster, por lo que puede incluir otras bases. No se cambian autovacuum, configuración del cluster ni servicios productivos.

Servidor Nest de prueba: no AppModule completo, scheduler, integraciones ni ThrottlerGuard. Imágenes se comprueban como metadatos; volumen sintético y caché caliente. No es certificación de SLA, todos los procesos financieros ni soak de horas. Reporte de cada ejecución exitosa: `q0453c2c3b-http-business.json`, publicado después de eliminar copia.

### Resultado sostenido de esta sesión

| Lectores | Consultas HTTP | p95 ms | Operaciones de negocio | Reintentos |
| --- | --- | --- | --- | --- |
| 4 | 22813 | 60.88 | 6595 | 396 |
| 8 | 36189 | 61.34 | 3905 | 236 |

59002 consultas, 10500 operaciones y 632 reintentos sin diferencias de negocio. [Reporte](q0453c2c3b-http-business.json). Caída del generador verificada: copia eliminada y reporte de éxito previo conservado. Ver README para alcance y siguiente fase c3c.

## Herramienta Q04.5.3c2c3c: AppModule y mezcla financiera

`npm run perf:full-app -- --backup=RUTA_DEL_DUMP` usa 20000 fixtures por dominio y ventana HTTP de 300 segundos por defecto. `--duration=` admite 40–600 segundos; `--fixtures=` admite múltiplos de 1000 entre 1000–100000. Ocho lectores en hijo separado esperan 1500 ms entre consultas. El escritor HTTP espera 2000 ms entre ciclos para respetar ThrottlerGuard. La prueba conserva guards, permisos, scheduler, módulos y configuración de pool de AppModule. Fiscal mock fijado explícitamente y URL de base propia validada antes de los flujos.

Antes del tráfico se verifican JWT/401, validación/400, CSV de seis dominios, dos jobs registrados, ejecución del job interno de notificaciones y 429 por ráfaga al health. La ráfaga no comparte la clave del limitador con listados o escrituras. La prueba no desactiva ni aumenta el limitador.

Cada aproximadamente 20 s, verifyOperations con financialOnly verifica compra/venta, cobros/REP, reversos/NC, fiscal mock, pedidos/backorders/abastecimiento y cuentas de proveedor mediante servicios reales sobre DataSource de aplicación. El modo completo anterior permanece por defecto y conserva la regresión de tesorería local. Los escritores de caja se coordinan para aislar deltas; las lecturas HTTP y las mutaciones SQL de nombres permanecen concurrentes. No es prueba de carreras entre todos los escritores financieros.

Los nuevos documentos hacen crecer algunos totales de búsqueda: el contrato de esta herramienta acepta ese crecimiento, valida IDs únicos y tamaño de página/totalPages y mantiene la cantidad conocida para términos estáticos. Imágenes de fixtures originales verificadas como metadatos, nuevos productos admiten arreglo vacío. No se simulan archivos de producto.

Reporte exitoso tras cerrar AppModule (incluido scheduler) y eliminar copia: `q0453c2c3c-full-app.json`. Limita la afirmación a esta mezcla, volumen sintético y ventana de minutos, con fiscal mock y NODE_ENV=test; no certifica SLA, producción fiscal ni soak de horas. Recursos conservan las limitaciones de CIM/working set/I/O de proceso y WAL global descritas en c3b.

### Resultado de Q04.5.3c2c3c

1567 consultas HTTP, 15 ciclos financieros y 720 operaciones HTTP de negocio; p95 65.10 ms. Sin desajustes de inventario/saldo/caja, interbloqueos o transacciones ociosas finales. [Reporte](q0453c2c3c-full-app.json) y [referencia agregada de volumen](q0453c2c3c-volume-baseline.json). El verificador anterior completo pasó de nuevo; la nueva opción financiera no lo reemplaza. Límites y siguiente fase c3d en README.

## Q04.5.3c2c3d1: separar clientes y auxiliares

`perf:full-app -- --backup=RUTA_DEL_DUMP --duration=40 --fixtures=1000 --transaction-breakdown` publica `q0453c2c3d1-transaction-age.json`, sin reemplazar evidencia c3c. El monitor compartido añade maxClientTransactionAgeSeconds, maxAuxiliaryTransactionAgeSeconds y maxAutovacuumTransactionAgeSeconds, además de clientConnections y auxiliaryConnections. Conserva maxTransactionAgeSeconds global.

Client backend incluye conexiones de aplicación, escritor y medición; no equivale exclusivamente a HTTP. Autovacuum worker está incluido en auxiliares. Los máximos independientes no se suman; son observaciones cada 500 ms, no latencias HTTP ni máximos absolutos entre muestras. clock_timestamp puede diferir unos microsegundos entre agregados.

Contrato SQL ejecutado en PostgreSQL contra filas deterministas: separa tipos, excluye otra base y devuelve cero para grupos vacíos. Carga final de 40 s/1000 fixtures: 216 lecturas, p95 58.78 ms, dos ciclos financieros por servicios y cero errores/interbloqueos/transacciones ociosas finales. Ver README para cifras y límites. c3d sigue parcial: flujos financieros HTTP y perfiles/soak permanecen pendientes.

## Q04.5.3c2c3d2: recorridos financieros por HTTP

`npm run perf:financial-http -- --backup=RUTA_DEL_DUMP --duration=120 --fixtures=20000` conserva el servidor completo y las métricas de c3d1. Publica `q0453c2c3d2-financial-http.json`, sin sustituir los reportes c3c/c3d1. Mantiene los límites duration 40–600 y fixtures 1000–100000 en múltiplos de 1000; el valor por defecto es 300 s/20000 filas.

Cada ciclo crea un producto aislado y ejecuta por HTTP: compra en efectivo, venta PPD, REP, pedido confirmado/surtido/entregado/facturado, solicitud autorizada, orden de compra y recepción. SQL solo prepara fixtures y comprueba efectos, no reemplaza esas operaciones. Los escritores de caja se coordinan; lectores y mutaciones de nombres siguen concurrentes. No certifica carreras entre todos los escritores financieros.

Verifica 401 en cinco entradas financieras, 400 de DTO inválido, 403 con permisos explícitamente denegados de venta/autorización/recepción, cinco reintentos que recuperan IDs originales y cuatro conflictos 409 de contenido. Las denegaciones se aplican exclusivamente al usuario temporal en la copia y se eliminan en finally. Compra, REP y pedido no tienen todos una política explícita por operación; esta prueba respeta la autorización existente y no afirma controles ausentes.

Comprueba inventario global/físico, cantidad recibida, caja y saldo de factura. El REP se reintenta después de liquidar. No amplía cobertura de NC/reversos/cuentas proveedor de la regresión integral, ni pruebas visuales, PAC o recuperación física. Fiscal mock y exclusión bancaria conservados.

`npm run perf:financial-http-failure -- --backup=RUTA_DEL_DUMP` provoca la caída del generador y verifica eliminación de copia y preservación del reporte exitoso financiero. Ejecutar sin otra prueba de copia concurrente para comparar correctamente el inventario de bases temporales antes/después. Resultados de la sesión en README.

## Q04.5.3c2c3d3: perfiles y objetivos locales

`npm run perf:profile -- --profile=mostrador|operaciones|soak --backup=RUTA_DEL_DUMP` activa recorridos financieros HTTP y AppModule completo. Cada ejecución publica un reporte separado `q0453c2c3d3-NOMBRE.json` después de cerrar servidor/scheduler y eliminar copia. No reemplaza evidencia c3c/c3d1/c3d2. No aumenta el pool ni desactiva el limitador.

| Perfil | Lectores | Pausa de lectura | Pausa almacén/cobro | Pausa financiera | Pausa SQL | Ventana predeterminada |
| --- | --- | --- | --- | --- | --- | --- |
| mostrador | 4 | 1500 ms | 3000 ms | 30 s | 60 ms | 120 s |
| operaciones | 8 | 1500 ms | 2000 ms | 20 s | 30 ms | 120 s |
| soak | 8 | 2000 ms | 3000 ms | 30 s | 60 ms | 600 s |

`--duration=` permite 40–3600 s con perfil; sin perfil conserva 40–600 s. `--fixtures=` conserva 1000–100000 filas por dominio en múltiplos de 1000, predeterminado 20000. Las pausas se agregan al tiempo de cada operación: carga cerrada, no tasas garantizadas ni patrón medido de clientes reales. El perfil soak admite ventana corta para diagnóstico; esa ejecución no demuestra duración prolongada.

Objetivos provisionales de regresión local: p95 global de lectura HTTP ≤500 ms, p95 del event loop del padre ≤100 ms y crecimiento de RSS medio ≤128 MiB entre el primer y último cuarto de muestras. Debe haber lecturas, commits SQL y ciclos financieros; también se exige integridad sin errores/interbloqueos/transacciones ociosas finales. Cada ventana conserva los 24 casos de contrato. Objetivos no son SLA productivo ni garantía de ausencia de fugas. Memoria del padre incluye aplicación, escritores y monitor; proceso lector separado conserva sus métricas propias. Promedios no sustituyen tendencia de horas ni memoria de PostgreSQL.

Resumen de lecturas por minuto con cantidad y p95; el último bloque puede ser parcial. Estos percentiles ayudan a observar variaciones, mientras el criterio de aprobación es global. Progreso de escritor/ciclos/RSS cada minuto. Estadísticas PostgreSQL mantienen separación cliente/auxiliares/autovacuum y límites de recursos/WAL ya documentados.

`npm run perf:profiles` verifica selección y rechazo de perfiles desconocidos, umbrales de latencia/event loop/memoria y falta de actividad. `npm run perf:profile-failure -- --profile=mostrador --backup=RUTA_DEL_DUMP --objective-failure` inyecta un p95 fallido deliberado exclusivamente para verificar exit 1, cierre/limpieza y preservación del reporte previo; sin objective-failure provoca caída del generador. Las pruebas de limpieza deben correr sin otra copia de carga concurrente.

Ver README para resultados reales y limitaciones. Perfiles no representan capacidad máxima ni simulación de toda la jornada del negocio; fiscal mock, coordinación de escritores de caja y exclusión bancaria se mantienen.

### Resultados de la sesión del 2 de octubre de 2026

Mostrador y operaciones: ventanas de 40 s/1000 fixtures, 108/208 lecturas y p95 60.89/57.21 ms. Soak: 600 s/20000 fixtures, 2360 lecturas, 19 recorridos financieros HTTP, p95 68.26 ms, event loop p95 34.37 ms y crecimiento medio RSS 57.19 MiB. Todos los objetivos provisionales aprobados, sin errores/interbloqueos/transacciones ociosas finales. [Reporte soak](q0453c2c3d3-soak.json). Soak conserva resumen por minuto; mostrador se ejecutó antes de incorporar ese resumen.

Primer intento soak falló por timeout de preparación y limpió la copia; segundo completó la ventana sin elevar timeout. Fallo de objetivo mostrador y caída del generador soak verificaron exit 1, limpieza y preservación de reportes previos. No confundir preparación/drenado con ventana HTTP ni diez minutos con una jornada/soak de horas. NC/reversos/cuentas proveedor siguen pendientes de ampliar a HTTP; son capacidades existentes.

## Q04.5.3c2c3d4: NC, devoluciones y cuentas de proveedor por HTTP

`npm run perf:reversals-http -- --backup=RUTA_DEL_DUMP --duration=120 --fixtures=20000` amplía los recorridos de c3d2 y publica `q0453c2c3d4-reversals-http.json`; conserva reportes anteriores. Mantiene límites sin perfil (40–600 s), AppModule/guards/scheduler/limitador, fiscal mock y copia propia. `perf:reversals-http-failure` verifica caída del generador, limpieza y preservación del reporte previo.

Cada ciclo devuelve tres unidades por separado y comprueba reembolsos 3.33/3.34/3.33, rechaza devolver más de lo vendido, crea/reintenta NC y bloquea cancelar origen con NC activa. Cancela primero NC y luego origen; inventario y caja de ese recorrido quedan restaurados.

Proveedor: factura conciliada con orden/recepción sin nueva entrada de inventario, aprobación, anticipo de 1 en efectivo, nota de 1 y pago de 2 para liquidar total 4. Reintentos recuperan IDs. Cancelar con pago activo produce 409; revierte pago, rechaza segunda reversión 409 y cancela factura con repetición segura. Saldo final cero, pago Revertido, anticipo/nota disponibles, cuatro pólizas relacionadas canceladas. Anticipo liberado queda disponible y no reembolsa caja: delta esperado −1 por ciclo, comprobado y separado de los cobros del escritor.

401/400 en entradas financieras adicionales y 403 con denegaciones explícitas de permisos en ventas y proveedor. No certifica carreras concurrentes ni rechazo de payload distinto para UUID de proveedor: sus servicios actuales consultan request_id y devuelven ID previo sin huella del contenido. Ese endurecimiento es pendiente técnico, no funcionalidad ERP ausente.

La prueba detectó IDs bigserial de proveedor serializados como texto e incompatibles con DTO/frontend numéricos. La respuesta JSON de CuentasProveedorController normaliza IDs anidados a enteros seguros, conserva importes/fechas/archivos y rechaza pérdida de precisión. No cambia tipos/tablas ni el parser global de PostgreSQL. Ver README para resultados, migraciones y límites.

Resultado c3d4: ventana final 120 s/20000 fixtures, 624 lecturas, seis recorridos ampliados y p95 74.16 ms. Sin errores/interbloqueos/transacciones ociosas finales; 184 pruebas backend y cinco HTTP autenticación aprobadas. Ver README para límites, corrección numérica de IDs y siguiente fase de reintentos de proveedor.

## Q04.5.3c2c3d5: concurrencia de reintentos de proveedor

`npm run perf:supplier-retry-http -- --backup=RUTA_DEL_DUMP --duration=120 --fixtures=20000` amplía los recorridos de reversos en una copia propia con AppModule/JWT/guards. Publica `q0453c2c3d5-supplier-retry.json` después de eliminar la copia. Ocho solicitudes simultáneas por factura/anticipo/nota/pago deben retornar el mismo ID; UUID en mayúsculas recupera la respuesta y cambios de contenido u operación devuelven 409.

Incluye fallo deliberado en el INSERT final de respuesta del pago: verifica rollback de caja, saldo y pago, retira el trigger de prueba y reintenta. También comprueba rechazo de nota histórica sin huella. Triggers y fixtures existen solo en la copia. `perf:supplier-retry-failure` verifica limpieza y conservación del reporte ante caída del generador.

La preparación inserta facturas y productos en lotes de 1000, conservando transacción, triggers, restricciones y timeout de 120 segundos por sentencia. No certifica capacidad productiva, PAC, pruebas de horas ni recuperación física. Ver README para resultados confirmados.

Resultado del 3 de octubre: 120 s, 20000 fixtures por dominio, 626 lecturas, 2866 commits y p95 72.52 ms; seis ciclos financieros con rollback/reintento y rechazo histórico aprobados. Caída del generador: copia eliminada y reporte preservado. Q04.5.3c2c3d5 completo en este alcance; Q04 sigue parcial.

## Q04.5.3c2c3d6: documentos de proveedor

`npm run perf:documents-http -- --backup=RUTA_DEL_DUMP --duration=120 --fixtures=20000` agrega a c3d5 casos de resguardo/descarga PDF multipart y XML ingresado por HTTP, bytes/hashes/MIME/disposición y rechazos 400/401/403/404/413. Publica `q0453c2c3d6-documents-http.json` solo después de eliminar la copia. `perf:documents-http-failure` comprueba limpieza y preservación del reporte frente a caída del generador. No mide renderizado, análisis antivirus ni autenticidad fiscal. Conserva los límites de carga local y la coordinación de escritores de caja.

Resultado del 3 de octubre: 120 s/20000 fixtures, 632 lecturas, 3029 commits y p95 62.74 ms, sin errores; seis ciclos documentales/financieros aprobados. Copia eliminada y fallo del generador validado sin sustituir reporte exitoso. Siguiente alcance: documentos comerciales existentes de ventas/cotización/REP/fiscal mock.

## Q04.5.3c2c3d7: documentos comerciales

`npm run perf:commercial-documents-http -- --backup=RUTA_DEL_DUMP --duration=120 --fixtures=20000` conserva c3d6 y agrega ticket/cotización/REP PDF, XML REP borrador condicionado a factura timbrada y XML fiscal mock de factura/REP. Verifica firma/EOF/contrato, igualdad con XML resguardado, reintento estable y errores 400/401/403/404. Publica `q0453c2c3d7-commercial-documents.json` tras eliminar la copia. `perf:commercial-documents-failure` valida limpieza y preservación del reporte. No certifica renderizado, PAC, XSD, SLA ni recuperación física.

Resultado c3d7 del 3 de octubre: 120 s/20000 fixtures, 624 lecturas de listados, 2694 commits, p95 64.53 ms y seis ciclos documentales/financieros, cero errores y copia eliminada. Build/lint y 187 pruebas backend/42 suites más cinco HTTP autenticación aprobados. Ver README para limpieza ante fallo y límites.

## Q04.5.3c2c3d8: soak ampliado

`npm run perf:extended-soak -- --backup=RUTA_DEL_DUMP --fixtures=20000` ejecuta 3600 s de carga con perfil soak y recorridos documentales/financieros, sobre copia propia. Conserva el perfil anterior de 600 s y reportes anteriores; publica `q0453c2c3d8-extended-soak.json` únicamente tras limpiar la copia y aprobar objetivos. Overrides de duración para pruebas cortas no equivalen a evidencia de una hora.

Conserva umbrales provisionales y exige tráfico/p95 por minuto y duración efectiva. `perf:extended-soak-failure` comprueba caída del generador; añadir `--objective-failure` prueba incumplimiento deliberado de objetivo. Ambas ejecuciones cortas deben eliminar la copia y conservar el reporte anterior. Resultados finales en README. No certifica SLA, fuga de memoria, días de operación, PAC ni recuperación física.

Resultado c3d8 del 3 de octubre: 3600 s programados, ventana/cierre 3607.33 s, 14173 lecturas, 50290 commits, 108 ciclos, p95 56.78 ms y event loop p95 34.57 ms. Cobertura de 60 minutos esperados y objetivos aprobados. Crecimiento RSS medio 73.62 MiB; no certifica ausencia de fuga. 61 buckets incluyen tramo parcial final; peor p95 de bucket 79.58 ms. Copia eliminada; limpieza ante fallo se registra en README.

Limpieza c3d8 aprobada tanto ante caída del generador como ante objetivo deliberadamente incumplido: copias eliminadas y reporte de la hora preservado exactamente. Próximo diagnóstico amplía RSS/heap pico existentes con series por tramo de memoria interna/externa del proceso servidor/cliente; el crecimiento observado no se atribuye todavía a la aplicación.

## Q04.5.3c2c3d12: diagnóstico dirigido de transporte

5 de octubre de 2026. `localLoadFetch` registra etapa headers y `readLoadBody` etapas body-json/text/arrayBuffer, con método/ruta/tipo/código. Sin query, cuerpo, headers ni reintentos. WeakMap asocia contexto con la respuesta sin retenerla; IPC conserva diagnóstico del hijo y el reporte parcial agrega origen del escritor y tiempo. Se corrige falta de contexto en lectura de cuerpos; no se declara corregida la causa histórica desconocida.

```powershell
node backend/scratch/verify-load-transport.js
node backend/scratch/verify-full-app-load.js --transport-probe --separate-financial-client --profile=soak --duration=120 --fixtures=1000 --backup=RUTA_DEL_DUMP
node backend/scratch/verify-full-app-failure.js --transport-probe --transport-failure --separate-financial-client --profile=soak --backup=RUTA_DEL_DUMP
```

Comandos npm: `perf:controlled-transport`, `perf:transport-probe`, `perf:transport-probe-failure`. Node 24; AppModule compilado para prueba ERP. Restaurar respaldo y comprobar/aplicar migraciones solamente en copia; ejecutar controles de fallo secuencialmente con respecto a otras cargas aisladas.

Servidor HTTP loopback sin DB: cortes deliberados antes de headers y durante lectura JSON/texto/binario, JSON inválido, timeout y respuesta posterior correcta. Una solicitud por ruta, sin reintentos. Cierre de servidor/conexiones antes de escribir `q0453c2c3d12-controlled-transport.json`. UND_ERR_SOCKET observado en cortes de prueba; no prueba que sea el código del incidente anterior.

El contrato de lectores concurrentes también usa estos helpers; se probó contra cuerpo truncado con headers de contrato para comprobar body-json y omisión del término de consulta. Esta comprobación es de transporte controlado, no una consulta real de negocio ni una repetición del probe ERP de 120 s.

Probe ERP de 120 s/1000 fixtures: 472 lecturas, 1684 commits, cuatro ciclos financieros, p95 58.33 ms y event loop p95 34.64 ms. Objetivos e integridad aprobados; copia eliminada. Cada ciclo agrega doce cargas de 10 MiB+1 rechazadas con 413 y comprueba PDF/XML posteriores; 48 rechazos adicionales y 96 descargas íntegras. Datos sintéticos y fiscal mock; no valida renderizado ni autenticidad fiscal. Evidencia `q0453c2c3d12-transport.json`. No se reprodujo fallo espontáneo en esta ventana; no sustituye soak prolongado.

Control `--transport-failure`: ruta efímera de respuesta truncada únicamente en AppModule de prueba, habilitada por flag que requiere probe. Rechazo esperado body-json/UND_ERR_SOCKET, origen financial-document-client, diagnóstico IPC/tiempo, abortar generador, cerrar hijo y eliminar copia. Aprobó preservación byte a byte del éxito y ausencia de cliente huérfano; evidencia separada `q0453c2c3d12-transport-transport-failed.json`, estado failed e injectedTransportFailure=true. No es un incidente espontáneo ni una carga aprobada.

Dos componentes implementados/validados (diagnóstico y pruebas dirigidas); causa histórica pendiente. Q04.5.3c2c3d12 parcial. Sigue c3d12b: captura/reproducción espontánea con contexto antes de atribuir o corregir una causa de producción. Sin cambios productivos ni migración nueva; 085 únicamente en copia después de db:check. Conexiones bancarias excluidas.

## Q04.5.3c2c3d11: una hora con cliente separado

Combinar `--separate-financial-client --extended-soak --profile=soak` selecciona esta fase y conserva los reportes d8/d9/d10. Comandos desde raíz, con Node 24 y backend compilado:

```powershell
node backend/scratch/verify-full-app-load.js --separate-financial-client --extended-soak --profile=soak --duration=3600 --fixtures=20000 --backup=RUTA_DEL_DUMP
node backend/scratch/summarize-separated-soak.js
node backend/scratch/verify-full-app-failure.js --separate-financial-client --extended-soak --profile=soak --backup=RUTA_DEL_DUMP
node backend/scratch/verify-full-app-failure.js --separate-financial-client --extended-soak --profile=soak --financial-client-failure --backup=RUTA_DEL_DUMP
node backend/scratch/verify-full-app-failure.js --separate-financial-client --extended-soak --profile=soak --objective-failure --backup=RUTA_DEL_DUMP
node backend/scratch/verify-full-app-failure.js --separate-financial-client --extended-soak --profile=soak --coverage-failure --backup=RUTA_DEL_DUMP
```

Equivalentes npm: `perf:separated-soak`, `perf:separated-soak-failure` y `perf:summarize-separated-soak`. Controles de fallo secuenciales de 40 s/1000 fixtures; no ejecutar simultáneamente con otra carga aislada, porque auditan las bases temporales y PIDs antes/después.

`MemoryDiagnostic.elapsedMs` registra el instante de la última muestra. El cliente toma una muestra final al cerrar. `separated-soak-coverage.js` exige duración efectiva, al menos cuatro muestras, todos los minutos esperados con muestras y las cinco medias/picos válidos en ambos procesos. La cobertura de lecturas y su p95 por minuto se evalúan con los controles extended existentes. El último minuto parcial adicional se conserva; no sustituye un minuto faltante de 0 a 59. Frecuencia nominal 100 ms, medias por muestra, sin GC forzado y sin un nuevo umbral RSS del cliente. Padre conserva AppModule, monitor, escritor SQL y cliente de almacén/pagos.

Reporte exitoso: `q0453c2c3d11-separated-soak.json`, escrito tras limpieza. Fallo real con grupo: `q0453c2c3d11-separated-soak-failed.json`; objetivo deliberado: `q0453c2c3d11-separated-soak-objective-failed.json`. `--coverage-failure` elimina deliberadamente el minuto cero del diagnóstico del cliente, exige rechazo y conserva ambos diagnósticos con `injectedCoverageFailure=true` en `q0453c2c3d11-separated-soak-coverage-failed.json`. Los fallos previos a construir grupo no garantizan diagnóstico persistido. Los fallos nunca sustituyen el éxito.

Resumen reproducible: `q0453c2c3d11-comparison.json`; exige fases, perfil/volumen compatibles, 3600 s, objetivos aprobados y cobertura temporal de lecturas y ambos procesos. Compara ventanas separadas de diez y sesenta minutos; sus cuartos tienen distinta duración, por lo que no implica causalidad, crecimiento lineal ni fuga. Picos independientes no se suman. La evidencia de una hora con cliente mezclado d8 no sustituye esta ejecución.

Resultado del 3 de octubre de 2026: primer intento alcanzó una hora y terminó con fetch failed antes de persistir diagnóstico; su causa no se pudo determinar. Repetición sin reintentos ni cambio de objetivos aprobó 14122 lecturas, 47317 commits y 105 ciclos; p95 72.31 ms, event loop p95 34.47 ms y duración efectiva 3604.95 s. Los 60 minutos esperados tienen tráfico/p95 y memoria válida de ambos procesos; se conserva minuto 60 parcial. Sin deadlocks ni transacciones abandonadas y con caja/saldos/stock alineados; copia eliminada. Ver sesión README para primer fallo y pendientes, sin declarar estabilidad productiva.

Padre: 34293 muestras, RSS medio 216.39 → 239.23 MiB (delta 22.83, pico 261.29). Cliente: 33825 muestras, RSS 165.73 → 232.44 MiB (delta 66.71, pico 415.67). Delta heapUsed padre 6.54 MiB y cliente 3.92; external 0.07 y 2.24; ArrayBuffers 0.08 y 788.42, respectivamente. Contabilidad Buffer/Blob no equivale a RSS ni demuestra fuga; no sumar picos. Objetivo de crecimiento RSS padre 128 MiB inalterado, aprobado. Cliente tiene diagnóstico/cobertura, no SLA adicional. Primera ventana fallida no tiene series persistidas: no inventar comparación de memoria con esa ventana. Resumen compara la repetición con d10.

Diagnóstico de transporte: `local-load-fetch.js` conserva método, ruta sin query y código de causa; no publica cuerpo ni autorización y no reintenta solicitudes. Los fallos de escritores abortan el generador y cierran los recursos. Antes de las validaciones finales se conserva un grupo parcial de memoria con `incomplete=true` y `readerResultAvailable`; la ausencia de resultado del lector no equivale a cero tráfico real. Un fallo previo al inicio del muestreo puede seguir sin grupo. Archivos `-client-failed.json` y `-generator-failed.json` llevan sus etiquetas de inyección; no sobrescriben `-failed.json` de fallos reales ni el éxito. La primera prueba preliminar de caída del cliente, anterior a separar esos archivos, se conserva como `-client-first-failed.json` con su error observado, no como fallo real.

Después de la repetición exitosa, los cuatro controles integrados (generador, cliente, objetivo y minuto ausente) aprobaron limpieza de copia y cliente, etiquetas de fallo y preservación byte a byte del reporte exitoso. Instrumentación, controles y ventana local de una hora validados; el primer fallo de transporte sigue sin causa determinada. Siguiente c3d12: diagnóstico dirigido/reproducción del incidente con el nuevo contexto; no presentar una repetición aprobada como solución de su causa ni certificación de estabilidad productiva.

## Q04.5.3c2c3d10: cliente financiero/documental separado

3 de octubre de 2026. `full-app-financial-client.js` ejecuta los recorridos existentes desde un hijo persistente y una conexión PG propia, exclusivamente contra la copia desechable. Conserva el proceso entre ciclos para observar crecimiento; no fuerza GC. Lectores siguen en su generador separado. Padre: AppModule, monitor, escritor SQL y cliente de almacén/pagos; no equivale a servidor puro. El pool del AppModule continúa en 10; la conexión auxiliar del cliente se cuenta fuera de ese pool.

Desde la raíz, con Node 24 y backend compilado:

```powershell
node backend/scratch/verify-full-app-load.js --separate-financial-client --profile=soak --duration=600 --fixtures=20000 --backup=C:\Sistema\.backups\2026-10-02T17-25-50-266Z\database.dump
node backend/scratch/compare-full-app-memory.js
node backend/scratch/verify-full-app-failure.js --separate-financial-client --profile=soak --backup=C:\Sistema\.backups\2026-10-02T17-25-50-266Z\database.dump
node backend/scratch/verify-full-app-failure.js --separate-financial-client --profile=soak --financial-client-failure --backup=C:\Sistema\.backups\2026-10-02T17-25-50-266Z\database.dump
node backend/scratch/verify-full-app-failure.js --separate-financial-client --profile=soak --objective-failure --backup=C:\Sistema\.backups\2026-10-02T17-25-50-266Z\database.dump
node backend/scratch/verify-financial-client.js
```

Comandos npm equivalentes: `perf:separate-financial-client`, `perf:separate-financial-client-failure`, `perf:compare-memory`. Ejecutar controles de fallo secuencialmente: comparan bases temporales y PIDs de clientes antes/después; otra carga simultánea invalidaría esa auditoría. El verificador de carga comprueba/aplica migraciones únicamente en copia y la elimina al terminar. Configuración y JWT se transmiten por IPC, sin escribir secretos en argumentos ni reportes. El cliente verifica Node 24, modo aislado, nombre de copia, `current_database()` y destino HTTP 127.0.0.1 antes del recorrido. RPC acotado a 120 s; cierre normal y terminación de respaldo, con espera de salida del hijo. Caída del padre cierra el hijo al desconectarse IPC.

Resultado de diez minutos: 2360 lecturas, 8319 commits, 18 ciclos, p95 65.33 ms, event loop p95 34.37 ms, integridad y objetivos aprobados. Reporte `q0453c2c3d10-separated.json`; 5757 muestras padre y 5674 cliente a intervalos nominales de 100 ms. Los retrasos del event loop producen distinto número de muestras: medias por muestra, no ponderadas por duración.

| Métrica (MiB) | Delta padre mixto d9 | Delta padre separado d10 | Delta cliente d10 |
| --- | ---: | ---: | ---: |
| RSS | 109.52 | 63.54 | 19.58 |
| heapUsed | 15.84 | 16.17 | 1.12 |
| heapTotal | 75.73 | 76.50 | 1.70 |
| external | 0.80 | 1.02 | -3.22 |
| ArrayBuffers | 135.35 | 1.02 | 129.75 |

Deltas firmados entre medias del primer y último cuarto. RSS padre 159.59 → 223.13 MiB, pico 244.70; cliente 113.32 → 132.90 MiB, pico 199.86. No sumar picos independientes. Objetivo RSS padre inalterado: crecimiento máximo 128 MiB; el cliente tiene diagnóstico descriptivo, no un SLA adicional. Comparador exige perfiles, volumen/duración y objetivos compatibles; publica `q0453c2c3d10-comparison.json` con fuentes y tres alcances. Ventanas distintas: no demostrar causalidad, consumo total simultáneo ni fuga. ArrayBuffers aumenta principalmente en el cliente documental; se conserva la cautela de contabilidad Buffer/Blob observada en d9.

Los tres controles de fallo aprobaron eliminación de copia, ausencia de cliente huérfano y conservación byte a byte del reporte exitoso. El fallo de objetivo guarda `q0453c2c3d10-separated-objective-failed.json` con estado failed, inyección declarada y ambos diagnósticos; no representa una carga exitosa. El verificador de caída del cliente fue corregido para reconocer su error en lugar del error del generador de lecturas.

En el reporte de esta ejecución, `groups[0].processScope` y `memoryDiagnostic.scope` son los alcances específicos; la limitación genérica final conserva texto histórico porque la ejecución comenzó antes del ajuste editorial. Código actual ya usa alcance específico en esa limitación. La evidencia no se modificó después de medirla.

Q04.5.3c2c3d10 completa en este alcance. Sigue Q04.5.3c2c3d11: una hora con cliente separado y cobertura por minuto; no sustituirla por la hora d8 con cliente mezclado. Otros escritores, pruebas de varias horas/días y calibración productiva permanecen pendientes.

## Q04.5.3c2c3d9: diagnóstico de memoria

`npm run perf:memory-diagnostic -- --backup=RUTA_DEL_DUMP --duration=600 --fixtures=20000` usa perfil soak y recorridos comerciales/proveedor, conserva objetivos y publica `q0453c2c3d9-memory-diagnostic.json`. `perf:memory-diagnostic-failure` y su variante `--objective-failure` verifican limpieza y preservación de ese reporte. Combinar con `--extended-soak` activa sus controles temporales; usar --duration=3600 para otra hora instrumentada.

El reporte añade `groups[].memoryDiagnostic`: cinco métricas en bytes, muestras por minuto, medias/picos y diferencias firmadas entre primer/último cuarto. RSS es memoria residente del proceso; heapUsed/heapTotal describen heap JavaScript; external incluye recursos externos administrados por JavaScript y ArrayBuffers es parte de external. Son categorías solapadas, no un balance que deba sumar RSS. Picos independientes tampoco deben sumarse.

Incluye servidor, monitor, escritores y cliente de archivos en el mismo proceso: no separa sus consumos. Las series permiten observar qué categorías cambiaron, sin probar causa ni fuga. Muestreo nominal 100 ms puede retrasarse; medias por muestras, no ponderadas por duración. El generador HTTP de lecturas es otro proceso. Resultados/limitaciones y próxima atribución en README.

Resultado c3d9: primera ventana de 600 s/20000 fixtures incumplió RSS y eliminó copia, sin desglose persistido. Repetición idéntica aprobó 2361 lecturas, 8384 commits, 18 ciclos y p95 62.92 ms; incremento RSS medio 109.52 MiB (<128), sin relajar umbrales. Ver tabla README. No elimina el resultado fallido ni prueba ausencia de fuga.

Los fallos con grupo diagnóstico se guardan tras limpieza en `q0453c2c3d9-memory-diagnostic-failed.json`; objetivo deliberado usa `q0453c2c3d9-memory-diagnostic-objective-failed.json`, marcado injectedObjectiveFailure, para no sustituir un fallo real ni el éxito. Caída del generador puede ocurrir antes de disponer de grupo, por lo que no garantiza un desglose.

[Node 24.19.0](https://nodejs.org/download/release/v24.19.0/docs/api/process.html#processmemoryusage) describe ArrayBuffers como parte de external. En este runtime el probe aislado Buffer/Blob reproduce ArrayBuffers mayor que external: no imponer identidad contable ni calcular memoria nativa restando estas métricas de RSS. `node --expose-gc backend/scratch/probe-blob-memory.js` usa GC explícito exclusivamente en un proceso aislado sin DB/app; no manipula la evaluación del soak. Reporte `q0453c2c3d9-blob-probe.json`. Separación servidor/cliente de archivos sigue pendiente; el generador de lecturas ya está separado.

## Q04.5.3c2c3d12b: búsqueda ampliada con diagnóstico del lector

5 de octubre de 2026. `--transport-search` implica probe y conserva cliente separado, recorridos y objetivos; genera `q0453c2c3d12b-search.json` independiente de d12. Solo perfil soak, sin combinar extended-soak. No añade reintentos.

Desde raíz con Node 24 y backend compilado:

```powershell
npm run perf:transport-search -- --duration=600 --fixtures=1000 --backup=RUTA_DEL_DUMP
npm run perf:transport-search-failure -- --backup=RUTA_DEL_DUMP
node backend/scratch/verify-generator-diagnostic.js
```

Ejecutar cargas/controles secuencialmente. La copia requiere respaldo existente, db:check antes de db:migrate y eliminación final. No modifica base operacional; 085 solo en copia, sin migración nueva. El control de fallo exige preservar byte a byte el éxito y eliminar copia/cliente; guarda `q0453c2c3d12b-search-transport-failed.json` con inyección explícita.

Corrección del lector: conserva diagnóstico estructurado al envolver errores y transmitirlos por IPC. El reporte parcial registra reader-generator, tiempo y método/ruta/etapa/código; no registra término de búsqueda ni autorización. La prueba sin DB trunca una respuesta HTTP local, comprueba body-json/UND_ERR_SOCKET y espera cierre del hijo.

Resultado: 2368 lecturas, 8251 commits, 18 ciclos en 600 s/1000 fixtures; p95 46.82 ms, event loop p95 34.44 ms, crecimiento RSS padre 80.18 MiB. Objetivos e integridad aprobados; 216 rechazos adicionales 413 y 432 descargas posteriores íntegras, copia eliminada. Control deliberado de corte aprobado con preservación de éxito y limpieza.

Fallo espontáneo histórico no reproducido ni atribuido: c3d12b y Q04 siguen parciales. Volumen/duración distintos del primer incidente; esta ventana y la inyección no sustituyen su reproducción ni certifican producción. Se conserva pendiente obtener contexto espontáneo antes de corregir una causa. Fiscal mock y exclusión de conexiones bancarias intactos.
## Q04.5.3c2c3d12c: transporte observado en servidor de prueba

`--server-transport` implica transport-search/probe, requiere cliente separado/soak y publica evidencia d12c independiente. Instala observador antes de configureApp en la herramienta de copia: finish cuenta respuestas terminadas, close previo a finish cuenta incompletas y aborted registra el evento Node sin inferir quién cerró. Los contadores aborted/incomplete pueden solaparse. No se altera producción.

```powershell
npm run perf:server-transport -- --duration=600 --fixtures=20000 --backup=RUTA_DEL_DUMP
npm run perf:server-transport-failure -- --backup=RUTA_DEL_DUMP
node backend/scratch/verify-server-transport.js
```

Retención de últimos 100 eventos; ruta sin query, método/tiempo/status/flags, sin headers ni cuerpos. El origen temporal es la instalación del middleware y comprende preflight; contadores incluyen todas las solicitudes, no solo lectores. No mide errores TCP previos al middleware ni demuestra causalidad de un cierre.

Validación 2026-10-05: regresión 40 s/1000 fixtures aprobó 160 lecturas, 572 commits, dos ciclos y p95 67.99 ms; 776 solicitudes del servidor terminadas, cero incompletas. Corte deliberado capturó un aborted y un incomplete de la misma ruta efímera, junto con body-json/UND_ERR_SOCKET del cliente; copia/hijo eliminados y éxito preservado byte a byte. Reportes `q0453c2c3d12c-server.json` y `q0453c2c3d12c-server-transport-failed.json`. Prueba local verifica retención/privacidad/snapshot.

Instrumentación c3d12c validada; causa espontánea c3d12b pendiente. No se ejecutó aquí otra hora ni se reprodujo el incidente histórico. Respaldo previo, db:check y 085 solo en copias; sin migración nueva. Mantiene fiscal mock y exclusión bancaria. Ejecutar controles secuencialmente.