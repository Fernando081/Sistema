# Diagnóstico de publicaciones y recuperaciones interrumpidas

**WEB03.1b**, actualizado el 11 de octubre de 2026. Diagnóstico, reconciliación, reanudaciones, cierres, cancelaciones y continuaciones del inventario están implementados en su alcance local. Desde esta sesión el cierre se delimita: **WEB03.1b-M1** documenta incidentes fuera de automatización; **WEB04.1d** verifica recuperación del preview instalado desde respaldo guardado sobre copias; **WEB03.1b-P1** mantiene aceptación/medición del lote real y ensayo de su publicación sellada pendientes. No se añaden automáticamente nuevas capas de continuación. Las funciones manuales no equivalen a resolución automática. Sin dominio/hosting ni conexiones bancarias.

## Qué cambió

`check:web-recovery` observa `publish.lock`, `publish-recovery.lock`, `publish-maintenance.lock`, `publish-resume.lock`, `publish-finalization.lock` y la evidencia de recuperación/reconciliación/cierre/reanudación. No elimina, renombra o cambia archivos del directorio inspeccionado. Escribe un reporte sanitizado separado en `.artifacts/web-recovery-status.json`.

Las recuperaciones nuevas escriben PID/equipo/nonce/fecha en su guarda antes de archivar el bloqueo de publicación; la guarda ya no queda deliberadamente vacía. Al liberarla comprueban que el contenido siga siendo propio. Si cambia, conservan el archivo y fallan. Guardas vacías de versiones anteriores se consideran inciertas y siguen requiriendo revisión.

`plan:web-recovery` prepara una propuesta ligada a la evidencia exacta. `reconcile:web-recovery` requiere una revisión explícita de ese hash y archiva exclusivamente la guarda elegible, conservando sus bytes. No mata procesos ni se ejecuta automáticamente al inspeccionar o publicar. En esta sesión se aplicó únicamente en directorios temporales de prueba.

`check:web-maintenance` observa la etapa alcanzada por un mantenimiento interrumpido. `plan:web-maintenance` prepara únicamente el cierre de una operación ya completada e íntegra con bloqueo residual. `finalize:web-maintenance` exige revisión explícita del nuevo plan. Estos comandos rechazan terminar una operación parcial.

`check:web-resume` y `plan:web-resume` comprueban elegibilidad estricta para continuar una reconciliación v2 parcial válida. `resume:web-recovery` aplica exclusivamente un plan revisado: conserva evidencia, registra una continuación actual y deja el mantenimiento para revisión de cierre separada. No se ejecuta automáticamente al diagnosticar o publicar.

`check:web-resume-guard`, `plan:web-resume-guard` y `finalize:web-resume-guard` atienden un caso distinto: la reanudación ya tiene ambos recibos completos/intactos, pero sigue presente su bloqueo exacto, local e inactivo. No completan recibos faltantes ni cierran mantenimiento.

`check:web-resumption-continuation`, `plan:web-resumption-continuation` y `continue:web-resumption` revisan una reanudación original v2 que quedó incompleta antes de su recibo. Continúan cuatro etapas válidas ligadas a su guarda local inactiva exacta; conservan los recibos existentes y registran los faltantes con fecha y revisión actuales. Mantienen mantenimiento para cierre separado y utilizan la exclusión de finalización existente.

`check:web-resumption-abort`, `plan:web-resumption-abort` y `abort:web-resumption` ofrecen cancelación revisada de esa reanudación parcial en cuatro etapas. Conservan archivos y recibos originales; solo archivan/retiran la guarda de reanudación y registran su cancelación. En las primeras tres etapas la reconciliación original permanece pendiente; en la cuarta se reconoce su recibo previo íntegro como evidencia existente. Mantenimiento se conserva para revisión separada.

`check:web-closure-resume`, `plan:web-closure-resume` y `resume:web-closure` continúan un cierre de mantenimiento o de guarda de reanudación interrumpido. Exigen una intención de cierre v2 vinculada exactamente a su guarda de recuperación. Registran una revisión nueva y completan solo pasos/recibos faltantes con fecha actual, conservando recibos existentes.

`check:web-reconciliation-abort`, `plan:web-reconciliation-abort` y `abort:web-reconciliation` permiten cancelar una reconciliación v2 parcial válida sin recibo. Revisión/ID/motivo nuevos, evidencia intacta, archivos de guardas y recibo propio de cancelación; no crean un recibo de éxito de la operación original. Reutilizan la guarda exclusiva de finalización.

`check:web-closure-abort`, `plan:web-closure-abort` y `abort:web-closure` cancelan un cierre original v2 de mantenimiento o guarda de reanudación interrumpido antes de su recibo, en tres etapas por tipo. Conservan el origen completado, sus recibos y los archivos existentes; archivan únicamente la recuperación del cierre. Fuente residual presente se cierra después por revisión/ID nuevos, sin ejecutar la revisión cancelada. Cierre ya completado utiliza la continuación existente.

## Uso con Node24

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --strict
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL --strict
```

Por defecto inspecciona `public-web/dist`. Directorio inexistente/no regular, argumentos desconocidos o fallo de inspección devuelven código1. En modo estricto devuelve1 cuando la coordinación no está libre. Sin modo estricto permite observar un estado que requiere revisión; eso no significa que sea seguro publicar. El publicador no invoca este comando automáticamente: incorporarlo al procedimiento/pipeline si se necesita ese control.

Reporte incluye estado, fecha, alcance, `coordinationClear`, estado/PID/fecha/hash de bloqueos válidos, conteos/incidencias de archivo-registro y IDs/hashes de reconciliaciones, cierres, reanudaciones, continuaciones y cancelaciones. `maintenanceReviews.pending`, `resumptions.pending`, `resumptionContinuations.pending`, `resumptionAborts.pending`, `resumptionReviews.pending`, `closureResumptions.pending` y `reconciliationAborts.pending` impiden estado ready cuando una operación quedó incompleta/alterada, aunque ya no exista su bloqueo. Las cancelaciones íntegras se reflejan en `reconciliations.aborted` o `resumptions.aborted`, separadas de `completed`; no reconstruyen un recibo de éxito original. La cuarta etapa de cancelación de reanudación conserva y reconoce un recibo previo de reconciliación, identificado con `completionEvidence=preserved-reconciliation-receipt` y `resumptionAbortId`. No copia datos crudos, reviewer, motivo, nombre del equipo, catálogo, contactos, claves o rutas privadas al reporte. Archivos inválidos no exponen siquiera su digest, pues podrían contener bytes privados ajenos a metadata. El hash identifica bytes de metadata válida; no autentica un propietario.

## Estados y decisiones

La cancelación de cierres incorpora `closureAborts.completed/pending` y `maintenanceReviews.aborted`/`resumptionReviews.aborted`, separados de éxito. `closureAborts.pending` impide ready y publishing con metadata incompleta/alterada aun sin guardas. Solo una cadena de cancelación completa/intacta retira el cierre cancelado de pending; recibos de reconciliación/reanudación de origen se validan por separado. El diagnóstico conserva límites y sanitización.

| Estado | Lectura | Siguiente paso |
| --- | --- | --- |
| ready | Sin bloqueo/guarda presentes y sin pares de recuperación pendientes detectados | Comprobar por separado versión activa, recibo y aceptación; no es permiso de lanzamiento |
| publishing | Bloqueo local con PID activo, sin guarda ni incidentes de historial | Esperar/revisar el proceso; no matarlo o retirar el bloqueo desde este diagnóstico |
| recovering | Guarda local con PID activo | Recuperación en curso al observar; no iniciar otra. Comprobar de nuevo después |
| reconciling | Mantenimiento local con PID activo | Operación o proceso propietario presente; esperar/revisar. Publicadores y recuperadores cooperantes rechazan intervenir |
| resuming | Guarda de reanudación local con PID activo | Continuación o proceso propietario presente; otras herramientas cooperantes rechazan intervenir. Revisar de nuevo al terminar |
| finalizing | Guarda de continuación de cierre local con PID activo | Revisión o proceso propietario presente; publicadores, recuperadores, reconciliadores y cierres cooperantes rechazan intervenir |
| needs-review | Propietario ausente/ajeno/indeterminado, metadata inválida o evidencia incompleta/divergente | Conservar archivos y revisar procesos/evidencia; preparar plan solo si cumple los requisitos siguientes |
| changed | Nombres/contenidos cambiaron durante el doble recorrido | Repetir cuando termine la operación; no tomar el reporte como snapshot estable |
| invalid | No se pudo completar la inspección acotada | Revisar acceso, directorio y límites; no se declara coordinación libre |

Cada bloqueo puede indicar absent, active, inactive, foreign, invalid o unverifiable. Proceso local se sondea mediante señal0; solo ESRCH se considera ausencia. PID reutilizado aparece activo y no se declara huérfano. Permisos insuficientes u otros errores no se convierten en ausencia. Un equipo distinto requiere revisión; no se consulta una máquina remota.

Un PID activo no prueba que el proceso siga trabajando, que el bloqueo pertenezca todavía a la misma instancia original o que no haya quedado colgado. PID/equipo/nonce son metadata local, no autenticación. El diagnóstico no decide qué proceso debe terminarse.

## Pares de evidencia

Una recuperación completada conserva `publish-orphan-UUID.lock` y `lock-recovery-UUID.json`. Se comprueba estructura, identidad archivada y SHA-256 exacto; el registro debe declarar propietario inactivo y decisión recover-local-lock. Validar el par no prueba aprobación comercial, firma del revisor o vigencia del recibo ERP.

| Incidencia | Qué significa |
| --- | --- |
| missing-record | Archivo archivado sin registro final; posible interrupción después del rename |
| missing-archive | Registro sin archivo archivado correspondiente |
| invalid-record | Archivo/metadata/registro no cumplen el formato esperado |
| archive-mismatch | Hash o campos del propietario no coinciden con el archivo archivado |

Las incidencias se conservan incluso si ya no hay guarda. El modo estricto no informa ready por encontrar el directorio sin `publish.lock` cuando falta evidencia de una recuperación. Una reconciliación válida puede reconocer un missing-record exacto: se cuenta en `archives.acknowledged`, separado de `archives.complete`. No crea el registro histórico ausente. Los demás incidentes siguen bloqueando el estado ready. Archivos privados con nombres no relacionados no se leen ni se inventarian. La inspección no diagnostica versiones sin activar, archivos pointer temporales o todo el contenido del directorio.

Lectura de archivos regulares, sin enlaces simbólicos, máximo16 KiB por metadata; no interpreta contenido arbitrario como propietario. Recorrido acotado a10000 entradas y600 archivos de historial, además de los cinco bloqueos. Exceder un límite exige revisión de archivo/historial, no truncado silencioso que pueda declarar ready. No se elimina historial para cumplir el límite. Preparación de reanudación reserva espacio para sus nuevos archivos antes de intervenir.

Después del análisis vuelve a leer nombres y contenidos para detectar cambios concurrentes. No adquiere un bloqueo: estado de procesos/filesystem puede cambiar después del reporte. Modificaciones externas, permisos privilegiados y la ventana entre comparación de propietario y retirada de guarda no quedan protegidos por una transacción de filesystem o bloqueo distribuido.

## Procedimiento de revisión local

1. Ejecutar diagnóstico y conservar el reporte; revisar también el estado del proceso en el equipo correcto. No usar antigüedad como prueba de ausencia.
2. Ejecutar `check:web-active`: es la comprobación separada del puntero/sello/rutas de la versión activa. Un preview sin versión informa pending; coordinación ready no lo convierte en versión verificada. Vigencia de recibo ERP y lote comercial siguen independientes.
3. Para un bloqueo nuevo de publicación, sin guarda y con propietario realmente ausente, continúa disponible el procedimiento existente de inspección/aprobación por hash en [WEB_PUBLICA.md](WEB_PUBLICA.md#web031b--recuperar-bloqueo-de-publicación). No se ejecutó recuperación sobre la instalación en esta sesión.
4. Si hay guarda inactiva válida del equipo local, seguir la preparación y revisión siguientes. Para guarda antigua/corrupta, equipo ajeno, proceso activo o mantenimiento presente, conservar evidencia y revisar manualmente. No usar el procedimiento ordinario para borrar guardas o reconstruir registros históricos.
5. Comprobar de nuevo diagnóstico, versión activa, recibo ERP y lote tras cualquier intervención. Una reconciliación puede terminar correctamente y todavía dejar un `publish.lock` huérfano: su recuperación ordinaria necesita revisión separada de su hash.

## Preparar y aplicar una reconciliación — 2026-10-11

### Requisitos de preparación

- Directorio local regular y evidencia estable en dos observaciones.
- `publish-recovery.lock` con estructura nueva válida, del equipo local y PID ausente. Antigüedad no basta; PID reutilizado/activo impide preparar.
- `publish.lock` ausente o válido, local e inactivo. No se retira este archivo mediante reconciliación.
- `publish-maintenance.lock` ausente. No se recupera automáticamente un mantenimiento interrumpido.
- Sin reconciliaciones incompletas/alteradas ni incidentes históricos distintos de missing-record. Máximo20 archivos sin registro por plan; más requieren revisión manual sin truncado ni selección automática.
- Cada archivo a reconocer conserva metadata local válida de un proceso ausente. Se mantiene sin modificación.
- `current-release.json` ausente o con formato válido. Se liga el hash de sus bytes, sin validar aquí sello, archivos publicados o recibo ERP.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-recovery -- --directory=RUTA_LOCAL
```

Produce `.artifacts/web-reconciliation-plan.json` con status prepared-local, plan y planSha256. La preparación no interviene en publicaciones ni aprueba el plan. El hash liga la ruta física del directorio (sin imprimirla), guarda, bloqueo ordinario, puntero y IDs/hashes de archivos sin registro. Copiar la misma evidencia a otra carpeta no permite reutilizar la revisión. Guardar copia privada del plan y de la evidencia antes de aplicar.

### Revisión explícita

Crear un JSON privado con **solo** estos campos. Sustituir los textos indicados por un UUIDv4 nuevo de la operación, nombre del responsable y hash exacto preparado:

```json
{
  "operationId": "UUIDv4-DE-LA-OPERACION",
  "decision": "reconcile-local-recovery",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-REVISADO"
}
```

Los marcadores anteriores son ilustrativos y el comando los rechaza. El UUID es un identificador técnico de idempotencia, no un timbre fiscal. No incluir contraseñas, tokens, claves, contactos ni datos del catálogo. Reviewer es una declaración local del operador: estos registros no contienen firma digital, autenticación ERP ni prueba de aprobación del propietario.

