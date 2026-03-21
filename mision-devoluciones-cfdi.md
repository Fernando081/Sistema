## Objective
Implement a Surgical Partial Returns module (Devoluciones Parciales). The system must securely process inventory restock, handle financial refunds (Cash vs. Store Credit), and generate the base data structure for a CFDI Tipo E (Egreso / Credit Note) without altering the original closed invoice.

## Context
Tech Stack: PostgreSQL 18, NestJS (Node 25.7.0), Angular 21.2.0 (Signals), TypeScript 5.9.3.
Business Logic: When a customer returns 1 out of 5 purchased spark plugs, the system must create a 'Devolucion', restock that 1 item in the 'kardex', and either deduct the cash from 'caja_chica' or add 'saldo_a_favor' to the customer's CRM profile.

## Tasks

### 1. Database Schema & Stored Procedure (PostgreSQL 18)
- **Migrations:**
  - Create table `devolucion` (`id_devolucion`, `id_factura`, `fecha`, `monto_total`, `metodo_reembolso` [Efectivo, Saldo], `uuid_cfdi_egreso`).
  - Create table `devolucion_detalle` (`id_devolucion`, `id_producto`, `cantidad`, `precio_unitario`).
  - Alter `cliente` table: Add column `saldo_a_favor` (NUMERIC 10,2, default 0).
- **Stored Procedure (`sp_procesar_devolucion_parcial`):**
  - Receives: `p_id_factura`, `p_metodo_reembolso`, and a JSONB array of items (`[{"id_producto": 1, "cantidad": 2, "precio": 150.00}]`).
  - Action 1: Insert into `devolucion` and `devolucion_detalle`.
  - Action 2: Loop JSONB to `INSERT INTO kardex` (Concept: 'ENTRADA POR DEVOLUCIÓN - FACTURA #' || p_id_factura) restoring the exact `cantidad`.
  - Action 3: If `p_metodo_reembolso` = 'Efectivo', insert a negative record in the `gasto`/`saldos` table (deducting from Caja Chica). If 'Saldo a Favor', `UPDATE cliente SET saldo_a_favor = saldo_a_favor + total_refund`.

### 2. Backend API & CFDI Mock (NestJS)
- Update `VentaModule` or create `DevolucionModule`.
- Create strict TS 5.9.3 DTO: `ProcesarDevolucionDto`.
- Create endpoint `POST /api/v1/venta/:id/devolucion`. Wrap the execution of `sp_procesar_devolucion_parcial` inside a TypeORM `QueryRunner` transaction.
- **CFDI Tipo E Preparation:** Before returning the HTTP response, structure a JSON object mathematically ready for the PAC (CFDI 4.0 Egreso rules: TipoDeComprobante='E', specific UUID relations to the original invoice). Log this JSON or return it in the response payload.

### 3. Frontend UI (Angular 21)
- **Invoice Detail View (`factura-detalle.component.html`):** Add a "Generar Devolución" button.
- **Return Dialog (`DevolucionDialogComponent`):**
  - Use Angular Signals (`itemsADevolver = signal([])`).
  - Display the original invoice items. Add a `<input type="number">` to each row bounded by the original purchased quantity.
  - Add a Radio Button group: "Devolver en Efectivo" vs "Generar Saldo a Favor".
  - Show a dynamic total: "Total a Reembolsar: $X.XX".
  - On submit, use `isSaving` signal to disable the button, call the backend, and display a modern Toast notification on success.