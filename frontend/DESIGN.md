---
name: RTT ERP — Industrial premium
description: Sistema visual del ERP + CRM de Refacciones y Tractorepuestos Tampico; grafito, tinta y latón para trabajo diario de mostrador y oficina.
colors:
  canvas: "#f4f3ef"
  surface: "#ffffff"
  surface-2: "#faf9f6"
  surface-sunken: "#efede8"
  border: "#e4e1da"
  border-strong: "#cfcac0"
  text: "#141a24"
  text-2: "#454e5c"
  text-3: "#5f6776"
  ink: "#121b2a"
  on-ink: "#ffffff"
  brass: "#d99a2b"
  brass-strong: "#c4861b"
  on-brass: "#1c1305"
  brass-text: "#82540f"
  brass-soft: "#f8edd8"
  link: "#1f4f86"
  focus: "#c4861b"
  success: "#1f7a4a"
  success-soft: "#e3f3ea"
  warning: "#8a5a00"
  warning-soft: "#fbf0d9"
  danger: "#b42335"
  danger-soft: "#fbe8ea"
  info: "#1f4f86"
  info-soft: "#e5eef8"
  violet: "#5b3fb5"
  violet-soft: "#eeeafb"
  rail: "#0f1520"
  rail-2: "#161e2b"
  rail-border: "#232c3a"
  rail-text: "#c7cfda"
  rail-muted: "#8f9aaa"
  rail-active-text: "#f2d49c"
  canvas-dark: "#0b0f15"
  surface-dark: "#121821"
  surface-2-dark: "#161d28"
  surface-sunken-dark: "#0e131b"
  border-dark: "#242d3a"
  border-strong-dark: "#364254"
  text-dark: "#e9edf2"
  text-2-dark: "#b8c1cd"
  text-3-dark: "#98a3b3"
  brass-dark: "#e6ae4c"
  brass-strong-dark: "#f0bf66"
  brass-text-dark: "#f0c47a"
  link-dark: "#a6cdf6"
  success-dark: "#6dd39b"
  warning-dark: "#f2c46d"
  danger-dark: "#ff8d99"
  info-dark: "#8cbcf0"
  violet-dark: "#b9a6ff"
  rail-dark: "#090d13"
typography:
  headline:
    fontFamily: "Inter Variable, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.55rem, 2.1vw, 1.95rem)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  total:
    fontFamily: "Inter Variable, Segoe UI, sans-serif"
    fontSize: "1.85rem"
    fontWeight: 700
    letterSpacing: "-0.03em"
    fontFeature: "'tnum'"
  metric:
    fontFamily: "Inter Variable, Segoe UI, sans-serif"
    fontSize: "1.55rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
    fontFeature: "'tnum'"
  title-dialog:
    fontFamily: "Inter Variable, Segoe UI, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 650
    lineHeight: "1.5rem"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Variable, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: "1.4rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Variable, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'cv11', 'ss01'"
  label-eyebrow:
    fontFamily: "Inter Variable, Segoe UI, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.09em"
  label-table:
    fontFamily: "Inter Variable, Segoe UI, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.06em"
  code:
    fontFamily: "ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  chip: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  card: "24px"
  page: "1.75rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.md}"
    height: "38px"
  button-primary-dark:
    backgroundColor: "{colors.brass-dark}"
    textColor: "{colors.on-brass}"
    rounded: "{rounded.md}"
  button-brass:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.on-brass}"
    rounded: "{rounded.md}"
    height: "50px"
  button-brass-hover:
    backgroundColor: "{colors.brass-strong}"
  button-outlined:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  button-outlined-hover:
    backgroundColor: "{colors.surface-2}"
  button-disabled:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-3}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.lg}"
    padding: "24px"
  metric-card-featured:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.lg}"
    padding: "1.15rem 1.2rem"
  total-receipt:
    backgroundColor: "{colors.rail-2}"
    textColor: "#e8edf3"
    rounded: "{rounded.lg}"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "0.2rem 0.6rem"
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
    padding: "0.2rem 0.6rem"
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    padding: "0.2rem 0.6rem"
  badge-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.pill}"
    padding: "0.2rem 0.6rem"
  code-chip:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-2}"
    typography: "{typography.code}"
    rounded: "{rounded.chip}"
    padding: "0.05rem 0.4rem"
  rail-link-active:
    backgroundColor: "rgba(217, 154, 43, 0.14)"
    textColor: "{colors.rail-active-text}"
    rounded: "9px"
    height: "36px"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-3}"
    typography: "{typography.label-table}"
    padding: "12px 14px"
