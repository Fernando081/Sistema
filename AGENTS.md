# Registro y trabajo en este repositorio

- Antes de proponer funcionalidades o pendientes, leer `README.md` y los manuales de `docs/`, y contrastar con rutas, controladores y migraciones. No volver a presentar capacidades existentes como faltantes.
- Al terminar una implementación, actualizar `README.md`: inventario, IDs del plan, fecha de sesión, cambios, migraciones aplicadas, pruebas y limitaciones. No marcar como completado un avance parcial.
- El proyecto es de Refacciones y Tractorepuestos Tampico y conserva datos de prueba y modo fiscal mock. Mantener identificadores técnicos e idempotencia; distinguirlos de timbres fiscales simulados.
- Las conexiones y APIs bancarias están excluidas por decisión del propietario. La tesorería es local mediante archivos/captura.
- Usar Node.js 24. No modificar migraciones aplicadas; agregar la siguiente y ejecutar `db:check` antes de `db:migrate`, con respaldo previo.
- No documentar contraseñas, tokens, CSD ni secretos. Conservar trabajo existente y verificar los cambios antes de declararlos listos.

# Skills de diseño (uso automático)

En cualquier tarea de interfaz (web pública `public-web/` o pantallas del ERP: diseñar, rediseñar, pulir, animar o revisar), aplicar sin que se pida, leyendo el `SKILL.md` en `.agents/skills/<nombre>/` si la skill no aparece cargada en la sesión:

- `design-taste-frontend`: dirección de arte, composición, tipografía, paleta e imágenes; para pantallas del ERP, su modo de app.
- `impeccable`: criterios de calidad y revisión de diseño; atender lo que reporten sus hooks.
- Skills de Emil Kowalski: `emil-design-eng` y `apple-design` para pulido; `animate`, `improve-animations`, `find-animation-opportunities`, `animation-performance` y `animation-vocabulary` al crear o ajustar movimiento; `review-animations` antes de dar por terminada cualquier animación.
- No aplican al proyecto: `write-swift`, `mobile-native`, `animate-expo`, `ask-sonner`.

La web pública puede usar JavaScript propio servido desde el sitio (sin CDN) cuando mejore la experiencia o las animaciones, con el contenido completo sin JavaScript y respetando `prefers-reduced-motion`. Se permiten fotos de bancos de imágenes con autor y licencia registrados, nunca presentadas como fotos reales de producto. No inventar textos, datos ni números de parte.
