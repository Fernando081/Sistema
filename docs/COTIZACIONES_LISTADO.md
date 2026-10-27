# Listado y exportación de cotizaciones

## V01 — revisiones y respuesta, 20/10/2026

El historial añade **Revisiones y respuesta** por cotización. Permite activar snapshots/revisiones explícitas, abrir su editor, generar/revocar enlace y consultar respuesta comercial. Una nueva revisión es otra cotización con folio propio y mismo cliente/unidad; conserva la anterior, sin heredar aceptación. Para documentos activados sólo la última vigente/aceptada origina pedido/venta, a precios aceptados y con comprobación comercial/fiscal descrita; propuestas no activadas conservan el flujo anterior. No es un cambio a los filtros/CSV/PDF, no valida identidad del cliente ni crea un pedido por responder. [Manual V01, permisos, contratos, privacidad y pruebas](VERSIONES_COTIZACION.md).

El estado comercial de la fila/CSV conserva su contrato anterior; no equivale a respuesta ni a ser la revisión actual. Consultar **Revisiones y respuesta** para ese estado. Las acciones antiguas siguen sujetas a la comprobación del servidor y rechazan una revisión sustituida o sin aceptación aunque la fila diga Vigente.

Q04.2.2a — 30 de septiembre de 2026.

El historial conserva creación de pedido, PDF y conversión a venta. La paginación ya existía; ahora los controles de orden consultan el conjunto completo en el servidor. La búsqueda admite folio, prefijo `C-`, cliente y RFC; ignora mayúsculas y trata `%` y `_` literalmente. No incluye conceptos ni busca aproximadamente.

## Uso y contrato

El campo **Buscar cotización** espera 300 ms, vuelve a la primera página y cancela consultas anteriores. `?q=...` establece y muestra el filtro inicial. Las cabeceras folio, fecha, cliente, total y estatus ordenan en servidor; el orden inicial es ID descendente. No se aplica orden local a una página parcial. Las consultas fallidas limpian resultados y muestran un aviso; la página vacía fuera del rango vuelve a la última disponible.

**Exportar CSV filtrado** toma el texto visible incluso antes de esperar la búsqueda. Descarga todos los resultados del filtro/orden, independientemente de la página. Máximo 5000 filas, con error al excederlo y sin truncamiento. UTF-8 BOM, comillas y protección de fórmulas. Incluye ID, folio, fecha de emisión, nombre/RFC, total y estatus; no incluye conceptos ni el documento fiscal. Las fechas Date se serializan como ISO; cadenas de fecha e importes conservan su valor de origen. No se certifica ni cambia el modo fiscal mock.

GET `/api/v1/cotizacion` y GET `/api/v1/cotizacion/exportar` comparten estos parámetros:

| Parámetro | Valores |
| --- | --- |
| page | 1–100000; defecto 1 |
| limit | 1–100; defecto 10 |
| term | Texto máximo 200 caracteres; defecto vacío |
| sortBy | id, folio, fecha, cliente, total, estatus; defecto id |
| sortOrder | asc o desc; defecto desc |

CSV ignora página/tamaño. Listado devuelve `{ data, total, page, totalPages }` con los campos existentes y `id_pedido`. Si existen múltiples pedidos vinculados, muestra el ID más reciente para conservar una fila por cotización y bloquear otra creación desde el historial. No cambia ni elimina pedidos almacenados. Autenticación existente conservada; SQL parametrizado y columnas permitidas. Los parámetros inválidos reciben HTTP 400.

## Validación y límites

Pruebas unitarias de validación, SQL, página/orden, serialización y límite CSV; Playwright con API simulada para página, orden, URL y descarga del término recién escrito. `node backend/scratch/verify-quote-list.js`, después de compilar, verifica el SQL con tablas temporales y ROLLBACK y consulta compatibilidad con tablas reales en transacción READ ONLY.

Sin nuevas migraciones ni escrituras a datos operativos. Conteo/filas pueden diferir ante cambios concurrentes. No se optimiza aún la búsqueda por subcadena para volúmenes grandes. Q04 permanece parcial: facturas y compras, sus filtros y exportaciones, continúan en Q04.2.2b/c; no se declara terminada toda la fase de documentos.


## Q04.4.3 — estado y rango de fechas, 1 de octubre de 2026

El historial y CSV admiten estado vacío/Todos o Vigente, Pendiente, Convertida o Rechazada. Estados contrastados con código y registros actuales; se conservan los históricos sin transformar documentos. No representan certificación fiscal ni recalculan saldos.

GET del listado y /exportar comparten estado, desde y hasta. Fechas reales YYYY-MM-DD de 1900–9999, extremos opcionales, rango invertido o estado inválido reciben HTTP 400. Fechas de emisión almacenadas como timestamptz; límites explícitos en America/Mexico_City. Hasta incluye el día completo con límite exclusivo del siguiente. Consulta parametrizada común para conteo, filas y CSV; se conserva búsqueda literal, orden y tope de 5000 filas.

Selector Estado comercial y controles Desde/Hasta con Aplicar fechas y Limpiar fechas. Aplicar toma texto visible y vuelve a página 1, conservando filtros/orden/tamaño. Rango inválido avisa y conserva consulta previa; CSV usa rango aplicado, no fechas editadas sin aplicar. Estado y rango se guardan en URL y se restauran al abrir/recargar. Entradas inválidas se normalizan; rango invertido limpia ambos extremos. La limpieza de fechas conserva estado y búsqueda.

Validación DTO/SQL y CSV, pruebas de navegador con API simulada y verificador PostgreSQL ampliados. Fixtures temporales timestamptz y ROLLBACK, sesión UTC para probar límites de Tampico, y compatibilidad real READ ONLY. Sin nuevas migraciones ni escrituras operativas. Q04.4 completado en facturas/cotizaciones/compras; Q04 sigue parcial: otros módulos y optimización de búsqueda pendientes.

## Q04.5.2e1 — búsqueda indexada

Migración 083 aplicada el 2026-10-01. Índice textual de folio/C-folio/nombre/RFC conserva coincidencias entre campos, espacios y NULL. Página/conteo/CSV comparten ruta previa para términos cortos/signos y selección por sondeo de hasta 257 coincidencias para los demás. Al alcanzar umbral se conserva consulta anterior. No cambia estado/rango/orden/URL, creación/conversión ni último pedido. Añade consulta; no promete mejora universal ni snapshot común bajo concurrencia. Equivalencia exacta validada con respaldo restaurado y operación. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md).

Q04.5.3b (2026-10-01): listado paginado usa una transacción REPEATABLE READ READ ONLY sobre la misma conexión para sondeo/conteo/página. Evita discrepancias de total y filas ante cambios confirmados entre esas consultas. Facturas incluye enriquecimiento fiscal; productos incluye reservas/disponibilidad. Contratos de filtro/orden/página y CSV se conservan; CSV no se envuelve en nueva transacción. La validación de carreras y errores con TypeORM/PostgreSQL está en [Rendimiento de listados](RENDIMIENTO_LISTADOS.md). Carga HTTP sostenida/recursos pendiente; no certifica todas las escrituras del ERP ni SLA.
