## Objective
Implement a bidirectional Cross-Reference system (Cruces) for auto parts and upgrade the Point of Sale (PoS) autocomplete UX to proactively suggest in-stock alternatives with a 1-Click Substitution feature.

## Context
Tech Stack: PostgreSQL 18, NestJS (Node 25.7.0), Angular 21.2.0 (Signals), Tailwind CSS.
Business Logic: Auto parts often have exact equivalents from different brands. If Part A crosses with Part B, the system must implicitly know Part B crosses with Part A. 

## Tasks

### 1. Bidirectional Backend Logic (NestJS & PostgreSQL 18)
- Locate or create the cross-reference table (e.g., `producto_cruce` with `id_producto_origen` and `id_producto_destino`).
- Create/Update the endpoint `GET /api/v1/producto/:id/alternativas`.
- **Crucial Query Logic:** The SQL query MUST resolve bidirectionally without duplicating records. Example logic:
  `SELECT p.* FROM producto p JOIN producto_cruce pc ON p.id_producto = pc.id_producto_destino WHERE pc.id_producto_origen = $1`
  `UNION`
  `SELECT p.* FROM producto p JOIN producto_cruce pc ON p.id_producto = pc.id_producto_origen WHERE pc.id_producto_destino = $1`
- The query MUST return the current stock (`kardex` / `stock_actual`) and `precio` of the alternatives.

### 2. PoS Autocomplete UX (`venta.component.html` & `.ts`)
- Update the product search `mat-autocomplete`. 
- If a searched product has `stock === 0`, trigger an automatic background fetch to the `/alternativas` endpoint.
- **Visuals (Tailwind):** Inside the autocomplete option, if alternatives exist, render a highly visible warning badge: `<span class="bg-yellow-100 text-yellow-800 font-bold px-2 py-1 rounded text-xs">0 en stock. Ver {X} alternativas disponibles</span>`.

### 3. 1-Click Substitution UI
- When the user selects a product with 0 stock but available alternatives, open a small `MatBottomSheet` or a `MatDialog` (`AlternativasDialogComponent`).
- Display a data-dense list of the equivalent parts showing: Brand, Price, and Stock.
- Add a "Sustituir" (Substitute) button next to each alternative.
- **Signal State Update:** Clicking "Sustituir" must seamlessly add the chosen alternative to the `carrito` Signal and close the dialog, bypassing the out-of-stock original item completely.

## Constraints
- Use strict TypeScript 5.9.3 interfaces (`ProductoAlternativa`).
- Enforce Angular 21 control flow (`@if`, `@for`) in the templates.
- Maintain the PoS performance; ensure the backend query is optimized and indexed.