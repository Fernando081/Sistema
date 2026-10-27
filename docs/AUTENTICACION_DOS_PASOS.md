# Verificación en dos pasos — S02.3

Implementación local del 19/10/2026 para Refacciones y Tractorepuestos Tampico. Complementa S02.1 (sesiones) y S02.2 (cookie HttpOnly/CSRF). Es opcional, por cuenta persistida: la migración no activa autenticadores ni altera credenciales de usuarios existentes. No requiere dominio, hosting, SMS o servicios de pago.

## Uso desde el ERP

1. Entrar a **Mi cuenta → Verificación en dos pasos** y confirmar la contraseña actual.
2. En una aplicación autenticadora compatible, añadir una cuenta mediante clave manual. Capturar el emisor/nombre y la clave que muestra el ERP: **TOTP, SHA-1, 6 dígitos, intervalo de 30 segundos**. No se genera QR ni se envían secretos a servicios externos.
3. Escribir el código de la aplicación antes de diez minutos para confirmar la activación. Hasta confirmarlo, el segundo factor no está activo. Cancelar descarta la clave de la pantalla; el pendiente del servidor vence y no concede acceso.
4. Guardar los diez códigos de respaldo en un lugar privado y separado del equipo. Solo se muestran al activar; no vuelven a recuperarse desde la API. Cada código sirve una sola vez y requiere también la contraseña para iniciar sesión.
5. La activación cierra todas las sesiones, incluida la actual. Los respaldos se muestran en `/login/respaldos`, fuera del área autenticada: no hay consultas automáticas de notificaciones que puedan interrumpirlos. Se transfieren una sola vez entre componentes, solo en memoria; nunca mediante URL, historial, cookies o Web Storage. Pulsar **Ya guardé mis códigos · Iniciar sesión** y entrar con contraseña + autenticador o respaldo. La pantalla avisa antes de salir/recargar; al descartarla los códigos no se recuperan. Abrir esa ruta sin una entrega pendiente vuelve al login.

Para desactivar: contraseña actual + código vigente no usado o respaldo disponible. El éxito elimina secreto y respaldos, invalida retos y cierra todas las sesiones. Un error de contraseña/código conserva la pantalla para corregirlo. Para sustituir el autenticador o renovar respaldos, desactivar y volver a configurar; hace falta conservar un factor válido durante ese procedimiento. No existe un botón de administrador para omitir MFA de otras cuentas.

## Contrato HTTP

Todas las rutas bajo `/api/v1/auth`. Los cuerpos/respuestas de autenticación son privados y no deben registrarse. Cookie y Bearer se sujetan a las mismas comprobaciones del segundo factor.

| Ruta | Requisito / respuesta |
| --- | --- |
| `POST login` | Contraseña verificada. Sin MFA conserva el contrato anterior. Con MFA devuelve exclusivamente `mfaRequired`, reto opaco y `expiresIn=300`; no crea sesión/JWT/cookie nueva |
| `POST mfa/login` | Reto + código; anónimo con prueba limitada, nunca autoriza otras rutas. Éxito crea sesión normal: navegador recibe cookie HttpOnly y metadata pública; cliente API recibe Bearer |
| `GET mfa/status` | Sesión propia. Solo `enabled`, `available`, cantidad de respaldos disponibles; nunca secreto, hashes o códigos |
| `POST mfa/setup` | Sesión propia + contraseña actual; devuelve clave manual una vez y vence en600s; no sobrescribe un factor activo |
| `POST mfa/confirm` | Sesión propia + código del autenticador; confirma pendiente, devuelve diez respaldos y revoca sesiones |
| `POST mfa/disable` | Sesión propia + contraseña actual + autenticador/respaldo; borra configuración y revoca sesiones |

Los clientes API que antes asumían que todo login201 contenía JWT deben procesar el reto cuando su cuenta active MFA. Los clientes de cuentas no inscritas mantienen su contrato. Angular conserva el reto solo en memoria y elimina la contraseña del formulario al pasar al segundo paso. Recargar/cancelar requiere comenzar de nuevo. Se mantiene la protección de origen/cabecera/Fetch Metadata para el transporte del navegador; ningún origen externo obtiene una cookie al completar el reto.

## Protección y persistencia

