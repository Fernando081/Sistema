# C01 — Consentimiento comercial y preparación de campañas

Negocio: Refacciones y Tractorepuestos Tampico. Implementación local **C01.1**,20/10/2026. **C01 permanece parcial**: canales/envíos y métricas de ejecución real C01.2 pendientes. Resultados efectivos, respaldos y migraciones en README; este manual describe el contrato técnico y sus límites, no acredita consentimiento humano ni cumplimiento legal.

## Capacidades existentes que se reutilizan

- Contactos de **Cliente360**, tabla cliente_contacto de053: nombre/cargo/correo/teléfono/canal preferido. No se crea otro directorio.
- **CRM → Operación CRM**: segmentos, plantillas y campañas en Borrador de067. La bitácora de comunicaciones de068 conserva su propósito: registrar no envía mensajes.
- S01 permite delegar el nuevo permiso **crm.campanas.gestionar** (ADMIN inicialmente); permiso y versión del personal se revalidan. Es acceso interno transversal a clientes/campañas, sin separación por cartera o sucursal.
- El consentimiento de promociones es independiente de las cuentas del portal, la finalidad de consultas web y las obligaciones comerciales/fiscales. Tener un contacto, indicar su canal preferido o haber recibido una consulta/compra **no genera autorización de campañas**.

## Registrar una decisión del contacto

1. Clientes → Ficha360 → **Consentimiento comercial**. También **Revisar preferencias** desde los destinatarios de una campaña abre el mismo diálogo del cliente.
2. Elegir canal **Correo**, **WhatsApp** o **Llamada** y buscar un contacto existente (páginas20). El destino se toma del correo/teléfono del contacto. No se inscribe automáticamente el correo general del cliente, un prospecto o un teléfono de la web.
3. **Registrar decisión**: Autorizó promociones o Solicitó baja; fecha/hora manifestada no futura, fuente (Documento/Presencial/Llamada/Correo/WhatsApp), referencia verificable y motivo. Se debe confirmar destino/canal/decisión.
4. Una autorización permite vigencia opcional. Si se captura, debe ser posterior a la manifestación y al momento del registro. Una baja no admite vigencia: tiene efecto inmediato al registrarla, sin programar su levantamiento.
5. **Historial de decisiones** muestra estado, canal, versión, fecha manifestada/registrada, autor, fuente, referencia y motivo. No permite reescribir ni borrar declaraciones anteriores.

Las fechas del formulario se interpretan en la zona local del navegador y se envían en UTC; se muestran en la zona del navegador. Las fechas de negocio para segmentación/vigencia de campaña usan America/Mexico_City. Registrar una referencia no carga documentos, verifica su autenticidad o demuestra que el contacto otorgó el consentimiento; el operador debe conservar/comprobar la evidencia mediante el procedimiento del negocio. No incluir secretos, identificaciones o conversaciones completas en campos de texto o Git.

### Vinculación al destino, bajas compartidas y reautorización

- Una decisión se vincula a cliente/contacto/canal/finalidad **Promociones** y huella del destino normalizado. Versiones secuenciales por contacto/canal, UUID/huella por operación, reintento sin duplicación. La API rechaza un destino libre: exige la huella consultada y vuelve a leer el contacto; si cambió,409.
- Cambiar correo/teléfono no traslada una autorización al destino nuevo. Contacto sin decisión coincidente → Sin autorización. Vigencia cumplida → Vencido. Una nueva autorización con fecha futura no se acepta ni se considera elegible.
- Correo ASCII de hasta150 caracteres, parte local hasta64 y sin puntos iniciales/finales/consecutivos. Plegado conservador a minúsculas; **no** se eliminan etiquetas '+', puntos significativos ni se equiparan dominios distintos. Alias que entregan al mismo buzón no se detectan automáticamente.
- Teléfono con '+' y8–15 dígitos E164, primer dígito distinto de0; se ignoran espacios/paréntesis/puntos/guiones. Diez dígitos sin prefijo se interpretan explícitamente como México(+52). Extensiones u otros formatos quedan excluidos hasta corregir el contacto. No se comprueba existencia del buzón/teléfono/cuenta WhatsApp ni identidad de su propietario.
- **Baja en el mismo destino/canal bloquea todos los contactos que lo compartan**, incluso de clientes fuera del segmento. Se consulta la última decisión de cada vínculo contacto/destino/canal: una autorización en otro contacto no elimina esa baja.
- Para levantar una baja del mismo contacto/destino se requiere nueva autorización con manifestación posterior a su baja. Si hay otras bajas activas del destino, éste continúa excluido. Los canales se distinguen: una baja Correo no altera WhatsApp/Llamada.
- Eliminar un contacto **no elimina su baja** ni transfiere derechos a un contacto nuevo. El historial conserva su referencia técnica y muestra Contacto retirado. La interfaz no levanta una baja histórica de un contacto eliminado; resolver esa situación exige un procedimiento de identidad/evidencia y revisión administrativa adicional antes de la operación real. No hay bypass automático al recrear contactos.

