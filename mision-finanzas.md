## Objective

Implement a unified Finance Module to track expenses, synchronize cash/bank flows automatically from sales, prorate logistics costs, and generate weekly financial reports in PDF.

## Context

Tech Stack: NestJS, PostgreSQL 18, Angular 21.2.0, TypeScript 5.9.3.

## Tasks

1. **Database & Migrations (`backend/migrations/`):**
   - Create a `saldos` table (or similar mechanism) to track current `caja_chica` (cash) and `cuenta_banco` (transfers/cards) balances.
   - Create a `gasto` table: `id`, `fecha`, `concepto`, `monto`, `categoria` (Nómina, Stock, Operativos, Fletes, etc.), `metodo_pago` (Efectivo, Transferencia), `id_usuario`, and an optional `id_compra` (for logistics prorating).
   - Write a trigger/SP so that when a sale (venta) is paid in 'Efectivo', it adds to `caja_chica`; if 'Transferencia/Tarjeta', it adds to `cuenta_banco`.
   - Write a DB function: If a `gasto` is categorized as "Flete/Paquetería" and linked to an `id_compra`, proportionally distribute this cost among the `costo_unitario` of the products in that purchase (Landed Cost).

2. **NestJS Backend (`FinanzasModule`):**
   - Create CRUD endpoints for `Gastos`.
   - Implement a reporting endpoint `GET /api/v1/finanzas/corte-pdf`.
   - Integrate `pdfmake` to generate a PDF on the fly. Strictly set `pageSize: 'LETTER'`. The PDF must include: Income summary (grouped by Cash/Bank), Expense summary (grouped by category), and final expected balances.

3. **Angular Frontend (`GastosComponent`):**
   - Create a Standalone Component for Gastos with a form including a conditional dropdown to link an `id_compra` if the category is logistics.
   - Add a button to download the weekly PDF cut, opening it in a new browser tab or triggering a download.
