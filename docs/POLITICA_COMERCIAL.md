# Precios, crédito y autorizaciones

## Prioridad del precio

El motor comercial elige el precio en este orden:

1. Precio especial vigente para cliente y producto.
2. Escala vigente de la lista asignada al cliente, usando la mayor cantidad mínima aplicable.
3. Precio público del producto.

El backend calcula además el costo de reposición, precio mínimo y margen. El costo proviene del valor configurado, recepciones recientes, kardex de compras o una estimación conservadora cuando todavía no existe historial.

La venta de mostrador consulta el motor al seleccionar un cliente y al agregar productos. El backend vuelve a validar el precio dentro de la misma transacción al crear una cotización, pedido o venta; por ello una manipulación del navegador no puede omitir la política.

## Crédito

Cada cliente puede tener lista, límite, días autorizados y bloqueo. El crédito disponible descuenta facturas pendientes y pedidos todavía comprometidos.

## Autorizaciones

Las excepciones de descuento, margen bajo o exceso de crédito conservan solicitante, motivo, valor solicitado, referencia, autorizador, resolución y vigencia. Solo un administrador puede aprobarlas o rechazarlas.

Una cotización comprueba que exista la autorización, pero no la gasta. La autorización se consume al crear el pedido o la venta final y queda vinculada al tipo e identificador de esa operación. El bloqueo y consumo usan bloqueos de fila para impedir que dos operaciones concurrentes utilicen la misma autorización.

La validación de crédito se aplica a operaciones PPD. Al facturar un pedido, su importe se excluye de los compromisos antes de sumar la nueva cuenta por cobrar, evitando contabilizarlo dos veces.

Los clientes sin una fila en `cliente_comercial` conservan temporalmente el comportamiento histórico. Esto permite configurar y activar la política cliente por cliente durante la etapa de pruebas.

## Pantalla

Abra **Ventas → Precios y crédito** para usar el simulador, configurar clientes y atender la bandeja de autorizaciones.

## Relación con S03 (19/10/2026)

Las excepciones de descuento/margen/crédito y su consumo atómico ya están implementadas; no son un faltante nuevo. S03.1/098 protege la tabla de auditoría existente y añade trazabilidad administrativa de acceso, sin cambiar estas reglas comerciales. No añade por sí sola contexto de actor a todas las mutaciones comerciales.

S03.2 amplía la matriz por monto/tipo de operación, límites de autoridad, separación configurable del solicitante/aprobador y revalidación del actor dentro de las transacciones descritas abajo. No se impone doble aprobación a una empresa con un único administrador sin una política operativa acordada. [Auditoría, límites y pruebas](AUDITORIA_Y_APROBACIONES.md).

## S03.2 — Matriz y límites de aprobación (19/10/2026)

Migración **099_aprobaciones_por_operacion.sql**. No modifica migraciones aplicadas ni reescribe autorizaciones anteriores. Crea nueve reglas: Venta/Pedido/Cotizacion × Descuento/Margen bajo/Exceso credito, con versión, tope opcional del total, separación y vigencia máxima. El estado inicial conserva compatibilidad: sin nuevo tope, separación desactivada y vigencia máxima24h. No se inventan límites financieros del negocio.

### Configurar reglas y autoridad

En **Ventas → Precios y crédito → Reglas de aprobación**:

1. Editar la combinación de operación y excepción. Indicar motivo, tope del **total del documento con impuestos en MXN/tipo de cambio1**, horas máximas1–720 y si el aprobador debe ser diferente del solicitante.
2. Un tope vacío significa sin límite; cero solo admite total cero. El motivo queda auditado. Guardar incrementa versión e invalida para uso futuro las aprobaciones de versiones anteriores de esa combinación; no se cambian ventas ya confirmadas ni se borra el historial.
3. Elegir administrador y operación para fijar un límite individual adicional. Sin registro, no hay tope individual adicional; vacío retira ese tope sin borrar el registro de cambios. Se aplica el menor de regla/límite individual. Cambiar el límite afecta el próximo uso de autorizaciones existentes, sin extender su monto originalmente aprobado.
4. Los límites no conceden rol ni permiso. Aprobar exige administrador activo y `credito.autorizar`. Configurar exige administrador y **`comercial.configurar_aprobaciones`**, concedido inicialmente solo al rol admin y administrable por perfiles/excepciones existentes. Una cuenta con permiso de configuración puede cambiar sus propios límites: no sustituye separación organizativa del responsable de políticas.

Antes de activar aprobador distinto, disponer de otro administrador habilitado. No se activa automáticamente. La regla no exige dos aprobadores ni añade firmas o una cadena de escalamiento multinivel.

### Solicitar y resolver

**Autorizaciones → Solicitar excepción comercial** permite seleccionar cliente, producto cuando corresponde, destino, valor unitario solicitado/referencia, tope del total y motivo. Para exceso de crédito no hay producto y el valor solicitado es el total de la operación. El monto indicado es un alcance máximo propuesto; no sustituye al cálculo del servidor.

