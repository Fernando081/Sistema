## Objective
Refactor the NestJS (Node.js 25.7.0) backend to achieve enterprise-level stability, implementing Server-Side Pagination, Global Exception Filters, secure Database Transactions, and centralizing constants.

## Context
Tech Stack: NestJS, TypeScript 5.9.3, PostgreSQL 18.
The system is an ERP/PoS that must prevent partial data writes, handle DB exceptions gracefully, and scale to thousands of records.

## Tasks
1. **Server-Side Pagination:**
   - Modify the `GET` endpoints in `producto.controller.ts`, `venta.controller.ts`, and `compra.controller.ts` to accept `page` and `limit` query parameters.
   - Update the respective services to use `LIMIT` and `OFFSET` in their `dataSource.query()` calls. Return a structured response: `{ data: [...], total: number, page: number, totalPages: number }`.

2. **Global Exception Filter (`src/common/filters/postgres-exception.filter.ts`):**
   - Create a global NestJS Exception Filter to catch PostgreSQL errors (e.g., code `23505` for unique constraints).
   - Format the response into user-friendly HTTP 409/400 JSON error messages instead of raw 500 errors. Register it in `main.ts`.

3. **Secure Transactions (TypeORM QueryRunner):**
   - Refactor critical mutations in `venta.service.ts` and `compra.service.ts` (where sales and purchases are created and stock is deducted).
   - Wrap the `dataSource.query()` calls inside a TypeORM `QueryRunner` transaction (`await queryRunner.startTransaction()`). Ensure `commitTransaction` on success and `rollbackTransaction` on failure to prevent data corruption.

4. **Constants Centralization:**
   - Create `src/common/constants/app.constants.ts`.
   - Move all "magic strings/numbers" (e.g., tax rates like `0.0125`, CFDI usage codes like `'G03'`, or item categories) into exported TypeScript `enum`s or `const` objects. Replace their hardcoded usage across the backend.