Tras revisar la evidencia exacta y coordinar a los operadores:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run reconcile:web-recovery -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL --strict
```

### Aplicación y evidencia conservada

1. Adquiere `publish-maintenance.lock` de forma exclusiva con PID/equipo/nonce/fecha y sync. Publicadores, recuperadores y otros reconciliadores de esta versión comprueban esa guarda. Revalida el plan y la propiedad antes de intervenir.
2. Guarda `recovery-reconciliation-UUID.intent.json` con revisión actual, plan/hash y fecha, mediante creación exclusiva y sync. Desde esta sesión, las intenciones nuevas usan schemaVersion2 e incluyen maintenanceSha256 de su bloqueo exacto. Los registros schemaVersion1 siguen siendo legibles, sin modificarlos ni inventarles ese vínculo. Una intención no equivale a resultado completado.
3. Crea `publish-recovery-orphan-UUID.lock` mediante enlace duro con destino exclusivo. Comprueba hash/propiedad y retira la guarda original únicamente después de conservar sus bytes y revalidar evidencia. Requiere enlaces duros del filesystem local (NTFS en esta instalación), en el mismo volumen.
4. Escribe `recovery-reconciliation-UUID.json` con hash exacto de la intención y fecha de terminación. Verifica el conjunto y conserva el puntero original.
5. Retira exclusivamente su mantenimiento si mantiene la propiedad. Reporta reconciled; repetir la misma revisión/ID con evidencia completada intacta devuelve replayed sin duplicar archivos. Cambiar responsable/hash o alterar evidencia rechaza la repetición.

El diagnóstico valida los tres archivos, el plan y los hashes de archivos reconocidos. Diferencia reconocimiento actual y recuperación histórica completada. No escribe un `lock-recovery-UUID.json` anterior que no exista. No cambia catálogo, versión activa, recibos, contactos o BD.

### Fallo o interrupción

Si falla antes de escribir intención, libera su mantenimiento solo cuando conserva la propiedad. Desde el intento de persistir intención, cualquier fallo deja el mantenimiento y la evidencia para revisión; no se reanuda ni limpia automáticamente. Si otro actor cambia la guarda de mantenimiento, la conserva y rechaza continuar. Tras terminar el proceso, el diagnóstico presenta mantenimiento inactivo/evidencia incompleta como needs-review. Mientras el PID esté presente, reconciling no garantiza que la operación continúe avanzando.

El CLI devuelve código1 y sobrescribe su reporte de resultado con not-completed/resultConfirmed=false. Esto **no afirma ausencia de cambios**: puede existir intención, archivo conservado o guarda ya retirada. Revisar la evidencia antes de reintentar. Si no puede escribir el reporte, también falla sin imprimir contenido privado. Argumentos desconocidos/duplicados, revisión incompleta o un hash desactualizado se rechazan.

## Revisar mantenimiento interrumpido y cerrar una operación terminada

Esta ampliación de WEB03.1b separa la comprobación de una operación incompleta del archivo de un bloqueo residual después de una operación terminada. Se ensayó en carpetas temporales con procesos hijos propios. No se intervino en mantenimiento operativo.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-maintenance -- --directory=RUTA_LOCAL
```

Escribe `.artifacts/web-maintenance-status.json`. Realiza dos observaciones y compara estado/evidencia; no modifica el directorio inspeccionado. Código0 permite observar un caso bloqueado y **no** significa autorización para intervenir. Directorio inválido o evidencia cambiada durante la observación devuelve1. No aceptar un reporte de fixture como diagnóstico de la instalación: ejecutar los comandos sobre el directorio correcto después de las pruebas.

| Etapa | Lectura y decisión |
| --- | --- |
| maintenance-absent | No hay mantenimiento presente; revisar coordinación/historial y versión por separado |
| maintenance-active/foreign/invalid/unverifiable | Propietario presente, ajeno, inválido o indeterminado; no se prepara cierre |
| unlinked-maintenance | Ninguna intención válida v2 liga el hash de este mantenimiento; incluye el historial v1 sin ese vínculo. Conservar para revisión manual |
| ambiguous-intents | Más de una intención liga el mismo mantenimiento; no elegir arbitrariamente |
| intent-only | Intención registrada, guarda original presente y archivo todavía ausente; operación incompleta |
| guard-archived | Guarda original y archivo conservado presentes, sin recibo final; operación incompleta |
| guard-removed | Guarda original ausente, archivo conservado presente, sin recibo final; operación incompleta |
| completed-before-release | Intención, archivo y recibo originales completos/intactos, mantenimiento local inactivo ligado por hash y guarda de recuperación ausente; puede preparar revisión de cierre |
| divergent-evidence/changed/invalid | Discrepancia, cambio o lectura inválida; conservar evidencia y no aplicar |

Las tres etapas parciales describen lo observado, no prueban que toda la operación sea correcta ni autorizan terminarla. El diagnóstico/cierre no escribe recibos, elimina mantenimiento o reanuda pasos pendientes. Para preparar una continuación se usa el procedimiento distinto siguiente, que además valida todos los archivos reconocidos y sus registros ausentes.

### Plan elegible y revisión nueva

Para completed-before-release, la publicación debe permanecer ausente/inactiva con el hash original, y el puntero conservar exactamente sus bytes originales o su ausencia. No puede haber incidentes de historial ni cierres parciales. Solo se admite una intención v2 íntegra cuyo maintenanceSha256 coincida con el mantenimiento inactivo. No se presupone asociación por antigüedad, PID o proximidad de nombres.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-maintenance -- --directory=RUTA_LOCAL
```

Produce `.artifacts/web-maintenance-plan.json`. El plan liga directorio físico, mantenimiento, ID/intención/recibo/guarda archivada originales, publicación, puntero y hash agregado de nombres/hashes de **todo** el historial de coordinación observado. Archivos privados ajenos no se leen. Conservar plan y evidencia privados antes de intervenir; este plan todavía no está aprobado ni aplicado. Revisiones desactualizadas o copiadas a otro directorio se rechazan.

Crear un JSON privado con solo estos campos, sustituyendo los marcadores por UUIDv4 nuevo, responsable y hash del plan revisado:

```json
{
  "operationId": "UUIDv4-NUEVO-DEL-CIERRE",
  "decision": "archive-completed-maintenance",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-MANTENIMIENTO"
}
```

Los marcadores no son valores válidos. Es una revisión distinta de la aprobación de la reconciliación original; declara el responsable local sin autenticarlo ni firmar digitalmente. No incluir secretos o datos de clientes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run finalize:web-maintenance -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL --strict
```

### Aplicación, fallos e idempotencia

El cierre adquiere exclusivamente `publish-recovery.lock`, con metadata propia y sync. Reutiliza la guarda que ya respetan publicadores/recuperadores; sigue bloqueando el intervalo entre retirada del mantenimiento y liberación final. Un segundo revisor, publicador, recuperador o reconciliador cooperante no interviene simultáneamente.

Persiste `maintenance-review-UUID.intent.json` con la revisión/plan actuales. Nuevas intenciones schemaVersion2 incluyen `recoverySha256` de su guarda propia; v1 conserva lectura histórica sin inventarle ese vínculo. Conserva el mantenimiento exacto mediante enlace duro exclusivo `publish-maintenance-orphan-UUID.lock`, revalida propietario, puntero y todo el historial, y retira únicamente el mantenimiento revisado. Escribe `maintenance-review-UUID.json` ligado al hash de esta intención actual, valida el conjunto y libera exclusivamente su guarda propia. Los tres archivos son evidencia del cierre actual; los registros originales permanecen byte por byte. No cambia la versión activa ni reconstruye historia fiscal/comercial.

El diagnóstico valida el cierre contra su intención/archivo/recibo y contra la reconciliación v2 original íntegra. Repetir una revisión/ID idénticos sobre evidencia completada intacta devuelve replayed sin duplicar archivos; cambiar responsable/hash o alterar evidencia rechaza la repetición. Si queda publish.lock inactivo, su recuperación ordinaria requiere revisión separada; un cierre terminado no significa coordinación ready o aceptación del lote.

Ante fallo antes de intentar intención se retira solo la guarda propia. Desde el intento de persistir intención, cualquier fallo conserva guarda/evidencia; no hay limpieza ni reintento automático. Intención parcial, archivo divergente o recibo ausente mantienen `maintenanceReviews.pending`. El CLI informa not-completed/resultConfirmed=false sin revelar la excepción: puede haber habido cambios. Si otro actor sustituye la guarda, la conserva.

Una interrupción **después de completar el recibo del cierre**, pero antes de liberar su guarda, deja el cierre comprobable y publish-recovery.lock inactivo. El procedimiento existente plan:web-recovery/reconcile:web-recovery permite revisar y archivar esa guarda con una revisión nueva, si cumple su propia elegibilidad; no inventa un recibo del cierre. Esto fue ensayado. Para cierres v2 vinculados existe además la continuación separada descrita abajo, que admite las cuatro etapas válidas y conserva recibos existentes. Un recibo corrupto/divergente sigue requiriendo revisión manual; el reconciliador no acepta historial pendiente.

## Reanudar una reconciliación parcial válida con revisión nueva

La reanudación admite exclusivamente una reconciliación original v2 ligada al hash del mantenimiento local inactivo. No cambia la intención original ni el propietario histórico del mantenimiento. Los archivos v1 siguen legibles, pero no se les inventa el vínculo faltante.

### Diagnóstico y requisitos

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-resume -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-resume -- --directory=RUTA_LOCAL
```

Los reportes `.artifacts/web-resumption-status.json` y `.artifacts/web-resumption-plan.json` quedan fuera del servidor público. Inspección/preparación realizan dos observaciones sin modificar el directorio. Código0 de diagnóstico permite observar un caso bloqueado; revisar `eligible` y `stage`. No usar el reporte de un fixture para intervenir en la instalación.

| Etapa elegible | Evidencia exigida | Pasos permitidos tras revisión |
| --- | --- | --- |
| intent-only | Guarda original válida/local/inactiva y archivo aún ausente, sin recibo | Conservar guarda mediante enlace exclusivo, retirar fuente revisada y registrar terminación actual |
| guard-archived | Guarda original y archivo con bytes exactos, ambos válidos/locales/inactivos, sin recibo | Conservar archivo existente, retirar fuente revisada y registrar terminación actual |
| guard-removed | Fuente ausente y archivo exacto válido/local/inactivo, sin recibo | Conservar archivo existente y registrar terminación actual |

Además exige:

- Mantenimiento local inactivo y **una sola** intención v2 válida vinculada por hash. Proceso activo/indeterminado, equipo ajeno, metadata antigua/corrupta o ambigüedad impiden preparación.
- Recibo original completamente ausente; jamás se sobrescribe un recibo existente, parcial o alterado.
- Directorio físico, publicación ausente/inactiva y puntero idénticos al plan original. No valida aquí el sello ni recibo ERP.
- Cada `acknowledgedArchives` original conserva bytes/propietario válidos, locales e inactivos. Su `lock-recovery` histórico sigue ausente. La lista coincide exactamente con las incidencias missing-record pendientes; un registro agregado o archivo no reconocido bloquea.
- Sin otras reconciliaciones, cierres o reanudaciones incompletos/alterados. `publish-resume.lock` ausente. No selecciona arbitrariamente una intención ni limpia historial.
- Historial de coordinación estable y dentro de límites. Archivos privados ajenos no se leen.

El plan schemaVersion1 liga etapa exacta, directorio físico, mantenimiento, ID/hash de la intención original, fuente/archivo de guarda, publicación, puntero y hash agregado de nombres/hashes del historial. La etapa también forma parte del hash: una revisión de intent-only deja de ser válida si otro actor archiva la guarda antes de aplicar.

### Revisión y aplicación

Conservar respaldo privado del directorio/evidencia y revisar el plan concreto. Crear un JSON privado con **solo** estos campos, sustituyendo los marcadores por UUIDv4 **nuevo y distinto del original**, responsable y hash preparado:

```json
{
  "operationId": "UUIDv4-NUEVO-DE-LA-REANUDACION",
  "decision": "resume-local-reconciliation",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-REANUDACION"
}
```

Los marcadores son ilustrativos y se rechazan. La revisión es local/declarada, sin autenticación ERP ni firma digital. No incluir secretos o datos de clientes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run resume:web-recovery -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-maintenance -- --directory=RUTA_LOCAL
```

1. Crea `publish-resume.lock` exclusivo con su propio PID/equipo/nonce/fecha y sync; publica/recupera/reconcilia/cierra únicamente con herramientas actualizadas que respeten esta guarda. Se comprueba antes/después de adquirir sus bloqueos. Revalida el plan y propietario antes de cada cambio.
2. Persiste `reconciliation-resume-UUID_NUEVO.intent.json`, ahora schemaVersion2, con revisión/plan actuales y `resumptionSha256` de su guarda propia exacta. Intenciones v1 previas siguen legibles sin modificarlas o inventarles ese vínculo. Desde el intento de escritura cualquier fallo conserva la guarda y evidencia.
3. Continúa únicamente los pasos pendientes de la etapa revisada. Guarda archivada se mantiene exacta; enlace nuevo usa destino exclusivo. Retira fuente solo después de comprobar archivo, mantenimiento, publicación, puntero, intención original, historial y guarda propia.
4. Crea el **recibo original antes ausente** `recovery-reconciliation-UUID_ORIGINAL.json`, schemaVersion2, con fecha **actual** de terminación, hash de la intención original y `resumptionId`/`resumptionIntentSha256`. Declara una continuación actual; no atribuye pasos a una fecha o responsable anteriores ni inventa un `lock-recovery` histórico.
5. Crea `reconciliation-resume-UUID_NUEVO.json`, schemaVersion1, con hash de la nueva intención, `reconciliationReceiptSha256` del recibo original actual y fecha de terminación. Diagnóstico valida el conjunto de ambos recibos y ambas intenciones; no hay dependencia circular entre hashes.
6. Libera solo su guarda propia tras verificar el resultado. **Mantiene el mantenimiento original sin modificar**. Preparar y revisar su cierre por separado con `plan:web-maintenance`/`finalize:web-maintenance`; un publish.lock residual exige todavía su recuperación ordinaria independiente.

### Idempotencia, fallos y evidencia

Una repetición de ID/revisor/hash idénticos con todo el conjunto completado intacto devuelve `replayed: true` sin repetir pasos o crear archivos nuevos. Esto también funciona después del cierre separado y de un cambio posterior válido del puntero: comprueba un resultado **histórico**, no afirma que el directorio actual esté libre o autorizado para publicar. Revisión distinta, trasplante de carpeta, intención o recibo alterados se rechazan.

Recibos originales schemaVersion1 de reconciliaciones normales siguen aceptándose. Un recibo original schemaVersion2 solo cuenta como completo cuando está ligado a una reanudación completa/intacta; falta/alteración del recibo nuevo deja ambos pendientes. `resumptions.completed/pending` registra estos resultados sin exponer contenido crudo o responsables.

Antes de intentar intención, libera exclusivamente su guarda propia al fallar. Desde el intento, la conserva aunque la fuente original ya haya sido retirada o el recibo original escrito. El CLI devuelve1 y reemplaza `.artifacts/web-resumption-result.json` con `not-completed/resultConfirmed=false`, sin imprimir la excepción privada. Puede haber habido cambios; no implica rollback. Guarda cambiada se conserva y bloquea continuación. No se admite reanudación automática de la **propia reanudación parcial** ni limpieza automática de guarda residual. Para reanudación original v2 parcial válida existe la continuación **revisada y separada** siguiente. Con ambos recibos completos y vínculo v2 existe el cierre de guarda; evidencia inválida/sin vínculo conserva revisión manual.

