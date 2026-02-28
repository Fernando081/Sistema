## Objective
Fix lingering UI bugs from the previous refactor. Resolve Angular 21 initialization issues for ngx-charts, apply a cohesive "GitHub Tokyo Night" dark theme globally, and fix CSS conflicts breaking Angular Material input fields.

## Context
Tech Stack: Angular 21.2.0, TypeScript 5.9.3, Tailwind CSS, Angular Material.

## Tasks (Critical Bug Fixes)

1. **Bug 1: Dashboard/Charts Initial Rendering**
   - **Symptom:** The dashboard remains blank on initial load until the theme toggle is clicked.
   - **Technical Fix:** The `ThemeService` Signal must be initialized synchronously with the stored value from `localStorage` so it doesn't emit late. Additionally, `ngx-charts` is failing to calculate its container size on load. In `dashboard.component.ts`, use Angular 21's `afterNextRender` or `ngAfterViewInit` to trigger a manual window resize event (`window.dispatchEvent(new Event('resize'))`) slightly after the view loads to force the charts to draw.

2. **Bug 2: Incomplete Dark Mode Background (Tokyo Night Theme)**
   - **Symptom:** Cards are dark, but the main application background remains white.
   - **Technical Fix:** Implement the "GitHub Tokyo Night" color palette. 
   - Light Mode: Background `#f3f2f1`, Cards `#ffffff`.
   - Dark Mode: Global Background `#1a1b26`, Cards `#1f2335`, Text `#c0caf5`, Borders `#292e42`.
   - Crucial: Ensure the global dark background is applied to the `<body>` tag, the `<mat-sidenav-container>`, and `.mat-drawer-content` in `styles.css` and `app.html` using Tailwind's `dark:bg-[#1a1b26]`. 

3. **Bug 3: Broken Angular Material Inputs (CSS Conflict)**
   - **Symptom:** Input fields (like username/password or search) have a broken visual line or gap at the beginning.
   - **Technical Fix:** Tailwind's CSS reset (`preflight`) is stripping the default border styles that Angular Material relies on for its `.mdc-notched-outline`. 
   - Add this specific override to your global `styles.css` to fix the Material Inputs:
     ```css
     .mdc-notched-outline__notch {
       border-right: none !important;
       border-left: none !important;
     }
     .mat-mdc-text-field-wrapper {
       box-sizing: border-box !important;
     }
     ```
   - Ensure input backgrounds adapt to Tokyo Night (`dark:bg-[#16161e]`).