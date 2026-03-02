## Objective

Build the NestJS backend bridge to expose the 23 pre-calculated KPIs from the PostgreSQL 18 materialized views to the frontend.

## Context

Tech Stack: Node.js 25.7.0, TypeScript 5.9.3, NestJS.

## Tasks

1. **Analytics Interfaces (`dashboard.types.ts`):**
   - Create strict TypeScript 5.9.3 interfaces mapping perfectly to the 23 columns returned by the 4 materialized views created in the previous phase (`mv_ventas_facturacion`, `mv_inventario_almacen`, `mv_clientes_cobranza`, `mv_operaciones_avanzadas`). Absolutely NO `any` types.

2. **Dashboard Controller & Service (`backend/src/dashboard/`):**
   - Create 4 new `GET` endpoints in `DashboardController`:
     - `/api/v1/dashboard/ventas`
     - `/api/v1/dashboard/inventario`
     - `/api/v1/dashboard/clientes`
     - `/api/v1/dashboard/operaciones`
   - In `DashboardService`, use `dataSource.query()` to perform a simple `SELECT * FROM mv_[name]` for each endpoint.

3. **Performance Constraint:**
   - The NestJS service MUST NOT manipulate the arrays. Do not use `.reduce()`, `.map()`, or `.filter()` to calculate totals. Just fetch the raw rows from the materialized views and return them as JSON.

4. **Automation:**
   - Import `@nestjs/schedule` and create a daily Cron Job (e.g., at 02:00 AM) that executes `this.dataSource.query('CALL sp_refresh_analytics_views()')` to keep the data fresh.