Las pruebas interrumpen procesos propios antes/después de enlace, tras retirada y antes/después del recibo original, e inyectan cambios de propietario/puntero/historial. Verifican exclusión, bytes conservados, tres etapas, rechazo de revisiones desactualizadas y replay histórico. Son ensayos temporales; no se intervino en bloqueos instalados y no prueban durabilidad ante corte eléctrico.

## Continuar una reanudación original interrumpida con revisión nueva

Esta herramienta atiende una reanudación original v2 cuyo recibo todavía está ausente. No repite la reanudación inicial ni el cierre de una guarda tras resultado completo. Las intenciones originales permanecen intactas; los vínculos faltantes de v1 no se reconstruyen.

### Diagnóstico y propuesta sin intervención

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-resumption-continuation -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-resumption-continuation -- --directory=RUTA_LOCAL
```

Reportes privados: `.artifacts/web-resumption-continuation-status.json` y `.artifacts/web-resumption-continuation-plan.json`. Inspección/preparación realizan doble observación y no cambian el directorio. Código0 permite diagnosticar un caso bloqueado; solo `eligible: true` permite preparar revisión.

| Etapa elegible | Evidencia exigida | Pasos faltantes permitidos |
| --- | --- | --- |
| intent-only | Intención de reanudación v2 vinculada, recuperación original exacta presente, archivo y ambos recibos ausentes | Conservar/retirar recuperación, registrar ambos recibos, archivar/retirar guarda de reanudación y registrar continuación |
| guard-archived | Recuperación y archivo exactos presentes; ambos recibos ausentes | Conservar archivo, retirar recuperación y completar recibos/guarda/continuación |
| guard-removed | Recuperación ausente, archivo exacto; ambos recibos ausentes | Conservar archivo y completar recibos/guarda/continuación |
| reconciliation-completed | Recuperación ausente y archivo exacto; recibo de reconciliación v2 íntegro vinculado a esta reanudación; recibo de reanudación ausente | Conservar recibo existente byte por byte; completar recibo de reanudación, guarda y continuación |

Requisitos adicionales:

- Guarda `publish-resume.lock` regular, válida, local/inactiva y ligada por `resumptionSha256` a **una sola** intención de reanudación v2 válida. No deduce asociación por PID, nombre o antigüedad.
- Reconciliación original v2, hash de mantenimiento exacto e intenciones originales intactas; mantenimiento presente, válido/local/inactivo. Etapa actual consistente con la partida original: no admite una fuente reaparecida o un archivo perdido que contradigan el plan original.
- Recibo de reanudación completamente ausente. Un recibo presente/corrupto/parcial bloquea; resultado ya terminado se remite a `plan:web-resume-guard`, sin iniciar otra continuación.
- Directorio físico, publicación ausente/inactiva y puntero iguales a los planes originales. Recuperación/archivo conservan los hashes originales. El recibo de reconciliación presente debe estar ligado a esta reanudación, nunca a otra.
- Lista exacta de archivos sin registro reconocidos en el plan original, cada archivo local/inactivo intacto y su registro histórico todavía ausente. No inventa ese registro.
- Sin reconciliaciones/reanudaciones pendientes ajenas, cierres/cancelaciones/continuaciones pendientes o guarda de finalización ocupada. Hash agregado de todos los nombres/bytes reconocidos estable.
- Archivos limitados a16 KiB, directorio10000 entradas e historial600 archivos más cinco nombres de bloqueo. Reserva cuatro destinos nuevos más archivo/recibo de reconciliación faltantes; no trunca ni borra evidencia para hacer espacio.

Plan schemaVersion1 ligado a etapa/directorio, IDs y hashes de ambas intenciones, guarda de reanudación, fuente/archivo de recuperación, recibo de reconciliación presente o ausencia, mantenimiento, publicación/puntero e historial. Cambiar etapa invalida el hash preparado.

### Revisión y aplicación explícita

Conservar respaldo privado del directorio/evidencia y revisar el plan exacto. Preparar JSON privado con **solo** estos campos, sustituyendo los marcadores por UUIDv4 nuevo distinto de ambos IDs originales, responsable y hash:

```json
{
  "operationId": "UUIDv4-NUEVO-DE-LA-CONTINUACION",
  "decision": "continue-local-resumption",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-CONTINUACION"
}
```

Los marcadores se rechazan. Revisión local declarada sin firma/autenticación ERP; no incluir contactos, contraseñas o claves.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run continue:web-resumption -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-maintenance -- --directory=RUTA_LOCAL
```

1. Adquiere `publish-finalization.lock` exclusivo, con propietario propio y sync; las herramientas cooperantes respetan este bloqueo existente antes/después de adquirir los suyos. Revalida etapa/plan exactos y todos los destinos ausentes.
2. Persiste `resumption-continuation-UUID_NUEVO.intent.json` con revisión, plan y hash de su guarda actual. Desde el intento de escritura conserva bloqueo/evidencia ante cualquier fallo.
3. Crea solo el archivo original de recuperación faltante mediante enlace duro exclusivo y retira únicamente su fuente exacta, si está presente. Revalida entre pasos. Archivo previo se conserva byte por byte.
4. Crea el recibo de reconciliación v2 **solo si estaba ausente**, con fecha actual y vínculo a la intención de reanudación original. Si ya estaba completo, conserva bytes y fecha existentes. No sobrescribe intención/recibo ni atribuye pasos actuales al revisor pasado.
5. Crea el recibo antes ausente de la reanudación, ahora schemaVersion2, con fecha actual, hashes de sus evidencias y `resumptionContinuationId`/`resumptionContinuationIntentSha256`. Recibos históricos v1 siguen legibles sin modificación.
6. Conserva la guarda de reanudación exacta mediante enlace exclusivo `publish-continued-resume-UUID_NUEVO.lock`, revalida y retira solamente su fuente revisada.
7. Registra `resumption-continuation-UUID_NUEVO.json` con hashes de intención actual, ambos recibos y guarda archivada. Diagnóstico valida la cadena en dos pasadas antes de declarar ambas operaciones completas; libera únicamente su guarda propia intacta.

**El mantenimiento original permanece intacto.** Preparar/aplicar su cierre revisado por separado; una publicación residual conserva recuperación ordinaria independiente. No cambia catálogo, puntero, sellos, recibos ERP o captación.

### Fallos, histórico y casos manuales

`resumptionContinuations.completed/pending` refleja la cadena actual sin copiar responsable o valores privados. Un recibo de reanudación v2 que depende de continuación incompleta/alterada deja `resumptions.pending` y la reconciliación pendiente; no se certifica a partir de un recibo aislado. Pendientes impiden ready aun cuando desaparezcan las guardas. Vínculo/recibo prestados de otra continuación no se aceptan.

Replay de ID/responsable/hash idénticos sobre cadena completa/intacta no duplica archivos. Verifica evidencia histórica incluso tras cierre de mantenimiento o cambio posterior válido del puntero; no afirma coordinación actual libre. Revisión distinta, traslado de carpeta o evidencia alterada rechazan replay.

Fallo antes de intentar intención libera solo guarda propia intacta. Desde el intento conserva guarda/evidencia aunque haya retirado fuentes o escrito recibos. CLI devuelve1 y reemplaza `.artifacts/web-resumption-continuation-result.json` con not-completed/resultConfirmed=false, sin excepciones privadas; puede haber mutaciones. Si la **nueva continuación** se interrumpe, incluso con recibo final antes de liberar guarda, requiere revisión manual; no hay reintento/limpieza automática. V1 sin vínculo, corruptos, ajenos/activos/indeterminados o evidencia divergente permanecen bloqueados.

Ensayos en temporales con procesos hijos propios: cuatro etapas válidas, tres etapas de partida originales, nueve cortes de la continuación, recibos intactos, competencia de revisores, exclusión de herramientas, cambios de evidencia/propiedad, historial acotado, CLI y fallo de E/S tras retirar guarda. No constituyen recuperación operativa, aceptación comercial o garantía frente a corte eléctrico/filesystem remoto.

## Cerrar la guarda residual de una reanudación completada

Este cierre comprueba un resultado ya terminado y retira su bloqueo exacto después de conservarlo. Es independiente de la reanudación de pasos pendientes y del cierre de mantenimiento. Se ensaya en temporales; no se retira ninguna guarda instalada al implementar/probar esta herramienta.

### Diagnóstico sin intervención

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-resume-guard -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-resume-guard -- --directory=RUTA_LOCAL
```

Reportes: `.artifacts/web-resume-guard-status.json` y `.artifacts/web-resume-guard-plan.json`. Dos observaciones sin cambiar el directorio; código0 de diagnóstico no aprueba intervención. Solo `eligible: true`, `stage: completed-before-release` permite preparar un plan.

| Etapa | Decisión |
| --- | --- |
| resumption-guard-absent | Sin bloqueo presente; comprobar historial/mantenimiento por separado |
| resumption-guard-active/foreign/invalid/unverifiable | No intervenir; propietario presente, ajeno, metadata inválida o estado indeterminado |
| unlinked-resumption-guard | No hay intención v2 válida vinculada a su hash; incluye v1 completo sin ese vínculo. Revisión manual |
| ambiguous-intents | Más de una intención liga el bloqueo; no elegir por fecha o nombre |
| resumption-incomplete | Vínculo válido pero faltan recibos íntegros; no fabricarlos ni retirar bloqueo |
| recovery-* / maintenance-* | Guarda de recuperación ocupada/no válida o mantenimiento original sin estado local inactivo requerido |
| divergent-evidence / changed / invalid / history-limit | Discrepancia, cambio, lectura inválida o límites excedidos; conservar evidencia |
| completed-before-release | Reanudación/reconciliación completas e intactas, vínculo v2 exacto, origen estable y sin otros pendientes; preparar revisión nueva |

El mantenimiento original debe estar presente, local/inactivo y conservar el hash del plan de reanudación. Guarda de recuperación ausente, publicación ausente/inactiva y puntero/directorio iguales al plan original. Reconciliación, ambos recibos, archivos reconocidos y todo el historial deben seguir íntegros; no cierres pendientes. No presupone asociación por PID, antigüedad o proximidad de nombres.

El plan liga directorio, guarda de reanudación, ID/intención/recibo de reanudación, ID/intención/recibo/archivo de la reconciliación original, mantenimiento, publicación/puntero y hash agregado de nombres/hashes de todo el historial observado. Reserva tres archivos nuevos dentro del límite600. Archivos privados ajenos no se leen.

### Revisión y aplicación

Conservar respaldo privado de evidencia/directorio y revisar el plan concreto. JSON de revisión con **solo** estos campos; sustituir marcadores por UUIDv4 nuevo **distinto de reconciliación y reanudación**, responsable y hash exacto:

```json
{
  "operationId": "UUIDv4-NUEVO-DEL-CIERRE-DE-GUARDA",
  "decision": "archive-completed-resumption",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-GUARDA"
}
```

Los marcadores no son válidos. Revisión local/declarada, sin autenticación ERP o firma digital; no incluir secretos/datos de clientes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run finalize:web-resume-guard -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-maintenance -- --directory=RUTA_LOCAL
```

1. Adquiere `publish-recovery.lock` exclusivo con metadata propia y sync. Protege el intervalo tras retirar la guarda de reanudación. Reanudador, publicador/rollback, recuperador, reconciliador y cierre de mantenimiento cooperantes no intervienen simultáneamente; reanudador comprueba recuperación antes/después de adquirir su guarda.
2. Persiste `resumption-review-UUID.intent.json` schemaVersion2 con revisión/plan actuales y `recoverySha256` de su guarda propia antes de cambiar la fuente. V1 conserva lectura histórica sin inventarle ese vínculo.
3. Conserva la guarda exacta mediante enlace duro exclusivo `publish-resume-orphan-UUID.lock`. Revalida archivo, fuente, propietarios, mantenimiento, puntero e historial antes/después de retirar `publish-resume.lock`.
4. Persiste `resumption-review-UUID.json`, schemaVersion1, con hash de la intención nueva y fecha actual. Diagnóstico valida intención/archivo/recibo y el vínculo a los conjuntos originales completos, sin dependencia circular.
5. Libera exclusivamente su guarda de recuperación propia. El mantenimiento original sigue intacto para `plan:web-maintenance`/`finalize:web-maintenance` por revisión separada. Un publish.lock residual sigue necesitando recuperación ordinaria independiente.

Intenciones/recibos originales y catálogo/puntero no se cambian. Repetir ID/revisor/hash idénticos con evidencia histórica completa intacta devuelve replayed sin duplicar ni repetir pasos, también tras cerrar mantenimiento/cambiar posteriormente un puntero válido. No afirma coordinación actual libre ni aceptación comercial.

### Fallos y casos todavía pendientes

Desde el intento de escribir intención, cualquier fallo conserva la guarda de recuperación/evidencia. El CLI devuelve1 y sustituye su resultado por not-completed/resultConfirmed=false sin revelar excepciones privadas; puede haber cambios. Propietario sustituido se conserva. Archivo/intención/recibo alterado deja `resumptionReviews.pending`, incluso si desapareció la fuente o después se cerró mantenimiento; no permite ready.

Corte durante este cierre, o después de su recibo antes de liberar recuperación, mantiene revisión pendiente: no se reintenta/limpia automáticamente. La continuación revisada siguiente admite las cuatro etapas válidas exclusivamente si la intención de cierre v2 liga la recuperación exacta. Si todavía hay mantenimiento original, no usar el reconciliador ordinario para saltar ese bloqueo. Intenciones v1 sin hash de guarda no se convierten a v2; conservan revisión manual aunque los recibos históricos sean completos. No completa reanudaciones incompletas ni implementa aborto. El simulacro con respaldo operativo y lote real mantienen validaciones separadas.

## Reanudar un cierre interrumpido y su guarda de recuperación vinculada

Implementación local en `public-web/closure-resumption.mjs`. Atiende un cierre de mantenimiento o de guarda de reanudación que comenzó correctamente y se interrumpió. Se diferencia de reanudar la reconciliación original y de cerrar una guarda de reanudación ya completada. No hay continuación automática al arrancar la web.

