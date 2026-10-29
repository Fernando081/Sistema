# Product

<!-- impeccable:product-schema 1 -->

Registro de producto compartido para todo el negocio: el ERP + CRM interno (`frontend/`, Angular), el portal de clientes (`/portal`, dentro del mismo frontend) y la web comercial pública (`public-web/`, sitio estático). Confirmado con el propietario el 29/10/2026.

## Platform

web

## Users

**ERP (uso diario):**

- **Propietario/administrador.** Decide y aprueba: precios y crédito, autorizaciones comerciales, compras, finanzas (contabilidad, DPO, tesorería local), salud del sistema y respaldos. Revisa el estado del negocio y atiende alertas.
- **Mostrador/ventas.** Cotiza, vende y cobra con el cliente enfrente, por teléfono o por WhatsApp. Busca por número de parte, marca y aplicación; trabaja rápido, a menudo con lector de código y teclado.

Otros módulos (almacén móvil, contabilidad, CRM) existen y los opera hoy ese mismo equipo; no se confirmaron como roles separados de uso diario.

**Clientes del negocio (web pública y portal):**

- Flotillas y transportistas con tractocamiones de servicio pesado diésel.
- Talleres mecánicos diésel que compran por número de parte para sus clientes.
- Maquinaria agrícola e industrial (tractores y equipo).
- Otras refaccionarias (reventa/mayoreo).

## Product Purpose

Refacciones y Tractorepuestos Tampico (RTT) compra y vende refacciones para servicio pesado diésel. El sistema integra en un solo lugar clientes y unidades (VIN/ESN), catálogo especializado, cotizaciones, ventas, pedidos, compras, almacén, CRM, garantías, cobranza, contabilidad y facturación mexicana (CFDI 4.0).

Éxito significa vender la pieza correcta a la primera, con el registro completo detrás (inventario, cobranza, contabilidad y fiscal cuadrados), y que el cliente encuentre y consulte la pieza sin fricción.

## Positioning

- **Precisión de la pieza:** número de parte, marca y aplicación se confirman antes de vender; menos devoluciones.
- **Trato directo familiar:** un negocio familiar; el cliente habla con quien conoce la pieza.
- **Surtido:** capacidad de conseguir piezas difíciles y enviar por paquetería a toda la República Mexicana.
- **Rapidez local:** mostrador y entregas locales en Tampico.

## Operating Context

- Mostrador físico en Tampico, Tamaulipas; atención por teléfono, WhatsApp y correo. Horario y dirección confirmados en `public-web/business.json`.
- El ERP corre en local (loopback) con versiones, staging y rollback locales; se usa en escritorio en mostrador/oficina y en teléfono para tareas de almacén.
- La web pública es **de consulta, no tienda**: catálogo sin precios ni carrito; el cliente consulta y se le cotiza por teléfono, WhatsApp o solicitud web, que entra al CRM (bandeja comercial).
- El portal de clientes es de sólo lectura: pedidos, propuestas, ventas, unidades, garantías y documentos publicados.
- Terminología del negocio en español de México: número de parte, aplicación, cotización, pedido, apartado, surtir, REP, CFDI, timbrado, póliza, Kardex, VIN/ESN.

## Capabilities and Constraints

- `README.md` es el inventario vivo de capacidades y pendientes; los manuales de `docs/` detallan cada módulo. No presentar como faltante algo que ya existe ahí.
- Fiscal en **modo mock/sandbox**: los timbres son simulados y deben distinguirse siempre de identificadores técnicos reales.
- **Sin conexiones ni APIs bancarias** por decisión del propietario; tesorería local por archivos/captura.
- Envío externo (correo, campañas) desactivado por defecto; "Simulado" nunca se presenta como "Enviado".
- La web pública aún no está publicada (`noindex`), sin dominio decidido, sin JavaScript cliente y con CSP estricta. El lote real del catálogo no está aprobado.
- Node.js 24. Presupuestos de peso vigentes en ERP (componentes e inicial) y web (CSS minificado).
- Cámara y QR de almacén diferidos por decisión del propietario.

## Brand Commitments

- Nombre: **Refacciones y Tractorepuestos Tampico** (abreviatura RTT).
- Logotipo: tractocamión azul y engrane, `public-web/assets/logo-rtt.jpg`. Aún no existe versión con transparencia o SVG.
- Voz: negocio familiar, directo y claro; promete información correcta, no superlativos. Español de México.
- Sistemas visuales vigentes aprobados por el propietario: ERP en `docs/SISTEMA_VISUAL.md` (U01); web pública en `docs/WEB_PUBLICA.md` (WEB02.4, aprobación visual final pendiente). Son mundos distintos por decisión explícita.

## Evidence on Hand

- Contacto, dirección, horario, zona de servicio y mapa confirmados: `public-web/business.json`.
- Logotipo: `public-web/assets/logo-rtt.jpg`.
- **No existen** y no deben inventarse: historia del negocio (`story` sin confirmar), marcas representadas (`brands` vacío), testimonios, clientes nombrados, cifras de ventas, precios públicos, fotografías de producto aprobadas para la web ni dominio público.
- El ERP conserva datos de prueba; no usarlos como evidencia comercial.

## Product Principles

1. **La pieza correcta primero.** Número de parte, marca y aplicación son el eje de búsqueda, de la ficha y de la venta.
2. **Velocidad en mostrador.** Las pantallas de uso diario se optimizan para captura rápida con teclado y lector, sin pasos de más.
3. **Verdad sobre apariencia.** Nada simulado se presenta como real (fiscal, envíos, catálogo); los estados parciales se nombran como tales.
4. **Una conversación directa.** La web y el portal llevan al cliente a hablar con el negocio, no a un proceso impersonal.
5. **Registro completo e idempotente.** Toda operación deja rastro auditable y soporta reintentos sin duplicar.

## Accessibility & Inclusion

- WCAG 2.x A/AA verificado con Axe sin infracciones, sin desbordamiento horizontal a 1440 y 390 px, en claro y oscuro (ERP: `frontend/tests/ui-showcase.spec.ts`).
- Movimiento sólo con `prefers-reduced-motion: no-preference`; sin animaciones en bucle sin pausa (WCAG 2.2.2).
- Estados nunca sólo por color; operación completa por teclado; web pública usable sin JavaScript.
