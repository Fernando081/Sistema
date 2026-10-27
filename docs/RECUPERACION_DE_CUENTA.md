# Recuperación local de contraseña y cuenta — S02.4

Refacciones y Tractorepuestos Tampico. Implementación local del19/10/2026, Node.js24, migración097. Complementa sesiones S02.1, cookie/CSRF S02.2 y MFA S02.3. No se infiere un correo de recuperación a partir del correo comercial, ni se contratan/enlazan servicios externos. Las cuentas existentes no quedan inscritas automáticamente.

## Política técnica aplicada

El canal local es una **clave de recuperación guardada previamente fuera del sistema**. Su inscripción exige una sesión persistida, contraseña actual y, si hay MFA, un código válido no utilizado del autenticador o respaldo disponible. Confirmar la clave demuestra que el usuario recibió/copió el secreto. No verifica teléfono, correo o identidad civil.

La clave recupera la contraseña de esa cuenta; no concede por sí sola una sesión y **no elimina ni sustituye MFA**. Si MFA está activado, recuperar exige también el autenticador o un respaldo MFA disponible. Estos últimos son distintos de la clave de recuperación de contraseña. La recuperación sin ningún factor no se automatiza ni se habilita mediante un botón administrativo.

Este método funciona en el entorno local actual, sin dominio, hosting, SMTP, SMS ni cargos por servicio. Avisos internos registrados en la cuenta informan de configuración, retirada y recuperación. No hay notificación externa inmediata, correos de restablecimiento, validación de dirección electrónica ni entrega automática de claves.

## Preparar acceso antes de olvidar la contraseña

1. Entrar a **Mi cuenta → Recuperar acceso a tu cuenta**.
2. Confirmar contraseña actual y, cuando corresponda, MFA. Un código usado para entrar no se acepta otra vez: esperar al siguiente o usar un respaldo.
3. Pulsar **Generar clave de recuperación**. El prefijo identifica una clave de contraseña y la distingue de códigos MFA; contiene256bits aleatorios. Se muestra únicamente en esa respuesta/pantalla privada.
4. Guardarla en un lugar protegido y separado del equipo (por ejemplo, una copia física protegida o un gestor de contraseñas personal). No copiarla a README, tickets, capturas, chats o registros.
5. Repetirla en **Repite la clave que guardaste** y confirmar antes de diez minutos. Solo entonces funciona. Caduca365d después de confirmar y permite **una recuperación**.

Al reemplazar una clave, la anterior sigue vigente hasta confirmar la nueva. Descartar la pantalla no activa el pendiente; este vence y no elimina la clave anterior. Generar otro pendiente sustituye el pendiente previo. La interfaz avisa antes de cerrar/recargar mientras muestra una clave pendiente; no la guarda en URL, historial, cookies o Web Storage.

**Retirar clave de recuperación** requiere contraseña y MFA si aplica; elimina la clave y cualquier pendiente. La próxima recuperación necesitará configurar otra. Cerrar sesiones/cambiar permisos no invalida una clave confirmada por sí solo; **cambiar la contraseña sí la invalida**, incluso si se vuelve a usar el mismo texto, porque su hash bcrypt nuevo es diferente. El estado distingue una clave vigente de un pendiente obsoleto.

## Recuperar la contraseña

Desde login, pulsar **Olvidé mi contraseña** (`/login/recuperar`). Introducir usuario, clave de recuperación guardada, nueva contraseña dos veces y factor MFA si está activo.

- La contraseña cumple la política común del ERP: mínimo diez caracteres y máximo72bytes UTF-8, sin truncamiento silencioso por bcrypt.
- Un intento con usuario desconocido, cuenta inactiva, clave incorrecta/retirada/vencida, credencial cambiada o factor inválido devuelve el mismo error general. No confirma si una cuenta existe.
- Éxito: cambia el hash de contraseña, incrementa versión, revoca todas las sesiones de la cuenta y retos MFA, elimina clave de recuperación/pendientes y registra aviso interno sin secretos. El navegador limpia su cookie/identidad y debe iniciar sesión normalmente; no hay login automático.
- MFA continúa activado con el mismo autenticador. Un respaldo MFA presentado se consume una sola vez; los restantes no se eliminan. El siguiente login vuelve a exigir los dos pasos.
- Después de entrar, revisar sesiones/factores y generar otra clave de recuperación. La utilizada no vuelve a servir.

No se bloquea una cuenta ni se consume su clave al escribir un usuario/clave incorrectos. Un fallo real de MFA, **después de acreditar la clave offline**, conserva el contador compartido de S02.3: cinco fallos bloquean diez minutos. No se reinicia pidiendo otra recuperación. El bloqueo o ausencia de MFA no consume la clave offline ni un respaldo válido.

## Pérdida de todas las evidencias

Sin clave previamente confirmada o sin un factor MFA válido, esta pantalla no puede recuperar la cuenta. El texto dirige al propietario **personalmente**. La política de soporte propuesta exige corroborar la identidad/vínculo por medios independientes ya conocidos; no aceptar una petición por WhatsApp/correo o datos públicos como prueba suficiente. No se inventa aprobación, entrega o verificación de identidad por el mero hecho de abrir la pantalla.