### Diagnóstico y elegibilidad

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-closure-resume -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-closure-resume -- --directory=RUTA_LOCAL
```

Reportes privados separados: `.artifacts/web-closure-resumption-status.json` y `.artifacts/web-closure-resumption-plan.json`. Dos observaciones sin cambiar el directorio. Código0 de diagnóstico permite observar un caso bloqueado; solo `eligible: true` permite preparar un plan.

Requisitos:

- Guarda `publish-recovery.lock` regular, válida, del equipo local y con proceso inactivo. Exactamente una intención de cierre schemaVersion2 válida debe ligar su hash mediante `recoverySha256`. No se atribuye por fecha, PID o proximidad de nombres. Un cierre v1 completo sigue reconocido históricamente, pero no permite esta continuación sin el vínculo.
- Reconciliación original completa/intacta; si es cierre de guarda de reanudación, también la reanudación original completa/intacta y mantenimiento original presente, local/inactivo y con hash exacto. Comprueba IDs, intenciones, recibos y guardas archivadas de los conjuntos enlazados.
- Directorio físico, publicación ausente/inactiva, hash de publicación y puntero iguales al plan original. Historial sin pendientes ajenos, alteraciones o continuación anterior de este cierre. Guarda `publish-finalization.lock` ausente.
- Fuente y archivo ausentes/presentes exactamente según la etapa; archivos presentes locales/inactivos con hash exacto. Recibo ausente o completo/intacto. Un recibo existente corrupto o no coincidente nunca se reemplaza.
- Lecturas regulares hasta16 KiB,10000 entradas y600 archivos de historial. Reserva tres archivos nuevos de continuación y cada archivo/recibo original faltante antes de intervenir; exceder límites bloquea sin truncar o borrar evidencia.

| Etapa | Evidencia y pasos permitidos |
| --- | --- |
| intent-only | Intención válida, fuente exacta presente, archivo y recibo ausentes; archivar fuente, retirar fuente y escribir recibo actual |
| source-archived | Fuente y archivo exactos presentes, recibo ausente; conservar archivo, retirar fuente y escribir recibo actual |
| source-removed | Fuente ausente, archivo exacto presente, recibo ausente; conservar archivo y escribir recibo actual |
| completed-before-release | Fuente ausente, archivo exacto y recibo v1 completos/intactos; conservar recibo existente byte por byte |
| recovery-guard-absent | No hay guarda; comprobar historial y demás bloqueos por separado |
| recovery-* / finalization-* | Guarda ocupada, ajena, inválida o indeterminada; conservar evidencia, no intervenir |
| unlinked-recovery-guard / ambiguous-intents | Sin vínculo exacto o varias intenciones; revisión manual, no elegir arbitrariamente |
| closure-resumption-needs-review / divergent-evidence / changed / invalid / history-limit | Evidencia incompleta/alterada, cambio o límites excedidos; no preparar ni aplicar |

El plan liga tipo/ID/intención/recibo del cierre, etapa, directorio, recuperación, fuente/archivo, mantenimiento restante, publicación/puntero y hash agregado de nombres/hashes de todo el historial reconocido. Solo excluye bloqueos fijos y los archivos que el procedimiento debe crear; cada uno se verifica separadamente antes/después de cambiarlo. Los archivos privados de negocio no se leen.

### Revisión nueva y aplicación

Conservar respaldo privado y revisar la evidencia concreta antes de aplicar a una instalación. JSON de revisión con **solo** estos campos; sustituir marcadores por un UUIDv4 nuevo distinto de cierre/reconciliación/reanudación, responsable y hash exacto:

```json
{
  "operationId": "UUIDv4-NUEVO-DE-LA-CONTINUACION",
  "decision": "resume-local-closure",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-CONTINUACION"
}
```

Los marcadores no son válidos. Identidad declarada local; no autentica al responsable en el ERP. No incluir secretos o datos de clientes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run resume:web-closure -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-maintenance -- --directory=RUTA_LOCAL
```

Secuencia:

1. Crea `publish-finalization.lock` exclusivo con metadata propia y sync. Publicación/rollback, recuperación, reconciliación, reanudación y ambos cierres comprueban esta guarda antes/después de adquirir sus bloqueos. Diagnóstico indica `finalizing` mientras el proceso local está activo. Revalida etapa/plan, propietarios y evidencia antes de intentar intención.
2. Escribe `closure-resumption-UUID.intent.json`, schemaVersion1, con revisión/plan actuales y `finalizationSha256` de su guarda exacta. Desde este intento, un fallo conserva guarda y evidencia.
3. Ejecuta únicamente pasos faltantes de la tabla: enlace duro exclusivo de la fuente original a su archivo y retirada de la fuente exacta. Revalida archivos, fuente, recuperación, guarda propia, origen, puntero e historial antes/después de cada paso. Los archivos presentes no se sobrescriben.
4. Si falta recibo original, escribe su schemaVersion2 con fecha actual, `closureResumptionId` y `closureResumptionIntentSha256`; no reconstruye una fecha pasada ni reutiliza la revisión antigua como autorización nueva. Si el recibo v1 ya existía, conserva sus bytes y liga su hash al resultado nuevo.
5. Archiva la recuperación exacta mediante enlace duro exclusivo `publish-closure-recovery-orphan-UUID.lock`, revalida y retira únicamente la guarda revisada. La guarda propia sigue excluyendo operaciones durante este intervalo.
6. Escribe `closure-resumption-UUID.json`, schemaVersion1, ligado a la intención nueva y hash del recibo original. Diagnóstico comprueba la evidencia original, archivo de recuperación y ambos recibos; un recibo original v2 solo cuenta como completo si su continuación enlazada está completa/intacta y corresponde exactamente a ese cierre/tipo. Validación en dos pasadas impide tomar la completitud de otra operación.
7. Libera exclusivamente su guarda propia tras validar el resultado. En cierre de guarda de reanudación, el mantenimiento original continúa intacto para `plan:web-maintenance`/`finalize:web-maintenance` separados. Un bloqueo ordinario residual mantiene su propia recuperación revisada.

Se conservan bytes de intenciones/recibos/archivos existentes y datos privados, sin cambios a puntero/catálogo/BD/captación. Replay de ID/revisor/hash idénticos verifica el conjunto histórico completo sin duplicarlo ni repetir pasos, incluso después de cerrar mantenimiento o cambiar posteriormente un puntero válido. No declara coordinación actual libre ni aceptación comercial.

### Fallos y alcance pendiente

Antes de intentar intención, un fallo libera únicamente su guarda propia, si sigue intacta. Desde el intento, conserva guarda/evidencia aunque la fuente o recuperación ya se hayan retirado. CLI devuelve1 y sustituye su reporte por not-completed/resultConfirmed=false; puede haber cambios y no implica rollback. Propietario sustituido se conserva. Excepciones y valores privados no se imprimen.

`closureResumptions.completed/pending` amplía el diagnóstico. Intención, archivo o recibo alterado/incompleto mantiene needs-review incluso si desaparecen los bloqueos. Una continuación de cierre que a su vez se interrumpe conserva `publish-finalization.lock` para revisión manual; no se retira por edad ni se admite reinicio automático, incluso si se alcanzó el recibo final antes de liberarla. Un fichero de guarda inválido o un enlace también excluye operaciones cooperantes.

Casos v1 sin vínculo, fuente/archivo/recibo divergentes, proceso activo, equipo ajeno, permisos indeterminados o intenciones ambiguas siguen bloqueados. No implementa aborto, continuación de una reanudación original incompleta, migración automática de registros antiguos ni aceptación operativa. Ensayos en temporales con procesos hijos propios; no se intervinieron bloqueos instalados.

## Cancelar una reconciliación parcial válida con revisión nueva

Implementación local en `public-web/reconciliation-abort.mjs`. Permite detener una reconciliación incompleta por una decisión revisada y conservar su evidencia. La operación original queda **cancelada**, sin recibo de éxito ni fechas históricas reconstruidas. No cancela publicaciones/ventas, no retira versiones y no mata procesos.

### Diagnóstico y requisitos

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-reconciliation-abort -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-reconciliation-abort -- --directory=RUTA_LOCAL
```

Reportes separados `.artifacts/web-reconciliation-abort-status.json` y `.artifacts/web-reconciliation-abort-plan.json`. Inspección/preparación hacen dos observaciones sin mutar el directorio. Código0 del diagnóstico permite observar un caso bloqueado; solo `eligible: true` permite preparar un plan.

- Mantenimiento original regular, válido, local/inactivo y **exactamente una** intención original schemaVersion2 que lo liga por hash. V1 permanece legible; no se le inventa el vínculo. PID activo, equipo ajeno, permisos indeterminados, contenido antiguo/inválido o ambigüedad bloquean.
- Recibo original completamente ausente. Un recibo válido completado, corrupto o parcial nunca se reemplaza ni se cancela mediante este procedimiento.
- Directorio físico, publicación ausente/inactiva, hash de publicación y puntero iguales al plan original. No valida aquí sello/recibo ERP o aceptación comercial.
- Cada archivo `acknowledgedArchives` del plan original conserva hash/propietario local inactivo y su `lock-recovery` histórico sigue ausente. La lista coincide exactamente con los missing-record pendientes; no admite archivos/registros agregados o cambiados.
- Sin otras reconciliaciones pendientes, cierres/reanudaciones/cancelaciones incompletos o alterados. Guardas de reanudación/finalización ausentes. No selecciona por antigüedad, nombre o PID.
- Historial dentro de límites: metadata regular hasta16 KiB,10000 entradas y600 archivos de historial además de cinco bloqueos. Reserva tres archivos nuevos de cancelación y un cuarto si la fuente de recuperación sigue presente. No trunca ni elimina evidencia para cumplir el límite.

| Etapa elegible | Evidencia exigida | Acción después de revisión |
| --- | --- | --- |
| intent-only | Mantenimiento e intención v2 exactos; recuperación original presente e inactiva, archivo original ausente y sin recibo | Archivar ambas fuentes en archivos de cancelación, retirarlas y registrar cancelación; el archivo/recibo originales ausentes siguen ausentes |
| guard-archived | Fuente y archivo original de recuperación exactos, mantenimiento vinculado y sin recibo | Conservar archivo original, archivar ambas fuentes y registrar cancelación |
| guard-removed | Fuente de recuperación ausente, archivo original exacto, mantenimiento vinculado y sin recibo | Conservar archivo original, archivar únicamente mantenimiento y registrar cancelación |

`maintenance-absent` sin historial pendiente indica que no hay mantenimiento para cancelar; no aprueba otras operaciones. `maintenance-*`, `finalization-*`, `receipt-present`, `unlinked-maintenance`, `ambiguous-intents`, `other-operation-needs-review`, `abort-needs-review`, `divergent-evidence`, `changed`, `invalid` o `history-limit` rechazan preparación/intervención. La cancelación de una reanudación/cierre distinto permanece fuera de este alcance.

El plan liga etapa, directorio, mantenimiento, ID/intención original, fuente/archivo de recuperación, publicación/puntero y hash agregado de nombres/hashes de **todo** el historial reconocido. Solo excluye bloqueos fijos y los cuatro destinos nuevos del propio procedimiento; estos se verifican individualmente antes/después de cada paso. Archivos privados de negocio no se leen.

### Revisión y aplicación

Conservar respaldo privado y revisar la evidencia concreta antes de intervenir en una instalación. JSON privado con **solo** estos campos; sustituir marcadores por UUIDv4 nuevo distinto del original, responsable, motivo y hash exacto:

```json
{
  "operationId": "UUIDv4-NUEVO-DE-LA-CANCELACION",
  "decision": "abort-local-reconciliation",
  "reviewer": "RESPONSABLE DE REVISION",
  "reason": "MOTIVO CONCRETO PARA DETENER LA RECONCILIACION",
  "planSha256": "SHA256-DEL-PLAN-DE-CANCELACION"
}
```

Los marcadores se rechazan. Responsable hasta100 caracteres y motivo hasta500, obligatorios y sin caracteres de control. Revisión declarada local, sin autenticación ERP/firma. No incluir secretos o datos de clientes; motivo/responsable quedan solo en la intención privada, fuera del diagnóstico y de la web pública.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run abort:web-reconciliation -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-active -- --directory=RUTA_LOCAL
```

1. Reutiliza `publish-finalization.lock` exclusivo, metadata propia y sync, respetado por todas las herramientas cooperantes antes/después de adquirir sus bloqueos. No agrega otra capa de bloqueos. Diagnóstico muestra finalizing mientras el proceso local está activo.
2. Revalida plan/evidencia y escribe `reconciliation-abort-UUID.intent.json`, schemaVersion1, con revisión/motivo actuales, plan/hash y `finalizationSha256` de su guarda exacta. Desde el intento de intención, cualquier fallo conserva guarda/evidencia.
3. Archiva mantenimiento exacto mediante enlace duro exclusivo `publish-aborted-maintenance-UUID.lock`. Si la recuperación original sigue presente, la archiva en `publish-aborted-recovery-UUID.lock`. Antes/después de cada enlace y retirada, comprueba propietarios, archivos, intención original/propia, publicación, puntero, archivos reconocidos, registros ausentes e historial. Retira únicamente las dos fuentes revisadas que estaban presentes.
4. Conserva todos los archivos/intenciones originales byte por byte, incluido el archivo original de recuperación si existía. El recibo original `recovery-reconciliation-UUID_ORIGINAL.json` **permanece ausente**. No escribe un registro histórico `lock-recovery`, no cambia catálogo/puntero/captación/BD y no interviene en un publish.lock residual.
5. Escribe `reconciliation-abort-UUID.json`, schemaVersion1, con outcome=aborted, hash de intención actual, hashes de archivos de cancelación y fecha actual. Valida intención/recibo/archivos y el vínculo exacto al original v2; solo un conjunto completo/intacto cuenta como cancelación registrada. Dos conjuntos completos que atribuyan cancelación al mismo original se consideran ambiguos.
6. Diagnóstico incorpora `reconciliationAborts.completed/pending` y `reconciliations.aborted` con ID de la cancelación; la reconciliación original no entra en completed. Sus archivos sin registro histórico cuentan en archives.acknowledged como evidencia revisada actual; no se inventa el registro anterior. Libera únicamente su guarda propia intacta después de validar el resultado.

Si queda publish.lock inactivo, requiere su recuperación ordinaria independiente. Coordinación ready no verifica versión activa, recibo ERP o aceptación del catálogo. Replay de ID/revisor/motivo/hash idénticos verifica la evidencia histórica completa sin repetir pasos ni duplicar archivos, también después de un cambio posterior válido del puntero/recuperación ordinaria. La operación cancelada no puede reanudarse o repetir su reconciliación como completada con la revisión antigua.

### Fallos y alcance pendiente

Antes del intento de intención, un fallo libera solo la guarda propia intacta. Después la conserva, incluso si ya retiró ambas fuentes o escribió el recibo final. Propietario sustituido permanece. CLI devuelve1 y reemplaza su resultado por not-completed/resultConfirmed=false, sin mostrar motivo, responsable, caminos privados o excepciones; puede haber cambios y no implica rollback.

Cancelación incompleta/alterada deja reconciliationAborts.pending, bloquea nuevas preparaciones y no permite ready incluso si desaparecen las guardas. Archivo/recibo/intención original alterado o un recibo/registro original agregado invalidan el vínculo; el reconciliador rechaza replay sobre cancelación pendiente/contradictoria. No se limpia por edad ni se reintenta automáticamente. Una cancelación original interrumpida válida ahora puede continuarse con revisión nueva mediante el procedimiento siguiente, incluyendo recibo completo antes de liberar finalización; los casos divergentes conservan revisión manual y respaldo.

Quedan fuera de este comando otros tipos de operación, reanudaciones incompletas, v1 sin vínculo, metadata corrupta/ajena/indeterminada y evidencia divergente. La continuación de una cancelación de reconciliación tiene herramienta y revisión separadas; una interrupción de esa nueva continuación sigue siendo manual. Reanudación original v2 parcial válida dispone de su continuación revisada separada descrita arriba. Pruebas temporales con procesos propios; no constituyen simulacro operativo, intervención en la instalación o aceptación comercial.

## Cancelar una reanudación parcial válida con revisión nueva

Implementación local en `public-web/resumption-abort.mjs`. Cancela una **reanudación original** incompleta; la reconciliación que intentaba resolver mantiene su propia evidencia y estado. No crea sus recibos de éxito, no publica versiones ni activa captación. Comparte la inspección conservadora de etapas con `resumption-continuation.mjs`; la decisión y la propuesta son distintas.

