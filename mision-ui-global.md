## Objective
Implement global UI/UX micro-interactions for an enterprise SaaS look and feel.

## Context
Tech Stack: Angular 21.2.0, Angular Material, Tailwind CSS.

## Tasks
1. **Global Badges & Inputs (`frontend/src/styles.css`):**
   - Add the following utility classes for Soft Badges:
     `.badge { @apply px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase inline-block; }`
     `.badge-success { @apply bg-[#e6f4ea] text-[#39cb7f]; }`
     `.badge-warning { @apply bg-[#fdf3e5] text-[#ffb22b]; }`
     `.badge-danger { @apply bg-[#fde9eb] text-[#fc4b6c]; }`
     `.badge-info { @apply bg-[#e8f2fc] text-[#1e88e5]; }`
   - Override Material inputs to match 8px rounded corners and soft gray background when unfocused:
     `:root { --mdc-outlined-text-field-container-shape: 8px; }`
     `.mat-mdc-text-field-wrapper:not(.mdc-text-field--focused) { background-color: #f8f9fa !important; }`

2. **Page Transitions (`frontend/src/styles.css`):**
   - Add a fade-in-slide-up animation for page routing:
     `@keyframes fadeInSlideUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }`
     `main.flex-1 > div { animation: fadeInSlideUp 0.4s cubic-bezier(0.2, 0, 0, 1) forwards; }`
     *(Adjust the CSS selector to correctly target the main router-outlet wrapper container in `app.html`)*.

3. **Modern Toasts (`app.config.ts` & `styles.css`):**
   - In `app.config.ts`, provide `MAT_SNACK_BAR_DEFAULT_OPTIONS` globally to set `horizontalPosition: 'right'`, `verticalPosition: 'top'`, `duration: 3000`, and `panelClass: ['premium-snackbar']`.
   - In `styles.css`, define `.premium-snackbar` applying a white/dark background, 8px border-radius, modern shadow, and a left border of `#1e88e5`. Ensure text and buttons inside use modern typography.