---

# Design System: RTT ERP — Industrial premium

Alcance: el ERP + CRM Angular de `frontend/` (incluido el portal de clientes y el login, que no usan el shell). La web pública `public-web/` tiene su propio mundo visual (`docs/WEB_PUBLICA.md`) y no sigue este archivo. Fuente normativa de los valores: `src/styles.css` (bloque U01), `src/custom-theme.scss`, `src/app/layout/authenticated-shell.component.css` y `src/app/shared/list-page.css`. Historia y estado de la migración: `docs/SISTEMA_VISUAL.md`.

## Overview

**Creative North Star: "El mostrador de latón"**

Un banco de trabajo ordenado. El grafito y la tinta sostienen el trabajo de todos los días: buscar por número de parte, capturar partidas, revisar saldos. El latón, el ámbar del logotipo RTT, aparece sólo donde algo se decide o se cierra: cobrar una venta, generar la cotización, el indicador de la sección activa, el foco del campo donde se escribe. Si el latón está en todas partes, deja de señalar.

La densidad es de herramienta profesional: Material 3 en densidad -1, cuerpo de 14 px, tablas con encabezados en versalitas y cifras tabulares. Las superficies son planas, blancas sobre un lienzo cálido (o tinta profunda en oscuro), separadas por bordes finos más que por sombras. El riel lateral es siempre oscuro en ambos temas; el escenario cambia entre claro y oscuro. Los controles son firmes y sobrios: una sola acción principal por vista, sin degradados decorativos ni color fijo fuera de los tokens.

**Key Characteristics:**

- Grafito y tinta para estructura; latón escaso para cierre, foco y selección.
- Lienzo cálido (no gris frío) en claro; tinta casi negra azulada en oscuro.
- Plano con realce sutil: borde fino en reposo, sombra sólo al interactuar o flotar.
- Inter Variable con cifras tabulares en todo monto y cantidad.
- Un solo título de página, puesto por el shell; el resto son `h2`.
- Estados con punto + texto, nunca sólo color.

## Colors

Neutros cálidos de papel y grafito con un único acento metálico; los colores semánticos sólo cuentan estados.

### Primary

- **Tinta de taller** (ink): acción principal en claro (botón sólido), avatar, tarjeta de indicador destacada. En oscuro el token `ink` pasa a latón (`brass-dark`), por eso la acción principal oscura es latón.
- **Latón RTT** (brass): acento de marca. Botones de cierre (`.btn-brass`: Cobrar venta, Generar cotización, Nueva venta), indicador de pestaña activa, barra izquierda del enlace activo del riel, línea del antetítulo de página.
- **Latón profundo** (brass-strong): hover de botones latón, borde de campo enfocado, contorno de foco (`focus`).
- **Latón legible** (brass-text): texto latón sobre fondos claros con contraste AA (antetítulos de sección, selección de alternadores).
- **Latón tenue** (brass-soft): fondos de selección, halo de foco de 3–4 px, barra de acciones en lote, `::selection`.

### Secondary

- **Azul de enlace** (link / info): enlaces y botones de texto, aviso informativo, notificaciones no leídas. Comparte valor con `info`.

### Neutral

