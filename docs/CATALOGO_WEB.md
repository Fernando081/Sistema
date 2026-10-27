# Preparación del catálogo web

## Alcance actual — 2026-10-05

WEB01.1 es la base administrativa del futuro sitio de Refacciones y Tractorepuestos Tampico. WEB01 sigue parcial. El plan completo, prioridades y criterios de cierre están en README.md, sección «Web comercial pública». WEB01.2 tiene el editor implementado/verificado; WEB01.3 y sitio público, buscador, cotización, SEO y lanzamiento siguen pendientes.

## Contrato administrativo

JWT y rol ADMIN obligatorios en GET/PUT `/api/v1/web-catalog/admin/products/:id`. No hay endpoint anónimo. GET devuelve el producto actual y la ficha guardada, si existe. PUT recibe slug, titulo, descripcion, estado, datosRealesConfirmados, derechosImagenConfirmados, compatibilidadVerificada y version. Las confirmaciones son booleanos obligatorios; texto sin HTML; slug de 3–160 caracteres en minúsculas, números y guiones; título de 8–160 y descripción de 30–6000 caracteres.

La primera edición usa version=0. Cada guardado incrementa la versión. Una versión antigua o slug ocupado devuelve 409; producto inexistente, 404. El producto se bloquea dentro de la transacción para serializar ediciones concurrentes. El autor se obtiene de la sesión autenticada.

Estados: borrador para preparar; listo para revisión aprobada; retirado para apartar la ficha. «Listo» requiere confirmar datos reales, derechos de imagen y compatibilidad, además de código, marca y al menos una imagen local existente. Todas las imágenes incluidas deben existir. Esto no publica una página ni verifica automáticamente si los datos son ficticios o si una fotografía representa el producto correcto.

## Datos y privacidad

La tabla web_producto_ficha, migración 088, guarda el texto comercial y un snapshot de código, marca, imágenes, OEM/alternos y aplicaciones con restricciones. Cambiar el maestro no actualiza esa copia hasta volver a revisar y guardar. El futuro publicador deberá consultar exclusivamente fichas aprobadas y construir una respuesta pública explícita.

Se omiten precios, costos, márgenes, cantidades, ubicaciones, proveedores, clientes, VIN/ESN y documentos fiscales. Solo se admiten nombres de imágenes locales PNG/JPEG/WebP; se excluyen rutas con traversal, SVG y URLs externas. Esta restricción no sustituye una revisión de derechos o contenido. El editor permite seleccionar fotos del maestro y características con unidades; categorías y equivalencias revisadas siguen en WEB01.3.

## Verificación

Con Node.js 24, compilar backend antes de `npm run test:web-catalog`. El comando ejecuta el servicio compilado contra PostgreSQL en un esquema transaccional temporal sin fallback a public y revierte sus datos: borrador, campos permitidos, snapshot, conflicto de versión/slug, requisitos de revisión y retiro. No aprueba productos reales.

Las pruebas unitarias cubren DTO, imágenes y guardado; la aprobación positiva usa existencia de archivo simulada. Las pruebas HTTP prueban JWT/roles/validación con autenticación y servicio simulados. No sustituyen la revisión de imágenes reales, pruebas del futuro editor ni una publicación efectiva.

## Editor — WEB01.2 implementado

Acceso: Productos → Editar un producto existente → Ficha web, solo ADMIN. La pestaña carga al abrirse. Permite textos, URL, revisión del maestro y confirmaciones manuales, vista previa y guardar borrador/listo/retirado. Guardar primero cambios del maestro en Datos Generales. No publica nada. Permite elegir fotos del maestro y hasta 30 características con nombre/valor/unidad. La primera seleccionada es principal; las imágenes que no cargan bloquean aprobación si siguen elegidas.

Ante 409, conserva el texto y bloquea guardar hasta cargar la versión actual. Al recargar conserva URL/título/descripción y reinicia confirmaciones; revisa diferencias y URL ocupada antes de guardar. Una ficha guardada conserva su versión; los errores no borran texto. La selección/especificaciones también se conservan ante conflictos. Las confirmaciones se reinician al cargar o modificar contenido. WEB01.2 fue verificado en claro/oscuro, móvil/escritorio, pruebas de interfaz con API simulada e integración SQL real separada. WEB01.3 continúa pendiente; ninguna prueba aprueba automáticamente un producto real.

PUT acepta imagenes (hasta 12 rutas locales únicas pertenecientes al producto) y especificaciones (hasta 30 objetos nombre/valor/unidad, sin HTML ni campos extra). Nombre 2–80 caracteres, valor 1–160 y unidad 1–30. Se exige unidad explícita; indicar «sin unidad» cuando corresponda. Nombres duplicados tras trim/minúsculas se rechazan. Los campos nuevos son opcionales para compatibilidad: si se omiten conservan snapshot previo, o fotos actuales/especificaciones vacías en primera edición. Enviar [] vacía la selección, pero no permite marcar lista sin foto. El editor siempre envía ambos campos. No necesita migración adicional a 088.

## Lista de revisión — WEB01.3 parcial

En Productos → Preparar catálogo web (`/catalogo-web`, ADMIN) se revisan productos por estado, búsqueda y pendientes. GET de la colección usa páginas de 25 por defecto, máximo 100; permite término literal de hasta 100 caracteres y estado todos/sin_ficha/borrador/listo/retirado. No hay acceso anónimo ni salida de datos financieros o de clientes. Cada tarjeta abre el editor individual.

Las alertas cubren preparación, categoría/marca/código, selección de fotos/especificaciones, confirmaciones y fuentes. Posibles duplicados se comparan por código normalizado y marca sobre todos los maestros; no certifican equivalencia, ni fusionan o eliminan registros. El control de cambios compara código/marca/categoría del snapshot; no compara todas las modificaciones del maestro. No inspecciona fotos ni licencias automáticamente; un estado listo puede conservar pendientes de calidad que requieren revisión del propietario.

La categoría se copia del maestro al guardar. PUT admite fuenteCompatibilidad y fuenteReferencias como textos administrativos opcionales de hasta 500 caracteres sin HTML; omitir conserva la fuente previa, enviar vacío la limpia. El editor siempre envía los textos. No incluir secretos ni documentos privados. El futuro publicador usará un contrato explícito y decidirá qué evidencia técnica es apta para mostrar.

El lote piloto real y la revisión de equivalencias siguen pendientes. No se aprueban productos por aparecer en la lista o por pasar pruebas de interfaz.

Equivalencias: el editor muestra vínculos actuales del ERP y permite elegir hasta 30. Ninguna se selecciona por defecto. PUT equivalencias contiene IDs positivos únicos; servidor rechaza IDs no vinculados al producto y el snapshot conserva únicamente ID/código/nombre/marca. Omitir conserva la selección previa; [] la limpia. No implica compatibilidad mecánica verificada. Filtro revision de la lista: todos/con_pendientes/sin_pendientes. El último identifica ausencia de faltantes automáticos, no aprobación final.

WEB01.3a técnico implementado y verificado; WEB01.3b requiere seleccionar y comprobar el lote real por el propietario. WEB01.3 sigue parcial. WEB02.1 puede preparar diseño/arquitectura sin afirmar que el catálogo ya fue aprobado. Las pruebas SQL revierten todos sus fixtures; las pruebas visuales usan API simulada y no certifican datos comerciales reales.
