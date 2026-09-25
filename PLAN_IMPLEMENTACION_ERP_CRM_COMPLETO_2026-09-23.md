# Plan integral de implementación ERP + CRM

Fecha: 23 de septiembre de 2026
Negocio: Refacciones y Tractorepuestos Tampico

## 1. Objetivo

Convertir el sistema actual en una plataforma operativa completa para venta de refacciones de servicio pesado diésel. El proyecto debe conectar cotización, pedido, inventario, compras, entrega, facturación, cobranza, CRM, garantías, caja, contabilidad y análisis sin romper los flujos que ya funcionan.

El PAC continuará en modo ficticio hasta la fase específica de sandbox. Los UUID de idempotencia, identificadores internos y nombres aleatorios seguros para archivos sí deben conservarse cuando tengan una función técnica; no deben confundirse con UUID fiscales simulados.

## 2. Principios de implementación

1. Cada fase debe dejar el sistema compilable, probado y utilizable.
2. Los importes, existencias, saldos y estados se validan en backend y dentro de transacciones PostgreSQL.
3. Ningún movimiento financiero o de inventario se elimina físicamente; se cancela o revierte con trazabilidad.
4. Toda operación crítica usa idempotencia para impedir duplicados por doble clic o reintentos.
5. Los cambios nuevos incluyen permisos, auditoría, estados vacíos, carga, errores y diseño móvil.
6. Las migraciones son acumulativas, repetibles en una base restaurada y nunca modifican migraciones ya aplicadas.
7. Se utilizan banderas de funcionalidad cuando un módulo necesite desplegarse antes de quedar disponible para todos.
8. El diseño inicial sigue funcionando con una sola sucursal y un almacén, pero evita decisiones que impidan crecer posteriormente.

## 3. Línea base antes de ampliar

La línea base debe verificarse antes de comenzar cada bloque grande:

- Build backend y frontend.
- ESLint backend sin advertencias.
- Pruebas unitarias backend y frontend.
- Pruebas HTTP de autenticación, permisos y validación.
- Restauración de respaldo en una base aislada.
- Bundle inicial por debajo de 500 kB.
- Respaldo de base de datos y manifiesto de migraciones aplicadas.
- Node 24 LTS como runtime oficial.
- `JWT_SECRET` persistente en desarrollo, pruebas y producción para evitar invalidaciones por reinicio.

## 4. Hoja de ruta general

| Fase | Resultado principal | Dependencias |
|---|---|---|
| 0 | Plataforma y controles de entrega | Estado actual |
| 1 | Pedidos, apartados, surtido y backorders | Inventario, cotizaciones, ventas |
| 2 | Cliente 360 e historial VIN/ESN | CRM, clientes, pedidos |
| 3 | Órdenes de compra y recepciones | Backorders, proveedores, compras |
| 4 | Precios, descuentos, crédito y autorizaciones | Pedidos, clientes |
| 5 | Almacén profesional, ubicaciones y conteos | Reservas, compras |
| 6 | CRM operativo, tareas y notificaciones | Cliente 360 |
| 7 | Analítica, rentabilidad y pronóstico | Datos de fases 1 a 6 |
| 8 | Contabilidad y conciliación bancaria | Ventas, compras, caja, pagos |
| 9 | PAC sandbox y ciclo fiscal | Operación financiera estabilizada |
| 10 | Multialmacén y multisucursal | Almacén y contabilidad estables |
| 11 | Producción, observabilidad y continuidad | Todas las fases necesarias |

## 5. Fase 0: plataforma, permisos y experiencia común

### Backend e infraestructura

- Definir ambientes separados: desarrollo, pruebas, PAC sandbox y producción.
- Configurar secretos persistentes: JWT, base de datos, correo, PAC y cifrado.
- Crear tabla de banderas de funcionalidad o configuración operativa.
- Añadir permisos granulares además de los roles actuales:
  - ventas.crear
  - ventas.descuento
  - inventario.ajustar
  - compras.autorizar
  - credito.autorizar
  - caja.cerrar
  - contabilidad.cerrar_periodo
  - fiscal.timbrar
- Añadir correlación por `X-Request-ID` en logs, auditoría y errores.
- Estandarizar paginación, filtros, ordenamiento y respuestas de error.
- Crear pipeline CI con `npm run verify`, migraciones en base temporal y auditoría de dependencias.

### Frontend

