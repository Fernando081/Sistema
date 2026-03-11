## Objective
Refactor the Angular 21.2.0 routing architecture to implement Lazy Loading, and upgrade the Point of Sale state management to use Angular Signals exclusively.

## Context
Tech Stack: Angular 21.2.0, TypeScript 5.9.3.
Target Files: `app.routes.ts`, `venta.component.ts`, `compra.component.ts`.

## Tasks
1. **Lazy Loading Routing (`app.routes.ts`):**
   - Refactor all existing routes to use the `loadComponent` function (e.g., `{ path: 'venta', loadComponent: () => import('./venta/venta.component').then(m => m.VentaComponent) }`).
   - Ensure no heavy components are statically imported at the top of the routing file.

2. **Signals Migration (`venta.component.ts` & `compra.component.ts`):**
   - Replace standard array variables for the shopping cart with `carrito = signal<ConceptoVenta[]>([])`.
   - Remove any manual `recalcularTotales()` functions.
   - Implement `subtotal = computed(() => ...)`, `impuestos = computed(() => ...)`, and `total = computed(() => ...)` deriving their values mathematically from the `carrito` signal.
   - Update the HTML templates to invoke the signals (e.g., `{{ total() | currency }}`).