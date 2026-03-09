## Objective

Secure the NestJS application core for production deployment by implementing strict CORS, Helmet for HTTP headers, Rate Limiting against brute-force attacks, Global Exception Filters, and strict JWT expiration.

## Context

Tech Stack: Node.js 25.7.0, NestJS, TypeScript 5.9.3.

## Tasks

1. **Strict CORS (`main.ts`):**
   - Update `app.enableCors()` to restrict `origin` to specific production and local domains (e.g., `['http://localhost:4200', 'https://tudominio.com']`), allowing specific methods and `credentials: true`.
2. **Helmet Security (`main.ts`):**
   - Install `helmet` via npm.
   - Apply `app.use(helmet())` to hide Express/NestJS footprint and protect against XSS.
3. **Rate Limiting (`app.module.ts`):**
   - Install `@nestjs/throttler`.
   - Configure `ThrottlerModule.forRoot` with a strict limit (e.g., 10 requests per 60 seconds) and provide `ThrottlerGuard` globally to prevent brute-force attacks on the login route.
4. **Global Exception Filter (`main.ts`):**
   - Import the existing `PostgresExceptionFilter` and register it globally using `app.useGlobalFilters(new PostgresExceptionFilter())` to prevent DB structure leaks.
5. **JWT Expiration (`auth.module.ts`):**
   - Ensure the JWT registration object has a strict `signOptions: { expiresIn: '8h' }` to prevent infinite token validity.