- **Lienzo de papel** (canvas): fondo de la aplicación.
- **Superficie** (surface): tarjetas, listas, diálogos, campos.
- **Superficie 2** (surface-2): encabezados de tabla, hover de filas, franja de fechas, búsqueda global en reposo.
- **Superficie hundida** (surface-sunken): fondo de chips de código, botones deshabilitados, campos en oscuro.
- **Borde / borde fuerte** (border, border-strong): separación de superficies; el fuerte para contornos de campos y botones.
- **Texto, texto 2, texto 3** (text, text-2, text-3): títulos y montos; cuerpo; apoyo y etiquetas (cumple AA sobre canvas y surface).
- **Riel grafito** (rail, rail-2, rail-border, rail-text, rail-muted, rail-active-text): navegación lateral, siempre oscura. `rail-2` también es el fondo del recibo de totales.

### Semánticos y gráficas

Éxito, aviso, peligro, información y violeta, cada uno con su par `-soft` para fondo. Gráficas: `--c-chart-1…6` en orden latón, azul, verde, violeta, rojo, pizarra (contraste ≥3:1), resueltos por `shared/echarts.provider.ts` según el tema activo.

### Named Rules

**The Brass Means Done Rule.** El latón sólido se reserva para la acción que cierra una operación y para señales de posición/foco. Nunca para decorar tarjetas, títulos o iconos sueltos.

**The Token-Only Rule.** Ningún color fijo en componentes: todo valor sale de `--c-*`. Un hex en el CSS de una pantalla es una regresión (U01.2 retiró `#c62828`, `#a76809`, degradados índigo, etc.).

**The Two Inks Rule.** `--c-ink` cambia de tinta (claro) a latón (oscuro); cualquier fondo que deba ser oscuro en ambos temas usa los tokens del riel, no `ink`.

## Typography

**Display/Body Font:** Inter Variable 5.3.0 autoalojada (con Segoe UI Variable Text, Segoe UI, system-ui)
**Mono Font:** ui-monospace, Cascadia Mono, Consolas (sólo códigos y números de parte en chip)

**Character:** una sola familia neutra y técnica; la jerarquía viene del peso (600–700) y del tracking negativo en títulos, no de cambiar de fuente. Características `cv11` y `ss01` activas.

### Hierarchy

- **Headline** (650, clamp 1.55–1.95rem, 1.15, −0.025em): título de página único en el shell, debajo de un antetítulo de sección.
- **Total** (700, 1.85rem, −0.03em, tabular): total del recibo de venta/cotización; baja a 1.5rem en móvil.
- **Metric** (650, 1.55rem, tabular): valor de las tarjetas de indicador.
- **Title dialog** (650, 1.15rem): títulos de diálogo.
- **Title** (650, 1rem, −0.01em): títulos de tarjeta, de lista y `h2` de sección.
- **Body** (400, 14px, 1.5): texto de trabajo; celdas de tabla a 0.875rem.
- **Label eyebrow** (600, 0.72rem, +0.09em, mayúsculas): antetítulo de sección en latón legible, etiqueta del recibo.
- **Label table** (600, 0.72rem, +0.06em, mayúsculas): encabezados de tabla y etiquetas de modo tarjeta móvil.

### Named Rules

**The Tabular Money Rule.** Todo monto, cantidad, folio y conteo usa `font-variant-numeric: tabular-nums` y va alineado a la derecha en tablas.

**The Zero Tracking Rule.** Material trae tracking de 0.25–0.5 px; con Inter se ve estirado. Controles, tablas y campos van a tracking 0; sólo los rótulos en mayúsculas llevan tracking positivo.

**The One H1 Rule.** El shell pone el único `h1`. Las pantallas usan `h2`; si necesitan un `h1` para `aria-labelledby`, va `sr-only`.

## Layout

Shell de dos zonas: riel lateral fijo de 268 px y escenario con barra superior pegajosa de 64 px (vidrio esmerilado: superficie al 82 % con desenfoque 14 px). El contenido tiene padding `1.75rem clamp(1rem, 2.6vw, 2.5rem) 2.5rem` y entra con una animación de 220 ms.

