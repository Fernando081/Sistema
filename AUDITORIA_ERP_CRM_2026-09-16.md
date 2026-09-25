# Auditoría integral y ampliación del ERP + CRM

Fecha: 16 de septiembre de 2026.

## Alcance verificable

Se recorrieron de forma sistemática los 409 archivos fuente de aplicación y migraciones bajo `backend/src`, `frontend/src` y `backend/migrations`: 23,664 líneas de TypeScript, HTML, CSS/SCSS, SQL y JavaScript. La revisión incluyó autenticación, permisos, contratos HTTP, inventario, compras, ventas, cotizaciones, pagos, cuentas por pagar, finanzas, CRM, catálogos, reportes, garantías, uploads, migraciones y pantallas Angular.

La cifra no incluye `node_modules`, bundles compilados, cachés, imágenes binarias ni archivos generados. Ninguna revisión manual puede demostrar ausencia absoluta de defectos futuros; por eso los hallazgos críticos también se comprobaron con pruebas unitarias, HTTP y una restauración aislada de PostgreSQL.

## Correcciones de riesgo alto

- JWT con audiencia, emisor, fechas, versión de sesión y revalidación del usuario activo/rol en cada petición. Desactivar un usuario, cambiarle rol, contraseña o cerrar sesión invalida sus tokens anteriores.
- Login limitado por IP; registro y administración de usuarios solo para administradores; protección para conservar al menos un administrador activo.
- Fallback de credenciales de entorno prohibido en producción y bloqueado ante una caída de la base.
- Totales de ventas y compras recalculados en servidor, operaciones idempotentes, folios serializados y filas de inventario bloqueadas.
- Notas de crédito ligadas a la factura y cliente originales; cantidades, precios, moneda, pagos y garantías validados antes del reembolso.
- Devoluciones parciales con distribución exacta de centavos y límite acumulado por producto.
- REP ligado por identificador interno, cancelación con reverso financiero y protección contra coincidencias de texto.
- Pagos a proveedor y compras de contado afectan caja/banco. La verificación aislada detectó que el trigger de gastos faltaba en la base histórica; la migración 035 lo recrea.
- Cancelaciones bloqueadas cuando existen REP, notas de crédito o garantías vigentes que deben resolverse primero.
- Costo histórico, margen después de devoluciones/notas y demanda con periodos sin venta.
- Upload en memoria: valida firma y terminación del formato antes de escribir, asigna UUID y elimina escrituras parciales.
- PostgreSQL TLS verifica certificados por defecto y lo exige en producción.

## Ampliación funcional

- CRM con pipeline paginado, filtros, agenda, KPIs, historial de seguimientos, versión contra sobrescritura concurrente y registro/consulta de ventas perdidas.
- Administración de usuarios y perfil para cambio de contraseña.
- Catálogo diésel con números OEM, fabricante, alternos y aplicaciones por equipo, motor, modelo, años y restricciones.
- Garantías ligadas a la línea vendida, cantidad pendiente, evidencia, responsable, destino físico, estados y resolución.
- Caja general con apertura/cierre de turno, efectivo contado, esperado, diferencia e historial. La bitácora de movimientos es inmutable y conserva el saldo resultante.
- Descargas seguras, rutas API propias, manejo de sesiones expiradas y correcciones de carreras en búsquedas/listados.
- Correcciones de totales reactivos en factura global, selección coherente de cliente/proveedor y redondeos de compras/cotizaciones.

## Evidencia de validación

- Respaldo legible: `.backups/2026-09-16T16-25-27-516Z/database.dump` y su índice de `pg_restore`.
- Restauración completa del respaldo en una base temporal.
- Migraciones 013 (REP), 014, 035, 036, 040, 045 y 046 aplicadas en la copia y posteriormente eliminada.
- Pruebas reales aisladas: concurrencia de apertura/cierre, bitácora inmutable, compra de contado, idempotencia, devoluciones por centavo, margen neto, nota de crédito/reverso, REP y conversión de cotización.
- Backend: 14 suites y 76 pruebas unitarias aprobadas.
- HTTP: 5 pruebas de autenticación, roles, validación, revocación y rate limit aprobadas.
- Frontend: compilación de producción aprobada y 37 pruebas en ChromeHeadless aprobadas.
- ESLint del backend: cero errores y cero advertencias. Los resultados SQL se validan y tipan mediante `queryRows<Row>()`; el lint raíz usa `--max-warnings=0` para impedir regresiones.
- Auditoría npm: cero vulnerabilidades reportadas.

## Decisiones y límites actuales

- Los UUID, certificados y documentos del PAC siguen siendo ficticios por decisión de esta fase. Todo PDF/XML mock conserva una etiqueta visible sin validez fiscal.
- La caja implementada es general. Varias sucursales, almacenes y cajas requieren agregar `id_sucursal`/`id_almacen` a existencias, movimientos, turnos y documentos; no conviene fingir multialmacén con un solo saldo.
- La migración no inventa conciliación histórica. Pagos a proveedor y gastos nuevos quedan correctos; los movimientos anteriores deben conciliarse contra estados de cuenta antes de ajustar saldos.
- El bundle inicial de producción mide 449.42 kB (115.60 kB estimados transferidos), por debajo del presupuesto preventivo de 500 kB. El shell autenticado, Material y ECharts se cargan por ruta o funcionalidad.
- El proyecto exige Node 24 LTS en `.nvmrc`, `.node-version`, `package.json` y `.npmrc`. La comprobación con Node 24.19.0 pasa; la terminal anfitriona debe seleccionar esa versión para no mostrar la advertencia de Node 25.
- La fase PAC debe incluir sandbox, CSD de prueba, sellado, validación XSD, timbrado/cancelación, acuses, reintentos idempotentes y conciliación contra documentos del SAT.
