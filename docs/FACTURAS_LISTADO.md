# Historial y CSV de facturas

Q04.2.2b — 1 de octubre de 2026.

La paginación y los filtros Todas/Ingresos/Egresos ya existían. Se agregó orden real en servidor para folio, fecha, cliente, RFC, total y estatus comercial. La búsqueda literal por folio, serie/folio (con o sin guion), cliente y RFC ignora mayúsculas. El folio usa la serie almacenada, incluyendo notas de crédito; no supone siempre serie A. No busca conceptos ni UUID.

## Uso y API

El campo de búsqueda admite `?q=...`, muestra su valor y espera 300 ms. Filtrar, ordenar o cambiar tipo vuelve a página 1 y cancela consultas anteriores. Cambiar tipo usa el término visible, incluso si hay debounce pendiente. Errores limpian filas anteriores y muestran aviso. Las páginas vacías fuera del rango vuelven a la última disponible.

GET `/api/v1/venta` y GET `/api/v1/venta/exportar` comparten DTO:

| Parámetro | Valores |
| --- | --- |
| page | 1–100000; defecto 1 |
| limit | 1–100; defecto 10 |
| term | Máximo 200 caracteres; vacío por defecto |
| tipo | Vacío (todos), I (ingresos), E (egresos) |
| sortBy | id, folio, fecha, receptor, rfc, total, estatus; defecto id |
| sortOrder | asc o desc; defecto desc |

Valores inválidos reciben HTTP 400. La respuesta paginada mantiene `{ data, total, page, totalPages }` y el enriquecimiento `estado_fiscal`, con Borrador cuando no existe documento fiscal. La autenticación y las operaciones de detalle, PDF, correo, cancelación, devolución y factura global mantienen sus contratos.

**Exportar CSV filtrado** conserva término visible, tipo y orden; incluye todas las coincidencias, independiente de la página. Máximo 5000 filas: exceso produce error, sin truncar silenciosamente. Campos ID, serie, folio, fecha, cliente/RFC, tipo, total, estatus comercial y fiscal. Fechas Date se serializan ISO, importes mantienen su precisión textual; UTF-8 BOM, escape de comillas y neutralización de fórmulas. No exporta conceptos, costos, UUID ni documento fiscal. El CSV no cambia ni certifica timbres mock.

## Verificación y límites

Pruebas unitarias de parámetros, filtro/tipo, SQL y límite/serialización CSV; Playwright con API simulada para página, cambio de tipo, orden, texto recién escrito, URL y descarga. Después del build, `node backend/scratch/verify-invoice-list.js` comprueba SQL con tablas temporales y ROLLBACK y compatibilidad real en transacción READ ONLY. Índice único de fiscal_documento por factura contrastado con metadatos.

Sin migraciones ni escrituras operativas. Conteo y filas se leen separadamente y pueden diferir ante cambios concurrentes. Estado fiscal no es una columna ordenable. Este bloque original no incluía filtros por rango/estado; se incorporan abajo en Q04.4.1/Q04.4.2. La optimización para grandes volúmenes sigue pendiente.

Q04.3.2 (1 de octubre de 2026): el tipo I/E se guarda junto con q/page/limit/sort/order en URL y se restaura en el selector; consultas y CSV usan el mismo estado. Ver [Estado de listados en URL](ESTADO_LISTADOS_URL.md) para parámetros, pruebas y alcance actual.

## Q04.4.1 — estado comercial, 1 de octubre de 2026

El selector **Estado comercial** filtra Todos/Pendiente/Timbrada/Cancelada/Pagada. Valores contrastados con el enum actual de factura en PostgreSQL. Es el estatus comercial almacenado, independiente del estado del documento fiscal; seleccionar Timbrada no certifica un timbre real ni elimina el modo mock.

GET `/venta` y `/venta/exportar` admiten `estado` vacío o uno de esos cuatro valores. Los inválidos reciben HTTP 400. Conteo, filas y CSV comparten el filtro parametrizado; combina con texto, tipo y orden. No se modifican documentos ni transacciones comerciales.

`estado` se conserva en URL y restaura el selector al abrir/recargar. Elegir o limpiar estado conserva texto visible, tipo y orden, vuelve a página 1 y cancela la búsqueda pendiente. Los enlaces sin estado conservan el resultado anterior; un estado inválido en URL se normaliza a Todos. El CSV toma el mismo estado de consulta, no solo la página.

Pruebas unitarias backend/frontend, Playwright y verificador PostgreSQL ampliados para combinaciones de tipo/estado, casos sin coincidencias y CSV filtrado. Sin migraciones. Q04.4 permanece parcial: sigue Q04.4.2, rango de fechas de facturas; filtros de cotizaciones/compras se revisarán después, sin declarar cobertura anticipada.


## Q04.4.2 — rango de emisión, 1 de octubre de 2026

GET `/venta` y `/venta/exportar` admiten `desde` y `hasta` como fechas reales YYYY-MM-DD, de 1900-01-01 a 9999-12-31, o vacías. Puede usarse solo un extremo. Rangos invertidos, fechas inexistentes y formatos distintos reciben HTTP 400. Desde incluye el inicio del día; Hasta incluye el día completo mediante un límite exclusivo del día siguiente. fecha_emision es timestamp with time zone: los limites se calculan explicitamente en America/Mexico_City, independientemente de la zona del servidor o navegador.

Los campos Desde/Hasta se aplican juntos con **Aplicar fechas**; un rango inválido muestra aviso y conserva la consulta anterior. **Limpiar fechas** conserva texto, tipo, estado, orden y tamaño. Aplicar reinicia página y toma el texto visible, cancelando búsqueda pendiente. CSV exporta el rango aplicado; editar fechas sin aplicar no modifica la consulta ni la descarga.

Parámetros desde/hasta persistentes en URL y restaurados al abrir o recargar. Fechas inválidas se eliminan; un rango invertido en URL limpia ambos extremos. Conteo/listado/CSV comparten SQL parametrizado. Sin migraciones ni cambios en transacciones comerciales. Pruebas de DTO/SQL, navegador y PostgreSQL con tablas temporales/ROLLBACK y compatibilidad real de solo lectura.

Q04.4 sigue parcial: próximo Q04.4.3, contrastar e implementar filtros de estado/fechas en cotizaciones y compras. Otros módulos y búsqueda para grandes volúmenes permanecen pendientes.

## Q04.5.2e1 — búsqueda indexada

Migración 083 aplicada el 2026-10-01. Índice textual de folio, serie con/sin guion, nombre y RFC preserva coincidencias entre campos. Página/conteo/CSV usan estrategia compartida: ruta previa para términos cortos/signos; sondeo de hasta 257 coincidencias para los demás, con ruta previa al alcanzar umbral. No cambia filtros, orden, CSV, documentos ni timbres mock. Añade consulta de sondeo; no garantiza mejora universal ni consistencia de lecturas ante cambios concurrentes. Equivalencia exacta validada en respaldo restaurado y operación. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md).

Q04.5.3b (2026-10-01): listado paginado usa una transacción REPEATABLE READ READ ONLY sobre la misma conexión para sondeo/conteo/página. Evita discrepancias de total y filas ante cambios confirmados entre esas consultas. Facturas incluye enriquecimiento fiscal; productos incluye reservas/disponibilidad. Contratos de filtro/orden/página y CSV se conservan; CSV no se envuelve en nueva transacción. La validación de carreras y errores con TypeORM/PostgreSQL está en [Rendimiento de listados](RENDIMIENTO_LISTADOS.md). Carga HTTP sostenida/recursos pendiente; no certifica todas las escrituras del ERP ni SLA.
