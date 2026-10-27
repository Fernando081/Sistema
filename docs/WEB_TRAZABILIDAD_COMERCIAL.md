# Oportunidad, cotización y documentos de venta — WEB05.2b

Implementado localmente el 11 de octubre de 2026. Complementa [WEB05.2a](WEB_MEDICION_CRM.md) y utiliza las relaciones existentes de cotización/pedido/factura. No abre captación pública, habilita bancos o modifica el modo fiscal mock.

Registro actualizado el 12 de octubre de 2026; sesión WEB05.2b iniciada el 11, con migración y pruebas principales efectuadas ese día. WEB05.2c incorpora [medición financiera por moneda](WEB_MEDICION_FINANCIERA.md) sin modificar esta relación ni su migración.

## Uso en CRM

Abrir la ficha de una oportunidad en **CRM y agenda** y desplegar **Cliente ERP, cotizaciones y ventas vinculadas**.

1. **Asociar cliente existente:** buscar por nombre/RFC, elegir el resultado y confirmar que corresponde a la oportunidad. No crea, fusiona o copia contactos de clientes. La asociación por idCliente ya existía en el modelo; esta sección ofrece su selección explícita para oportunidades, incluidas las creadas desde consultas web.
2. **Buscar cotizaciones del cliente:** indicar un folio opcional. Se ofrecen hasta 20 resultados, exclusivamente del cliente asociado y sin vínculo con otra oportunidad.
3. **Vincular:** elegir una cotización y confirmar que proviene de esa oportunidad. El sistema exige cliente común; el origen comercial es una declaración del operador, no una inferencia automática por nombre, teléfono o etapa.
4. La lista muestra cotización/estado/fecha y documentos de venta vigentes, cancelados e inconsistentes. «Abrir cotización» lleva al historial filtrado en otra pestaña. Máximo 100 vínculos por oportunidad.
5. **Retirar vínculo:** requiere confirmación y conserva cotización, pedido y facturas. Se guarda el retiro en el seguimiento/auditoría. Para cambiar el cliente, primero retirar todos sus vínculos.

Sólo ADMIN o el responsable actual de la oportunidad pueden consultar o cambiar estos vínculos. Guardar primero los cambios de la ficha. La ficha se bloquea durante una mutación; después se recarga completa para no sobrescribir campos con una versión antigua. Si la versión no coincide, recargar la oportunidad y actualizar sus vínculos.

Las búsquedas conservan el texto al fallar y limpian las opciones anteriores. Una respuesta incierta conserva operación, oportunidad, documento y versión: **Reintentar la misma operación** usa los mismos datos. No seleccionar otro documento para resolver un resultado desconocido.

## Modelo y consistencia

Migración **092_vinculos_comerciales_crm.sql**, nueva, sin editar las aplicadas:

- `crm_oportunidad_cotizacion`: una cotización tiene un único origen activo. Incluye oportunidad, cliente común, autor y fecha.
- FK compuestas contra oportunidad y cotización exigen el mismo cliente también ante SQL directo. Una relación vigente impide cambiar sus clientes a valores incompatibles.
- Índice por oportunidad, auditoría existente y seguimiento con usuario autenticado para asociación, vínculo y retiro.
- Las mutaciones bloquean la oportunidad y avanzan versión en la misma transacción que el vínculo/historial. Cliente y cotización se vuelven a comprobar en servidor.
- PUT de recurso es idempotente: repetir un vínculo presente o retiro ausente no inserta otro seguimiento ni avanza versión. Un reintento antiguo después de retirar el vínculo encuentra una versión diferente y no lo recrea.
- No se puede apropiarse de una cotización que pertenece a otra oportunidad. Dos operaciones concurrentes compiten por su PK y sólo una puede conservar el vínculo.

El historial conserva la decisión del operador; no certifica que todas las partidas correspondan a la consulta, compatibilidad física o causalidad comercial. Retirar/reasociar cambia la atribución actual y queda trazado. No crea una serie histórica de métricas ni una auditoría global append-only; S03 conserva su alcance pendiente.

## Conteo de documentos

En **Solicitudes web → Medición de solicitudes**, «Documentos de venta con origen vinculado» añade:

| Indicador | Definición |
| --- | --- |
| Cotizaciones vinculadas | Vínculos actuales de oportunidades derivadas de solicitudes del periodo |
| Solicitudes con cotización | Solicitudes distintas con alguna cotización vinculada |
| Solicitudes con venta registrada | Solicitudes distintas con al menos un documento de ingreso vigente y relaciones coherentes |
| Documentos de venta vigentes | Facturas internas tipo I por cotización directa o pedido, sin cancelación local/fiscal registrada |
| Documentos cancelados | Tipo I con relaciones coherentes y estado local Cancelada/Cancelado o fiscal Cancelado |
| Documentos inconsistentes | Tipo I con cliente distinto, pedido cancelado/incompatible, cotizaciones de ambas rutas diferentes o estado local ausente; se excluyen |

Cada factura se cuenta una vez, incluso si tiene ambas rutas. Las ventas parciales pueden producir varios documentos de una solicitud. Notas de crédito tipo E y ventas sin vínculo explícito quedan fuera. La agregación usa el mismo snapshot READ ONLY de WEB05.2a y selecciona la cohorte por **fecha de recepción**, no fecha de venta. Los estados/relaciones se observan al consultar y pueden cambiar después del periodo.

Este conteo por sí solo no demuestra cobro, ingreso neto, unidades netas vendidas, utilidad, CFDI timbrado real o estado SAT consultado en ese momento. WEB05.2c añade importes/cobros/venta neta por moneda en una sección separada, con cobertura y desconocidos explícitos; ver [definiciones y límites](WEB_MEDICION_FINANCIERA.md). Una oportunidad Ganada sin documentos vinculados no incrementa este conteo. Datos de la BD de prueba producen resultados de prueba.