- Unificar encabezados, filtros, estados vacíos, errores, formularios y diálogos.
- Crear componentes compartidos para búsqueda, paginación, dinero, fechas, permisos y carga.
- Añadir centro de notificaciones y contador en la barra superior.
- Añadir borradores y recuperación de formularios largos.
- Añadir preferencias por usuario: tema, columnas, tamaño de página y filtros guardados.
- Completar accesibilidad con teclado, foco, etiquetas y contraste WCAG AA.

### Criterios de aceptación

- Los permisos se aplican tanto en UI como en backend.
- Un usuario sin permiso no puede ejecutar el endpoint aunque conozca la URL.
- Los errores críticos muestran un identificador consultable en logs.
- Todas las pantallas principales funcionan en escritorio y móvil.

## 6. Fase 1: pedidos de venta, reservas y backorders

### Modelo de datos

Crear entidades para:

- `pedido_venta`
- `pedido_venta_detalle`
- `reserva_inventario`
- `surtido_pedido`
- `entrega_pedido`
- `backorder_cliente`
- historial de estados y autorizaciones

Estados sugeridos del pedido:

`Borrador → Confirmado → Parcialmente surtido → Surtido → Entregado → Facturado`

Estados alternos:

`En espera`, `Cancelado`, `Cerrado parcialmente`.

### Reglas críticas

- La existencia se divide en física, reservada y disponible.
- Confirmar un pedido reserva existencias dentro de una transacción.
- Nunca se permite reservar más de la existencia disponible salvo autorización explícita para backorder.
- Cancelar o reducir un pedido libera las reservas.
- Facturar consume únicamente cantidades surtidas o entregadas, según configuración.
- Las recepciones de compra intentan cubrir backorders por prioridad y fecha.
- La conversión de cotización a pedido es idempotente.

### Backend

- CRUD y transición de estados de pedidos.
- Servicio central de reservas con bloqueo de filas.
- Surtido parcial y escaneo de productos.
- Entregas y remisiones.
- Conversión de cotización a pedido.
- Conversión de pedido a venta/factura.
- Consulta y asignación de backorders.

### Frontend

- Bandeja de pedidos con filtros por estado, cliente, responsable y fecha.
- Pantalla de pedido con disponibilidad por partida.
- Vista de surtido optimizada para almacén y escáner.
- Impresión de remisión y lista de surtido.
- Indicadores visibles de reservado, disponible y pendiente.
- Panel de backorders con cliente, producto, antigüedad y compra vinculada.

### Pruebas indispensables

- Dos usuarios no pueden reservar la misma última pieza.
- Cancelar libera exactamente la cantidad reservada.
- Surtidos parciales no duplican salidas.
- Un reintento no crea dos pedidos, reservas o ventas.
- La devolución restaura inventario sin recrear reservas cerradas.

## 7. Fase 2: cliente 360 e historial por VIN/ESN

### Modelo de datos

- Evolucionar `crm_unidad_cliente` a una ficha completa de unidad.
- Asociar cotizaciones, pedidos, ventas, garantías y seguimientos a `id_unidad`.
- Crear historial de aplicaciones y piezas por unidad.
- Permitir contactos múltiples del cliente con cargo y canal preferido.
- Registrar documentos y fotografías de la unidad cuando sean necesarios.

### Funcionalidad

- Ficha Cliente 360 con pestañas:
  - Resumen
  - Contactos
  - Unidades y motores
  - Cotizaciones y pedidos
  - Ventas y facturas
  - Cobranza
  - Garantías
  - Seguimientos
- Ficha de unidad con VIN, ESN, número económico, motor, transmisión, diferencial, marca, modelo, año y notas.
- Línea de tiempo de piezas cotizadas, compradas, devueltas y garantizadas.
- Selección de unidad durante cotización, pedido y venta.
- Sugerencias de productos basadas en compras anteriores de esa unidad.
- Advertencia cuando una pieza no coincide con la aplicación conocida.

### Criterios de aceptación

- Un VIN y un ESN son únicos cuando se encuentran informados.
- La búsqueda global localiza cliente, unidad, VIN, ESN, motor y número económico.
- Una venta asociada a una unidad aparece inmediatamente en su historial.
- Fusionar clientes duplicados conserva unidades y documentos.

## 8. Fase 3: órdenes de compra, recepción y proveedores

### Modelo de datos

- `solicitud_compra`
- `solicitud_compra_detalle`
- `orden_compra`
- `orden_compra_detalle`
- `recepcion_compra`
- `recepcion_compra_detalle`
- `costo_adicional_compra`
- `devolucion_proveedor`
- `evaluacion_proveedor`

