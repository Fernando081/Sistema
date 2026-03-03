## Objective
Finalize the ERP frontend by connecting Server-Side Pagination, implementing Role-Based Access Control (RBAC) in the UI, and adding Progressive Web App (PWA) capabilities.

## Context
Tech Stack: Angular 21.2.0, Angular Material.

## Tasks
1. **Server-Side Pagination Integration (`producto-list`, `factura-list`):**
   - Connect the Angular Material `<mat-paginator>` `(page)` event to trigger HTTP calls.
   - Pass the current `pageIndex` and `pageSize` to the new paginated NestJS endpoints created in Phase 1. Update the `MatTableDataSource` with the fresh chunk of data instead of holding all 15,000 records in memory.

2. **Frontend RBAC (`app.html` & Routes):**
   - Ensure the `AuthService` extracts and stores the user's role (`admin`, `user`, etc.) from the JWT payload upon login.
   - Use Angular 21's `@if` control flow block in the sidebar (`app.html`) to hide administrative links (like `ReportesUtilidad` or Dashboard Analytics) from non-admin users.
   - Add role checks to the Angular Route Guards (`auth.guard.ts`) to prevent manual URL access to restricted views.

3. **PWA Implementation:**
   - Execute the Angular CLI command to add PWA support to the project.
   - Configure `ngsw-config.json` to aggressively cache static assets, fonts, and the application shell, ensuring the PoS interface loads instantly and survives micro-disconnections.