- **Listas:** `list-page.css` — superficie única con cabecera (título + conteo + acciones), fila de filtros, franja de fechas en `surface-2`, tabla y paginador. Padding horizontal 1.25rem.
- **Captura (venta, cotización, compra):** dos columnas, captura a la izquierda y recibo grafito pegajoso a la derecha; a ≤1100 px el recibo pasa abajo.
- **Indicadores:** cuadrícula de 3 columnas (gap 1rem); filas de trabajo en 2 columnas (gap 0.75rem).
- **Responsivo:** ≤1100 px se oculta el nombre de cuenta; ≤900 px el contenido baja a 1.1rem/1rem y "Nueva venta" queda sólo icono; ≤760 px las listas `.stack` se vuelven tarjetas de dos columnas con etiqueta de columna; ≤768 px los diálogos son hojas inferiores a ancho completo; ≤650 px se ocultan "Nueva venta" y la cuenta de la barra.
- Sin desbordamiento horizontal a 1440 y 390 px (verificado por `tests/ui-showcase.spec.ts`).

## Elevation & Depth

Plano con realce sutil. En reposo las superficies se separan por borde fino y `shadow-xs` casi imperceptible; la sombra crece sólo como respuesta (hover de tarjetas de indicador y de trabajo) o para capas que flotan sobre el contenido (diálogos, menú de búsqueda, notificaciones). En oscuro las sombras son más densas y negras para seguir leyéndose sobre la tinta.

### Shadow Vocabulary

- **xs** (`0 1px 2px rgba(17,24,39,.05)`): tarjetas, listas y botón principal en reposo.
- **sm** (`0 1px 2px rgba(17,24,39,.04), 0 2px 6px rgba(17,24,39,.05)`): hover de filas de trabajo.
- **md** (`0 2px 4px rgba(17,24,39,.04), 0 10px 24px -6px rgba(17,24,39,.12)`): hover de indicadores, recibo de totales, enlace de salto.
- **lg** (`0 24px 60px -12px rgba(17,24,39,.28)`): diálogos, resultados de búsqueda, panel de notificaciones.
- **Halo latón** (`0 6px 18px -6px rgba(217,154,43,.65)`): exclusivo de los botones de cierre latón.

### Named Rules

**The Flat-At-Rest Rule.** Nada se levanta sin motivo: la elevación es estado (hover, flotante), no decoración.

## Shapes

Esquinas suavemente redondeadas en cuatro pasos: 8 px controles pequeños y opciones de búsqueda, 10 px botones/campos/búsqueda global, 14 px tarjetas/listas/paneles, 18 px diálogos (en móvil, 14 px sólo arriba). Píldora completa para insignias y contador de notificaciones; 6 px para chips de código y `kbd`. Bordes de 1 px en todo contenedor; `kbd` y el atajo de búsqueda llevan borde inferior de 2 px como tecla física.

## Components

### Buttons

Firmes y sobrios.

- **Shape:** 10 px, etiqueta 600 sin tracking, altura 38 px en cabeceras.
- **Primary:** sólido tinta con texto blanco y brillo interior de 1 px; en oscuro, latón con texto `on-brass`. Hover: brillo +12 %.
- **Brass (cierre):** `.btn-brass` latón en ambos temas, halo latón, 50 px de alto y ancho completo en el recibo; hover a latón profundo.
- **Outlined:** superficie con borde fuerte, texto principal; hover a `surface-2`.
- **Text:** azul de enlace.
- **Disabled:** superficie hundida, texto 3 y borde: visible en ambos temas.
- **Focus:** contorno latón de 2 px con separación de 3 px en todo elemento enfocable.

### Badges

Píldora con punto de 6 px del color del texto + etiqueta 0.72rem/600; fondo `-soft` del estado (éxito, aviso, peligro, info).

### Code chip

Número de parte o código en monoespaciada 0.72rem/600 sobre superficie hundida con borde fino y radio 6 px. Es la forma canónica de mostrar un número de parte.

### Cards / Containers

- **Corner Style:** 14 px.
- **Background:** superficie con borde fino.
- **Shadow Strategy:** `xs` en reposo; tarjetas navegables (`.metric-card`) suben 2 px con `md` y su flecha se desplaza 3 px.
- **Internal Padding:** 24 px en tarjetas Material; 1.15–1.25rem en indicadores y listas.
- **Destacada:** el indicador principal es tinta sólida con un halo radial latón en la esquina.

