## Objective

Upgrade password cryptography from PBKDF2 to Bcrypt for GPU-resistance, and eliminate all "Magic Strings" across the application by centralizing variables into TypeScript Enums.

## Context

Tech Stack: Node.js 25.7.0, NestJS, TypeScript 5.9.3.

## Tasks

1. **Bcrypt Implementation (`auth.service.ts`):**
   - Install `bcrypt` and `@types/bcrypt`.
   - Replace the `crypto.pbkdf2` logic in the Auth service with `bcrypt.hash()` for password creation and `bcrypt.compare()` for login verification. Use a salt round of 10.
2. **Enums Centralization (`src/common/enums/`):**
   - Create centralized enum files (e.g., `app.enums.ts`).
   - Define strict Enums for:
     - User Roles (`ADMIN`, `USER`).
     - SAT Tax Objects (`NO_OBJETO = '01'`, `SI_OBJETO = '02'`).
     - Payment Methods (`EFECTIVO = 'Efectivo'`, `TRANSFERENCIA = 'Transferencia'`).
3. **Codebase Refactor:**
   - Scan the backend and replace raw string usage (e.g., `if (role === 'admin')`) with the newly created Enums (e.g., `if (role === RolUsuario.ADMIN)`).
