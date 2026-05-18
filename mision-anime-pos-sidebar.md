## Objective
Implement UX micro-interactions using Anime.js: A "Pop" scale effect when items are added to the PoS cart, and a fluid staggered slide-in for the main Sidebar navigation.

## Tasks

### 1. PoS Cart "Pop" Interaction (`venta.component.ts`)
- When a product is successfully added to the `carrito` Signal, trigger a quick visual confirmation.
- Select the specific row added or the general "Total" container.
- Apply a rapid scaling animation: `anime({ targets: '.cart-item-latest, .cart-total-badge', scale: [1, 1.05, 1], duration: 300, easing: 'easeInOutSine' })`.

### 2. Sidebar Fluid Entry (`app.component.ts` / Sidebar Layout)
- On application initial load, animate the sidebar navigation items.
- Target the sidebar links (`.sidebar-nav-item` or equivalent Tailwind classes).
- Apply a staggered slide-in from the left: `translateX: [-30, 0]`, `opacity: [0, 1]`, `duration: 500`, `delay: anime.stagger(60)`, `easing: 'easeOutQuart'`.