### Flujo

`Sugerencia/backorder → Solicitud → Autorización → Orden → Recepción parcial → Factura proveedor → Pago`

### Funcionalidad

- Consolidar necesidades de backorders, mínimos y pronóstico.
- Comparar cotizaciones de proveedores por precio, plazo y disponibilidad.
- Emitir orden de compra y registrar confirmación del proveedor.
- Recibir cantidades parciales, sustituciones y diferencias.
- Distribuir flete, seguro, importación y maniobras entre partidas.
- Actualizar costo promedio o método definido sin alterar costos históricos de ventas anteriores.
- Vincular lotes recibidos con garantías y devoluciones a proveedor.
- Calificar proveedor por precio, cumplimiento, calidad y garantías.

### Pruebas críticas

- Nunca se recibe más de lo pendiente sin autorización.
- Una recepción repetida no duplica inventario.
- La distribución de costos adicionales cuadra al centavo.
- El backorder conserva trazabilidad hasta el pedido del cliente.

## 9. Fase 4: precios, descuentos, crédito y autorizaciones

### Modelo y reglas

- Listas de precios por segmento, vigencia y moneda.
- Precio especial por cliente y producto.
- Escalas por cantidad.
- Promociones con fecha y condiciones.
- Costo de reposición y margen mínimo.
- Límite de crédito, días autorizados y saldo disponible.
- Solicitudes de autorización para descuento, margen bajo y exceso de crédito.

### Frontend

- Simulador de precio y margen antes de guardar.
- Explicación del precio aplicado: lista, promoción, cliente o autorización.
- Bandeja de autorizaciones para administradores.
- Semáforo de crédito en cliente, pedido y venta.
- Estado de cuenta con antigüedad 0–30, 31–60, 61–90 y más de 90 días.

### Criterios de aceptación

- El frontend nunca decide por sí solo el precio final autorizado.
- Toda excepción conserva solicitante, autorizador, motivo, fecha y valores anteriores.
- Los documentos históricos mantienen el precio usado aunque cambie la lista.

## 10. Fase 5: almacén profesional

### Alcance inicial

- Catálogo de almacén, zonas, pasillos, anaqueles, niveles y contenedores.
- Existencia por ubicación.
- Movimientos entre ubicaciones.
- Conteos cíclicos y conteos generales.
- Ajustes con motivos y autorización.
- Etiquetas con código de barras o QR.
- Lotes y números de serie para productos configurados.
- Cascos o piezas recuperables con depósito.
- Kits y despiece de conjuntos.

### Pantallas

- Mapa/lista de ubicaciones.
- Recepción dirigida a ubicación.
- Reubicación por escaneo.
- Conteo cíclico sin mostrar existencia teórica al capturista, cuando se configure.
- Investigación y autorización de diferencias.
- Consulta de trazabilidad por lote o serie.

### Criterios de aceptación

- La suma por ubicaciones coincide con la existencia total.
- Cada diferencia genera movimiento y auditoría.
- Los productos con serie no pueden salir con una serie inexistente o ya utilizada.

## 11. Fase 6: CRM operativo, agenda y notificaciones

### Funcionalidad

- Tareas con responsable, prioridad, vencimiento y relación con cliente, unidad, cotización o pedido.
- Recordatorios dentro del sistema.
- Escalamiento de tareas vencidas.
- Plantillas de llamadas, correos y WhatsApp.
- Registro de comunicaciones sin enviar mensajes automáticamente hasta configurar integraciones autorizadas.
- Campañas y segmentos de clientes.
- Reactivación de clientes inactivos.
- Alertas de cotizaciones próximas a vencer.
- Encuestas breves de satisfacción y motivos de pérdida estructurados.
- Metas y embudo por vendedor.

### Centro de notificaciones

- Backorder recibido.
- Pedido listo para surtir o entregar.
- Crédito excedido.
- Cobranza vencida.
- Garantía próxima a incumplir su fecha compromiso.
- Tarea CRM vencida.
- Stock crítico.
- Fallo de integración fiscal o correo.

### Criterios de aceptación

- Las notificaciones no se duplican.
- Se pueden marcar como leídas y abrir el documento relacionado.
- Cada usuario ve únicamente las tareas y alertas permitidas por su rol.

## 12. Fase 7: analítica y decisiones

### Indicadores comerciales

- Ventas, utilidad y margen por producto, categoría, cliente, vendedor y sucursal.
- Conversión de cotizaciones y tiempo promedio de cierre.
- Clientes nuevos, recurrentes, inactivos y recuperados.
- Descuentos y ventas bajo margen mínimo.

