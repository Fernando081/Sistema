# Sistema (Ventas, Compras, Inventario, Cobranza y Facturación)

Monorepo full-stack con **NestJS + TypeORM (backend)** y **Angular standalone + Material (frontend)** para operar procesos comerciales: clientes, proveedores, productos, ventas, compras, cotizaciones, cobranza y cuentas por pagar.

## 1) Estado actual del proyecto

El sistema está funcional en arquitectura cliente-servidor:

- **Backend** con API REST versionada (`/api/v1`) y validación global de DTOs.
- **Frontend** standalone con rutas protegidas por guard JWT.
- **Autenticación JWT** implementada de extremo a extremo (login, guard, interceptores).
- **Módulos de negocio** activos para catálogo y operación comercial.
- **Base SQL principal** en `Sistema_Completo.sql` + carpeta de migraciones en `backend/migrations`.

## 2) Stack técnico

- **Backend:** NestJS 11, TypeORM 0.3, PostgreSQL, class-validator, pdfmake, nodemailer.
- **Frontend:** Angular 20, Angular Material, RxJS.
- **Persistencia:** PostgreSQL.
- **Auth:** JWT HS256 con guard global en backend.

## 3) Estructura del repositorio

- `backend/` API REST, módulos de dominio, entidades, auth, servicios.
- `frontend/` aplicación Angular, componentes standalone, servicios HTTP e interceptores.
- `backend/migrations/` scripts SQL incrementales.
- `Sistema_Completo.sql` script integral de base de datos.
- `ANALISIS_CODIGO.md` análisis técnico y mejoras aplicadas.

## 4) Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL 14+

## 5) Configuración de entorno

### Backend (`backend/.env`)

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=sistema

JWT_SECRET=cambiar-en-produccion
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123

EMAIL_USER=correo@gmail.com
EMAIL_PASS=app-password
```

### Frontend

Variables por entorno en:

- `frontend/src/environments/environment.ts`
- `frontend/src/environments/environment.development.ts`
- `frontend/src/environments/environment.production.ts`

Se recomienda proxy en desarrollo (`frontend/proxy.conf.json`) para consumir `/api/v1`.

## 6) Instalación y ejecución

### Backend

```bash
cd backend
npm install
npm run start:dev
```

API por defecto: `http://localhost:3000/api/v1`

### Frontend

```bash
cd frontend
npm install
npm start
```

UI por defecto: `http://localhost:4200`

## 7) Seguridad y autenticación

### Implementado

- `POST /api/v1/auth/login` (público) para obtener token.
- Guard global `JwtAuthGuard` para proteger endpoints.
- Decorador `@Public()` para excepciones puntuales.
- `AuthService` con:
  - Validación contra tabla `auth_user`.
  - Fallback a credenciales de entorno si la tabla no está disponible.
  - Validaciones adicionales de seguridad para producción.
- Frontend con:
  - `authGuard` para rutas privadas.
  - `authInterceptor` para inyectar `Bearer` automáticamente.
  - `errorInterceptor` para manejo global de errores (incluye 401).

### Nota operativa

Existe endpoint `POST /api/v1/auth/register` como `@Public()` para alta inicial de usuarios. En producción se recomienda restringirlo o deshabilitarlo tras el bootstrap inicial.

## 8) Funcionalidad de negocio cubierta

- Dashboard de métricas.
- Catálogos SAT (régimen fiscal, forma/método pago, uso CFDI, estado, municipio, clave prod/serv, clave unidad, unidad, objeto impuesto).
- Clientes, proveedores, categorías y productos.
- Ventas + generación de ticket/PDF (servicio dedicado).
- Compras e historial.
- Cotizaciones (alta + historial).
- Cobranza y cuentas por pagar.

## 9) Cambios y mejoras ya incorporados

- Refactor de venta para separar generación de PDF en `TicketService`.
- Tipado adicional para ticket (`ticket.types.ts`) y servicios en frontend.
- Cálculo monetario en centavos en flujo de ventas para reducir errores de coma flotante.
- Normalización de contratos API hacia camelCase en frontend (por ejemplo cliente/proveedor/producto).
- Estado de carga para evitar doble envío en registro de venta (`guardandoVenta`).
- Pruebas unitarias base en auth y servicios críticos (`compra`, `pago`, `pago-proveedor`).

## 10) Pruebas

### Backend

```bash
cd backend
npm test
```

### Frontend

```bash
cd frontend
npm test
```

## 11) Recomendaciones pendientes

1. Cerrar o proteger `auth/register` para ambientes productivos.
2. Consolidar estrategia de moneda/decimales también en backend para cálculos fiscales.
3. Ampliar cobertura de pruebas E2E para flujos completos (venta, compra, pagos).
4. Añadir observabilidad (logging estructurado + trazabilidad por request).


## 12) Registro de cambios y mejoras (histórico)

> Esta sección se mantiene para **no perder trazabilidad** de mejoras realizadas.

### Seguridad y auth
- Implementación de `AuthModule`, `AuthService`, `JwtAuthGuard` global y decorador `@Public()`.
- Login JWT operativo en `POST /api/v1/auth/login`.
- Integración frontend de `authGuard`, `authInterceptor` y `errorInterceptor`.
- Evolución de auth a usuarios persistidos (`auth_user`) con fallback por entorno para desarrollo.

### Ventas y facturación
- Refactor para delegar generación de PDF a `TicketService`.
- Tipado adicional para datos de ticket (`ticket.types.ts`).
- Ajustes de precisión monetaria en frontend de ventas con estrategia en centavos (`toCents/fromCents`).
- Mejora UX en guardado de venta con estado `guardandoVenta` para evitar doble envío.

### Contratos y mantenibilidad
- Normalización progresiva de respuestas a camelCase en frontend.
- Reducción de usos de `any` en servicios relevantes.
- Validación global de DTOs en backend (whitelist/transform/forbidNonWhitelisted).

### Calidad
- Pruebas unitarias base agregadas/reforzadas en `AuthService`, `CompraService`, `PagoService` y `PagoProveedorService`.
