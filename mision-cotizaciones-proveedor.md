## Objective
Implement a "Just-in-Time" Pricing History module. The system must allow users to register, track, and compare quotes from multiple suppliers for a specific product, tracking the brand, price, delivery time, and date to maximize reseller margins.

## Context
Tech Stack: PostgreSQL 18, NestJS (Node 25.7.0), Angular 21.2.0 (Signals, Tailwind CSS, Material).
Business Model: Reseller. Products are rarely stocked; they are quoted with 2-5 local/external suppliers upon customer request.

## Tasks

### 1. Database Schema & Migration (PostgreSQL 18)
- Create a migration file `015_create_producto_cotizacion_prov.sql`.
- Create a table `producto_cotizacion_prov`:
  - `id_cotizacion_prov` (Primary Key, Auto-increment/Serial)
  - `id_producto` (Foreign Key -> `producto.id_producto`)
  - `id_proveedor` (Foreign Key -> `proveedor.id_proveedor`)
  - `marca_ofrecida` (VARCHAR 100, nullable - because suppliers offer different alternative brands for the same generic part)
  - `precio_cotizado` (NUMERIC 10,2)
  - `dias_entrega` (INT, 0 means immediate/local, >0 means external shipping)
  - `fecha_registro` (TIMESTAMP, default NOW())
- Add a trigger or audit capability if necessary.

### 2. Backend API (NestJS)
- Update `ProductoModule` or create `CotizacionProvModule`.
- Create strict TypeScript 5.9.3 DTOs: `CreateCotizacionProvDto`.
- Create endpoints:
  - `POST /api/v1/producto/:idProducto/cotizacion-prov` (Registers a new supplier quote).
  - `GET /api/v1/producto/:idProducto/cotizacion-prov` (Fetches pricing history for a product, joining with the `proveedor` table to get the supplier's name. Sort by `fecha_registro` DESC).

### 3. Frontend UI (Angular 21)
- **Product List (`producto-list.component.html`):** Add a new action button (e.g., a `$`, `price_check` or `manage_search` icon) in the actions column. This button opens a new dialog: `ProductoCotizacionesDialogComponent`.
- **New Dialog (`ProductoCotizacionesDialogComponent`):**
  - Use Standalone components and Angular Signals for state management (`cotizaciones = signal([])`).
  - **Top Section (Form):** A compact inline form (Tailwind flex/grid) with fields: Proveedor (Dropdown), Marca Ofrecida (Input), Precio (Input), Días de Entrega (Input number). A "Guardar Cotización" button using the `isSaving` signal pattern to prevent double submission.
  - **Bottom Section (Data Grid):** A dense `mat-table` displaying the history of quotes for this product. Columns: Fecha, Proveedor, Marca, Precio (Aligned right, currency format), Entrega (Días).
  - Ensure the table highlights the row with the lowest price in a subtle green (`bg-green-50` in light mode, or equivalent dark mode class) to help the user choose the best option instantly.