## Objective
Transform the Quotes module (Cotizaciones) into a B2B CRM tool. Implement partial conversions to Sales (Ventas), track the exact final negotiated price versus the quoted price, and record structured rejection reasons for unclosed items (Win/Loss Tracking).

## Context
Tech Stack: PostgreSQL 18, NestJS (Node 25.7.0), Angular 21.2.0 (Signals, Material), TypeScript 5.9.3.
Business Logic: A quote can have 5 items, but the customer might only buy 3. The remaining 2 must be marked as 'Rejected' with a specific reason. The Sale must be linked to the Quote to calculate lost revenue vs closed revenue.

## Tasks

### 1. Database Schema & Migration (PostgreSQL 18)
- Create migration `017_add_crm_cotizaciones.sql`.
- Alter `cotizacion_detalle` table:
  - Add `estatus` (VARCHAR 20, default 'Pendiente' - allowed: 'Pendiente', 'Comprada', 'Rechazada').
  - Add `motivo_rechazo` (VARCHAR 100, nullable).
  - Add `precio_cierre` (NUMERIC 10,2, nullable - to track if a last-minute discount was given to close the deal).
- Alter `venta` table:
  - Add `id_cotizacion` (INT, Foreign Key -> `cotizacion.id_cotizacion`, nullable).
- Create a DB Function/SP `fn_convertir_cotizacion_parcial` that receives JSON of accepted/rejected items, updates `cotizacion_detalle`, and generates the `venta` and `kardex` movements in a single secure transaction.

### 2. Backend API (NestJS)
- Update `CotizacionModule` and `VentaModule`.
- Create strict TypeScript 5.9.3 DTO: `ConvertirCotizacionDto` containing arrays of `articulosAceptados` (with `precio_cierre`) and `articulosRechazados` (with `motivo_rechazo`).
- Create a `POST /api/v1/cotizacion/:id/convertir` endpoint that invokes the PostgreSQL function inside a TypeORM `QueryRunner` transaction for maximum safety.

### 3. Frontend UI (Angular 21)
- **Quote Detail/List:** Add a prominent "Convertir a Venta" button.
- **Conversion Dialog (`ConvertirCotizacionDialogComponent`):**
  - Use Angular 21 Signals to manage the form state.
  - Render a `mat-table` or dynamic grid containing all items from the quote.
  - Each row must have a Checkbox (Accepted/Rejected).
  - **If Checked (Accepted):** Show a numeric input for `Precio Final` (defaulting to the quoted price, allowing the user to apply a quick discount to close the sale).
  - **If Unchecked (Rejected):** Hide the price input and show a `mat-select` for the Rejection Reason (Options: "Precio alto", "Tiempo de entrega muy largo", "Lo encontró en otra tienda", "Ya no lo necesita", "Otro").
  - Provide a dynamic subtotal at the bottom calculating the expected new Sale total based strictly on the checked items and their updated prices.
  - On Submit, send the payload to the backend and redirect the user to the newly generated Sale receipt.