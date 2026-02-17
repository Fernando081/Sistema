# Sistema (Ventas, Compras, Inventario y Facturación)

Monorepo con **NestJS (backend)** + **Angular standalone (frontend)** para operar clientes, proveedores, productos, ventas, compras, cotizaciones, cobranza y cuentas por pagar.

## 1) Arquitectura técnica

- **Backend:** NestJS + TypeORM + PostgreSQL + funciones SQL/stored procedures.
- **Frontend:** Angular 20 standalone + Angular Material + Tailwind utilities.
- **Base de datos:** script principal en `Sistema_Completo.sql`.
- **Comunicación:** REST bajo prefijo `/api/v1`.

Estructura:

- `backend/` API, módulos de dominio y acceso a BD.
- `frontend/` UI y servicios HTTP.
- `ANALISIS_CODIGO.md` mejoras técnicas y estado.

## 2) Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL 14+

## 3) Variables de entorno

### Backend (`backend/.env`)

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=sistema

# Auth
JWT_SECRET=cambiar-en-produccion
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123

# Correo para envío de facturas
EMAIL_USER=correo@gmail.com
EMAIL_PASS=app-password
```

### Frontend

Se usa configuración por entorno en `frontend/src/environments/*` con `apiBaseUrl`.
Recomendado en desarrollo: proxy Angular (`/api/v1` -> backend:3000).

## 4) Instalación y arranque

### Backend

```bash
cd backend
npm install
npm run start:dev
```

### Frontend

```bash
cd frontend
npm install
npm start
```

Abrir `http://localhost:4200`.

## 5) Seguridad implementada (JWT)

- Endpoint público de login: `POST /api/v1/auth/login`.
- Guard global que protege el resto de endpoints con `Authorization: Bearer <token>`.
- Token firmado HS256 (HMAC) con expiración.
- Frontend con:
  - `AuthService` (persistencia de token en `localStorage`).
  - `authInterceptor` (inyecta token automáticamente).
  - `errorInterceptor` (manejo global de 401/4xx/5xx).
  - `authGuard` en rutas privadas.
  - `LoginComponent`.

> Credenciales por defecto para dev: `admin / admin123` (ajustar por `.env`).

## 6) Refactor clave: PDF de factura

Se separó la generación del PDF en un servicio dedicado (`TicketService`) para mantener `VentaService` enfocado en la orquestación y datos de negocio.

## 7) Tipado y precisión de moneda

- Se agregaron interfaces de tipado para resultado del ticket (`ticket.types.ts`).
- En frontend de ventas, totales y cálculos se consolidan en centavos para evitar errores de coma flotante.

## 8) Pruebas

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

Incluye pruebas base para autenticación (`auth.service.spec.ts` en backend y frontend).

## 9) Deploy y operación

- Definir `JWT_SECRET` fuerte en producción.
- No usar credenciales por defecto.
- Colocar backend detrás de HTTPS + reverse proxy.
- Mantener `synchronize: false` en TypeORM y migrar con SQL controlado.

## 10) Roadmap recomendado

1. Migrar auth a usuarios persistidos en BD + roles/permisos granulares.
2. Cobertura de pruebas para servicios críticos (venta, compra, pagos).
3. Diseños responsivos alternativos para tablas en móvil (cards + breakpoints).
4. Logging estructurado y trazabilidad de errores por request.
