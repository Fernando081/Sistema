## Objective

Refactor all Angular Material tables (`mat-table`) across the application to implement strict alignment rules, apply status badges, and replace default empty messages with friendly Empty States.

## Context

Target components: All `-list.component.html` (e.g., Ventas, Compras, Cotizaciones, Productos, Clientes, Proveedores).

## Tasks

1. **Friendly Empty States:**
   - Scan all list components. Replace the current `*matNoDataRow` with a highly visual empty state using an opacity-50 `mat-icon` (like `inventory_2`, `receipt_long`, or `group`), a bold header ("No hay registros aún"), and a helper text. Ensure it spans all columns using `[attr.colspan]="displayedColumns.length"`.

2. **Money Right-Alignment:**
   - Find all table columns dealing with currency, money, or numbers (Total, Subtotal, Costo, Precio, Impuestos).
   - Add Tailwind classes `text-right pr-6` to BOTH the `<th mat-header-cell>` and `<td mat-cell>`.
   - Apply `font-mono font-medium` to the `<td>` text containing the currency pipe.

3. **Status Badges Application:**
   - In components handling statuses (Facturas, Cotizaciones, Compras), update the `estatus` column.
   - Wrap the status text in a `<span>` using the `.badge` class created in Phase 1.
   - Dynamically bind `.badge-success`, `.badge-warning`, `.badge-danger`, or `.badge-info` based on the row's value (e.g., 'Pagada', 'Pendiente', 'Cancelada').