### Indicadores de inventario

- Rotación y días de inventario.
- Clasificación ABC por ventas y utilidad.
- Inventario muerto y lento movimiento.
- Nivel de servicio y tasa de surtido.
- Backorders y ventas perdidas.
- Exactitud de conteos.

### Indicadores de compras

- Variación de costo.
- Tiempo real de entrega por proveedor.
- Cumplimiento de cantidades.
- Rentabilidad por marca y proveedor.

### Implementación técnica

- Vistas o tablas materializadas para cálculos costosos.
- Actualización programada y fecha visible de última actualización.
- Exportación a Excel/PDF.
- Filtros guardados y comparación entre periodos.
- Definiciones documentadas para cada KPI.

## 13. Fase 8: contabilidad y conciliación bancaria

### Modelo

- Catálogo de cuentas.
- Periodos contables.
- Pólizas, partidas y fuentes de origen.
- Cuentas bancarias.
- Movimientos importados del estado de cuenta.
- Conciliaciones y diferencias.
- Centros de costo.
- Presupuestos.

### Automatización

- Pólizas por venta, costo de venta, compra, pago, gasto, devolución, nota de crédito, REP y movimiento de caja.
- Reversos contables en cancelaciones.
- Cierre mensual con bloqueo de periodo.
- Balanza, estado de resultados, balance general y flujo de efectivo.
- Exportación para revisión del contador.

### Condición previa

Antes de activar pólizas automáticas, un contador debe aprobar el catálogo, las reglas y ejemplos completos. Los saldos históricos se concilian; no se inventan asientos para forzar coincidencias.

## 14. Fase 9: PAC sandbox y ciclo fiscal

### Preparación

- Adaptador desacoplado para cambiar de PAC.
- Almacén cifrado de CSD y contraseñas.
- Separación total entre sandbox y producción.
- Cola persistente para timbrado y cancelación.
- Idempotencia por documento.

### Flujo fiscal

- Generar cadena original y sello.
- Validar XML contra XSD y reglas CFDI vigentes.
- Timbrar y conservar XML, UUID, sellos y respuesta íntegra.
- Crear representación impresa desde el XML timbrado.
- Cancelar, consultar estado y conservar acuses.
- Conciliar documentos internos, PAC y SAT.
- Reintentar errores temporales sin duplicar CFDI.
- Bloquear definitivamente cualquier documento mock en producción.

### Pruebas

- Matriz de CFDI de ingreso, egreso, pago y factura global.
- PUE, PPD, impuestos, descuentos, devoluciones y múltiples pagos.
- Errores de certificado, catálogo, red, timeout y rechazo del PAC.
- Cancelación con y sin aceptación cuando corresponda.

## 15. Fase 10: multialmacén y multisucursal

Esta fase se activa solo cuando el negocio la necesite.

### Cambios

- Agregar sucursal y almacén a usuarios, existencias, reservas, pedidos, compras, caja y documentos.
- Folios por serie/sucursal.
- Transferencias con origen, tránsito, recepción y diferencias.
- Precios, mínimos y responsables por sucursal.
- Caja y cuentas bancarias por establecimiento.
- Consolidación corporativa y reportes comparativos.

### Migración

- Crear una sucursal y almacén predeterminados.
- Asignar todos los datos históricos a ese origen antes de hacer obligatorias las claves.
- Validar que saldos y existencias no cambien durante la migración.

## 16. Fase 11: producción y continuidad

- Despliegue automatizado con migración controlada y rollback de aplicación.
- PostgreSQL administrado con respaldo, cifrado y recuperación a un punto en el tiempo.
- Prueba trimestral de restauración.
- Monitoreo de disponibilidad, errores, latencia, conexiones, disco y colas.
- Alertas operativas sin incluir datos fiscales o secretos.
- Rotación de secretos y certificados.
- Segundo factor para administradores.
- Registro de dispositivos y sesiones.
- Política de conservación de auditoría y documentos fiscales.
- Procedimiento documentado para caída de Internet, PAC, base de datos y servidor.
- Capacitación y manuales por rol.

## 17. Mejoras de UI/UX transversales

Se implementan dentro de cada fase, no como una remodelación aislada al final:

