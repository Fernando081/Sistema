# Almacén profesional

## Alcance implementado

El módulo permite administrar varios almacenes y ubicaciones físicas, consultar existencias por posición, transferir mercancía y aplicar conteos físicos. También registra lotes con caducidad y números de serie por producto.

La instalación crea el almacén principal `TAM-01` y su ubicación `GENERAL`. Las existencias actuales se cargan inicialmente en esa ubicación.

## Reglas de inventario

- Las entradas de compras, devoluciones, cancelaciones y ajustes positivos llegan a `GENERAL` del almacén principal.
- Las ventas y demás salidas descuentan primero de `GENERAL` y después de las demás ubicaciones con existencia.
- Una transferencia cambia la posición física, pero no modifica la existencia global.
- Un conteo físico modifica la ubicación contada y aplica la misma diferencia a la existencia global y al kardex.
- Las transferencias y los conteos usan un `requestId` para que un reintento no duplique movimientos.
- Ninguna ubicación puede quedar con existencia negativa.
- Al registrar el surtido de un pedido, el sistema genera automáticamente la lista de picking con almacén, ubicación y cantidad.
- La mercancía surtida queda comprometida en su ubicación. Al facturar el pedido, la salida se descuenta de esas mismas posiciones y el picking cambia a `Consumida`.
- Si se cancela un pedido antes de facturarlo, sus posiciones de picking cambian a `Liberada`.

## Operación recomendada

1. Crear zonas y ubicaciones con códigos breves, por ejemplo `A-01-02`.
2. Transferir de `GENERAL` a la posición real cuando se acomode mercancía.
3. Confirmar el pedido y registrar el surtido; el detalle indicará dónde recoger cada producto.
4. Revisar las posiciones sugeridas antes de entregar o facturar.
5. Capturar conteos cíclicos o generales sin mostrar la existencia teórica al capturista.
6. Un usuario autorizado revisa la diferencia y aprueba o rechaza el conteo. El inventario y kardex cambian únicamente al aprobar.
7. Definir la composición de kits y registrar cada armado o desarmado con idempotencia y movimientos de kardex.
8. Controlar cascos recuperables desde la entrega al cliente hasta su recepción, envío y acreditación.
9. Generar etiquetas imprimibles para productos y ubicaciones.
10. Registrar lote y caducidad cuando el fabricante los controle.
11. Registrar el número de serie en componentes que requieran trazabilidad o garantía.

## A01.1 — Verificación por códigos (21/10/2026)

Almacén → Escaneo móvil de picking y el detalle del pedido abren `/almacen/movil`. Reutiliza las asignaciones del surtido, compara ubicación completa/QR y producto exacto/QR, exige cantidad/revisión/confirmación y conserva verificaciones/anulaciones nominales. Permiso `inventario.escanear` ADMIN inicial/delegable; etiquetas QR PDF reales desde esta pantalla y Etiquetas. No genera otro surtido, reserva, entrega o descuento de stock, ni bloquea la facturación anterior. A01.2 mantiene aceptación operativa/dispositivos/impresión reales. [Procedimiento, códigos, reintentos, cámara y límites](ESCANEO_ALMACEN.md).

## Integridad

La función `fn_sincronizar_existencia_ubicaciones` mantiene alineada la suma física con `producto."Existencia"`, incluso para los flujos históricos de compra y venta. Si una salida no puede cubrirse con las ubicaciones disponibles, la transacción completa se cancela.

Los cambios de almacenes, ubicaciones, existencias, transferencias, conteos, lotes y series quedan en la auditoría JSON del sistema.

Los movimientos de kits, cambios de estado de cascos y autorizaciones de conteos también conservan usuario, fecha y trazabilidad.

## Kardex gestionado — Q04.5.3c2c2b2b (2026-10-02)

Conteos directos/autorizados y armado/desarmado de kits usan updateManagedStock dentro de la transacción y conservan su Kardex explícito. El indicador local evita un segundo ajuste manual del trigger 085; no desactiva auditoría, cambios manuales de precio/stock ni sincronización física. En conteos, la ubicación ya modificada se conserva; en kits, la sincronización automática sigue activa. Los indicadores previos se restauran después de cada UPDATE exitoso; errores revierten toda la operación.

Guardado de composición de kits corregido: se pasa un arreglo como parámetro único a ANY. [Validación real](q0453c2c2b2b-stock.json): Kardex único, existencias físicas/globales, rollback completo y reintento. No repara registros históricos ni certifica concurrencia de todos los flujos. GarantiaService actual no modifica stock.

## Reintentos y bloqueos — Q04.5.3c2c3a (2026-10-02)

Transferencias, conteos directos/capturados y movimientos de kits guardan huella y respuesta transaccional. Conserve requestId y contenido al reintentar; un movimiento nuevo requiere otra clave. Misma clave con datos/documento/tipo distintos devuelve 409. Registros históricos sin huella devuelven 409 para consultar original; no se reconstruye su huella. No envíe otra clave para repetir una operación cuyo resultado sigue incierto.

Productos se bloquean por ID antes de ubicaciones en conteos/transferencias. Composición y movimiento de kit comparten bloqueo por kit. Aprobación de conteo conserva bloqueo de cabecera y un solo cambio de estado. [Reporte real](q0453c2c3a-warehouse.json) documenta ocho reintentos por flujo, conflictos, rollback y carga acotada. Persistencia de claves en consumidores frontend no incluida. No certifica todos los procesos ni repara Kardex histórico.