### Elegibilidad y etapas

- Una sola intención original de reanudación v2 válida, ligada por `resumptionSha256` a su guarda exacta `publish-resume.lock`, local e inactiva. Intención de reconciliación v2 y mantenimiento local inactivo vinculados exactamente.
- Recibo de reanudación original completamente ausente. Si ya existe un resultado completo/íntegro, usar el cierre de guarda existente. Un recibo corrupto o parcial se conserva para revisión manual.
- Etapa compatible con el plan inicial, sin retroceder evidencia. Fuente/archivo de recuperación, archivos reconocidos, publicación residual y puntero conservan sus hashes originales; no admite otros journals pendientes, guardas activas/ajenas/indeterminadas o vínculos antiguos.
- Doble observación sin mutación y propuesta ligada a directorio físico, etapa, ambas intenciones, recibo previo si existe, todas las guardas y el historial completo. Metadata regular hasta16 KiB,10000 entradas y600 archivos históricos además de cinco bloqueos fijos. Reserva tres destinos antes de intervenir, sin truncar ni eliminar evidencia.

| Etapa | Evidencia original | Resultado de cancelar solo la reanudación |
| --- | --- | --- |
| intent-only | Fuente de recuperación intacta; archivo y recibo de reconciliación ausentes | Conserva esa fuente y sus ausencias; reconciliación sigue pendiente |
| guard-archived | Fuente y archivo de recuperación intactos; recibo de reconciliación ausente | Conserva ambos archivos; reconciliación sigue pendiente |
| guard-removed | Fuente de recuperación ausente; archivo intacto; recibo de reconciliación ausente | Conserva archivo y ausencias; reconciliación sigue pendiente |
| reconciliation-completed | Fuente retirada, archivo intacto y recibo original v2 íntegro ligado a esta reanudación; aún no hay recibo de reanudación | Conserva ese recibo byte por byte; reconciliación se identifica como terminada por evidencia previa, reanudación como cancelada |

En todos los casos permanecen intactos mantenimiento, intención original, catálogo, versión y puntero. La guarda de reanudación se conserva en un archivo propio de cancelación antes de retirarla. El recibo de reanudación original **no se crea**.

`resumption-guard-absent` sin historial pendiente indica que no hay guarda que cancelar. `resumption-*`, `maintenance-*`, `unlinked-resumption-guard`, `ambiguous-intents`, `resumption-receipt-present`, `resumption-abort-needs-review`, `continuation-needs-review`, `other-operation-needs-review`, `divergent-evidence`, `finalization-*`, `history-limit`, `changed` o `invalid` impiden preparar/aplicar. Resultado terminado indica `resumption-completed-use-guard-review`. Ninguno de esos resultados autoriza borrar metadata manualmente.

### Preparar y revisar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-resumption-abort -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-resumption-abort -- --directory=RUTA_LOCAL
```

Reportes separados: `.artifacts/web-resumption-abort-status.json` y `.artifacts/web-resumption-abort-plan.json`. No contienen contenido crudo, responsable, motivo o rutas privadas. No los copie al sitio público. Una revisión privada nueva tiene exactamente estos campos:

```json
{
  "operationId": "UUID_V4_NUEVO",
  "decision": "abort-local-resumption",
  "reviewer": "Responsable de la revisión",
  "reason": "Motivo de detener esta reanudación",
  "planSha256": "SHA256_EXACTO_DE_LA_PROPUESTA"
}
```

Sustituir los marcadores por un UUID v4 minúsculo distinto de ambos IDs originales y el hash exacto actual. Responsable no vacío hasta100 caracteres, motivo no vacío hasta500; ambos sin caracteres de control. No incluir secretos. No acepta campos adicionales, IDs antiguos o revisión desactualizada; un cambio de etapa/recibo/puntero/historial exige preparar/revisar otra propuesta. Responsable y motivo son declaraciones locales, no firma o autenticación.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run abort:web-resumption -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
```

### Aplicación y estado posterior

1. Reutiliza `publish-finalization.lock` exclusivo con propietario y sync; todas las herramientas cooperantes actuales lo respetan. Revalida la propuesta y cada archivo entre pasos.
2. Persiste primero `resumption-abort-UUID.intent.json`, schemaVersion1, con revisión, motivo, plan exacto, hash de finalización y fecha actual. Desde ese intento, un fallo conserva guarda/evidencia para revisión.
3. Archiva únicamente `publish-resume.lock` por enlace duro exclusivo en `publish-aborted-resume-UUID.lock`. Comprueba bytes/propietario/evidencia antes de retirar la fuente. No archiva ni retira mantenimiento o la recuperación original.
4. Escribe `resumption-abort-UUID.json`, schemaVersion1, outcome=aborted, hash de intención, hash de archivo, hash/null del recibo de reconciliación conservado y fecha actual. Solo la cadena completa/intacta y única cuenta como cancelación registrada. Libera únicamente su finalización propia intacta tras validar el resultado.
5. Diagnóstico incorpora `resumptionAborts.completed/pending` y `resumptions.aborted` con ID de cancelación. La reanudación no pasa a completed. En la cuarta etapa `reconciliations.completed` indica `completionEvidence=preserved-reconciliation-receipt` y `resumptionAbortId`: verifica el recibo que **ya existía**, sin fabricarlo.

En las primeras tres etapas, seguir con una decisión independiente: cancelar la reconciliación original mediante `plan:web-reconciliation-abort`/`abort:web-reconciliation`, o reanudarla mediante `plan:web-resume`/`resume:web-recovery` con ID nuevo. Si se reanuda, cerrar después mantenimiento con su herramienta existente. En la cuarta, el cierre de mantenimiento existente puede revisarse directamente. Un `publish.lock` residual mantiene su recuperación ordinaria separada.

Una reanudación posterior válida para el mismo origen puede escribir su recibo de reconciliación con su propio vínculo. La cancelación anterior sigue como evidencia histórica incluso si esa sucesora se interrumpe antes de su recibo; el éxito de la sucesora se valida por su propia cadena, nunca por la cancelación antigua. Un recibo agregado atribuido a la reanudación cancelada, un vínculo prestado/divergente o cualquier recibo de esa reanudación cancelada invalidan la cancelación.

Replay con ID/responsable/motivo/hash idénticos y cadena histórica intacta no repite pasos, incluso tras resolución independiente del origen y un cambio posterior válido de puntero. No declara coordinación actual libre. IDs/responsables/motivos distintos se rechazan. Reporte de aplicación `.artifacts/web-resumption-abort-result.json`; ante fallo usa `not-completed`/`resultConfirmed=false`, no el éxito previo ni errores privados.

### Fallos y límites

`resumptionAborts.pending` impide ready y bloquea nuevas preparaciones si queda intención/archivo/recibo incompleto, alterado o ambiguo, incluso sin guardas. Dos cancelaciones completas del mismo origen son ambiguas. Reemplazo del propietario, intenciones, fuentes, archivos, recibos o historial entre comprobaciones conserva exclusión y evita certificar resultado.

La cancelación original interrumpida válida ahora dispone de continuación revisada separada descrita abajo, también después de su recibo antes de liberar finalización. No se reanuda automáticamente, no se limpia por edad y no reconstruye recibos de éxito originales. La nueva continuación nuevamente interrumpida, cierres de mantenimiento/guarda y metadata antigua/corrupta/divergente mantienen sus procedimientos o pendientes separados. Estas herramientas no sustituyen respaldo, simulacro operativo, aceptación comercial o versión activa; el publicador no ejecuta automáticamente el diagnóstico estricto.

## Cancelar un cierre parcial válido con revisión nueva

Implementación local en `public-web/closure-abort.mjs`. Detiene un cierre original incompleto de mantenimiento o guarda de reanudación, conservando los pasos y archivos que ya existen. No revierte una publicación ni restaura bloqueos retirados; no inventa su recibo de éxito. La reconciliación y, cuando corresponde, la reanudación de origen deben estar completadas e íntegras antes de preparar esta revisión.

### Requisitos y etapas

- Una sola intención original de cierre v2 válida, ligada por `recoverySha256` a la guarda exacta `publish-recovery.lock`, local e inactiva. Origen/recibos/archivos intactos, tipo inequívoco y contexto de directorio, publicación/puntero y mantenimiento coincidentes.
- Recibo del cierre completamente ausente. Si ya está completo/íntegro, `closure-completed-use-resumption` remite a `plan:web-closure-resume`/`resume:web-closure`, que conservan ese recibo y resuelven la recuperación residual. Un recibo parcial/corrupto, v1 sin vínculo o evidencia divergente permanece manual.
- Sin otros cierres, reanudaciones, continuaciones o cancelaciones pendientes/alterados, ni guardas ajenas/activas/indeterminadas. Doble observación sin mutación; propuesta por hash de toda la evidencia.
- Metadata regular hasta16 KiB,10000 entradas y600 archivos históricos además de cinco bloqueos. Reserva exactamente tres destinos antes de intervenir, sin truncar ni borrar evidencia. Un plan de continuación con más destinos puede quedar fuera del límite aunque este plan de cancelación sí quepa.

| Etapa del cierre original | Evidencia exigida | Lo que conserva la cancelación |
| --- | --- | --- |
| intent-only | Fuente de mantenimiento/reanudación exacta presente; archivo del cierre y recibo ausentes | Fuente presente, archivo/recibo ausentes; requiere cierre nuevo separado |
| source-archived | Fuente y archivo exactos presentes; recibo ausente | Ambos archivos; fuente requiere cierre nuevo separado |
| source-removed | Fuente ausente, archivo exacto presente y recibo ausente | Fuente y recibo ausentes, archivo intacto; no restaura fuente ni crea recibo |

Son seis casos locales elegibles: tres por cada tipo. En cierre de guarda de reanudación, el mantenimiento original queda intacto para su revisión separada. Recibos de reconciliación/reanudación originales siempre se conservan byte por byte. Solo se archiva/retira la guarda de **recuperación del cierre**; no se retira ninguna fuente residual como parte de cancelar.

### Plan y revisión

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-closure-abort -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-closure-abort -- --directory=RUTA_LOCAL
```

Por defecto inspecciona `public-web/dist`. Reportes separados `.artifacts/web-closure-abort-status.json` y `.artifacts/web-closure-abort-plan.json`; no cambian la carpeta inspeccionada ni contienen datos crudos, responsable, motivo o ruta privada. No se sirven por HTTP. `closure-abort-needs-review`, guardas no elegibles, `unlinked-recovery-guard`, `ambiguous-intents`, `divergent-evidence`, pendientes ajenos, `history-limit`, `changed` o `invalid` rechazan preparación/aplicación. Ausencia de recuperación sin historial pendiente indica `recovery-guard-absent`, sin autorizar otras operaciones.

Revisión privada con exactamente estos campos:

```json
{
  "operationId": "UUID_V4_NUEVO",
  "decision": "abort-local-closure",
  "reviewer": "Responsable de la revisión",
  "reason": "Motivo de detener este cierre",
  "planSha256": "SHA256_EXACTO_DE_LA_PROPUESTA"
}
```

Sustituir marcadores por UUID v4 minúsculo nuevo distinto del cierre/reconciliación/reanudación originales y hash exacto actual. Responsable no vacío hasta100 caracteres, motivo no vacío hasta500, ambos sin controles ni secretos. No acepta campos adicionales; tipo/etapa/archivo/recibo/puntero/historial cambiados requieren otra propuesta/revisión. Responsable/motivo son declaraciones locales sin autenticación o firma.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run abort:web-closure -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
```

### Registro, resultado y acciones independientes

1. Reutiliza `publish-finalization.lock` exclusivo, propietario propio y sync; comprueba plan, contexto y propiedad entre pasos. Herramientas cooperantes actuales rechazan intervención concurrente.
2. Persiste primero `closure-abort-UUID.intent.json`, schemaVersion1, con revisión/motivo, plan por hash, finalización exacta y fecha actual. Desde el intento de intención, un fallo conserva guarda y evidencia.
3. Conserva `publish-recovery.lock` mediante enlace duro exclusivo a `publish-aborted-closure-recovery-UUID.lock`, verifica bytes/propietario y retira solo esa fuente de recuperación. Intención/fuente/archivo/ausencia de recibo del cierre y todos los recibos de origen permanecen iguales.
4. Registra `closure-abort-UUID.json`, schemaVersion1, outcome=aborted, hash de intención y recuperación archivada, con fecha actual. Diagnóstico exige cadena completa/intacta y única; dos cancelaciones del mismo cierre/tipo son ambiguas. Libera únicamente su finalización propia intacta tras validar resultado.
5. `closureAborts.completed/pending` distingue la revisión actual. El cierre original pasa a `maintenanceReviews.aborted` o `resumptionReviews.aborted` con ID de cancelación, separado de completed. No se inventa el recibo de cierre faltante; éxito del origen sigue respaldado por sus propios recibos.

Si la fuente de mantenimiento/reanudación aún está presente, coordinación sigue needs-review: preparar un cierre **nuevo** con su herramienta existente y otro ID. Su archivo anterior se conserva. Si la fuente ya estaba retirada, esa ausencia se conserva y el archivo original queda revisado por la cadena de cancelación; no requiere un recibo ficticio. En cierre de reanudación, cerrar mantenimiento por revisión separada. Un `publish.lock` residual mantiene su recuperación ordinaria independiente.

Un cierre sucesor puede interrumpirse de nuevo sin invalidar la cancelación anterior: el origen y archivo cancelados siguen intactos; la terminación del sucesor depende de su propia cadena. Usar la continuación de cierre existente cuando sea elegible. No ejecutar la revisión antigua cancelada.

Replay de ID/responsable/motivo/hash idénticos verifica historia íntegra sin repetir pasos, incluso tras cierre nuevo, recuperación ordinaria o cambio posterior válido de puntero. No certifica coordinación actual libre. Responsable/motivo distintos, archivo/recibo/intención de origen alterados o un recibo añadido al cierre cancelado invalidan la cadena. Resultado `.artifacts/web-closure-abort-result.json`; fallo reemplaza éxito previo por not-completed/resultConfirmed=false y no muestra valores privados.

### Fallos y alcance pendiente

`closureAborts.pending` impide ready y bloquea nuevas preparaciones aun si desaparecen las guardas. Reemplazos entre comprobaciones conservan exclusión/evidencia sin certificar cancelación. La cancelación original interrumpida válida dispone de continuación revisada separada en cuatro etapas por tipo, descrita abajo, incluso después de su recibo antes de liberar finalización. Nuevas continuaciones nuevamente interrumpidas siguen manuales. No se limpia por edad ni se reintenta automáticamente.

Esta entrega cancela el cierre **original** v2 parcial válido; no resuelve una cancelación o nueva continuación nuevamente interrumpida, v1 sin vínculo, metadata antigua/corrupta/ajena/indeterminada o evidencia divergente. Pruebas locales en temporales con procesos propios; no sustituyen respaldo, simulacro operativo, aceptación comercial o versión activa. El publicador no ejecuta automáticamente el diagnóstico estricto.

## Continuar una cancelación original de reconciliación interrumpida con revisión nueva