## Revisar y conservar la preparación

Ruta **/crm/campanas**, disponible desde **CRM → Operación CRM → Preparar destinatarios y revisar bajas**. Páginas20/búsqueda de campañas existentes. Para crear un borrador, reutilizar el formulario Campañas planificadas.

1. **Revisar destinatarios** de un Borrador. Requiere segmento y plantilla activos; una campaña terminada por fecha o con otro estado queda bloqueada. Se puede preparar una campaña con inicio futuro: conservar un plan no la activa ni envía nada.
2. Revisar configuración/plantilla, clientes del segmento, clientes sin contactos, contactos evaluados, elegibles/excluidos y desglose de motivos. Búsqueda de destinatarios por cliente/contacto/motivo, páginas20, direcciones enmascaradas. El filtro de pantalla no reduce la preparación: siempre se calcula el segmento completo.
3. Exclusiones: **Destino inválido**, **Baja**, **Sin autorización**, **Vencido** o **Duplicado**. La primera coincidencia elegible por cliente/contacto ordenados ocupa un destino; las siguientes autorizaciones del mismo destino/canal no se duplican. Un contacto excluido no consume el lugar de otro autorizado.
4. Máximo **1000 contactos** por evaluación. Si el segmento lo supera, se bloquea la preparación completa y se solicita acotarlo; no se conserva una muestra como si fuera la lista completa. Borradores sin configuración y evaluaciones con cero elegibles no producen preparaciones utilizables.
5. Capturar motivo, declarar revisión de plantilla/destinatarios/exclusiones y **Conservar preparación**. Una confirmación identifica campaña/canal/cantidades. El servidor vuelve a calcular y comparar la huella; cambios relevantes producen409 y exigen revisar de nuevo.
6. Última preparación muestra fecha/autor/SHA-256 y **Coincide con la revisión actual** u **Obsoleta**. Una baja, cambio de dirección/elegibilidad/plantilla/segmento/configuración o vencimiento relevante invalida la coincidencia al consultar de nuevo. No hay actualización automática en tiempo real de una pantalla ya abierta.

La preparación conserva referencias técnicas/huellas/decisiones/conteos y huella de configuración, sin copiar nombres, correos/teléfonos ni texto de plantilla en su snapshot. Es una constancia local de revisión, **no una cola de envío ni un original completo del mensaje**. Campaña sigue en Borrador. No hay botón de enviar, exportación masiva de destinos, token público de baja, proveedor SMTP/WhatsApp o acción de compra. Preparaciones antiguas no se reutilizan como autorización de envío; cualquier ejecución futura deberá revalidar preferencias y condiciones.

### Segmentos y métricas

El conteo de segmentos existente y la preparación reutilizan la misma condición. Tipo de cliente se obtiene de oportunidades vinculadas. “Días sin compra” considera ingresos I, serie distinta de G y estado comercial Timbrada/Pagada; excluye Pendiente, Cancelada y tipo E. Límite inclusivo desde la medianoche de Tampico de hoy menos días, convertido a instante UTC; la fecha se mantiene estable durante cada transacción. Es clasificación por estado registrado, incluso mock, **no verificación de timbrado ni conciliación**. Cliente nunca vendido cumple la condición de inactividad. Una oportunidad histórica de ese tipo puede incluir al cliente; no se deduce su giro legal.

Clientes sin contactos no se confunden con contactos excluidos. Elegibles+excluidos = contactos evaluados cuando no hay bloqueos; un bloqueo por límite/configuración muestra cero contactos evaluados, sin afirmar que toda la base carece de autorización. Las métricas son de preparación, no entregas/aperturas/clics/conversiones/ingresos o ROI. La medición web ya existente conserva su alcance independiente.

## Seguridad, conservación y concurrencia

