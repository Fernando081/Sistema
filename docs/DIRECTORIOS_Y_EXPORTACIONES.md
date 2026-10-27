# Directorios y exportaciones — Q04.1

Fecha: 2026-09-30. Clientes y proveedores usan búsqueda, paginación y orden en el servidor. Los selectores existentes conservan las rutas de arreglos completas; esta fase no migra todos los selectores ni los demás módulos.

## Uso

En Clientes o Proveedores, escribe un nombre, RFC o código postal. Clientes también busca VIN, ESN, número económico y placas de sus unidades registradas. La búsqueda ignora mayúsculas y espera 300 ms; cambia a la primera página y descarta respuestas anteriores. `%` y `_` se buscan literalmente. No hay búsqueda aproximada ni normalización de acentos.

Las cabeceras ID, RFC, razón social y código postal ordenan el resultado completo. El paginador ofrece 10, 25 o 50 registros. Después de eliminar el último registro de una página se consulta la última página disponible. El filtro inicial `?q=...` sigue siendo compatible con la búsqueda global.

**Exportar CSV filtrado** descarga todos los resultados del filtro y orden actuales, no únicamente la página visible. Contiene ID, RFC, razón social y código postal; no exporta unidades ni otros datos fiscales. Máximo 5000 registros: si se excede, se rechaza con un mensaje para reducir la búsqueda, sin truncar silenciosamente. Usa UTF-8 con BOM, comillas y saltos CRLF; neutraliza prefijos de fórmulas de hojas de cálculo. El archivo se descarga localmente.

## API

Rutas autenticadas bajo `/api/v1`:

| Directorio | Página | CSV |
| --- | --- | --- |
| Clientes | GET `/cliente/pagina` | GET `/cliente/exportar` |
| Proveedores | GET `/proveedores/pagina` | GET `/proveedores/exportar` |

Parámetros compartidos: `page` (1–100000, defecto 1), `limit` (1–100, defecto 10), `term` (máximo 200 caracteres), `sortBy` (`id`, `rfc`, `razonSocial`, `codigoPostal`; defecto `id`) y `sortOrder` (`asc`, `desc`; defecto `desc`). El CSV valida el mismo contrato pero ignora página y tamaño. Respuesta de página: `{ data, total, page, totalPages }`; las filas mantienen el contrato SQL PascalCase y los servicios frontend lo normalizan.

Los valores se parametrizan y las columnas/direcciones se restringen a una lista permitida. La búsqueda de unidades usa `EXISTS`, evitando duplicar clientes con varias unidades. Las rutas antiguas GET `/cliente` y `/proveedores` no cambian. No se requieren migraciones ni conexiones externas.

## Validación y límites

- Pruebas unitarias: validación de parámetros, SQL parametrizado, orden permitido, protección/escape CSV y límite de exportación; estado frontend, cancelación de respuestas, cambio de orden y corrección de página tras eliminación.
- Playwright con API simulada: página remota, búsqueda y descarga con filtro en ambos directorios. No sustituye una prueba HTTP contra PostgreSQL.
- PostgreSQL real: después de compilar backend, `node backend/scratch/verify-directories.js` verifica VIN/ESN, unidades sin duplicados, búsqueda literal, página/orden y CSV sobre tablas temporales, con `ROLLBACK`. No escribe en las tablas operativas.

El conteo y las filas se consultan por separado: cambios concurrentes pueden modificar el total entre ambas lecturas. La búsqueda por subcadena puede necesitar índices o una estrategia especializada según el volumen medido. Q04 permanece parcial; sigue Q04.2 para contrastar y uniformar productos/documentos y sus exportaciones, sin duplicar funciones existentes.


## Q04.5.2c — búsqueda indexada, 1 de octubre de 2026

Migración 081 aplicada con respaldo y db:check previo: pg_trgm y tres índices de expresión para clientes, proveedores y unidades VIN/ESN/número económico/placas. Contratos, columnas, conteo, orden y CSV se conservan; no hay columnas internas nuevas en respuestas. Clientes une IDs de ambas fuentes sin duplicar entidades.

Búsqueda selectiva usa LIKE literal escapado. Términos sin tres letras/números consecutivos usan la ruta previa; para los demás, un sondeo de hasta 257 filas elige ruta previa si las coincidencias son amplias. Se mantienen términos cortos/signos, espacios/NULL, minúsculas PostgreSQL y coincidencias entre campos. El sondeo añade trabajo; no se promete rapidez en todos los casos. Ver [Rendimiento de listados](RENDIMIENTO_LISTADOS.md) para 256 comparaciones de equivalencia, mediciones y límites.

Q04.5.3b (2026-10-01): listado paginado usa una transacción REPEATABLE READ READ ONLY sobre la misma conexión para sondeo/conteo/página. Evita discrepancias de total y filas ante cambios confirmados entre esas consultas. Facturas incluye enriquecimiento fiscal; productos incluye reservas/disponibilidad. Contratos de filtro/orden/página y CSV se conservan; CSV no se envuelve en nueva transacción. La validación de carreras y errores con TypeORM/PostgreSQL está en [Rendimiento de listados](RENDIMIENTO_LISTADOS.md). Carga HTTP sostenida/recursos pendiente; no certifica todas las escrituras del ERP ni SLA.