El simulador prepara cliente/producto/precio/tipo y permite ir al formulario para completar el monto total y motivo. Precio propuesto vacío conserva el sugerido; cero se respeta como precio explícito y se somete a la política.

El administrador registra resolución y vigencia. La decisión bloquea la solicitud pendiente, revalida cuenta/versión/permiso, consulta reglas/límite actuales y aplica separación/topes/vigencia. Rechazar una solicitud fuera de límite sigue siendo posible. La aprobación conserva versión y snapshot de regla/límite/separación/horas en `politica_decision`; el evento de auditoría captura además el nombre del actor. Una decisión concurrente posterior recibe409. Un error conserva el borrador de la pantalla.

La bandeja conserva su ventana de200 solicitudes, fecha de vencimiento, solicitante/aprobador, destino, monto y vínculo de uso. Un estado Aprobada por sí solo no garantiza vigencia: puede vencer o dejar de cumplir permisos, límite o versión de regla.

### Comprobar al utilizar

- El servidor calcula el total y el precio **neto después del descuento de renglón**. El alcance aprobado debe corresponder al cliente/producto/tipo, precio solicitado dentro de la tolerancia existente0.01, destino y total máximo. Se corrige la omisión anterior del descuento al revisar margen.
- Se comprueban nuevamente vigencia, versión actual de regla, administrador aprobador activo, permiso de aprobación, límite individual/regla y separación. Una reducción de límite o revocación no conserva una facultad anterior por el simple estado Aprobada.
- Configuración y uso comparten bloqueo transaccional de política. Los aprobadores candidatos se bloquean antes de obtener un nuevo snapshot de permisos; las mutaciones normales de acceso bloquean esa misma cuenta. Se conserva el bloqueo y consumo único de la solicitud. La respuesta SQL de consumo usa CTE/SELECT para evitar confundir filas retornadas con el contador del controlador PostgreSQL.
- Una cotización valida y no consume. Pedido/venta consumen atómicamente y enlazan operación/ID. Una cotización y un pedido nuevos requieren el alcance de su destino. La facturación de un pedido conserva los precios ya comprometidos por ese pedido; el crédito se verifica al facturar. Los reintentos existentes por requestId conservan documento y stock.
- Los topes implementados son **MXN con tipo de cambio1**. Una excepción que requiera comparar otra moneda/tipo de cambio se rechaza; no se hace una conversión implícita. Operaciones que no requieren autorización conservan sus contratos previos.

Los clientes sin `cliente_comercial` conservan el modo histórico, como antes. Esta migración no configura automáticamente sus límites o política. Autorizaciones históricas ya aprobadas sin destino/monto se conservan y pueden validarse solo bajo la versión inicial compatible de la regla, con aprobador actual identificado/habilitado y topes actuales; cambiar esa regla obliga a una nueva solicitud con alcance. Una solicitud histórica pendiente sin alcance debe reemplazarse para aprobar, aunque puede rechazarse. No se fabrican snapshots o montos retroactivos.

### API y cobertura de actor

| Ruta privada bajo `/api/v1/comercial` | Acceso/contrato |
| --- | --- |
| GET `politica-aprobaciones` | ADMIN, snapshot consistente de reglas, límites y administradores elegibles; private/no-store |
| PUT `reglas-aprobacion` | ADMIN + permiso de configuración; operación/tipo, monto opcional, separación, horas, versión y motivo |
| PUT `limites-aprobacion/:idUsuario` | Mismo acceso; operación, monto opcional, versión (0 si no existe), motivo |
| POST `autorizaciones` | Cuenta persistida vigente; añade `operacionDestino` y `montoOperacion` obligatorios |
| POST `autorizaciones/:id/resolver` | ADMIN + credito.autorizar; resolución no vacía, horas acotadas por regla; snapshot al aprobar |

Los clientes API anteriores deben enviar destino y monto en solicitudes nuevas. Versiones de regla/límite anteriores producen409, no sobrescritura. Mutaciones de crédito, listas, escalas y precios especiales comparten transacción con revalidación y contexto LOCAL de auditoría. Los HTTP de creación de venta, cotización, pedido, pedido desde cotización, facturación de pedido y conversión parcial también propagan el actor autenticado y lo revalidan dentro de la transacción; el alta de venta conserva su comprobación de `ventas.crear`. Los llamados internos de servicios usados por fixtures/otros procesos conservan compatibilidad con ID opcional, sin inventar una sesión verificada. No se declara cobertura universal de todas las acciones del ERP.

Se conserva el motivo de bloqueo al editar condiciones y la etiqueta aclara que el bloqueo vigente afecta operaciones del cliente. Los controles SQL de S03.1 y sus límites frente al propietario PostgreSQL permanecen. No hay nueva dependencia, timbre real o conexión bancaria. Pruebas y límites de liberación en el README y el [manual de auditoría](AUDITORIA_Y_APROBACIONES.md).
