# Revisión técnica y funcional del ERP + CRM

Fecha: 15 de septiembre de 2026. Negocio: compra-venta de refacciones para servicio pesado diésel.

## Dictamen

El proyecto tiene una base aprovechable: módulos NestJS por dominio, Angular con componentes standalone y rutas diferidas, PostgreSQL, consultas parametrizadas, transacciones, Kardex, cotizaciones, cruces y cotizaciones de proveedores. Conviene conservar esta arquitectura y endurecer sus reglas de operación.

La prioridad es la integridad de inventario, dinero y permisos. La amplitud de pantallas supera actualmente la cobertura de pruebas y la consistencia de algunas reglas de negocio.

## Alcance y evidencia

- Inventario de 327 archivos bajo backend/src y frontend/src; revisión dirigida de arquitectura, autenticación, controladores, DTO, servicios operativos, frontend de captura, pruebas y scripts SQL relacionados.
- Pruebas backend: 6 suites, 33 pruebas aprobadas con `npm.cmd --workspace backend test -- --runInBand`.
- Compilación de producción frontend: genera bundle; advierte 949.90 kB iniciales frente al presupuesto de 500 kB, unos 223.83 kB estimados de transferencia.
- GET /api/v1/dashboard responde HTTP 200 sin token en el servidor local.
- No se realizaron ventas, compras, pagos, registros de usuarios, cancelaciones ni migraciones sobre la base real.
- No se compararon las definiciones de funciones y triggers instalados en PostgreSQL con las del repositorio. Los hallazgos SQL describen el código versionado y deben contrastarse con la base antes de corregir datos existentes.
- Esta revisión no equivale a una certificación exhaustiva de cada archivo, una auditoría de dependencias ni una prueba integral de todas las pantallas.

## 1. Seguridad y acceso — prioridad inmediata

### 1.1 Registro público con administrador por defecto

Evidencia: [auth.controller.ts](C:/Sistema/backend/src/auth/auth.controller.ts:30).

POST /auth/register tiene @Public() y el rol omitido se convierte en admin. Cualquier persona con acceso a la API puede intentar crear una cuenta administrativa. No se ejecutó esa operación durante la revisión.

Acción: alta de usuarios exclusiva de administradores, rol mínimo por defecto, bootstrap inicial controlado y pruebas de 401/403 para cada ruta sensible.

### 1.2 Dashboard público y permisos incompletos

Evidencia: [dashboard.controller.ts](C:/Sistema/backend/src/dashboard/dashboard.controller.ts:16), [app.module.ts](C:/Sistema/backend/src/app.module.ts), controladores de ventas, productos, finanzas y reportes.

Los cinco endpoints del dashboard son públicos; se confirmó HTTP 200 sin autenticación en el principal. RolesGuard se utiliza en auditoría, pero los demás flujos sensibles revisados se protegen principalmente con autenticación. La restricción visual de Angular no impide llamar a la API.

Acción: matriz explícita de permisos para administrador, mostrador, almacén y cobranza. Separar permisos de vender, cambiar precios, ajustar inventario, cancelar, reembolsar, ver costos y consultar utilidad.

### 1.3 Fallback de autenticación permite ignorar la desactivación

Evidencia: [auth.service.ts](C:/Sistema/backend/src/auth/auth.service.ts:114).

Cuando la validación de BD retorna null, también por usuario inactivo o contraseña incorrecta, se intenta la contraseña de entorno. Si coincide, puede emitirse un token de administrador sin usuario activo asociado. Un cambio de contraseña en BD tampoco invalida automáticamente el acceso alternativo por entorno.

Acción: autenticar contra usuarios persistidos; separar el bootstrap del login normal. Incorporar revocación de sesiones y usar una implementación JWT mantenida, con validación explícita de claims y expiración.

### 1.4 Credencial de PostgreSQL incrustada en archivo versionado

Evidencia: [run-migrations.js](C:/Sistema/backend/run-migrations.js:4), confirmado con git ls-files. El valor se omite deliberadamente en este informe.

Acción: mover configuración a entorno, rotar la credencial si sigue vigente y revisar exposición en el historial/remotos. La cuenta del servicio debe tener permisos limitados; las migraciones deben usar una cuenta distinta.

### 1.5 Archivos y sesión