### Inputs / Fields

- **Style:** Material `outline`, radio 10 px, contorno borde fuerte, fondo superficie (hundida en oscuro).
- **Hover:** contorno texto 3. **Focus:** contorno latón profundo; los campos propios (dinero, búsqueda global) añaden halo `brass-soft` de 3–4 px. Cursor latón en oscuro.
- **Dinero y cantidad:** alineados a la derecha, tabulares; control de cantidad con botones − / + de 32 px.

### Tables

Encabezado en `surface-2` con rótulos 0.72rem en mayúsculas y texto 3; celdas 12×14 px con borde inferior; hover de fila a `surface-2`. Folio en texto principal 650, cliente con RFC debajo en texto 3, montos a la derecha. Acciones por fila como botones de icono discretos en texto 3 que se aclaran al pasar sobre la fila.

### Navigation

- **Riel:** grafito, enlaces de 36 px (32 px en subgrupos) con radio 9 px, texto `rail-text` 0.84rem/500. Hover: blanco al 5 %. Activo: fondo latón al 14 %, texto `rail-active-text`, icono latón y barra latón de 3 px a la izquierda. Grupos plegables con `<details>` y chevron que gira 180°.
- **Marca:** placa de 38 px con degradado latón y siglas RTT.
- **Barra superior:** búsqueda global (Ctrl K) con atajo como tecla, "Nueva venta" latón, notificaciones, avatar informativo y "Cerrar sesión" aparte.
- **Encabezado de página:** antetítulo de sección latón con raya de 14 px + título único.

### Recibo de totales (signature)

Panel grafito (`rail-2`) en ambos temas con línea superior latón que se desvanece, etiqueta en latón legible, desglose tabular, total grande blanco sobre línea punteada y el botón de cierre latón a ancho completo. Es el momento en que la pantalla de captura "cierra"; aparece en venta, nueva cotización y cobranza (factura global usa una variante en superficie con borde superior latón).

### Empty state

Caja con borde punteado y radio 12 px, icono de 38 px en texto 3, título en texto principal y explicación breve.

## Do's and Don'ts

### Do:

- **Do** usar sólo tokens `--c-*`, `--radius-*` y `--shadow-*`; agregar un token nuevo antes que un valor suelto.
- **Do** tener una sola acción principal por vista; las de cierre de operación son `.btn-brass`.
- **Do** mostrar números de parte como chip de código y montos con cifras tabulares a la derecha.
- **Do** plegar el detalle técnico (huellas, UUID, bytes) en `<details>` o en una línea secundaria.
- **Do** usar `:host-context(.dark)` o CSS global para variantes oscuras dentro de componentes Angular.
- **Do** incluir `shared/list-page.css` por `styleUrls` en cada lista, para que viaje en su chunk diferido.
- **Do** verificar cada pantalla migrada con `ui-showcase` (Axe A/AA, 1440 y 390 px, claro y oscuro).
- **Do** limitar el movimiento a transiciones de 150–250 ms con `--ease-out` y respetar `prefers-reduced-motion`.

### Don't:

- **Don't** poner un `h1` visual dentro de una pantalla del shell.
- **Don't** usar colores fijos, utilidades Tailwind de color o degradados decorativos (se retiraron índigo/morado/rosa, `blue-600`, `#c62828`).
- **Don't** usar el latón como color de decoración, de títulos o de varias acciones a la vez.
- **Don't** comunicar un estado sólo con color: siempre punto o icono + texto.
- **Don't** dejar `animation-fill-mode: forwards` con `transform` en contenedores de página: convierte al componente en contenedor de los `position: fixed`.
- **Don't** subir los presupuestos de CSS por componente (6 kB aviso / 8 kB error); mover patrones repetidos al CSS global.
- **Don't** usar `--c-ink` para fondos que deben ser oscuros en ambos temas.
