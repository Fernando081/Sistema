## Objective

Enable physical product identification through image uploads and implement a bulletproof global Audit Trail for all database mutations.

## Context

Tech Stack: NestJS (Multer), PostgreSQL 18 (JSONB triggers), Angular 21.2.0.

## Tasks

1. **Product Image Gallery (Backend & Frontend):**
   - Add an `imagen_url` column to the `producto` table.
   - Configure `@nestjs/platform-express` (Multer) in a new `UploadController` to accept image files, saving them to a local `/uploads` directory (or memory buffer for now) and returning the URL. Serve these static assets in `main.ts`.
   - Update `ProductoDialogComponent` in Angular to support image Drag & Drop. Display thumbnails in `ProductoListComponent` and the PoS search autocomplete.

2. **Global Audit Trail (Database):**
   - Rewrite the existing `tg_audit()` PostgreSQL trigger function. It MUST capture the exact `OLD_RECORD` and `NEW_RECORD` using the `JSONB` data type, alongside `table_name`, `action` (INSERT/UPDATE/DELETE), `timestamp`, and `db_user`.
   - Write an initialization SQL script that iterates over ALL critical tables (`producto`, `venta`, `compra`, `pago`, `gasto`, `cliente`) and applies this trigger dynamically.

3. **Audit Viewer (Frontend):**
   - Create an `AuditoriaComponent` containing a `mat-table` to view the audit logs.
   - Parse and display the `JSONB` diff visually (what changed from OLD to NEW).
   - Hide this component entirely from the sidebar if the user role is not 'admin'.