- Inicio distinto por rol.
- Acciones rápidas y búsqueda global.
- Navegación por teclado y soporte de escáner.
- Autoguardado y recuperación de borradores.
- Tablas configurables y filtros guardados.
- Formularios divididos por pasos cuando sean largos.
- Resumen fijo de totales y consecuencias antes de confirmar.
- Historial visible en pedidos, compras, clientes y garantías.
- Diseño móvil específico para surtido, recepción y conteo.
- Mensajes que indiquen qué ocurrió y cómo resolverlo.
- Ayuda contextual y glosario de términos fiscales u operativos.

## 18. Estrategia de pruebas

### Unitarias

- Reglas de precios, impuestos, crédito, estados y autorizaciones.
- Reservas, recepciones, lotes, costos y pólizas.

### Integración

- PostgreSQL real en base aislada.
- Bloqueos concurrentes y reintentos.
- Migraciones desde un respaldo representativo.

### E2E

1. Cotización → pedido → reserva → surtido → entrega → factura → cobro.
2. Backorder → orden de compra → recepción → apartado → entrega.
3. Venta por VIN/ESN → devolución → garantía.
4. Compra → recepción parcial → costo adicional → cuenta por pagar → pago.
5. CFDI PPD → pagos parciales → REP → cancelación controlada.
6. Cierre de caja y conciliación.

### No funcionales

- Seguridad por rol y permiso.
- Accesibilidad WCAG AA.
- Rendimiento de búsquedas y listados.
- Recuperación desde respaldo.
- Operación con red lenta y reintentos.

## 19. Definición de terminado por funcionalidad

Una funcionalidad solo se considera terminada cuando incluye:

- Migración y rollback operativo documentado.
- Backend con validación, transacción, permisos y auditoría.
- Frontend con carga, error, vacío, confirmación y diseño móvil.
- Pruebas unitarias y de integración relevantes.
- Flujo E2E principal verificado.
- Documentación de usuario y soporte.
- Métrica o reporte para comprobar su operación.
- Revisión de seguridad y rendimiento.

## 20. Entregas recomendadas

### Entrega A: operación comercial conectada

- Fase 0.
- Pedido de venta.
- Reservas.
- Surtido.
- Backorders.
- Cliente 360 básico.
- Asociación de VIN/ESN con documentos.

### Entrega B: abastecimiento y control de margen

- Órdenes de compra.
- Recepciones parciales.
- Costos adicionales.
- Evaluación de proveedores.
- Listas de precios.
- Crédito y autorizaciones.

### Entrega C: almacén y CRM avanzado

- Ubicaciones.
- Conteos.
- Lotes/series.
- Tareas, alertas y notificaciones.
- Indicadores operativos.

### Entrega D: administración financiera

- Contabilidad.
- Conciliación bancaria.
- Presupuestos.
- Estados financieros.

### Entrega E: fiscal y escalamiento

- PAC sandbox.
- Certificación del flujo fiscal.
- Preparación de producción.
- Multialmacén/multisucursal cuando exista la necesidad real.

## 21. Estimación y forma de ejecución

El alcance completo equivale a varias entregas mayores. Para una implementación cuidada por una sola línea de desarrollo, debe planearse en iteraciones de una a dos semanas y liberar cada entrega después de pruebas operativas. La prioridad no debe medirse solo por número de pantallas; pedidos, inventario, contabilidad y PAC requieren validaciones y pruebas de concurrencia.

Orden de inicio recomendado:

1. Completar Fase 0.
2. Implementar Fase 1 completa.
3. Añadir Cliente 360 e historial VIN/ESN.
4. Continuar con órdenes de compra.
5. Implementar precios y crédito.
6. Profesionalizar almacén.
7. Expandir CRM y analítica.
8. Diseñar contabilidad con el contador.
9. Integrar PAC sandbox.
10. Activar multisucursal únicamente cuando corresponda.

## 22. Primer bloque técnico a ejecutar

El primer bloque de implementación debe contener:

1. Migración de pedidos, detalles, reservas y backorders.
2. Servicios transaccionales de disponibilidad y reserva.
3. Conversión idempotente de cotización a pedido.
4. Bandeja y editor de pedidos.
5. Pantalla móvil de surtido.
6. Liberación de reservas por cancelación o vencimiento controlado.
7. Pruebas concurrentes de la última pieza disponible.
8. Asociación opcional del pedido con cliente y unidad VIN/ESN.
9. Indicadores de existencia física, reservada y disponible en venta y producto.
10. Documentación del flujo para vendedores y almacén.

Este bloque ofrece el mayor beneficio inmediato y crea la base técnica para compras, backorders, crédito, almacén y analítica.
