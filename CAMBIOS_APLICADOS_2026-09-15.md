# Cambios aplicados al ERP + CRM

Fecha de cierre: 15 de septiembre de 2026.

## Resultado

Se reforzó la base del sistema para continuar las pruebas internas con mejores garantías de seguridad, consistencia contable e integridad de inventario. Los documentos fiscales y UUID de prueba se conservaron en modo simulado de forma intencional; el salto a un PAC y certificados de sandbox queda como una etapa posterior.

## Seguridad y acceso

- Autenticación JWT global con validación de expiración y roles.
- Registro de usuarios restringido a administradores; el rol predeterminado es usuario.
- Rutas sensibles de panel, finanzas, reportes, cancelaciones y devoluciones protegidas por rol.
- Secretos y credenciales retirados de scripts auxiliares y configuración de ejemplo.
- CORS configurable por ambiente, encabezados de seguridad con Helmet y validación estricta de DTO.
- Archivos cargados validados por contenido y guardados con nombres UUID.
- Errores de PostgreSQL traducidos a respuestas seguras sin filtrar detalles internos.

## Ventas, compras e inventario

- Totales recalculados en el servidor y comparados con precisión de centavos.
- Bloqueos de filas para evitar ventas, compras, pagos o devoluciones simultáneas inconsistentes.
- Idempotencia en ventas y compras para evitar duplicados por reintentos de red.
- Folios únicos y serializados por serie.
- Cancelaciones con reversión correcta de inventario y protección contra existencias negativas.
- Devoluciones parciales limitadas a la cantidad realmente vendida y calculadas con el precio e impuestos originales.
- Costo histórico congelado en cada venta para reportes de utilidad confiables.

## Cobranza y finanzas

- Validación de sobrepagos y correspondencia entre pago, cliente y factura.
- REPs con bloqueo transaccional y reversión financiera al cancelar.
- Pagos a proveedores protegidos contra concurrencia y saldos inválidos.
- Corte financiero basado en cobros y gastos reales del periodo.
- Reporte de utilidad identifica costos desconocidos en vez de inventar márgenes.
- Factura global bloquea los tickets exactos incluidos y evita duplicar efectivo o comisiones.

## CRM, catálogo y garantías

- Pipeline CRM con oportunidades, etapas y seguimientos.
- Registro de ventas perdidas para analizar demanda no atendida.
- Catálogo para refacciones diésel con números OEM, fabricante, alternos y aplicaciones por equipo, modelo, motor, año y restricciones.
- Búsqueda remota de productos en ventas, compras, cotizaciones y equivalencias.
- Flujo de garantías ligado al concepto original de factura, con evidencia, destino físico, responsable, estados y resolución obligatoria antes del cierre.
- Acceso a garantías desde el detalle de la factura y módulo `/garantias` en el menú principal.

## Base de datos

El ejecutor de migraciones ahora registra número, nombre y checksum, aplica cada migración en una transacción y detecta alteraciones posteriores. Se agregaron y aplicaron:

- `027_integridad_operativa.sql`
- `028_costo_historico_venta.sql`
- `029_prediccion_demanda_consistente.sql`
- `030_idempotencia_operaciones.sql`
- `031_crm_pipeline.sql`
- `032_catalogo_diesel_y_garantias.sql`
- `033_cancelaciones_devoluciones_seguras.sql`
- `034_garantias_operativas.sql`

Antes de migrar se creó el respaldo local `.backups/pre-integridad-2026-09-15.dump`.

## Validación realizada

- Compilación de backend: correcta.
- Pruebas Jest de backend: 34 aprobadas.
- Prueba transaccional de cancelaciones y devoluciones: correcta y revertida al terminar.
- Compilación de producción del frontend: correcta.
- Auditoría de dependencias de producción: 0 vulnerabilidades.
- Angular Material y CDK alineados con Angular 21.2.
- `git diff --check`: sin errores de contenido.
- Frontend disponible en `http://127.0.0.1:4200`.
- Backend disponible en `http://127.0.0.1:3000/api/v1`; una petición sin token a una ruta protegida devuelve 401.

## Próxima etapa recomendada

1. Usar Node.js 24 LTS para desarrollo y producción; los archivos `.nvmrc` y `.node-version` ya lo indican.
2. Crear un ambiente de staging con datos anonimizados y pruebas de recorridos completos por rol.
3. Integrar el PAC en sandbox, certificados de prueba, timbrado, cancelación, descarga y conciliación de CFDI.
4. Agregar pruebas de integración del PAC y restauración automatizada de respaldos antes de la salida a producción.
5. Optimizar la carga inicial del frontend; la compilación pasa, pero mantiene una advertencia por tamaño del bundle.