## API privada

Base: `/api/v1/crm/oportunidades/:id/documentos-comerciales`.

| Método / ruta | Uso |
| --- | --- |
| GET base | Cliente/versión y vínculos con conteos; hasta 100 |
| GET `/disponibles?term=C-123` | Hasta 20 cotizaciones libres del cliente; texto literal, máximo 100 caracteres |
| PUT `/cliente` | `{idCliente, expectedVersion, confirmado:true}` |
| PUT `/cotizaciones/:quote` | `{expectedVersion, confirmado:true}` |
| PUT `/cotizaciones/:quote/retirar` | `{expectedVersion, confirmado:true}` |

JWT activo, filtro ADMIN/responsable y `Cache-Control: private, no-store`; usuario ajeno recibe404 sin consultar documentos. DTO global rechaza campos extra, confirmación ausente/falsa y versiones inválidas. No acepta autor/responsable aportado por cliente. Lecturas parametrizadas, snapshot READ ONLY y plazo SQL5s; UI espera hasta10s. Las reglas del servidor y las FK no dependen de que el navegador muestre un control deshabilitado.

## Pruebas de esta sesión

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:web-commercial-db
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace backend test -- --runInBand crm
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 --workspace frontend run test:e2e -- tests/crm-commercial.spec.ts tests/web-metrics.spec.ts tests/web-inbox.spec.ts
```

- **9/9 grupos PostgreSQL/HTTP**: clientes/propietario/versiones, idempotencia/carreras, FK compuestas, rutas directa/pedido, duplicados, cancelación local/fiscal, inconsistencias, exclusión de NC/sin vínculo, retiro/historial/auditoría, facturas intactas, JWT/login/revocación y DTO. [Reporte](../.artifacts/web-commercial-db.json), [salida](../.artifacts/web-commercial-db.log). Esquema mínimo propio eliminado; recrea 031/089/090/092 y auditoría010 sólo en ese esquema, sin fallback public o cambios de tablas de negocio.
- **40/40 pruebas backend** en siete suites CRM; [salida](../.artifacts/web-commercial-unit.log).
- **18/18 Playwright**: cuatro casos nuevos, cuatro de métricas ampliados y diez de bandeja. Claro1280/oscuro390, cliente/confirmación, commit con recibo fallido/reintento, bloqueo de ficha, retiro, error/búsqueda vacía, datos comerciales y protección de cambios sin guardar. Axe sin infracciones en el componente y reflujo aprobados. API/login simulados sólo en esas pruebas UI; capturas inspeccionadas. [Salida](../.artifacts/web-commercial-ui.log).
- Regresión PostgreSQL/HTTP de WEB05.2a aprobada **8/8 grupos** con estructura092 en su propio esquema; [salida](../.artifacts/web-commercial-metrics-regression.log).
- Builds backend/frontend y ESLint de backend afectado aprobados. Angular inicial **476.79 kB frente a500 kB**, presupuesto conservado; [build](../.artifacts/web-commercial-frontend-build.log). Primera compilación detectó tipo de retorno no exportado; se corrigió y el build final pasó.
- **AppModule completo y copia restaurada** desde respaldo previo: `db:check` antes de `db:migrate` en copia, migración092, guards/login/bcrypt/JWT reales, Angular producción claro/oscuro, recepción/rotación/purga anteriores y vínculo comercial por responsable actual, tercero404, reintento, métrica y retiro conservando cotización. Cron detenido y captura fixture sólo en copia; copia/servidores cerrados/eliminados. [Reporte](../.artifacts/web-inbox-auth-acceptance.json), [salida](../.artifacts/web-commercial-full-auth.log). `test:web-inbox-auth` ahora requiere al menos una cotización con cliente en el respaldo de prueba para ese caso; no inventa una oferta comercial.
- **Instalación actual 10/10 sondeos**: nueva ruta anónimo401, métricas ADMIN200/privadas coherentes con SQL READ ONLY, ERP4300/web4500/piloto4600 disponibles y captación/puente503. Login real, panel comercial oscuro390px sin API simulada/JWT inyectado y reflujo aprobado; **0 solicitudes/0 vínculos** en el periodo consultado. Backend reiniciado con build actual; sin insertar fixtures de negocio en esa base. [Reporte](../.artifacts/web-commercial-live.json).

Respaldo previo legible: `.backups/2026-10-12T05-21-07-487Z/database.dump` (11/10, hora local). `db:check` revirtió la validación de092; `db:migrate` la aplicó después y `db:status` la confirmó. [Respaldo](../.artifacts/web-commercial-backup.log), [check](../.artifacts/web-commercial-db-check.log), [migración](../.artifacts/web-commercial-db-migrate.log). Tabla de vínculos nueva, inicialmente vacía; no asignar relaciones a registros reales para simular resultados.

## Pendientes conservados

WEB05.2b completa esta trazabilidad/conteo local, no toda WEB05.2. Importes/cobros/neto de venta están implementados en WEB05.2c y rentabilidad atribuible con costos comparables en [WEB05.2d](WEB_RENTABILIDAD_CRM.md). WEB05.2e incorpora [cobros netos y reembolsos vinculados](WEB_COBROS_NETOS_CRM.md) en el alcance local MXN/factor1, saldo a favor separado y cobertura de desconocidos. Siguen pendientes costos multimoneda con procedencia verificada, flujo de caja integral, ventas sin vínculo, navegación con privacidad acordada y aceptación comercial. Tampoco certifica carga masiva, todas las intercalaciones concurrentes, todas las reglas financieras o dispositivos físicos. D01–D09, P1, hosting/HTTPS y Ollama mantienen sus decisiones/prioridad.