Si tampoco hay un administrador con acceso, el propietario necesita asistencia de quien administra el servidor y PostgreSQL, con evidencia de titularidad y autorización fuera del ERP, respaldo previo, control de cambios y revisión de sesiones/factores. Ese acceso de infraestructura ya permite modificar la base; **no se agregó una API/CLI de bypass**. No ejecutar cambios masivos o eliminar MFA automáticamente. El protocolo operativo de identificación/recuperación asistida y sus responsables deberán aprobarse y ensayarse antes de producción; la prueba local no acredita una identidad real ni cubre pérdida total del servidor/secretos.

## Contrato HTTP

Rutas bajo `/api/v1/auth/password-recovery`; `Cache-Control: private, no-store`.

| Ruta | Acceso y efecto |
| --- | --- |
| `GET status` | Cuenta propia autenticada: vigente, fechas y pendiente confirmable. Sin claves, hashes ni datos de otra cuenta |
| `POST setup` | Sesión + contraseña actual + MFA si aplica. Emite un pendiente10min; conserva la clave anterior |
| `POST confirm` | Sesión vigente + clave pendiente; verifica versión/credencial/caducidad y activa365d. Invalida la anterior |
| `POST revoke` | Sesión + contraseña actual + MFA si aplica. Retira clave y pendiente |
| `POST complete` | Público, pero exige clave guardada, nueva contraseña/confirmación y MFA si aplica. No entrega JWT; consume y revoca accesos |

Setup/confirm/revoke/complete limitados a cinco peticiones por minuto/IP. Las escrituras con cookie y las recuperaciones de navegador mantienen cabecera/origen/Fetch Metadata de S02.2; un origen externo se rechaza. Bearer/API no permite omitir el segundo factor. TLS es obligatorio al desplegar; HTTP local solo se usa según el entorno loopback existente.

## Persistencia y transacciones

- **097_recuperacion_cuenta_local.sql** añade `auth_password_recovery`, FK a usuario y checks de estado completo; no modifica migraciones aplicadas. No inserta claves de prueba en la instalación.
- Solo SHA-256 de claves aleatorias de256bits; nunca su texto. Huella del hash bcrypt vincula claves a la credencial para invalidarlas cuando cambia. Pendientes además ligados a versión y caducidad. No guardar hashes/claves en la auditoría JSON de cambios.
- Registro/confirmación/revocación/reset bloquean primero al usuario. Prueba/consumo MFA usa el mismo EntityManager/transacción y los bloqueos de S02.3. Actualización de contraseña, consumo de clave/respaldo, cierre de accesos y notificación se confirman juntos; un fallo SQL revierte todo.
- Dos resets simultáneos con una clave permiten solo un cambio. Comprobar clave/factor no crea una sesión temporal ni concede acceso a otras rutas.
- El rechazo de MFA se devuelve después de confirmar su contador, para no perderlo con rollback. El mensaje público no revela el motivo específico de autenticación.
- Se ejecuta el mismo coste bcrypt antes de consultar tanto cuentas inexistentes como existentes para reducir diferencias de tiempo. No se afirma tiempo constante de red/PostgreSQL; se mantienen límites por IP.
- Sin cron nuevo: reemplazo, revocación, recuperación y eliminación del usuario limpian sus filas. Un cambio normal de contraseña invalida por huella sin borrar automáticamente la fila histórica de configuración; el siguiente reemplazo/retirada la sustituye/elimina. No hay purga global nueva ni retención legal aprobada.
- Avisos internos usan `app_notification` existente, solo para el titular, sin contraseña, claves o hashes. No equivalen a auditoría global inmutable S03 ni alerta por canal externo.

## Validación

Con backend/Angular compilados y un respaldo legible bajo `.backups/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:password-recovery -- --backup=.backups/FECHA/database.dump
```

`backend/verify-password-recovery.js` restaura una base propia, check/migrate solo en esa copia y AppModule con fiscal mock/cron detenido. Angular producción y logins por formulario sin inyección de JWT. Ocho grupos: identidad/estado privado/errores genéricos, inscripción/confirmación/rotación/CSRF, reset real, caducidad/cuenta inactiva/credencial/sesión/revocación/concurrencia, inscripción y abuso MFA, recuperación con respaldo y MFA conservado, temas/móvil/axe/almacenamiento y límite HTTP real. Nuevas cuentas/secretos solo en copia; se elimina al terminar. Reporte `.artifacts/s024-password-recovery.json`, capturas sin claves/contraseñas.

Unitarias prueban política UTF-8/confirmación, errores equivalentes, ausencia de bypass MFA, metadata pública y estado pendiente obsoleto. Frontend verifica cuerpos privados, ausencia de almacenamiento y limpieza de identidad solo tras éxito. Regresiones de sesiones/cookies/MFA real se separan de suites HTTP/UI con mocks.

## Alcance

**S02.4 parcial: método local implementado/verificado para recuperación con evidencia offline previamente inscrita.** Pendientes identificación/soporte asistido aprobados y ensayados, y aviso externo por canal verificado antes de producción. No constituye recuperación arbitraria sin factores, envío por correo/SMS, FIDO ni despliegue HTTPS real. S02 conserva esas limitaciones operativas; no se declara el sistema listo para producción. La información ficticia y fiscal mock, identificadores técnicos e idempotencia, y exclusión de conexiones bancarias permanecen vigentes. Siguiente bloque técnico local: contrastar los pendientes S03; no repetir este método mientras se resuelven las decisiones de operación.

Referencia primaria: [OWASP, recuperación de contraseña: métodos offline y controles](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [OWASP, recuperación de MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