- Nuevas rutas requieren identidad ERP y permiso efectivo **crm.campanas.gestionar**. Cookie externa del portal no autentica el ERP. SQL parametrizado, consultas en snapshot REPEATABLE READ READ ONLY, respuestas privadas/no-store. No hay alta pública o enlaces de mensajes.
- Escrituras revalidan usuario activo/rol/token_version/permiso con FOR SHARE y atribuyen actor LOCAL. Un bloqueo transaccional común serializa decisiones y preparaciones, incluido reuso de UUID entre ambos flujos. Se bloquea la fila de contacto al registrar; versión/huella y cliente se vuelven a comprobar.
- Reintentos del mismo UUID/contenido devuelven el registro anterior; otro contenido/cliente/acción devuelve409. Reintentar una preparación que ya no coincide devuelve su registro con actual=false y no cambia decisiones. Distintos UUID sobre la misma versión de preferencia no sobrescriben: uno obtiene409.
- Una edición ajena al nuevo flujo (p.ej. borrar un contacto o editar maestros) puede hacer obsoleta una preparación incluso después de conservarla. No se promete una reserva de destinatarios ni que una captura en pantalla siga vigente. No existe ejecución que omita revalidación porque esta fase no envía.
- **106_crm_consentimiento_campanas.sql**: crm_consentimiento_comercial y crm_campana_preparacion, UUID/índices/FKs/versiones/huellas, audit metadata y guardas ALWAYS contra UPDATE/DELETE/TRUNCATE. No modifica migraciones aplicadas ni rellena contactos existentes. Las referencias históricas a contacto no tienen FK que borre las bajas al quitarlo del directorio; cliente/actor/campaña sí conservan FKs restrictivas.
- Snapshot máximo512KiB. Direcciones no duplicadas automáticamente en eventos/snapshots; huellas SHA-256 con separación por finalidad/canal **no son anonimización ni cifrado** (destinos de baja entropía pueden adivinarse). Referencia/motivo son texto privado y pueden contener datos aportados por el operador. Auditoría y respaldos conservan historial; retención, acceso operativo y aclaraciones deben definirse antes de uso real.
- POST de decisiones y preparación:10/min por IP/handler, además del límite general. Pruebas respetan ventanas, sin elevarlas/desactivarlas; algunos casos de concurrencia/abuso llaman al servicio real directamente.

## HTTP (prefijo /api/v1)

| Método y ruta | Entrada / resultado |
| --- | --- |
| GET /clientes/:cliente/consentimiento-comercial | canal/page/q; contactos20, destino propio, huella, versión y estado efectivo |
| GET /clientes/:cliente/consentimiento-comercial/historial | page; decisiones20, fuente/referencia/motivo/fechas/autor |
| POST /clientes/:cliente/consentimiento-comercial/:contacto | requestId/canal/estado/versionAnterior/destinoHuella/ocurridaEn/venceEn opcional/fuente/referencia/motivo/confirmacion=true |
| GET /crm/campanas-locales | page/q; campañas existentes20 |
| GET /crm/campanas-locales/:id/destinatarios | page/q; configuración/conteos/bloqueos/huella/última preparación y contactos enmascarados20 |
| POST /crm/campanas-locales/:id/preparar | requestId/evaluacionSha256/motivo/confirmacion=true; referencia de preparación y coincidencia actual |

401 sin identidad ERP;403 sin permiso vigente;404 contacto fuera del cliente/origen ausente;400 formato/fechas/confirmación;409 versión/huella/reuso/configuración/no elegibles;503 integridad de snapshot. No acepta propiedad libre de destino/finalidad/actor o cliente para ampliar una consulta de campaña.

## Validación y despliegue local

Node24. Respaldar → db:check (rollback) → builds → aceptación en copia → db:migrate → reiniciar backend. No reconstruir dist mientras se ejecuta aceptación.

`npm run test:campaign-consent -- --backup=.backups/FECHA/database.dump` restaura en base propia verify_campaigns_<16hex>, comprueba DB antes de escribir y aplica allí migraciones. Sólo en copia: desactiva usuarios heredados, prepara cohorte Taller sintética y clientes/contactos/campañas de prueba, prueba límites y elimina su copia al terminar. AppModule/PostgreSQL/HTTP/Angular producción reales, API sin mocks. Reporte `.artifacts/c01-consentimiento.json`: exigir passed/cleanupPassed/copyRemoved. Incluye permisos/DTO, idempotencia/versiones, destinos/baja compartida, vencimiento real, reautorización, eliminación/cambio de contacto, segmento/fecha Tampico, preparaciones/obsolescencia/concurrencia, límites, guardas/rollback/actor revocado y UI claro1280/oscuro390 con axe/reflujo. Las pruebas físicas de evidencia, identidad, canal real, entregabilidad y aprobación de privacidad no están cubiertas.

## Pendientes C01.2 y límites del cierre

Consentimiento/evidencia e identidad humana, procedimiento para destinos compartidos/contactos retirados, privacidad/conservación y aprobación operativa; luego evaluar proveedor/canal/costos, autorización explícita para enviar, programación/colas/cancelación/revalidación de bajas, baja accesible al destinatario y métricas reales con procedencia. Nada de esto se habilita por preparar una lista. Sin banco, compras de hosting/dominio o nueva prioridad de Ollama. C02 podrá ampliar secuencias internas reutilizando las tareas/agenda/bitácora existentes, con envíos externos fuera del alcance autorizado.
