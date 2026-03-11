## Objective
Implement strict database transactions using TypeORM's QueryRunner to ensure atomicity across sales, payments, and inventory movements.

## Context
Tech Stack: Node.js 25.7.0, NestJS, PostgreSQL 18.
Target Files: `venta.service.ts` (and any other service modifying multiple tables).

## Tasks
1. **QueryRunner Implementation:**
   - In `venta.service.ts` (inside the method that finalizes a sale), inject the `DataSource` and create a `QueryRunner`.
   - Start a transaction: `await queryRunner.startTransaction()`.
   - Execute all related database calls (calling the PostgreSQL Stored Procedures for `venta`, `pago`, and `kardex` stock deduction) using `queryRunner.query(...)` instead of `this.dataSource.query(...)`.
   - On complete success, call `await queryRunner.commitTransaction()`.
   - Implement a strict `try/catch` block. In the `catch` block, trigger `await queryRunner.rollbackTransaction()` and throw an appropriate NestJS Exception.
   - Ensure `await queryRunner.release()` is called in a `finally` block to prevent database connection leaks.