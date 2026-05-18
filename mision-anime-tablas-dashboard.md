## Objective
Integrate Anime.js to implement a Staggered (Cascade) entry effect for all Material Tables and animated Number Counters (CountUp) for the Dashboard KPIs.

## Context
Tech Stack: Angular 21.2.0 (Signals, modern control flow), Anime.js.
Critical: Do NOT manipulate DOM `innerHTML` directly for the counters. Animate a numeric property on an object and update an Angular Signal inside Anime.js's `update()` callback to respect Angular's change detection.

## Tasks

### 1. Table Stagger Effect (`*-list.component.ts`)
- Target `producto-list`, `cliente-list`, and `venta-list` components.
- Import `anime` from `animejs`.
- Create a method `animarEntradaTabla()`. Use `anime({ targets: '.mat-mdc-row', translateY: [20, 0], opacity: [0, 1], delay: anime.stagger(50), duration: 400, easing: 'easeOutCubic' })`.
- Execute this method slightly after the `MatTableDataSource` is populated with backend data. Use Angular 21's `afterNextRender` or a `setTimeout` of 0 to ensure the DOM rows exist before animating.

### 2. Dashboard CountUp Animation (`dashboard.component.ts`)
- In the Dashboard, refactor the KPI totals (e.g., Total Ventas, Utilidad) to be rendered from local Signals (e.g., `ventasAnimadas = signal(0)`).
- Create a reusable logic or method to animate these numbers from 0 to their actual value (`totalVentas`).
- Configure Anime.js to animate a dummy object: `const obj = { val: 0 }; anime({ targets: obj, val: targetValue, duration: 1500, easing: 'easeOutExpo', update: () => this.ventasAnimadas.set(obj.val) });`. Ensure currency pipes in the HTML format the animated signal correctly.