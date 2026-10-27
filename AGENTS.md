# Registro y trabajo en este repositorio

- Antes de proponer funcionalidades o pendientes, leer `README.md` y los manuales de `docs/`, y contrastar con rutas, controladores y migraciones. No volver a presentar capacidades existentes como faltantes.
- Al terminar una implementación, actualizar `README.md`: inventario, IDs del plan, fecha de sesión, cambios, migraciones aplicadas, pruebas y limitaciones. No marcar como completado un avance parcial.
- El proyecto es de Refacciones y Tractorepuestos Tampico y conserva datos de prueba y modo fiscal mock. Mantener identificadores técnicos e idempotencia; distinguirlos de timbres fiscales simulados.
- Las conexiones y APIs bancarias están excluidas por decisión del propietario. La tesorería es local mediante archivos/captura.
- Usar Node.js 24. No modificar migraciones aplicadas; agregar la siguiente y ejecutar `db:check` antes de `db:migrate`, con respaldo previo.
- No documentar contraseñas, tokens, CSD ni secretos. Conservar trabajo existente y verificar los cambios antes de declararlos listos.
