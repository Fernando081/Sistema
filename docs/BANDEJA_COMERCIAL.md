# Bandeja comercial — C03.1

Implementación local del 21/10/2026. Entrar en **Clientes y CRM → Bandeja comercial**, o `/crm/bandeja`. Reúne trabajo comercial existente; no añade capturas, asignaciones, tareas, notificaciones ni otra agenda. C03.2 ya agrega los reportes internos programados; ver [manual](REPORTES_COMERCIALES_PROGRAMADOS.md).

## Fuentes y acceso

| Origen | Qué aparece | Acceso y continuación |
|---|---|---|
| Tareas | Pendiente/En progreso; se excluyen pasos de secuencias pausadas | ADMIN todas; operador asignadas o creadas por él. Abrir tarea entra a Operación CRM con el ID exacto, conservando ACL y controles de versión existentes |
| Oportunidades | Etapas distintas de Ganada/Perdida, incluso sin siguiente fecha | ADMIN todas, incluidas sin asignar; operador sólo responsable actual. Abre la ficha existente |
| Cotizaciones | Estados Pendiente o Vigente | Sólo ADMIN; abre la pantalla existente de cotización/revisiones. No suma importes ni interpreta su estado como venta |
| Solicitudes web | Pendiente/Revisada, sin oportunidad vinculada, contenido no purgado y conservación vigente | Sólo ADMIN; referencia/estado/fecha, sin contactos, piezas ni payload. Acceso a la pestaña existente Solicitudes web |

El operador que selecciona explícitamente cotizaciones/web recibe403; «Todos los permitidos» sólo reúne sus dos fuentes. No se ampliaron los permisos de las pantallas anteriores. La bandeja de notificaciones sigue separada: leer un aviso no completa un compromiso, y esta consulta no marca avisos como leídos. Una oportunidad y una tarea relacionada representan dos asuntos distintos; el total no cuenta clientes únicos.

## Plazos, búsqueda y paginación

- Una referencia temporal del servidor por consulta; días en `America/Mexico_City`, presentación con `Intl.DateTimeFormat` en esa misma zona, independientemente del navegador.
- Clasificación excluyente: **Vencida** si el plazo ya pasó; **Hoy** si aún no vence y es el mismo día local; **Próximos** después de hoy y antes de siete días desde la consulta; **Sin fecha** cuando es desconocida; **Posterior** para el resto.
- Para web, la fecha es el vencimiento de **conservación**, no una promesa de respuesta o SLA. Las solicitudes vencidas no se muestran, aunque aún no haya ejecutado la purga.
- Buscar por título, cuenta, responsable o referencia. `%`, `_` y barra inversa se tratan literalmente; parámetros SQL, no concatenación de entrada. No busca contactos o piezas web.
- Página fija de20, número de página1–100000 y búsqueda hasta100 caracteres. Orden por grupo de plazo, fecha, origen e ID; resumen/total cubren todas las páginas de los filtros aplicados. «Posteriores» contribuye al total pero no tiene tarjeta de resumen propia.
- Cada petición usa un snapshot `REPEATABLE READ READ ONLY` con límite de8 segundos. Lista y resumen pertenecen al mismo snapshot. No congela varias páginas frente a cambios de otros usuarios: actualizar puede mover asuntos entre páginas.
- Filtros/página quedan en la URL para recargar o compartir dentro del ERP autorizado. Aplicar filtros vuelve a página1. Un error borra resultados anteriores y permite corregir/reintentar; los campos editados se aplican sólo al enviar el formulario.

## Contrato y seguridad

`GET /api/v1/crm/bandeja?page=1&q=&tipo=todos&plazo=todos`. DTO cerrado: no admite SQL, usuario/responsable suministrado por el cliente, fuentes arbitrarias ni páginas fuera del límite. Guardas globales de sesión/roles y comprobación de cuenta activa, rol y `token_version` dentro del snapshot. `Cache-Control: private, no-store`. Los identificadores se devuelven como texto para conservar precisión de bigint/UUID.

La respuesta contiene `data`, `total`, `page`, `limit`, `administrador`, `consultadoEn`, `zonaHoraria` y `resumen` (`vencidas`, `hoy`, `proximas`, `sinFecha`). Cada fila contiene ID/tipo/título/cuenta/responsable/estado/fecha/plazo. Campos no disponibles permanecen nulos; no se inventan nombres/contactos o responsables.

La consulta existente `GET /crm/tareas` admite `idTarea` opcional como texto bigint validado y acotado al rango PostgreSQL. El filtro se suma al alcance previo de creador/responsable/ADMIN, sin buscar sólo dentro de las primeras200 tareas. `/crm?tab=tareas&tarea=ID` selecciona Operación CRM; «Ver todas las tareas» retira el foco incluso al reutilizar la misma ruta. `/crm?tab=web` selecciona Solicitudes web únicamente para ADMIN. Los cambios de estado siguen usando las rutas y versiones anteriores, no una operación nueva de la bandeja.

## Verificación

Con Node24 y ambos builds terminados:

```powershell
npm run test:crm-inbox -- --backup=.backups/FECHA/database.dump
```

Exige dump local bajo `.backups`. Restaura sólo una base propia `verify_inbox_*`, comprueba migraciones antes de migrar esa copia y usa AppModule/SQL/HTTP/Angular de producción con login real y credenciales efímeras en memoria. Detiene cron en la copia y elimina su base al terminar. No requiere activar recepción pública ni crea fixtures en la base de trabajo.

Comprueba ACL, cuenta/version, fuentes y exclusiones, privacidad web aun antes de purgar, estados de cotización, comodines/inyección, plazos de Tampico, paginación/resumen/vacíos, pausa real C02, DTO/sesión/caché, filtro directo de tarea y ausencia de escrituras por lectura concurrente. Navegador real claro1280/oscuro390: filtros/páginas, abrir oportunidad, tarea exacta, retirar foco sin cambiar componente, solicitudes, permisos/error/vacío/recarga del operador. Axe/reflujo y errores JS se verifican aparte del conjunto general con APIs simuladas. Evidencia y cifras efectivas en la sesión C03.1 del README; [reporte](../.artifacts/c031-bandeja.json).

Se corrigió el contraste del pequeño encabezado de marca del shell usando el color secundario del tema; la captura oscura de C03.1 detectó el marrón fijo anterior. [Captura clara](../.artifacts/c031-bandeja-light.png), [oscura](../.artifacts/c031-bandeja-dark.png).

## Límites y siguiente fase

Sin migración nueva, dependencias, presupuesto de tamaño ampliado o escrituras al consultar. No hay búsqueda global en payload web ni acceso directo a su contacto desde esta bandeja; se continúa en el módulo administrativo. No incorpora cobranza, garantías, inventario, reporte financiero nuevo o calendario laboral. No certifica carga distribuida, piloto comercial real o conservación aprobada.

**C03.2 implementado localmente:** [Reportes internos diarios/semanales](REPORTES_COMERCIALES_PROGRAMADOS.md), por origen/plazo y ADMIN propietario, con snapshots conservados y observabilidad existente. No duplicar el programador ni los cálculos. C03.3 conserva aceptación operativa, retención/capacidad. O01 mantiene colas/reintentos generales. Siguiente técnico del README: A01, contrastando almacén/picking existentes. Sin comunicaciones externas, bancos, dominio/hosting o nueva prioridad de IA; datos de prueba y fiscal mock conservados.
