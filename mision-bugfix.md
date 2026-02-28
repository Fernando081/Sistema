## Objective

Fix critical UI/UX bugs, rendering issues, and data binding failures introduced during the Power BI and Dark Mode refactoring. Ensure the application is stable and visually consistent.

## Context

Tech Stack Strict Requirements: Angular CLI 21.2.0, TypeScript 5.9.3, Tailwind CSS, Angular Material.
The app is experiencing lifecycle rendering bugs, CSS conflicts between Tailwind and Material, and data integration issues.

## Tasks (Bug Fixes)

1. **Bug 1: Dashboard Rendering & Lifecycle (Theme Toggle Issue)**
   - **Symptom:** The dashboard and charts do not render correctly upon navigation until the dark/light mode button is toggled.
   - **Fix:** Fix the `ThemeService` initialization. Ensure the Signal state is evaluated immediately on load. For `ngx-charts`, the issue is likely a layout calculation failing before the container has dimensions. Ensure the charts component triggers a resize event or correctly evaluates its container size in `ngAfterViewInit` or using Angular 21's `afterRender` hook.

2. **Bug 2: Incomplete Dark Mode (Contrast Issues)**
   - **Symptom:** Dark mode leaves some backgrounds white and text black, making it unreadable across different modules.
   - **Fix:** Audit global `styles.css` and component templates. Ensure `mat-mdc-card`, `mat-mdc-table`, table headers (`th`), table rows (`tr`), and typography elements have explicit Tailwind dark mode classes (e.g., `dark:bg-[#1e1e1e] dark:text-gray-200`). Force Angular Material's background and text colors to sync with the Tailwind dark theme.

3. **Bug 3: "Utilidad" Module is Empty**
   - **Symptom:** The `ReportesUtilidadComponent` shows no data.
   - **Fix:** Debug the data fetching flow.
     - Check the service calling `GET /api/v1/reportes/utilidad`.
     - Ensure the component is subscribing correctly (using Signals `toSignal` or the `AsyncPipe`).
     - Verify the `mat-table` `dataSource` is being populated and the HTML template uses the correct column bindings matching the `ProductoUtilidad` TypeScript interface.

4. **Bug 4: Broken Input Fields (Login & Search)**
   - **Symptom:** Input fields (like username/password) have ugly visual gaps or broken outlines.
   - **Fix:** This is a known conflict between Tailwind's CSS reset (`@tailwind base`) and Angular Material's `mat-mdc-form-field`. Fix the CSS overrides in `styles.css` specifically for `.mdc-notched-outline`, `.mat-mdc-text-field-wrapper`, and `.mat-mdc-form-field-flex` to restore the clean Material look without visual tearing.

5. **Bug 5: Useless Top Search Bar**
   - **Symptom:** The top-left search bar does nothing.
   - **Fix:** Locate the main application shell/header (likely in `app.html` or a header component) and completely remove the search input and its associated HTML container to clean up the UI.
