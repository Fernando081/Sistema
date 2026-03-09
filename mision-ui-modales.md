## Objective
Refactor all Angular Material Dialog components to use a clean, modern SaaS layout with explicit headers, close buttons, and unified action footers.

## Context
Target components: All `-dialog.component.html` files (e.g., `cliente-dialog`, `producto-dialog`, `proveedor-dialog`).

## Tasks
For each dialog component template, wrap the existing form fields in the following strict structure:

1. **Header:** Create a top div with `flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50`. Place the `mat-dialog-title` (remove default margins) and add a `mat-icon-button` to close the dialog.
2. **Content:** Ensure the `form` tags wrap both the content and actions. Keep the existing inputs inside `<mat-dialog-content class="!p-6 !pt-4">`.
3. **Footer:** Use `<mat-dialog-actions align="end" class="!px-6 !py-4 border-t border-gray-100 bg-gray-50/30">`. Style the 'Cancel' button as `mat-stroked-button` and the 'Save' button as a `mat-flat-button color="primary"`, both with `!rounded-lg`. Keep the `[disabled]="form.invalid"` logic.