Entrega WEB03.1b, 2026-10-11. Resuelve el pendiente de cancelación original interrumpida identificado en la sesión anterior. Conserva la decisión `aborted` y la ausencia de recibo de éxito de la reconciliación original; la terminación de la auditoría nueva se registra por separado.

### Requisitos y seis etapas

Una única intención original `reconciliation-abort-UUID.intent.json` válida debe ligar exactamente `publish-finalization.lock` mediante `finalizationSha256`. Su propietario debe ser local, válido e inactivo. La reconciliación original debe ser v2, sin recibo de éxito; directorio físico, publicación/puntero, mantenimiento, recuperación y sus archivos históricos deben coincidir con el plan original. Conserva archivos reconocidos y la ausencia de sus registros históricos. No admite otros pendientes ajenos ni una guarda de reanudación ocupada.

| Etapa | Evidencia compatible |
| --- | --- |
| intent-only | Intención de cancelación presente; fuentes originales presentes; archivos de cancelación y recibo ausentes |
| maintenance-archived | Mantenimiento archivado, fuente presente; recuperación aún sin archivar cuando existía |
| sources-archived | Ambas fuentes presentes y archivadas; sólo si había recuperación al iniciar la cancelación |
| recovery-removed | Recuperación archivada/retirada; mantenimiento presente/archivado |
| maintenance-removed | Fuentes retiradas y todos los archivos requeridos presentes; recibo de cancelación ausente |
| completed-before-release | Igual que la anterior, con recibo original de cancelación v1 completo; finalización sigue presente |

Si la reconciliación ya había retirado recuperación antes de iniciar la cancelación, sólo aplican las otras cuatro etapas y no se crea un archivo de recuperación inexistente. Recibos parciales/corruptos, secuencias imposibles, guardas activas/ajenas/indeterminadas/antiguas, vínculos ausentes, dos intenciones para la misma finalización y cambios del contexto se rechazan sin resolverlos por edad.

### Preparación y revisión

Conservar respaldo privado de directorio/evidencia y revisar el plan exacto. Inspección y plan hacen dos observaciones sin mutar el directorio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-reconciliation-abort-continuation -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-reconciliation-abort-continuation -- --directory=RUTA_LOCAL
```

Reportes `.artifacts/web-reconciliation-abort-continuation-status.json` y `web-reconciliation-abort-continuation-plan.json`. Código0 de inspección no autoriza intervención. Sólo `eligible: true` permite preparar revisión. El plan liga etapa, ID/hash de cancelación original y finalización, presencia de fuentes/archivos, recibo previo o ausencia, directorio/publicación/puntero e historial. Reserva tres archivos propios más cada archivo/recibo original faltante dentro de600 históricos y cinco controles, sin truncar.

JSON privado con **sólo** estos campos; sustituir marcadores por UUIDv4 nuevo distinto de cancelación/reconciliación originales, responsable no vacío hasta100 caracteres sin controles y hash del plan:

```json
{
  "operationId": "UUIDv4-NUEVO-DE-LA-CONTINUACION",
  "decision": "continue-local-reconciliation-abort",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-CONTINUACION"
}
```

Los marcadores se rechazan. El motivo original permanece intacto en su intención; esta revisión declarada local no lo reescribe ni tiene firma/autenticación ERP. No incluir secretos o contactos.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run continue:web-reconciliation-abort -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
```

### Aplicación, recibos y bloqueos

1. Conserva finalización original y adquiere **el control existente `publish-resume.lock`** exclusivo con propietario propio. Mantiene exclusión al retirar la finalización original, sin introducir un sexto bloqueo. Revalida plan/destinos antes de intervenir.
2. Persiste `reconciliation-abort-continuation-UUID_NUEVO.intent.json` con plan, revisión y hash de su guarda de reanudación. Desde el intento de escritura conserva exclusión/evidencia ante cualquier fallo.
3. Crea sólo archivos de cancelación faltantes mediante enlaces duros exclusivos y retira sólo fuentes revisadas que aún existen. Comprueba hashes/propietarios y contexto entre pasos. Intenciones, archivos y recibos previos se conservan byte por byte.
4. Si el recibo original de cancelación ya existe completo como v1, lo conserva con bytes/fecha originales. Si falta, crea `reconciliation-abort-UUID_ORIGINAL.json` v2 con fecha actual, `outcome: aborted`, hashes originales y `abortContinuationId`/`abortContinuationIntentSha256` vinculados a la nueva revisión. Nunca crea el recibo de éxito de la reconciliación ni un registro histórico de recuperación.
5. Archiva por enlace duro exclusivo la finalización original exacta en `publish-continued-abort-finalization-UUID_NUEVO.lock`, revalida y retira sólo su fuente.
6. Escribe `reconciliation-abort-continuation-UUID_NUEVO.json` con hashes de intención y recibo de cancelación. El diagnóstico valida la cadena en dos pasadas; un recibo de cancelación v2 aislado no cuenta como resultado confirmado. Libera sólo su propia reanudación intacta al validar el resultado.

`reconciliationAbortContinuations.completed/pending` registra la auditoría. `reconciliationAborts.completed` confirma cancelación y `reconciliations.aborted` conserva el resultado original separado del éxito. Dos auditorías completas del mismo aborto se consideran ambiguas. Un recibo v1 previo sigue confirmando su cancelación aunque la nueva auditoría esté pendiente; ese pendiente bloquea coordinación libre.

Una publicación residual queda intacta y necesita su recuperación ordinaria independiente. No cambia catálogo, versión, captación, recibos ERP o BD. Replay de ID/responsable/hash idénticos e historia íntegra no duplica pasos, incluso con puntero posterior válido; no certifica coordinación actual libre. La revisión original de cancelación puede reconocer su resultado histórico sólo cuando la cadena requerida esté completa y no hay guarda de reanudación ocupada.

### Fallos y alcance pendiente

Reemplazos de fuente/archivo/guardas/intención/recibo o cambios del contexto conservan evidencia y no certifican éxito. Un fallo tras retirar finalización conserva reanudación y auditoría parcial. CLI reemplaza éxito anterior por `not-completed/resultConfirmed: false` sin publicar errores, responsables o caminos privados. Puede haber cambios y no implica rollback.

`reconciliationAbortContinuations.pending` bloquea ready/publishing y todas las preparaciones aunque desaparezcan las guardas. La continuación sin auditoría completa sigue manual. Tras auditoría completa e íntegra, con proceso local terminado, el cierre revisado descrito abajo resuelve su reanudación residual. Cancelaciones originales interrumpidas válidas de reanudación/cierre utilizan sus continuaciones separadas descritas abajo; no se inventan vínculos ni se fuerzan controles sin evidencia.

Ensayos con procesos propios en temporales prueban etapas, exclusión, bytes, vínculos y fallos controlados; no prueban durabilidad ante corte eléctrico, intervención operativa ni aceptación comercial.

## Continuar una cancelación original de reanudación interrumpida con revisión nueva

Entrega WEB03.1b, 2026-10-11. Implementa el siguiente pendiente de la sesión anterior. Conserva `aborted` para la reanudación cancelada, su recibo de éxito ausente y los recibos de reconciliación que ya existían. Reconciliación/mantenimiento y publicación residual conservan decisiones independientes.

### Requisitos y etapas

Una única intención válida `resumption-abort-UUID.intent.json` debe ligar exactamente una finalización local válida/inactiva mediante `finalizationSha256`. Ambas intenciones de origen deben ser v2; fuente/archivo de reanudación, recuperación, mantenimiento, recibo original de reconciliación o ausencia, directorio físico/publicación/puntero e historial deben coincidir con el plan original. No admite otros pendientes ajenos o evidencia ambigua/alterada.

| Etapa de cancelación | Evidencia |
| --- | --- |
| intent-only | Intención presente, fuente de reanudación intacta; archivo y recibo de cancelación ausentes |
| source-archived | Fuente y archivo exactos presentes; recibo ausente |
| source-removed | Fuente ausente, archivo exacto presente; recibo ausente |
| completed-before-release | Fuente ausente, archivo y recibo original de cancelación v1 completos; finalización sigue presente |

Estas cuatro etapas aplican a las cuatro partidas originales de reanudación: intención sola, recuperación archivada, recuperación retirada y reconciliación con recibo previo completo. Son16 combinaciones. En las tres primeras partidas la reconciliación permanece pendiente. En la cuarta se conserva/reconoce su recibo previo completo byte por byte; la reanudación sigue cancelada y nunca entra en completed.

Guardas activas/ajenas/indeterminadas/antiguas/sin vínculo, recibos corruptos/incompletos, intenciones ambiguas, secuencias imposibles, nuevas continuaciones parciales y contexto divergente requieren revisión manual. Nunca se elige un propietario por edad.

### Inspección, plan y revisión

Conservar respaldo privado del directorio/evidencia y revisar el plan exacto. Los comandos hacen dos observaciones sin mutar el directorio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-resumption-abort-continuation -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-resumption-abort-continuation -- --directory=RUTA_LOCAL
```

Reportes `.artifacts/web-resumption-abort-continuation-status.json` y `web-resumption-abort-continuation-plan.json`. Código0 de inspección no aprueba intervención. Sólo eligible=true permite revisar una propuesta. Plan ligado a etapa, directorio, ID/hash de intención de cancelación y finalización, fuente/archivo/recibo presentes o ausencias, mantenimiento/publicación/puntero e historial. Reserva tres destinos propios más archivo/recibo original faltantes dentro de600 históricos y cinco controles; no trunca evidencia.

JSON privado con **sólo** estos campos; sustituir marcadores por UUIDv4 nuevo distinto de cancelación/reanudación/reconciliación originales, responsable no vacío hasta100 caracteres sin controles y hash del plan:

```json
{
  "operationId": "UUIDv4-NUEVO-DE-LA-CONTINUACION",
  "decision": "continue-local-resumption-abort",
  "reviewer": "RESPONSABLE DE REVISION",
  "planSha256": "SHA256-DEL-PLAN-DE-CONTINUACION"
}
```

Marcadores y campos adicionales se rechazan. Revisión declarada local sin firma/autenticación ERP; conserva motivo original y no atribuye pasos actuales al revisor anterior. No incluir secretos o contactos.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run continue:web-resumption-abort -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-recovery -- --directory=RUTA_LOCAL
```

### Exclusión y registro

En algunas partidas los cinco controles ya están ocupados. Esta herramienta conserva **la finalización original exacta durante todas las escrituras**; sólo la retira después de validar ambos recibos y la cadena nueva. No reescribe su propietario ni introduce un sexto control fijo.

1. Revalida plan y destinos ausentes. Adquiere una reserva exclusiva mediante enlace duro desde finalización a `publish-continued-resumption-abort-finalization-UUID_CANCELACION_ORIGINAL.lock`. El destino usa el **ID de la cancelación original**, no el nuevo: dos revisores con IDs nuevos distintos compiten por el mismo nombre; sólo un enlace exclusivo puede ganar. El archivo conserva bytes del bloqueo original y después queda como evidencia histórica.
2. Revalida contexto/propietarios y persiste `resumption-abort-continuation-UUID_NUEVO.intent.json` con revisión, plan y `claimOwner` actual (PID/equipo/nonce/fecha). Esa metadata identifica al proceso de la reserva; no cambia el propietario del bloqueo original. Desde el intento de intención conserva reserva y finalización ante fallos.
3. Crea sólo el archivo original de cancelación faltante mediante enlace duro exclusivo, revalida y retira sólo la fuente exacta de reanudación si aún está presente. Mantenimiento/recuperación originales, sus archivos y los recibos previos quedan intactos.
4. Conserva recibo de cancelación v1 completo si ya existía. Si falta, crea `resumption-abort-UUID_CANCELACION_ORIGINAL.json` v2 con fecha actual, outcome=aborted, hashes originales y `abortContinuationId`/`abortContinuationIntentSha256` de la auditoría nueva. Conserva hash/null del recibo original de reconciliación. No crea recibos de éxito originales ni registros históricos de recuperación.
5. Escribe `resumption-abort-continuation-UUID_NUEVO.json` con hashes de intención y recibo de cancelación. Diagnóstico valida en dos pasadas la cadena completa; un recibo v2 aislado sigue pendiente.
6. Revalida contexto, intención propia, recibos, reserva y finalización exacta. Sólo entonces retira la finalización original; la reserva archivada se conserva.

`resumptionAbortContinuations.completed/pending` registra la auditoría y `resumptionAborts.completed` confirma cancelación. `resumptions.aborted` mantiene el resultado separado de éxito. Si ya había recibo original completo, `reconciliations.completed` usa completionEvidence=preserved-reconciliation-receipt; si no, continúa pendiente para revisión independiente. Un recibo v1 previo conserva su cancelación aunque la nueva auditoría quede parcial; ese pendiente bloquea coordinación.

Una reserva sin intención válida aparece como `unlinked-resumption-abort-continuation-archive` y bloquea preparaciones/ready aun sin controles. Dos auditorías completas que atribuyan continuación a la misma cancelación son ambiguas; no se elige revisor. Los datos declarados y hashes son metadata editable, no firma o auditoría inmutable.

### Resultado, pasos separados y fallos

En las tres partidas sin recibo de reconciliación, preparar una cancelación o reanudación **nueva** del origen con sus herramientas existentes, luego cerrar mantenimiento cuando corresponda. En la cuarta, revisar directamente el cierre de mantenimiento. Publicación residual requiere recuperación ordinaria independiente. No ejecuta ninguna de esas decisiones por sí sola ni cambia catálogo, versión, captación, BD o recibos ERP.

Replay de ID/responsable/hash idénticos e historia íntegra es **sólo lectura**: no duplica pasos ni retira guardas residuales; tampoco afirma coordinación libre. Sigue válido tras resolución independiente del origen y cambio posterior válido de puntero. Si la nueva continuación se interrumpió después de escribir auditoría antes de liberar finalización, puede reconocer la terminación histórica, pero el control residual permanece para revisión manual separada. Responsable/hash distintos, recibos prestados/alterados, archivos/orígenes cambiados o recibo de éxito agregado a la reanudación cancelada invalidan reconocimiento.

Un rechazo antes de intentar intención libera sólo la reserva propia intacta y conserva finalización original, si todo el contexto sigue intacto. Si cambia, conserva ambos. Desde el intento de intención, fallos conservan evidencia y finalización; no implica rollback. CLI reemplaza éxito previo por not-completed/resultConfirmed=false sin publicar valores privados o errores crudos. Un fallo de retirada puede dejar auditoría completa con control residual y resultado de aplicación no confirmado.

`resumptionAbortContinuations.pending` bloquea ready/publishing y todas las preparaciones aunque desaparezcan los cinco controles. La continuación sin auditoría completa sigue manual; su finalización residual tras auditoría completa dispone del cierre revisado descrito abajo; cancelaciones originales válidas de cierre utilizan su continuación separada descrita abajo; no se reintenta automáticamente, no se limpia por edad ni inventa vínculos. Pruebas temporales con procesos propios, sin certificar recuperación comercial, corte eléctrico o filesystem remoto. Publicación debe seguir el procedimiento de diagnóstico estricto; no interpreta automáticamente estos pendientes si un escritor externo elimina todos los controles.

## Continuar una cancelación original de cierre interrumpida con revisión nueva

