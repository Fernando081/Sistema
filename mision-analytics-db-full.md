## Objective

Create the database architecture using PostgreSQL 18 Materialized Views for a Power BI-style dashboard. You MUST strictly implement ALL 23 specific KPIs listed below. Do not omit any.

## Tasks

Create a SQL migration file in `backend/migrations/` (e.g., `004_create_analytics_views.sql`) that defines the following Materialized Views and a refresh function `sp_refresh_analytics_views()`.

### 1. View: `mv_ventas_facturacion` (Sales & Billing)

Must include exact columns for:

1. **Ingresos Brutos y Netos:** Total sales before and after taxes/discounts.
2. **Ticket Promedio (AOV):** Total revenue / number of tickets.
3. **Margen de Utilidad Bruta (%):** (Revenue - COGS) / Revenue.
4. **Ventas por Categoría/Producto:** Aggregated sales to identify Top 10 and Bottom 10 products.
5. **Comportamiento por Hora/Día:** Sales aggregated by hour and day of the week (for heatmaps).
6. **Descuento Promedio Otorgado:** Sum of discounts / Total sales.

### 2. View: `mv_inventario_almacen` (Inventory & Warehouse)

Must include exact columns for: 7. **Valor Total del Inventario:** Accumulated cost of all current stock. 8. **Tasa de Rotación de Inventario:** COGS / Average Inventory. 9. **Índice de Quiebre de Stock (Stockout Rate):** % of times items were out of stock. 10. **Días de Inventario (DSI):** Estimated days the current stock will last. 11. **Mercancía de Lento Movimiento:** Products with no sales in > 90 days. 12. **Merma o Discrepancia (Shrinkage):** Financial difference between theoretical stock and physical counts. 13. **Retorno de Inversión en Inventario (GMROI):** Gross Margin / Average Inventory Cost. 14. **Costo Aterrizado (Landed Cost):** Product cost + freight/packaging (if applicable in schema).

### 3. View: `mv_clientes_cobranza` (Customers & Billing)

Must include exact columns for: 15. **Tasa de Retención de Clientes:** % of returning vs new customers. 16. **Cuentas por Cobrar (Aging Report):** Total debt bucketed by days overdue (0-30, 31-60, 60+). 17. **Valor del Tiempo de Vida (LTV):** Projected net profit per customer. 18. **Días de Cuentas por Pagar (DPO):** Average time taken to pay suppliers.

### 4. View: `mv_operaciones_avanzadas` (Advanced Operations)

Must include exact columns for: 19. **Tasa de Conversión de Cotizaciones (Quote-to-Win):** % of quotes converted to invoices. 20. **Tasa de Devoluciones (Return Rate):** % of returned items vs sold items. 21. **Rentabilidad por Proveedor/Marca:** Net profit grouped by supplier/brand. 22. **Tasa de Cumplimiento (Fill Rate):** % of orders fulfilled immediately from stock. 23. **Índice de Ventas Cruzadas (Cross-Sell Rate):** Frequency of complementary items bought in the same ticket.

## Constraints

- Ensure all calculations are handled purely in SQL using `SUM`, `AVG`, `COUNT`, and window functions where necessary.
- Use standard PostgreSQL 18 syntax.
