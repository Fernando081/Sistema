## Objective

Implement Server-Side Pagination directly at the PostgreSQL 18 level to ensure high performance when querying thousands of records, preventing memory overload in NestJS.

## Context

Tech Stack: PostgreSQL 18, NestJS.

## Tasks

1. **PostgreSQL Stored Procedures Update (`backend/migrations/`):**
   - Create a new migration file to `CREATE OR REPLACE FUNCTION` for your main data retrieval functions (e.g., `fn_get_productos`, `fn_get_facturas`).
   - Add two new parameters to these functions: `p_limit INT DEFAULT 10`, `p_offset INT DEFAULT 0`.
   - Append `LIMIT p_limit OFFSET p_offset` to the inner SQL queries.
2. **NestJS Services Refactor (`producto.service.ts`, `venta.service.ts`):**
   - Update the `findAll()` methods to accept `page` and `limit` arguments.
   - Calculate the offset: `const offset = (page - 1) * limit;`.
   - Pass these calculated values into the `dataSource.query()` parameterized array: `this.dataSource.query('SELECT * FROM fn_get_productos($1, $2)', [limit, offset])`.
3. **Controllers Update:**
   - Ensure the respective GET endpoints extract `page` and `limit` using `@Query()` decorators and pass them to the service.