El upload valida el MIME declarado por el cliente y conserva la extensión original. Conviene validar el contenido real, decodificar/reexportar imágenes y asignar una extensión derivada del formato detectado. Evidencia: backend/src/upload/upload.controller.ts.

Angular conserva el token en localStorage, considera autenticada cualquier sesión que tenga un token y adjunta Authorization a todas las peticiones de HttpClient. Acotar el interceptor al origen/API propios y manejar expiración. Si se adopta cookie HttpOnly, diseñar también protección CSRF; no es solo cambiar el almacenamiento.

## 2. Inventario y ventas — prioridad inmediata

### 2.1 Totales y cantidades no tienen validación de negocio suficiente

Evidencia: backend/src/venta/venta.dto.ts, backend/src/compra/compra.dto.ts, backend/src/venta/venta.service.ts y backend/migrations/021_cfdi_40.sql.

IsNumber permite cantidades negativas; IsArray permite conceptos vacíos. El servicio y la función SQL revisados reciben totales e importes del cliente y los insertan. No se observa recalculado central ni conciliación cabecera-detalle en ese recorrido versionado.

Acción: cantidades positivas, listas no vacías, descuentos acotados, referencias válidas y cálculo autoritativo en backend/BD. Permitir precios negociados mediante reglas de descuento y autorización. Representar importes con precisión decimal y definir redondeo por concepto y comprobante.

### 2.2 Ajustes concurrentes pueden perder movimientos

Evidencia: [026_ajuste_inventario.sql](C:/Sistema/backend/migrations/026_ajuste_inventario.sql:32).

El procedimiento lee existencia sin FOR UPDATE y posteriormente escribe un saldo absoluto. Dos ajustes que lean 10 y descuenten 2 pueden dejar 8 en lugar de 6. Una transacción por sí sola no elimina este patrón.

El trigger de venta de la migración 022 también lee stock sin bloqueo antes de escribir Kardex. Aunque su UPDATE incrementa/decrementa de forma relativa, los saldos anterior/resultante del Kardex pueden quedar incoherentes; tampoco contiene una validación explícita de stock suficiente.

