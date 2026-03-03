## Objective
Modernize the Angular 21.2.0 frontend by migrating state management to Signals, preventing RxJS memory leaks, and implementing critical UI loading states.

## Context
Tech Stack: Angular 21.2.0, TypeScript 5.9.3, Angular Material.

## Tasks
1. **Angular Signals Migration (`venta.component.ts` & `compra.component.ts`):**
   - Refactor the shopping cart state to use `signal<ConceptoVenta[]>([])`.
   - Replace manual recalculation functions with `computed()` for subtotal, taxes, and grand total. Ensure the UI templates bind directly to these signals.

2. **Memory Leak Prevention:**
   - Audit all dialog components (e.g., `cliente-dialog.component.ts`, `producto-dialog.component.ts`).
   - Import `takeUntilDestroyed` from `@angular/core/rxjs-interop`.
   - Attach `.pipe(takeUntilDestroyed())` to all `.subscribe()` calls listening to `valueChanges` on form controls to kill subscriptions when dialogs close.

3. **Critical UI Locking (Submit Buttons):**
   - Add a `isSaving = signal(false)` state to all forms (Login, Venta, Compra, Dialogs).
   - Set it to `true` upon submission and back to `false` in the `finalize()` block of the HTTP request.
   - Bind this signal to the `[disabled]` attribute of the submit `<button>` to prevent users from double-clicking and creating duplicate invoices.

4. **Strict Typing (Remove `any`):**
   - Audit `factura-detalle.component.ts` and other components. Replace all `any` types with strict TypeScript 5.9.3 interfaces (e.g., `DetalleFacturaDb`).