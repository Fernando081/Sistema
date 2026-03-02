## Objective

Implement a high-performance, Power BI-style dashboard in Angular using Apache ECharts to display 23 specific KPIs. Ensure seamless integration with the existing "Tokyo Night" dark mode.

## Context

Tech Stack: Angular 21.2.0, TypeScript 5.9.3, Tailwind CSS.

## Tasks

1. **Dependency Management:**
   - Uninstall `@swimlane/ngx-charts` and install `echarts` and `ngx-echarts`. Update `app.config.ts` to provide ECharts.

2. **Service & State Integration:**
   - Update `DashboardService` using the new Angular `HttpClient` syntax to fetch data from the 4 new endpoints.
   - Use Angular Signals (`toSignal`) to manage the state of the fetched data.

3. **Dashboard Layout (Power BI Style in `dashboard.component.html`):**
   - Refactor the grid using Tailwind CSS.
   - **Top Row (Scorecards):** Use 6 compact Material cards (`mat-mdc-card`) for critical single-value KPIs (e.g., Ingresos Netos, Ticket Promedio, Valor Total del Inventario, Fill Rate, LTV). Use conditional classes for green/red trend indicators.
   - **Middle Rows (Charts - Apache ECharts):**
     - Add a Bar Chart for "Ventas por Categoría" (Top 10 / Bottom 10).
     - Add a Heatmap Chart for "Comportamiento por Hora/Día".
     - Add a Doughnut Chart for "Rentabilidad por Proveedor/Marca".
     - Add a Line Chart for "Tasa de Devoluciones" and "Shrinkage".
   - **Bottom Row (Data Matrix):** Add a dense `mat-table` for the "Aging Report" (Cuentas por Cobrar) and "Mercancía de Lento Movimiento".
   - Use Angular 21 `@if` and `@for` control flow blocks exclusively.

4. **Dynamic Theme Sync (Tokyo Night):**
   - Bind the ECharts instances to the `ThemeService` Signal.
   - Dynamically set the `[theme]` input of the `echarts` directive to `'dark'` when the Signal indicates dark mode, ensuring the charts adapt immediately without a page reload.