- Migración **096_autenticacion_dos_pasos.sql**: tablas `auth_mfa`, `auth_mfa_challenge` y `auth_mfa_recovery`, claves foráneas e índice. No modifica095 ni migraciones anteriores. IDs técnicos y timbres fiscales mock no cambian.
- Claves TOTP aleatorias de160bits. Cifrado **AES-256-GCM** con nonce aleatorio y AAD ligada a versión/cuenta; la clave de cifrado permanece fuera de PostgreSQL. La API no permite consultar nuevamente el secreto guardado.
- Diez respaldos aleatorios de128bits, persistidos únicamente como SHA-256 normalizado. Son secretos de alta entropía, no contraseñas humanas. Consumo único bajo bloqueo de fila; no se guardan en texto plano.
- Retos aleatorios de256bits: solo hash en PostgreSQL, cinco minutos de duración y un uso. Nuevo password-login sustituye el reto pendiente anterior de esa cuenta. Renovarlo no reinicia fallos del segundo factor. Limpieza oportunista propia al emitir un reto; no se promete purga global programada.
- TOTP admite ventana ±1 intervalo; rechaza un contador ya consumido, incluso desde un reto distinto. Después de activar hay que esperar al siguiente código o usar un respaldo. Se necesita reloj sincronizado en servidor y autenticador.
- Cinco fallos de código por cuenta bloquean verificación/emisión de reto diez minutos (HTTP429). El incremento se confirma aunque se rechace la respuesta; no se pierde por rollback. Renovar reto o repetir setup no reinicia ese límite. Tras el bloqueo vuelve a permitir intentos. Además hay límites HTTP por IP: login5/min, MFA-login/confirm10/min, setup/disable5/min.
- Orden de bloqueos usuario → MFA → reto. Comprueba cuenta activa/versión y cambios concurrentes. El uso de TOTP/respaldo y consumo del reto se confirman juntos; dos verificaciones simultáneas no duplican acceso. Si la cuenta cambia antes de crear la sesión, se rechaza y se necesita un nuevo intento.
- Activar/desactivar incrementa `token_version`, revoca sesiones y elimina retos. Cambios de contraseña/permisos/desactivación siguen invalidando retos por versión. Cookies y metadata mantienen los controles de S02.1/S02.2; no hay JWT de acceso temporal antes de MFA.

## Configuración y respaldo de clave

Usar **Node.js24**. `AUTH_MFA_ENCRYPTION_KEY` debe contener32bytes aleatorios codificados en base64 estándar. Se publica solo el nombre/placeholder en `.env.example`, nunca su valor. En la instalación local se puede configurar mediante:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run setup:mfa-key
```

El comando añade una clave nueva a `backend/.env` privado si falta y conserva cualquier clave existente válida. No imprime valores ni rota claves al reiniciar. Reiniciar backend después de configurar. En producción usar el gestor de secretos del entorno y HTTPS conforme a S02.2; no transportar esta clave al frontend o al catálogo público.

**Respaldar la clave separada y protegida de la base.** El respaldo de PostgreSQL contiene secretos cifrados, pero no sustituye la clave externa. Perderla/cambiarla sin un procedimiento de recifrado impide verificar los autenticadores inscritos, incluidos los intentos con respaldo. No hay rotación automática, recuperación de clave ni mecanismo de bypass. Si falta/es inválida, setup falla sin guardar un factor pendiente; cuentas sin MFA conservan login normal. Las cuentas inscritas fallan de forma cerrada, sin degradarse a contraseña sola.

No copiar `.env`, secretos de inscripción, respuestas de códigos o cookies a README, capturas, tickets o logs. Los informes y capturas de aceptación solo contienen estado después de ocultarlos; la clave y cuentas de prueba existen únicamente durante la copia descartable.

## Validación reproducible

Build backend/Angular previos, respaldo local legible bajo `.backups/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:mfa -- --backup=.backups/FECHA/database.dump
```

`backend/verify-mfa.js` restaura otra base, ejecuta check/migrate solo en esa copia, levanta AppModule con fiscal mock y cron detenido, y usa Angular producción/API/guardas/PostgreSQL reales. No inyecta sesiones para entrar a los navegadores. Nueve grupos comprueban inscripción/expiración/cifrado, clave ausente con rollback, revocación, login sin bypass, CSRF, reto vencido/versión obsoleta, bloqueo persistente, replay/concurrencia, respaldo y desactivación. La entrega de respaldos queda fuera del shell; avanzar61s del reloj del navegador no genera consultas de fondo ni redirige. Tras descartarla, abrir su ruta no recupera códigos. Esto no altera el reloj del servidor ni el contador TOTP: para login se espera el siguiente intervalo real. Navegadores claro1280/oscuro390, restauración, axe de panel/login/error y ausencia de desbordamiento. La copia se elimina y recursos se cierran; reporte `.artifacts/s023-mfa.json`. Unitarias usan vectores públicos RFC6238, prueban autenticación del cifrado, estado del cliente y transferencia efímera de un uso. La suite HTTP sin base mantiene mocks explícitos; no sustituye esta aceptación real.

## Límites y siguiente fase

S02.3 resuelve **MFA TOTP opcional con respaldo del autenticador**. [S02.4 añade recuperación local de contraseña con clave offline previamente confirmada](RECUPERACION_DE_CUENTA.md), conservando el requisito MFA y sus límites/consumo de respaldos. No hay correos de restablecimiento ni recuperación automática sin factores; S02 sigue parcial por soporte asistido/identificación real y canal externo de aviso antes de producción. Tampoco incluye llaves FIDO/passkeys, MFA obligatoria por rol, dispositivos confiables, auditoría append-only global ni despliegue TLS real. TOTP puede ser víctima de phishing y no elimina XSS; HttpOnly tampoco impide acciones desde scripts del propio origen. No se afirma certificación o preparación completa para producción.

Referencias primarias consultadas: [RFC6238, algoritmo y vectores](https://datatracker.ietf.org/doc/html/rfc6238), [OWASP, ciclo de MFA y recuperación](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). Se usa Node crypto para las primitivas estándar; sin nuevas dependencias de ejecución.
