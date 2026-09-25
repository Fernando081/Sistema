# Plan de pendientes técnicos

Fecha: 16 de septiembre de 2026.

## Estado de implementación

Implementado el 16 de septiembre de 2026:

- Bundle inicial: **449.42 kB crudos / 115.60 kB transferidos**, dentro del presupuesto de advertencia de 500 kB y de la meta operativa de 450 kB.
- Shell autenticado, rutas protegidas, animaciones, notificaciones y service worker cargados de forma diferida.
- ECharts modular reducido a los gráficos y componentes utilizados; su chunk diferido pasó de aproximadamente 1.1 MB a 617.45 kB.
- Tema Material limitado a componentes usados y fuentes remotas de texto eliminadas.
- Resultados SQL encapsulados en `queryRows<Row>()` y tipados por dominio.
- ESLint backend: **0 errores y 0 advertencias**; el comando falla ante cualquier nueva advertencia.
- TypeScript backend con `noImplicitAny` y `strictBindCallApply` activos.
- Node 24 fijado mediante `.nvmrc`, `.node-version`, `engines`, `.npmrc` y comprobación automática de runtime.
- `npm run verify` agregado como control único de build, lint, pruebas y auditoría.
- Validación final: 76 pruebas unitarias backend, 5 pruebas HTTP, 37 pruebas frontend y 0 vulnerabilidades de producción.

La terminal anfitriona aún tiene Node 25 como ejecutable predeterminado. Node 24.19.0 está disponible y supera `scripts/verify-runtime.js`; al abrir terminales externas debe seleccionarse `.nvmrc` para evitar la advertencia de Angular.

## Objetivos

1. Reducir el bundle inicial de producción de 818.70 kB a un máximo de 450 kB crudos, dejando al menos 50 kB de margen frente al presupuesto de advertencia.
2. Eliminar las 841 advertencias actuales de ESLint mediante tipos explícitos para resultados SQL.
3. Estandarizar desarrollo, pruebas y compilación en Node 24 LTS.
4. Convertir estas condiciones en controles automáticos para impedir regresiones.

## Presupuesto actual del frontend

Angular lo configura en `frontend/angular.json`, dentro de `projects.frontend.architect.build.configurations.production.budgets`:

- `initial.maximumWarning`: `500kB`.
- `initial.maximumError`: `1MB`.
- `anyComponentStyle.maximumWarning`: `4kB`.
- `anyComponentStyle.maximumError`: `8kB`.

El límite `initial` suma los recursos necesarios para iniciar la aplicación y usa su tamaño generado sin compresión. Los 193.78 kB estimados de transferencia son una medición distinta. El estado actual de 818.70 kB produce una advertencia, pero no bloquea la compilación porque permanece debajo de 1 MB.

No se aumentará el límite para ocultar el problema. La meta operativa será 450 kB y el presupuesto configurado seguirá en 500 kB hasta comprobar estabilidad.

## Orden de implementación

### Etapa 1: entorno reproducible y línea base

1. Usar Node 24 LTS, ya declarado en `.nvmrc`, `.node-version` y `package.json`.
2. Corregir la resolución de `node`, `npm` y Angular CLI en Windows para que todos pertenezcan a la misma instalación.
3. Ejecutar una instalación limpia con `npm ci` y generar `stats.json` con `ng build --configuration production --stats-json`.
4. Guardar un reporte por archivo, dependencia y ruta, además del total crudo y transferido.

Criterio de salida:

- Node 24 y npm responden desde una única instalación.
- Build, 37 pruebas frontend, 76 pruebas backend y 5 pruebas HTTP pasan.
- Existe una línea base reproducible del bundle.

Esfuerzo estimado: medio día.

### Etapa 2: bundle inicial por debajo de 500 kB

#### 2.1 Cargar el contenedor autenticado por ruta

El componente raíz actual importa CDK Layout, sidenav, toolbar, listas, botones e iconos. Todo ese código entra al arranque, incluso en `/login`.

Cambios:

1. Dejar `App` como un contenedor mínimo con `RouterOutlet`.
2. Mover menú, perfil, toolbar, cambio de tema y logout a un `AuthenticatedShellComponent`.
3. Cargar ese shell con `loadComponent` como padre de las rutas protegidas.
4. Mantener `/login` fuera del shell y conservar guardas y roles en las rutas hijas.
5. Comprobar navegación directa, recarga, sesión expirada, accesibilidad y diseño móvil.

Impacto esperado: es la reducción principal porque CDK y los componentes Material del layout dejarán de formar parte del paquete inicial público.

#### 2.2 Quitar proveedores de funcionalidades del núcleo

1. Retirar `NgxEchartsModule.forRoot` de `app.config.ts`.
2. Proveer gráficos únicamente en Dashboard, Utilidad y diálogo de producto.
3. Mantener en el núcleo solo router, HTTP, interceptores, locale y service worker.
4. Evaluar un servicio ligero de notificaciones para que el interceptor no obligue a cargar Snackbar antes de entrar al área autenticada.

#### 2.3 Usar ECharts modular