Entrega WEB03.1b, 2026-10-11. Aplica al cierre original v2 de mantenimiento o de guarda de reanudación que se canceló y quedó interrumpido durante su cancelación. Conserva el cierre como aborted y la ausencia de su recibo de éxito; no ejecuta de nuevo ese cierre.

### Requisitos y etapas de la cancelación

Una única intención válida `closure-abort-UUID.intent.json` debe ligar la finalización local válida/inactiva exacta por `finalizationSha256`. El cierre original debe ser v2 con recuperación vinculada, reconciliación/reanudación de origen completadas e íntegras, fuente/archivo originales del cierre y ausencia de su recibo exactos. Directorio físico, publicación, puntero e historial deben coincidir con la revisión original.

| Etapa de cancelación | Recuperación del cierre | Archivo de cancelación | Recibo de cancelación |
| --- | --- | --- | --- |
| intent-only | Presente, exacta e inactiva | Ausente | Ausente |
| source-archived | Presente, exacta e inactiva | Presente e idéntico | Ausente |
| source-removed | Ausente | Presente, exacto e inactivo | Ausente |
| completed-before-release | Ausente | Presente, exacto e inactivo | Original v1 completo; finalización aún presente |

Cuatro etapas por cada uno de los dos tipos. Aplican a las tres partidas originales del cierre antes de su recibo: intención sola, fuente archivada y fuente retirada. Son **24 combinaciones válidas**. `sourceSha256` y `archivedSourceSha256` del plan nuevo describen la recuperación del cierre y su archivo de cancelación; la fuente/archivo de mantenimiento o reanudación permanecen ligados al plan original y no se intervienen.

Guardas activas/ajenas/indeterminadas/antiguas, finalización ausente o sin vínculo exacto, otro pendiente ajeno, secuencia imposible, recibo v2 aislado, recibo de éxito agregado al cierre cancelado o evidencia divergente/ambigua requieren revisión separada. Un cierre que había completado su propio recibo utiliza la continuación de cierre existente, no su cancelación.

### Inspección, propuesta y revisión

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-closure-abort-continuation -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-closure-abort-continuation -- --directory=RUTA_LOCAL
```

Inspección y propuesta hacen dos observaciones sin intervenir en el directorio. Reportes `.artifacts/web-closure-abort-continuation-status.json` y `web-closure-abort-continuation-plan.json`. Código 0 de inspección no aprueba intervención; sólo eligible=true permite revisar la propuesta.

La propuesta liga tipo/etapa, directorio, IDs/hash de cancelación y cierre originales, finalización, recuperación/archivo/recibo presentes o ausencias, mantenimiento/publicación/puntero e historial. Reserva todos los destinos dentro de 600 archivos históricos más cinco controles; no trunca evidencia.

Revisión en un JSON privado:

```json
{
  "operationId": "UUID_V4_NUEVO",
  "decision": "continue-local-closure-abort",
  "reviewer": "RESPONSABLE_DE_LA_REVISION",
  "planSha256": "HASH_SHA256_DE_LA_PROPUESTA_ACTUAL"
}
```

Sustituir marcadores por UUID v4 minúsculo nuevo, distinto de cancelación, cierre, reconciliación y reanudación originales, y hash exacto actual. Responsable no vacío hasta 100 caracteres, sin controles o secretos. No admite campos adicionales. Responsable, propietario y fechas son declaraciones locales sin autenticación o firma; no agregan aprobación comercial.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run continue:web-closure-abort -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
```

### Exclusión, evidencia y resultado

Los cinco controles pueden estar ocupados, especialmente en un cierre de reanudación con publicación residual. La continuación conserva `publish-finalization.lock` original durante **todas** las escrituras; no cambia su propietario ni añade un sexto control fijo.

1. Reserva por enlace duro exclusivo `publish-continued-closure-abort-finalization-UUID_CANCELACION_ORIGINAL.lock`, con los bytes exactos de la finalización. El destino se deriva de la cancelación original, no del ID nuevo: dos revisores con IDs nuevos diferentes compiten por una sola reserva.
2. Revalida contexto y persiste `closure-abort-continuation-UUID_NUEVO.intent.json` con revisión, propuesta y `claimOwner` del proceso de reserva (PID/equipo/nonce/fecha). Desde el intento de intención, errores conservan reserva, finalización y evidencia.
3. Crea sólo el archivo faltante `publish-aborted-closure-recovery-UUID_CANCELACION_ORIGINAL.lock`; retira sólo `publish-recovery.lock` exacto si aún existe. No cambia intención/fuente/archivo del cierre original ni los recibos de origen.
4. Conserva byte por byte el recibo previo de cancelación v1, incluida su fecha. Si faltaba, crea `closure-abort-UUID_CANCELACION_ORIGINAL.json` de cancelación v2, outcome=aborted y fecha actual, ligado exactamente por `abortContinuationId`/`abortContinuationIntentSha256` a la auditoría nueva. No fabrica recibo de éxito del cierre.
5. Escribe `closure-abort-continuation-UUID_NUEVO.json`, con hashes de intención y recibo de cancelación. Diagnóstico en dos pasadas exige ambas cadenas completas e íntegras; un recibo v2 aislado permanece pendiente.
6. Revalida contexto, propiedad, intención y recibos; **sólo entonces retira la finalización original**, como última mutación. Resultado `.artifacts/web-closure-abort-continuation-result.json`.

`closureAbortContinuations.completed/pending` registra la auditoría nueva, `closureAborts.completed` confirma la cancelación y `maintenanceReviews.aborted`/`resumptionReviews.aborted` conservan el cierre cancelado separado de completed. Una reserva sin intención válida aparece como `unlinked-closure-abort-continuation-archive`; dos auditorías completas de la misma cancelación son ambiguas. Ambos casos bloquean ready/preparaciones aun sin controles.

Cancelación v1 previa sigue reconocida aunque la nueva auditoría quede parcial; la coordinación permanece bloqueada por ese pendiente. Cancelación v2 sólo cuenta con su auditoría completa, íntegra y única. Los hashes enlazados protegen coherencia de metadata editable; no constituyen una auditoría inmutable.

### Fuentes residuales, replay y fallos

Si la fuente de mantenimiento/reanudación aún existe, conserva needs-review y se cierra mediante revisión **nueva e independiente** con su herramienta existente y otro ID. Si ya estaba retirada, conserva ausencia y archivo; no restaura la fuente ni crea un recibo de cierre. En cierre de reanudación, mantenimiento se cierra por separado. Publicación residual conserva recuperación ordinaria independiente.

Un cierre sucesor puede volver a interrumpirse sin invalidar la cancelación histórica; su propia cadena determina si terminó. La continuación de cierre existente resuelve sus etapas válidas por revisión nueva. No reutilizar la revisión del cierre cancelado.

Replay de ID/responsable/hash idénticos e historia íntegra es **sólo lectura**: no duplica pasos ni retira controles residuales, incluso tras cierres independientes, recuperación ordinaria o cambio posterior válido del puntero. También puede reconocer auditoría terminada antes de retirar finalización; no afirma coordinación actual libre. Revisor/hash distintos, vínculos prestados, recibos/archivos/orígenes alterados o recibo de éxito añadido al cierre cancelado invalidan reconocimiento.

Un rechazo anterior al intento de intención propia libera sólo su reserva intacta con contexto igual; si cambia, conserva ambos controles. Desde el intento de intención, cualquier fallo conserva evidencia y finalización; no implica rollback. CLI reemplaza éxito previo por not-completed/resultConfirmed=false sin mostrar valores privados, caminos o errores crudos. Fallo al retirar finalización puede dejar auditoría completa y control residual con aplicación no confirmada.

`closureAbortContinuations.pending` bloquea ready/publishing y las preparaciones de herramientas cooperantes aunque desaparezcan los cinco controles. Las continuaciones sin auditoría completa siguen manuales. La finalización residual tras auditoría completa e íntegra dispone del cierre revisado descrito abajo. No se reintenta automáticamente ni se limpia por edad. Nuevas interrupciones, guardas sin vínculo/antiguas/corruptas y simulacro operativo conservan su alcance pendiente.

Ensayos con procesos propios en temporales verifican etapas, bytes, exclusión y fallos controlados. No certifican recuperación comercial, corte eléctrico, filesystem remoto o aprobación del lote real. No se realizaron intervenciones de cancelación/recuperación en la instalación al desarrollar esta entrega.

## Cerrar el control residual de una continuación de cancelación completada

Entrega WEB03.1b, 2026-10-11. Resuelve el control residual que queda **después** de completar la auditoría de una continuación de cancelación. No continúa una auditoría parcial, no cambia su decisión y no crea recibos de éxito originales.

### Alcance y controles

| Continuación completada | Control residual exacto | Control existente usado para exclusión |
| --- | --- | --- |
| Cancelación de reconciliación | `publish-resume.lock`, ligado a resumptionSha256 de su intención | `publish-finalization.lock` |
| Cancelación de reanudación | `publish-finalization.lock`, ligado a su plan y archivo previo | `publish-resume.lock` |
| Cancelación de cierre de mantenimiento o reanudación | `publish-finalization.lock`, ligado a su plan y archivo previo | `publish-recovery.lock` |

La decisión, la auditoría de continuación y su cancelación deben aparecer completadas, únicas e íntegras en el diagnóstico. Recibos/intenciones/archivos anteriores conservan sus bytes. Control residual local válido/inactivo y proceso de continuación terminado: para reconciliación comprueba propietario de reanudación; para los otros tipos comprueba también el claimOwner de la continuación. Recibo completo con proceso activo, extranjero o indeterminado **no** permite retirarle el control.

El control de exclusión de la tabla debe estar ausente; lo adquiere exclusivamente con propietario nuevo. No añade un sexto control fijo, reutiliza uno libre distinto del residual y comprueba propiedad entre pasos. Mantenimiento, recuperación, fuente residual del cierre y publicación existentes deben coincidir exactamente con los planes anteriores y estar locales/inactivos.

Directorio físico, puntero, controles e historial completos deben permanecer estables. Para cancelación de reanudación sin recibo previo de reconciliación, sólo admite ese origen pendiente y sus archivos originales sin registro; no admite pendientes ajenos. Esa reconciliación sigue requiriendo una decisión nueva independiente. Control sin vínculo, recibo faltante/vínculo prestado, evidencia antigua/alterada/ambigua o guardas activas/ajenas/indeterminadas mantienen revisión manual.

### Inspección, propuesta y revisión

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run check:web-abort-continuation-finalization -- --directory=RUTA_LOCAL
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run plan:web-abort-continuation-finalization -- --directory=RUTA_LOCAL
```

Ambos observan sin intervenir en el directorio. Inspección realiza dos observaciones y escribe `.artifacts/web-abort-continuation-finalization-status.json`; propuesta escribe `web-abort-continuation-finalization-plan.json`. Código 0 de inspección no aprueba intervención. Sólo eligible=true con etapa completed-before-release permite revisar la propuesta.

Plan ligado a tipo/ID/hash de intención y recibo de continuación, cancelación original y sus hashes, control residual/control de exclusión, los cinco controles, directorio/puntero e historial. Reserva los tres destinos nuevos dentro de 600 históricos más cinco controles; no trunca evidencia.

Revisión en un JSON privado:

```json
{
  "operationId": "UUID_V4_NUEVO",
  "decision": "finalize-completed-abort-continuation",
  "reviewer": "RESPONSABLE_DE_LA_REVISION",
  "planSha256": "HASH_SHA256_DE_LA_PROPUESTA_ACTUAL"
}
```

Sustituir marcadores por UUID v4 minúsculo nuevo distinto de continuación/cancelación/cierre/reconciliación/reanudación originales, y hash exacto actual. Responsable no vacío hasta 100 caracteres, sin controles ni secretos; rechaza campos adicionales. Es revisión local declarada, sin firma/autenticación ni aprobación comercial.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run finalize:web-abort-continuation -- --directory=RUTA_LOCAL --review=REVISION_PRIVADA.json
```

### Registro y resultado

1. Adquiere el control libre de la tabla, escribe PID/equipo/nonce/fecha y sincroniza. Revalida propuesta, proceso terminado, contexto e IDs antes de intervenir.
2. Persiste `abort-continuation-finalization-UUID_NUEVO.intent.json` con revisión, plan y hash de su control de exclusión. Desde el intento de intención conserva control y evidencia ante fallos.
3. Conserva por enlace duro exclusivo `publish-completed-abort-continuation-control-UUID_NUEVO.lock` los bytes exactos del residual; revalida y retira **sólo** su fuente. No modifica intención/recibo/archivo de continuación, cancelación o negocio.
4. Escribe `abort-continuation-finalization-UUID_NUEVO.json` con hashes de intención y control archivado, y fecha actual. Diagnóstico exige cadena íntegra enlazada a continuación/cancelación completas. `abortContinuationFinalizations.completed/pending` distingue resultado de auditoría parcial/alterada o ambigua; dos cierres completos del mismo tipo/continuación no eligen ganador.
5. Revalida contexto, propietarios, intención y recibo; libera únicamente su propio control de exclusión intacto. Resultado `.artifacts/web-abort-continuation-finalization-result.json`.

Archivo sin intención/recibo completos queda pendiente. Los pendientes bloquean ready/publishing y preparaciones de herramientas cooperantes aun si desaparecen los controles. La cancelación y continuación originales conservan su reconocimiento histórico; el cierre no inventa sus recibos ni altera aborted/completed.

### Operaciones independientes, repetición y fallos

Tras cerrar este control, la reconciliación pendiente puede continuarse o cancelarse con revisión nueva; mantenimiento y fuentes residuales conservan sus cierres independientes. Publicación residual necesita recuperación ordinaria separada. No ejecuta esas decisiones ni publica catálogo, cambia versión, activa captación o escribe en BD.

Replay idéntico e íntegro es **sólo lectura**: reconoce historia sin duplicar pasos, incluso después de resolver fuentes independientes o cambiar válidamente el puntero. No retira una guarda posterior ni un control residual del propio cierre; no afirma coordinación actual libre.

Rechazo anterior al intento de intención libera sólo su control nuevo intacto; no interviene en el residual. Un fallo de nonce antes de adquirirlo no crea controles. Desde el intento de intención, error/interrupción conserva control/evidencia; si el residual ya estaba retirado, su archivo y la auditoría parcial mantienen revisión manual. No implica rollback. CLI reemplaza éxito anterior por not-completed/resultConfirmed=false, sin valores privados, caminos o errores crudos.

Un cierre con recibo completo que se interrumpe antes de liberar su propio control tiene terminación histórica, pero ese control queda para revisión separada. **Cierres de controles nuevamente interrumpidos y continuaciones sin auditoría completa siguen pendientes**, junto con guardas sin vínculo/antiguas/corruptas/evidencia divergente. No limpia por edad ni reintenta automáticamente.

Las pruebas usan procesos propios y directorios temporales. No prueban intervención operativa, respaldo revisado, aceptación comercial, corte eléctrico, filesystem remoto o auditoría inmutable. La exclusión cubre herramientas cooperantes actuales; escritores externos pueden cambiar el filesystem entre comprobaciones. La publicación debe seguir el diagnóstico estricto; no interpreta automáticamente estos pendientes si un escritor externo elimina los controles.

