# Estado de listados en la URL

Q04.3.1 — 1 de octubre de 2026.

Clientes, proveedores, cotizaciones y compras conservan búsqueda, página, tamaño y orden en la URL. Recargar o abrir el enlace restaura la consulta y los controles. Se mantienen las rutas, los contratos de API y los CSV existentes.

Ejemplo: `/compra/historial?q=Diesel&page=3&limit=25&sort=total&order=asc`.

| Parámetro | Contrato |
| --- | --- |
| q | Texto, máximo 200 caracteres, recortado |
| page | Entero 1–100000, defecto 1 |
| limit | Entero 1–100, defecto 10 |
| sort | Columna permitida del listado, defecto id |
| order | asc o desc, defecto desc |

Clientes/proveedores permiten rfc, razonSocial y codigoPostal; cotizaciones folio, fecha, cliente, total y estatus; compras fecha, cliente (proveedor), folio y total. El servicio de compras conserva el mapeo a nombres SQL. Los valores inválidos vuelven al valor predeterminado; las API mantienen su validación independiente.

El enlace omite valores predeterminados y conserva parámetros ajenos al listado. Al escribir espera el debounce antes de guardar; al filtrar/ordenar vuelve a página 1. La corrección automática de página fuera de rango también se refleja en URL. El indicador de orden se restaura con la consulta; ID inicial no muestra una cabecera distinta como ordenada.

La sincronización usa replaceUrl: editar filtros no agrega una entrada al historial por cada cambio. No crea historial navegable de cada estado. Abrir un enlace externo actualiza el estado y cancela búsquedas pendientes; emitir la misma URL no dispara otra consulta. Suscripciones se liberan al salir del componente.

Pruebas Playwright con API simulada cubren los cuatro listados, carga inicial por URL, recarga, orden/tamaño/página enviados, actualización al paginar/buscar, conservación de parámetros ajenos y normalización de entradas inválidas. No se modifican SQL ni transacciones.

## Q04.3.2 — productos y facturas, 1 de octubre de 2026

Los seis listados revisados restauran ahora búsqueda, página, tamaño y orden. Productos usa los mismos controles y cancelación de consultas del estado compartido; mantiene los parámetros de API `sort`/`order`, imágenes, permisos de edición, CRUD, Kardex y cotizaciones de proveedor. Columnas de URL: codigo, descripcion, categoriaNombre, marca, ubicacion, precioUnitario y existencia. La búsqueda usa debounce de 300 ms.

Facturas agrega `tipo=I` o `tipo=E`; vacío/ausente significa Todas. Un tipo inválido se normaliza a Todas. El selector se restaura al abrir/recargar el enlace; cambiar tipo conserva texto visible y orden y vuelve a página 1. CSV toma el tipo de la misma consulta, sin depender de una variable independiente. Columnas de URL: folio, fecha, receptor, rfc, total y estatus; el estado fiscal no es ordenable.

Pruebas adicionales de navegador cubren ambos listados, tipo restaurado, recarga, página/tamaño/orden enviados, conservación de parámetros ajenos, cambio de tipo y entradas inválidas. Una prueba unitaria comprueba que cambiar tipo use el término recién escrito sin emitir otra búsqueda después del debounce.

Q04.3 cerrado en el alcance de estos seis listados. Q04 sigue parcial: otros módulos y filtros nuevos por rango/estado quedan fuera. Sin migraciones, escrituras operativas ni cambios de modo fiscal mock; conexiones bancarias excluidas. Continúa Q04.4, contraste de filtros existentes y definición/implementación acotada de filtros avanzados en documentos.

Q04.4.1 agrega `estado` a facturas: vacío/Todos, Pendiente, Timbrada, Cancelada o Pagada. Se guarda con tipo y demás filtros; inválidos se normalizan a Todos. Estado comercial y fiscal son campos distintos. Ver [Listado de facturas](FACTURAS_LISTADO.md).

Q04.4.2: facturas también conserva desde/hasta (YYYY-MM-DD). Fechas inexistentes se normalizan a vacío; rangos invertidos limpian ambos extremos. El rango aplicado se restaura en controles y CSV; ver [Listado de facturas](FACTURAS_LISTADO.md).

Q04.4.3: cotizaciones y compras también sincronizan estado/desde/hasta. Cada listado valida sus estados propios; tipo I/E permanece exclusivo de facturas. Se conservan parámetros ajenos, búsqueda/orden/página y exportación. Ver manuales de [Cotizaciones](COTIZACIONES_LISTADO.md) y [Compras](CONTRATOS_PRODUCTOS_COMPRAS.md). Q04.4 cerrado en estos tres historiales; no equivale a cobertura de toda la aplicación.