El chunk diferido completo de ECharts mide aproximadamente 1.1 MB. Se reemplazará `import('echarts')` por `echarts/core` y se registrarán únicamente:

- `LineChart`, `BarChart`, `PieChart` y `HeatmapChart`.
- Grid, Tooltip, Legend y VisualMap.
- `CanvasRenderer`.

Esto no determina por sí solo el presupuesto inicial, pero reduce de forma importante la carga de Dashboard, Utilidad y Producto.

#### 2.4 Reducir CSS y fuentes iniciales

1. Sustituir `mat.all-component-themes` por los mixins de los componentes realmente usados.
2. Eliminar Poppins: actualmente se descarga con cinco pesos y la interfaz utiliza Roboto.
3. Limitar Roboto a los pesos utilizados o usar la pila de fuentes del sistema.
4. Sustituir la fuente remota de Material Icons por SVG registrados o por un subconjunto local para que el ERP funcione bien sin Internet.
5. Revisar Tailwind y estilos globales para conservar únicamente utilidades usadas.

#### 2.5 Dividir diálogos y herramientas secundarias

Los diálogos grandes importados directamente por listas y ventas se cargarán con `import()` al abrirse. Esto reduce el primer chunk de cada funcionalidad y evita descargar editores que el usuario quizá no utilice.

Criterio de salida:

- Bundle inicial crudo menor o igual a 450 kB.
- Ninguna advertencia `initial` ni `anyComponentStyle`.
- Login, shell, Dashboard, Venta, Producto, CRM y Caja verificados en móvil y escritorio.
- Las 37 pruebas frontend siguen pasando.
- El service worker no conserva nombres de chunks obsoletos y una actualización instalada carga correctamente.

Esfuerzo estimado: dos a tres días, con medición después de cada subetapa.

### Etapa 3: tipado de las consultas SQL

Hay 191 llamadas directas a `query()` y la mayoría de las 841 advertencias proviene de los resultados `any` de TypeORM.

Cambios:

1. Crear tipos reutilizables para conteos, identificadores, saldos, paginación y resultados `RETURNING`.
2. Usar genéricos de TypeORM, por ejemplo `query<FilaFactura[]>(...)`, evitando conversiones dispersas.
3. Validar en los límites del sistema valores que PostgreSQL puede devolver como texto, especialmente `numeric`, `bigint`, fechas y JSON.
4. Migrar primero operaciones críticas: autenticación, caja, venta, devoluciones, pagos, REP, compras y cotizaciones.
5. Continuar con CRM, garantías, inventario, reportes y catálogos.
6. Reducir el máximo permitido de advertencias después de cada módulo hasta llegar a cero.
7. Activar `noImplicitAny`, `strictBindCallApply` y reglas estrictas solo cuando el código correspondiente quede limpio.

Criterio de salida:

- ESLint con cero errores y cero advertencias.
- `noImplicitAny: true` y `strictBindCallApply: true`.
- Sin accesos a posiciones `[0]` sin validar que exista una fila.
- Pruebas de integridad financiera y restauración aislada aprobadas.

Esfuerzo estimado: cuatro a seis días por el volumen y la criticidad de las consultas.

### Etapa 4: estandarizar Node 24 LTS

1. Instalar Node 24 LTS como versión activa para terminales y procesos de desarrollo.
2. Ejecutar `npm ci` bajo Node 24 y confirmar que `package-lock.json` no cambia inesperadamente.
3. Agregar `packageManager` con la versión de npm validada y activar `engine-strict` después de actualizar las estaciones de trabajo.
4. Documentar un único comando de arranque y otro de validación completa.
5. Configurar cualquier pipeline de CI con Node 24 y caché basada en `package-lock.json`.

Criterio de salida:

- Sin advertencia de versión impar de Node.
- Backend, frontend, migraciones y herramientas usan la misma versión.
- Una instalación limpia reproduce todas las pruebas.

Esfuerzo estimado: medio día, excluyendo instalaciones manuales en otras computadoras.

### Etapa 5: controles contra regresiones

Agregar un comando raíz `npm run verify` que ejecute:

1. Build backend.
2. ESLint backend con cero advertencias.
3. Pruebas unitarias y HTTP.
4. Build frontend con sus presupuestos.
5. Pruebas frontend en ChromeHeadless.
6. `npm audit --omit=dev --audit-level=high`.
7. Estado y comprobación de migraciones en un entorno aislado cuando cambie SQL.

El pipeline debe fallar si el bundle supera 500 kB. Cuando la medición se mantenga por debajo de 450 kB durante varias entregas, se podrá reducir `maximumError` desde 1 MB a un límite más cercano al presupuesto real.

## Secuencia recomendada

1. Node 24 y estadísticas reproducibles.
2. Shell autenticado diferido.
3. Proveedores por funcionalidad.
4. ECharts modular.
5. Tema, fuentes y diálogos.
6. Tipado SQL por módulos críticos y después administrativos.
7. TypeScript estricto y controles automáticos.

Esta secuencia reduce primero el tiempo visible de arranque y después elimina la deuda interna sin mezclar cambios de interfaz con cambios financieros de alto riesgo.