## Incidentes fuera del alcance automatizado — WEB03.1b-M1

Este procedimiento define un límite de soporte explícito. No crea una herramienta adicional para cada interrupción de una continuación, no retira guardas y no declara resueltos los casos rechazados. Una futura automatización se evalúa ante un incidente reproducible, con alcance y pruebas propios; no se agrega automáticamente como siguiente fase de WEB03.1b.

| Caso observado | Decisión |
| --- | --- |
| Etapa original válida cubierta por un comando existente, vínculo v2 exacto, dueño local ausente y evidencia íntegra | Preparar/revisar el plan exacto de ese comando; aplicar únicamente después de comprobar requisitos y conservar respaldo |
| Continuación sin auditoría completa, cierre del propio control nuevamente interrumpido, vínculo ausente, bytes/recibos contradictorios o metadata antigua/corrupta | Conservar `needs-review`/`invalid`; atención manual de incidente. No fabricar vínculos, intenciones, recibos o fechas |
| Proceso activo, dueño ajeno/indeterminado, permisos insuficientes o PID reutilizado | Revisar en el equipo propietario; no matar procesos ni retirar el control por antigüedad |
| Pérdida de archivos publicados o puntero/sello inválido | Conservar también el estado de versión; restauración desde copia conocida en destino aislado, con revisión independiente del historial y del recibo ERP |

### Procedimiento conservador

1. Detener los nuevos intentos cooperantes de publicación/mantenimiento mientras se investiga. Registrar fecha, entorno y operación esperada. Confirmar propietario/proceso sin terminar procesos ajenos.
2. Conservar los diagnósticos `check:web-recovery -- --strict` y `check:web-active`, en un expediente privado. Código 1 indica revisión pendiente; no es una invitación a borrar el bloqueo. No incluir secretos o contenido crudo en README/reportes públicos.
3. Conservar una copia privada del directorio completo afectado en un destino nuevo antes de cualquier intervención manual. El respaldo de preview **no** contiene historial, guardas ni versiones; no usarlo como sustituto de esa evidencia. Conservar bytes, recibos y fechas originales y el hash original del respaldo. Una copia del expediente no autentica al propietario ni garantiza copia externa.
4. Identificar fuente, intención, archivo, recibo, revisión y etapa de cada operación. Comparar los enlaces/hashes existentes; no inferir un vínculo v2 inexistente ni prestar el recibo de otra operación. Las cadenas ligadas al directorio original no se vuelven ejecutables al copiarlas a otra ruta.
5. Si cumple un caso automatizado documentado, usar su inspección/plan y una revisión actual ligada al hash. Si no cumple, documentar el incidente y mantenerlo bloqueado. Preparar cualquier propuesta de restauración en un destino aislado desde una copia conocida; no combinar archivos actuales con una copia parcial o regenerar recibos para que el diagnóstico quede verde.
6. Antes de proponer cambio sobre la instalación, verificar en la copia integridad, versión/recibo, rutas, restricciones y el tratamiento de la evidencia histórica; registrar exactamente qué se recupera y qué sigue sin resolver. Una restauración de contenido no resuelve automáticamente una coordinación incierta. Este documento no autoriza borrar controles/historial o reemplazar la instalación con una prueba.
7. Tras una intervención revisada independiente, conservar sus registros y volver a comprobar coordinación, versión, recibo ERP y aceptación comercial. No marcar resuelto con una guarda ausente si sigue existiendo auditoría pendiente. Si no puede justificarse el estado, permanecer en revisión.

### Registro mínimo del incidente

Fecha/entorno; IDs válidos de operaciones afectadas; estado de diagnóstico y versión; etapa confirmada o desconocida; referencia al expediente/respaldo privado y su hash original; motivo por el que no cumple automatización; propuesta, responsable y revisión; verificaciones/resultados y limitaciones. No anotar contraseñas, sesiones, claves, CSD, cuerpos HTTP ni datos crudos ajenos a metadata válida. No hay firma independiente o aprobación ficticia.

El simulacro de esta sesión sólo intervino en copias del preview actual, no en incidentes/guardas de la instalación. Evidencia y reproducción: [WEB04.1d](WEB_SIMULACRO_PREVIEW.md). Para el cierre comercial seguir [WEB03.1b-P1](WEB_ACEPTACION_LOTE.md#cierre-finito-web031b-p1).

## Límites y pendientes

La exclusión protege procesos cooperantes de la versión actual en el equipo local. No certifica coordinación con herramientas antiguas, escritores externos, permisos privilegiados, filesystem remoto o reemplazo del directorio/enlaces entre comprobaciones. No es una transacción del filesystem ni prueba de durabilidad ante corte eléctrico. Los registros son metadata editable protegida por hashes relacionados, no auditoría criptográfica inmutable.

Pendiente finito de WEB03.1b: **WEB03.1b-P1**, selección/revisión de 5–10 piezas y fotos reales, publicación local aprobada, revisión/medición móvil/escritorio y recuperación de esa publicación sellada. El ensayo **WEB04.1d** ya comprueba una copia del preview instalado; no sustituye el ensayo comercial/versionado. Continuaciones sin auditoría completa, cierres de controles nuevamente interrumpidos y guardas sin vínculo/antiguas/corruptas/divergentes se atienden con **WEB03.1b-M1**, manteniendo diagnóstico bloqueado y evidencia intacta; su automatización adicional no está implementada y no condiciona este cierre del catálogo. Las capacidades detalladas arriba se conservan. Dominio, hosting, HTTPS, privacidad, copias externas y lanzamiento mantienen sus propios criterios.

Los comandos, revisiones y reportes no se sirven por la allowlist HTTP. No se generan credenciales o claves, no se realizan consultas a la BD ni cambia la captura de solicitudes. Los pendientes del [expediente de privacidad](WEB_PRIVACIDAD_RETENCION.md), fiscal mock y UUID/idempotencia permanecen.

## Validación y límites de evidencia

Las pruebas usan directorios temporales y procesos hijos propios. Simulan recuperación interrumpida antes/después de archivar, reconciliación interrumpida antes/después de enlazar o después de retirar guarda, y ambos cierres interrumpidos antes/después del archivo, después de retirar fuente y después de completar recibo. Ensayan la continuación de los ocho casos, seis cortes de la propia continuación, bytes/recibos conservados, propuestas sin mutación, vínculos exactos, lectura histórica v1, reconocimiento separado del registro histórico, recuperación ordinaria posterior, idempotencia, revisores concurrentes, exclusión de todas las herramientas cooperantes, directorio/hash/puntero/historial alterados, límite de historial, metadata antigua/ajena/activa, propietario reemplazado y vínculos/recibos alterados. Fallos de E/S tras intención comprueban reporte incierto, recibo v2 pendiente mientras falta su continuación completa y bloqueo conservado. Esa inyección de fallo es técnica local; no demuestra recuperación operativa ante corte eléctrico o filesystem remoto.

La cancelación revisada añadió12 pruebas que cubren las tres etapas sin recibo, ausencia preservada del recibo original, archivos/bytes intactos, publicación residual independiente, replay, concurrencia, seis cortes de la cancelación, exclusión de todas las herramientas, cambios de propietarios/hashes/intenciones/recibos/directorio/puntero/historial, dos cancelaciones del mismo origen, límites y CLI. Un fallo de E/S tras retirar fuentes conserva guarda e intención; pérdida posterior de la guarda no convierte evidencia incompleta en ready. Suite de esa sesión157/157 aprobada; estos procesos y fallos controlados no demuestran durabilidad frente a corte eléctrico o recuperación comercial.

La continuación de reanudación original añadió13 pruebas descritas en su procedimiento, incluyendo rechazo de recibo enlazado a otra continuación y fallo de resultado después de retirar guarda. Ambos recibos quedan pendientes cuando falta la cadena nueva completa. Suite pública de esa sesión170/170 aprobada con Node24.19.0; comandos y evidencias históricas se conservan en el README. Las entregas posteriores de cancelación de reanudación y cierre originales se detallan arriba y en la sesión más reciente del README. Sin cambios de UI o backend, ni migraciones nuevas. WEB03.1b continúa parcial; capacidades implementadas y casos pendientes se distinguen arriba. No volver a presentar capacidades existentes como faltantes ni declarar completados los casos pendientes.

La cancelación original de reanudación añadió 15 pruebas dirigidas aprobadas. La suite pública de esa entrega pasó 185/185 con Node24.19.0: cuatro etapas y tres partidas originales, resolución independiente por dos rutas, recibo previo conservado, sucesora nuevamente interrumpida, ausencia de recibos fabricados, replay/concurrencia, cinco cortes, exclusión de diez herramientas, sustituciones/alteraciones/vínculos prestados, ambigüedad, límites, CLI y fallo de E/S tras retirar guarda. Los fallos conservan exclusión/evidencia; pérdida posterior de guardas no declara ready. Procesos propios en directorios temporales, no prueba de durabilidad ante corte eléctrico o recuperación comercial. Evidencia, tiempos y comprobaciones de esa entrega en la sesión correspondiente del README.

La cancelación de cierre original añadió14 pruebas dirigidas aprobadas; la suite de esa entrega pasó199/199 con Node24.19.0. Tres etapas por ambos tipos, conservación exacta de recibos/archivos y ausencia de recibo del cierre cancelado, fuentes residuales resueltas por revisión nueva, sucesor nuevamente interrumpido, publicación residual, v1/completados, replay/concurrencia, cinco cortes por tipo y exclusión de once herramientas, sustituciones/alteraciones/ambigüedad, límites, CLI y fallo de E/S tras retirar recuperación. Su pendiente de cancelaciones de reconciliación interrumpidas se implementó en la entrega descrita arriba. Evidencias históricas en la sesión correspondiente del README; ensayos temporales sin certificar simulacro operativo, aceptación comercial o corte eléctrico.

La continuación de cancelación original de reconciliación añadió 15 pruebas dirigidas aprobadas; la suite de esa entrega pasó 214/214 con Node24.19.0, sin fallidas/omitidas/canceladas. Dieciséis combinaciones válidas, recibo previo intacto o v2 ligado a auditoría completa, nueve cortes y exclusión de once herramientas más otra continuación, pérdida de guardas, fuentes/archivos/vínculos/recibos/revisor/contexto alterados, concurrencia/replay, ambigüedad, reserva600/605, CLI y fallo de E/S después de retirar finalización. Build11 páginas/JS cliente0, HTTP29/29 y sondeos9/9; evidencia y tiempos en la sesión correspondiente del README. Instalación de esa sesión ready sin controles/historial, nueva inspección finalization-absent, versión pending/unversioned-preview y captación closed/captureStarted=false. Sin intervenciones en la instalación, migraciones, escrituras de negocio o cambios UI/backend. Su pendiente de cancelaciones originales de reanudación interrumpidas se implementó en la entrega descrita arriba. Las pruebas temporales no demuestran recuperación comercial, corte eléctrico o filesystem remoto.

La continuación de cancelación original de reanudación añadió **15 pruebas dirigidas**, aprobadas en 103.12 s. La suite pública de esa entrega pasó **229/229** en 217.30 s con Node.js 24.19.0, sin fallidas, omitidas o canceladas. Cubre 16 combinaciones, recibos v1 preservados o v2 ligados a auditoría completa, origen resuelto por revisión independiente, concurrencia con IDs nuevos distintos, seis cortes con los cinco controles ocupados y exclusión de doce herramientas más otra continuación, pérdida posterior de controles, sustituciones/alteraciones/ambigüedad, límites 600/605 y CLI. Replay histórico comprobado sin retirar finalización residual; fallo de E/S después de crear cancelación v2 mantiene ambas cadenas pendientes. Build posterior de 11 páginas, máximo HTML+CSS 23093 bytes y JavaScript cliente 0; HTTP **29/29** y sondeos locales **9/9**. Instalación ready con cinco controles ausentes e historial vacío; continuación nueva finalization-absent, versión pending/unversioned-preview y captación closed/captureStarted=false. Evidencias y tiempos enlazados en la sesión correspondiente del README. Sin intervenciones de recuperación/cancelación en la instalación, migraciones ni escrituras de negocio. Su pendiente de cancelaciones originales de cierre interrumpidas se implementó en la entrega descrita arriba; WEB03.1b sigue parcial. Ensayos temporales sin certificar simulacro operativo, aceptación comercial, corte eléctrico o filesystem remoto.

La continuación de cancelación original de cierre añadió **17 pruebas dirigidas**, aprobadas en 173.51 s. La suite pública de esa entrega pasó **246/246** en 282.65 s con Node.js 24.19.0, sin fallidas, omitidas o canceladas. Cubre 24 combinaciones, recibos v1 preservados o v2 ligados a auditoría completa, cierres independientes, concurrencia por destino único, seis cortes por tipo y exclusión de trece herramientas más otra continuación con cinco controles ocupados, pérdida posterior de controles, sustituciones/alteraciones/ambigüedad, límites 600/605, CLI, fallo de E/S antes de auditoría y cierre sucesor nuevamente interrumpido. Replay histórico comprobado sin liberar finalización residual. Build posterior de 11 páginas, máximo HTML+CSS 23093 bytes y JavaScript cliente 0; HTTP **29/29** y sondeos locales **9/9**. Instalación ready con cinco controles ausentes e historial vacío; nueva inspección finalization-absent, versión pending/unversioned-preview y captación closed/captureStarted=false. Evidencias y tiempos enlazados en la sesión correspondiente del README. Sin intervenciones de recuperación/cancelación en la instalación, migraciones o escrituras de negocio. Su pendiente de cierre de controles residuales tras continuaciones de cancelación completadas se implementó en la entrega descrita arriba; WEB03.1b sigue parcial. Ensayos temporales sin certificar simulacro operativo, aceptación comercial, corte eléctrico o filesystem remoto.

El cierre revisado de controles residuales de continuaciones de cancelación completadas añadió **15 pruebas dirigidas**, aprobadas en 192.50 s. Suite pública completa **261/261**, 329.05 s con Node.js 24.19.0, sin fallidas, omitidas o canceladas. Veintiséis contextos válidos, bytes/recibos intactos, acciones independientes, proceso activo/ajeno, concurrencia/replay sin retirar guarda posterior, cinco cortes por tipo y exclusión de catorce herramientas más otro cierre, pérdida de controles, sustituciones/alteraciones/vínculos prestados, ambigüedad/archivo huérfano, límites y CLI. Fallo de recibo después de retirar fuente conserva archivo/intención/guarda y resultado pendiente. Build posterior de 11 páginas, máximo HTML+CSS 23093 bytes y JavaScript cliente 0; HTTP **29/29** y sondeos locales **9/9**. Instalación ready, cinco controles ausentes e historial vacío; nueva inspección residual-control-absent, versión pending/unversioned-preview y captación closed/captureStarted=false. Evidencias y tiempos en la última sesión del README. Sin cierres/recuperaciones/cancelaciones aplicados a la instalación, migraciones o escrituras de negocio. WEB03.1b sigue parcial; siguiente pendiente técnico local: revisión y resolución de cierres de controles residuales interrumpidos. Pruebas temporales sin certificar simulacro operativo, aceptación comercial, corte eléctrico o filesystem remoto.
