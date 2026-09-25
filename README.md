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
- **Frontend:** Angular 21, Angular Material, RxJS.
- **Persistencia:** PostgreSQL.
- **Auth:** JWT HS256 con guard global en backend.

## 3) Estructura del repositorio

- `backend/` API REST, módulos de dominio, entidades, auth, servicios.
- `frontend/` aplicación Angular, componentes standalone, servicios HTTP e interceptores.
- `backend/migrations/` scripts SQL incrementales.
- `Sistema_Completo.sql` script integral de base de datos.
- `ANALISIS_CODIGO.md` análisis técnico y mejoras aplicadas.

## 4) Requisitos

- Node.js 24 LTS (indicado en `.nvmrc` y `.node-version`)
- npm 10+
- PostgreSQL 14+

## 5) Configuración de entorno

### Backend (`backend/.env`)

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu-password-local
DB_NAME=tu-base-local

JWT_SECRET=secreto-aleatorio-de-al-menos-32-bytes
AUTH_USERNAME=admin
AUTH_PASSWORD=replace-with-a-temporary-bootstrap-password
ALLOW_ENV_AUTH=false
FISCAL_MODE=mock

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

El proyecto exige Node 24. En Windows, el lanzador incluido permite usar la instalación LTS del usuario aunque exista otra versión global en `C:\Program Files\nodejs`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 install
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify
npm run start:backend:node24
npm run start:frontend:node24
```

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
  - Fallback de entorno desactivado por defecto y habilitable sólo con `ALLOW_ENV_AUTH=true`.
  - Validaciones adicionales de seguridad para producción.
- Frontend con:
  - `authGuard` para rutas privadas.
  - `authInterceptor` para inyectar `Bearer` automáticamente.
  - `errorInterceptor` para manejo global de errores (incluye 401).

### Nota operativa

`POST /api/v1/auth/register` requiere token con rol `admin`; los usuarios nuevos reciben rol `user` si no se especifica otro.

## 8) Funcionalidad de negocio cubierta

- Dashboard de métricas.
- Catálogos SAT (régimen fiscal, forma/método pago, uso CFDI, estado, municipio, clave prod/serv, clave unidad, unidad, objeto impuesto).
- Clientes, proveedores, categorías y productos.
- Ventas + generación de ticket/PDF (servicio dedicado).
- Compras e historial.
- Cotizaciones (alta + historial).
- Cobranza y cuentas por pagar.
- CRM de oportunidades, seguimientos y ventas perdidas.
- Números OEM/alternos, aplicaciones por equipo/motor y búsqueda remota.
- Garantías ligadas al renglón original de venta.
- Agenda CRM con historial, control de concurrencia, filtros, indicadores y ventas perdidas.
- Administración de usuarios, cambio de contraseña y revocación inmediata de sesiones.
- Apertura/cierre de caja, efectivo esperado/contado, diferencias y movimientos auditables.
- Notas de crédito y devoluciones limitadas a la venta original, con reversos financieros.

## Verificación y migraciones

```bash
npm run build
npm test
npm run db:status
npm run db:backup
npm run db:check
npm run verify
npm run verify:release
```

`npm run verify` exige Node 24 LTS y ejecuta build de backend/frontend, ESLint sin advertencias, pruebas unitarias y HTTP, pruebas frontend, recorridos Playwright de escritorio/móvil, accesibilidad WCAG A/AA y auditoría de dependencias de producción.

`npm run verify:release` añade la restauración del respaldo más reciente en una base PostgreSQL temporal y recorre los ciclos transaccionales críticos. Consulta [Calidad y liberación](docs/CALIDAD_Y_RELEASE.md).

Los PDF/XML fiscales siguen marcados como documentos de prueba mientras `FISCAL_MODE=mock`. Integrar un PAC en sandbox, certificados y validación SAT pertenece a la siguiente etapa.

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

1. Conectar el modo fiscal a un PAC sandbox y reemplazar los documentos simulados.
2. Separar orden de compra, recepción parcial y factura de proveedor cuando se defina el flujo operativo final.
3. Ampliar cobertura E2E sobre una base aislada para venta, compra, pagos y concurrencia.
4. Añadir logging estructurado y un identificador de trazabilidad por petición.


## 12) Registro de cambios y mejoras (histórico)

> Esta sección se mantiene para **no perder trazabilidad** de mejoras realizadas.

### Seguridad y auth
- Implementación de `AuthModule`, `AuthService`, `JwtAuthGuard` global y decorador `@Public()`.
- Login JWT operativo en `POST /api/v1/auth/login`.
- Integración frontend de `authGuard`, `authInterceptor` y `errorInterceptor`.
- Evolución de auth a usuarios persistidos (`auth_user`) con fallback de entorno explícito y optativo.

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
- Bundle inicial reducido a 449.42 kB, dentro del presupuesto Angular de 500 kB.
- ESLint en cero advertencias y TypeScript con `noImplicitAny` y `strictBindCallApply`.
