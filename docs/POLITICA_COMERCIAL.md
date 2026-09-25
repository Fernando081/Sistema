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
