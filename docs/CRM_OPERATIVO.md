# CRM operativo

La pestaña **Clientes y CRM > Operación CRM** concentra herramientas comerciales que complementan el pipeline y la agenda.

## Tareas y recordatorios

Las tareas se relacionan con un cliente, unidad, oportunidad, cotización o pedido. Incluyen responsable, prioridad, vencimiento, estado y control de versión para evitar que dos usuarios sobrescriban cambios. Los usuarios comunes ven las tareas asignadas o creadas por ellos; un administrador puede consultar y reasignar todas.

Una tarea vencida genera una alerta deduplicada en el centro de notificaciones. Al completarla o cancelarla, la alerta pendiente se marca automáticamente como atendida.

## Alertas operativas

El centro de notificaciones revisa cada diez minutos y al abrirse:

- Cotizaciones pendientes que vencen dentro de tres días o que ya vencieron.
- Facturas PPD cuyo saldo superó los días de crédito del cliente.
- Garantías abiertas a dos días de su fecha compromiso o ya vencidas.
- Productos con demanda reciente, faltante proyectado y existencia crítica.

Las alertas usan una clave única por documento y usuario. Una alerta activa se actualiza en lugar de duplicarse y se marca como atendida cuando desaparece la condición que la originó.

## Bitácora de comunicaciones

Registra comunicaciones entrantes y salientes por llamada, correo, WhatsApp, visita u otro canal. La bitácora conserva autor, fecha, cliente, unidad u oportunidad y el resumen del resultado. Registrar una comunicación no envía mensajes a terceros.

## Segmentos

Permite agrupar clientes por tipo y por días transcurridos sin compra. El total de clientes se calcula al consultar el segmento; no se copia una lista que pueda quedar obsoleta.

## Plantillas y campañas

Las plantillas admiten llamada, correo o WhatsApp. Las campañas se guardan como borradores con segmento, plantilla, vigencia y objetivo. Crear una campaña no envía mensajes: la activación y la integración con un proveedor de comunicación se incorporarán como un flujo separado y auditable.

## Satisfacción

Registra una calificación de 1 a 5 y un comentario ligado a un cliente u oportunidad. El backend rechaza respuestas sin una relación comercial identificable.

## Metas

Un administrador puede definir metas de importe y cierres por vendedor y periodo. El avance se calcula con oportunidades ganadas dentro del intervalo configurado.

## Seguridad y trazabilidad

- La creación de segmentos, plantillas, campañas y metas requiere rol administrador.
- Los cambios se registran mediante los disparadores de auditoría de la base de datos.
- Las consultas usan parámetros para los valores aportados por el usuario.
- Las campañas permanecen en borrador y no producen comunicaciones externas desde esta pantalla.

## Base de datos

La migración `067_crm_operativo.sql` crea las tablas, restricciones, índices y disparadores necesarios. Se valida con `npm run db:check` y se aplica con `npm run db:migrate`.