Acción: bloquear productos en orden estable, validar disponible y registrar movimiento/stock en la misma transacción. Añadir pruebas con dos conexiones concurrentes. [Documentación oficial sobre bloqueos](https://www.postgresql.org/docs/17/explicit-locking.html).

### 2.3 Folios con MAX + 1

Evidencia: [venta.service.ts](C:/Sistema/backend/src/venta/venta.service.ts:49), también en factura global.

Dos ventas de la misma serie pueden calcular el mismo folio. Si hay restricción única, una falla; si no, pueden quedar duplicados.

Acción: contador atómico por serie o secuencia, restricción única serie/folio y manejo de reintentos. Incorporar clave de idempotencia: repetir una solicitud por pérdida de conexión debe devolver la venta existente, sin volver a descontar stock.

### 2.4 Devoluciones necesitan vínculo operativo por renglón

El camino de venta permite tipo E y reembolso, mientras el trigger 022 devuelve existencias. No se observa en ese camino una comprobación de unidades originalmente vendidas menos devoluciones previas. Una relación por UUID no sustituye ese control por concepto.

Acción: devolución enlazada al renglón original, cantidad máxima disponible para devolver, precio e impuestos originales y destino físico: vendible, revisión, garantía o merma. La cancelación debe considerar el tipo de documento; el script fix_cancel_factura.sql restaura stock sumando cantidades de forma general.

## 3. Pagos, caja y facturación — prioridad inmediata

### 3.1 REP acepta relaciones e importes insuficientemente validados

Evidencia: backend/src/pago/pago.dto.ts y [pago.service.ts](C:/Sistema/backend/src/pago/pago.service.ts:109).

montoSaldado no tiene mínimo positivo. La consulta bloquea la factura, pero no valida que pertenezca al cliente del REP ni que tenga método/estado elegible. No se verifica que la suma de aplicaciones coincida con montoTotal ni que los IDs sean únicos.

Acción: validar todas esas invariantes antes de guardar. Probar importes negativos/cero, sobrapagos, factura de otro cliente, duplicados, listas vacías y pagos simultáneos.

### 3.2 Cancelar REP no revierte su registro de pago

Evidencia: [pago.service.ts](C:/Sistema/backend/src/pago/pago.service.ts:139) y [cancelarRep](C:/Sistema/backend/src/pago/pago.service.ts:166).

El alta inserta filas en pago; la cancelación cambia estado del REP y aumenta saldo de factura, pero deja esas filas de pago. En los scripts financieros revisados, pago alimenta saldos. Puede aparecer deuda restaurada mientras el ingreso sigue reconocido.

Acción: movimientos de reverso relacionados con el original, sin borrar la trazabilidad. Conciliar saldo de factura, aplicaciones, caja/banco y estado documental. Confirmar triggers reales antes de intervenir datos.

### 3.3 Documentos REP contienen datos de demostración

Evidencia: [pago.service.ts](C:/Sistema/backend/src/pago/pago.service.ts:93) y [XML](C:/Sistema/backend/src/pago/pago.service.ts:518).

Se genera UUID con gen_random_uuid, certificados constantes, Certificado="MII..." y un emisor de ejemplo en XML distinto del PDF. PDF y XML calculan impuestos con reglas diferentes; además se construye XML interpolando texto sin escape estructural.

Acción: separar recibo interno de CFDI timbrado, usar datos fiscales configurados, recuperar impuestos del documento origen, generar XML con biblioteca y validarlo contra esquema. Conservar XML certificado, UUID real, respuesta del PAC y acuses. La representación debe reflejar el estado real: borrador, pendiente, timbrado o cancelado.

Referencias: [Complemento de pagos SAT](https://wwwmat.sat.gob.mx/consultas/92764/comprobante-de-recepcion-de-pagos), [certificación y timbre](https://wwwmatnp.sat.gob.mx/consulta/46336/complemento-para-facturas-electronicas). Este hallazgo se refiere al código, no determina el régimen fiscal aplicable al negocio.

### 3.4 Factura global puede asociar tickets no incluidos en su total

Evidencia: [venta.service.ts](C:/Sistema/backend/src/venta/venta.service.ts:248).

La lectura filtra IDs elegibles, pero el UPDATE final usa todos los idsTickets recibidos. Un lote mixto puede modificar vínculos de documentos que no participaron en el cálculo. La lectura tampoco bloquea tickets y no filtra las fechas recibidas.

Acción: bloquear filas, validar lote completo, fechas y estado; actualizar exclusivamente los IDs aceptados. Separar agregación fiscal de registro de una nueva venta para no duplicar cobros/comisiones; revisar el pago automático PUE de fn_crear_venta y su uso aquí.

### 3.5 El corte financiero no contiene ingresos reales

Evidencia: [finanzas.service.ts](C:/Sistema/backend/src/finanzas/finanzas.service.ts:60).

ingresosRaw es un arreglo vacío y los gastos se acumulan sin periodo. El documento no permite conciliar un turno o día.

Acción: apertura de caja, movimientos por medio de pago, devoluciones, retiros, cierre esperado, efectivo contado y diferencia. Registrar responsable y periodo. El controlador de gastos tampoco pasa el usuario autenticado al servicio.

## 4. Cotizaciones y CRM

### 4.1 Conversión puede tomar un concepto de otra cotización

Evidencia: [cotizacion.service.ts](C:/Sistema/backend/src/cotizacion/cotizacion.service.ts:122).

El UPDATE exige cotización e ID de concepto, pero el SELECT posterior solo exige ID de concepto. Si el UPDATE no afecta filas, el servicio aún puede usar una línea ajena para generar la venta.

Acción: recuperar y bloquear los conceptos bajo la cotización solicitada; validar pertenencia, duplicados, existencia y estado. No confiar en IDs enviados desde el diálogo.

### 4.2 Conversión parcial cierra toda la cotización

Evidencia: [cotizacion.service.ts](C:/Sistema/backend/src/cotizacion/cotizacion.service.ts:193).

Siempre marca Convertida, aunque queden renglones sin decidir o no se haya vendido ninguno. La cabecera se lee sin bloqueo, permitiendo que dos solicitudes lean el mismo estado abierto.

Acción: estados por línea y cabecera derivados; mantener pendientes, registrar cantidades atendidas y permitir ventas parciales sucesivas. Validar y bloquear para evitar conversión duplicada.

### 4.3 Evolución propuesta para tu negocio

- Separar persona/contacto comercial de datos fiscales. Hoy RFC y domicilio fiscal son obligatorios al crear cliente, lo que dificulta registrar prospectos de mostrador.
- Una cuenta puede ser flotilla, taller o transportista; puede tener comprador, mecánico, encargado de pagos y varias direcciones de entrega.
- Oportunidad/cotización con responsable, siguiente acción, fecha prometida y motivo de pérdida: precio, no existencia, marca, entrega o compatibilidad.
- Historial conjunto: consultas, cotizaciones, ventas, devoluciones, garantías y deuda.
- Registrar venta perdida por falta de inventario incluso si nunca hubo factura; ese dato debe ayudar a compras.
- Crédito por cliente: límite, plazo, vencimientos, promesas de pago y autorización para excepciones.

## 5. Catálogo, búsqueda y compras

### 5.1 El buscador operativo se limita a los primeros 1,000 productos

Evidencia: [venta.component.ts](C:/Sistema/frontend/src/app/venta/venta.component.ts:188), [compra.component.ts](C:/Sistema/frontend/src/app/compra/compra.component.ts:105).

La búsqueda se realiza sobre un subconjunto cargado al iniciar. Los productos fuera de él pueden no aparecer aunque existan en la base.

Acción: búsqueda remota con debounce, cancelación de consultas anteriores y paginación; coincidencia exacta de número de parte primero, después cruces, marca y descripción. Revalidar existencia al confirmar.

### 5.2 Ordenamiento ocurre después de paginar

Evidencia: [producto.service.ts](C:/Sistema/backend/src/producto/producto.service.ts:36) y migración 019.

La función aplica LIMIT/OFFSET y el servicio agrega ORDER BY al resultado. Esto ordena una página, no el catálogo completo.

Acción: filtro y orden global antes del límite; desempate estable por ID. Acotar page/limit y evitar que un límite enorme se convierta en una descarga completa accidental.

### 5.3 Modelado recomendado para refacciones diésel

- Número interno separado de números OEM y números por fabricante; preservar el original y normalizar una clave para buscar sin guiones/espacios.
- Aplicaciones por motor, familia, modelo, rango de años y restricciones. Los cruces existentes son una buena base, pero requieren fuente, grado de equivalencia y observaciones; no toda alternativa es intercambiable en todas las aplicaciones.
- Unidad de compra/venta y factor de conversión: pieza, caja, juego, metro o litro según producto.
- Estado: nuevo, reconstruido, usado; depósito y devolución de casco cuando corresponda.
- Garantía vinculada a venta, producto/proveedor, evidencia y resolución.
- Ubicación física y stock disponible, reservado, en tránsito y en revisión.
- Compras separadas en orden, recepción parcial y factura del proveedor. Entrega prometida, faltantes, costo y flete trazables.
- Comparador de proveedores por costo total, disponibilidad, plazo y garantía, aprovechando producto_cotizacion_prov.

## 6. Reportes y reposición

### 6.1 Utilidad calculada con costo supuesto

Evidencia: [003_create_fn_get_utilidad_productos.sql](C:/Sistema/backend/migrations/003_create_fn_get_utilidad_productos.sql:48).

Cuando faltan compras, la función supone costo igual al 50% del precio de catálogo. También usa promedio histórico de compras para ventas históricas: una compra posterior puede cambiar la utilidad atribuida a ventas anteriores. El nombre utilidad_neta no corresponde a descontar todos los gastos del negocio.

Acción: costo de salida persistido al vender, método de costeo definido y costo desconocido explícito. Distinguir margen bruto de resultado después de gastos. Confirmar la función instalada antes de recalcular reportes.

### 6.2 Predicción semanal etiquetada como mensual

Evidencia: [020_create_vw_prediccion_demanda.sql](C:/Sistema/backend/migrations/020_create_vw_prediccion_demanda.sql:41).

Se ajustan unidades semanales y se evalúa un punto futuro, pero el valor se presenta como demanda de 30 días. Las semanas sin ventas desaparecen y RANK comprime el tiempo. Tampoco se filtran egresos en esa agregación.

Acción: calendario completo, devoluciones separadas y suma correcta del horizonte. Para decidir compras, incluir plazo real del proveedor, stock reservado/en tránsito, múltiplos de compra y demanda perdida. Empezar con una regla comprobable: demanda durante reposición + seguridad - disponible - entrante. Compararla con ventas futuras antes de confiar en una predicción más compleja.

## 7. Mantenibilidad y operación

- Mantener monolito modular. Reforzar módulos Inventario, Ventas, Compras, Cobranza, CRM y Fiscal con responsabilidades claras. Evitar repartir la misma regla entre Angular, NestJS y varios triggers.
- Definir un contrato de respuesta único: actualmente se mezclan IdProducto, id_producto e idProducto y se repite el mapeo en componentes. Mapear en el límite del backend, publicar DTO/OpenAPI y generar cliente tipado.
- Migraciones con historial/checksum y ejecución una sola vez. run-migrations.js contiene una lista fija que termina en 013; el repositorio llega a 026 y tiene arreglos SQL sueltos. La migración 010 contiene DROP TABLE de auditoría: volver a ejecutarla puede borrar trazabilidad.
- Auditoría debe guardar usuario de aplicación, operación, motivo y request ID. current_user identifica la cuenta PostgreSQL compartida, no necesariamente a la persona que hizo el cambio.
- Limpiar archivos .orig/.rej y componentes/servicios vacíos después de verificar referencias. Por ejemplo venta.spec.ts prueba Venta en venta.ts, mientras la ruta real utiliza VentaComponent en venta.component.ts.
- Llevar backend hacia tipado estricto y reducir any en contratos de dinero e inventario. No usar casts para ocultar discrepancias SQL/API.
- Unificar manejo de carga/error y cancelar búsquedas anteriores; ProductoListComponent puede aceptar una respuesta antigua después de una búsqueda nueva.
- Fijar una versión de Node soportada por las dependencias y una instalación reproducible. La ejecución actual usa Node 25 y muestra advertencia de versión no LTS.
- Revisar composición del bundle inicial, importaciones pesadas y carga diferida. El build de producción excede el presupuesto configurado; medir antes de optimizar animaciones o gráficos.
- Respaldos de PostgreSQL y uploads, copia externa y simulacro de restauración. El objetivo no es solo generar un backup: es recuperar la operación con datos conciliados.
- Separar entorno de desarrollo/pruebas del de operación. Ninguna prueba de concurrencia o cancelación debe ejecutarse sobre ventas reales.

## 8. Pruebas de aceptación prioritarias

1. Usuario anónimo no obtiene métricas ni crea usuarios; mostrador no ajusta inventario ni consulta utilidad sin permiso.
2. Dos vendedores intentan vender la última pieza: una sola venta prospera.
3. Dos ajustes de inventario simultáneos conservan todos los movimientos y saldos.
4. Reenvío de una venta/pago tras timeout devuelve el resultado anterior sin duplicar.
5. Totales adulterados, cantidades negativas y conceptos vacíos son rechazados.
6. Una conversión no usa conceptos ajenos, no se duplica y conserva pendientes.
7. Pago parcial, cancelación y reembolso concilian factura, aplicaciones y caja/banco.
8. Devolver dos veces no supera lo vendido; mercancía dañada no aumenta disponible vendible.
9. Factura global concurrente o con IDs mixtos no duplica ni reasigna tickets previos.
10. Producto fuera de los primeros 1,000 aparece al buscar; sort es global y estable.
11. Compra posterior no cambia el costo histórico de una venta cerrada.
12. Una base vacía se reconstruye con las migraciones y un respaldo se restaura correctamente.

Estas pruebas necesitan una base PostgreSQL aislada, además de pruebas unitarias. Las 33 pruebas actuales aprobadas no demuestran por sí solas estas garantías.

## Orden de implementación

1. Accesos: cerrar registro público/dashboard, permisos, fallback y credenciales versionadas.
2. Operación confiable: validación central, inventario concurrente, folios e idempotencia.
3. Dinero/documentos: conciliación de pagos y reversos, corte de caja, devolución y estados fiscales reales.
4. Mostrador: búsqueda completa, cruces/aplicaciones, reservas y recepciones parciales.
5. CRM: contactos, seguimiento, oportunidades, crédito y garantías.
6. Reportes: costeo histórico, rentabilidad y reposición basados en datos comprobados.

La primera entrega debe demostrar un ciclo completo: comprar → recibir → vender → cobrar → devolver/cancelar → conciliar inventario y dinero. Esa evidencia es más valiosa para el negocio que añadir más pantallas sin cerrar el ciclo.
