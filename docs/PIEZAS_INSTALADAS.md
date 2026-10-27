# D02 — Piezas instaladas, compatibilidad y garantías

Refacciones y Tractorepuestos Tampico. Implementación local del20/10/2026. Requiere backend/frontend compatibles y migración **101**. Complementa [D01](EXPEDIENTE_UNIDADES.md); VIN/ESN, aplicaciones de catálogo y trámite de garantías ya existían.

## Uso

**Clientes → Unidades → Expediente → Piezas instaladas y garantías**. También se llega desde oportunidad o Cliente360. Una venta no crea automáticamente una instalación: la captura es un reporte explícito de qué pieza fue colocada en una unidad concreta.

1. Pulsar **Registrar instalación** y buscar la factura por folio, número de parte o descripción.
2. Seleccionar su renglón; se muestran cantidad vendida/disponible y hasta cinco aplicaciones del catálogo, con su total y restricciones. Estas referencias no validan automáticamente un VIN/ESN; revisar las demás en Productos.
3. Capturar cantidad, fecha/hora, trabajo reportado y compatibilidad: **Pendiente**, **Verificada** o **Incompatible**, con fuente/motivo obligatorio incluso si falta verificar. No se consulta un decodificador externo ni se infiere compatibilidad por coincidencia de modelo.
4. **Revisar compatibilidad** conserva una nueva versión con autor/fecha/auditoría. Una incompatibilidad puede documentar una instalación reportada incorrecta; no se oculta el hecho ni se aprueba su uso.
5. **Vincular garantía** busca un trámite existente del mismo renglón. Abrir una garantía nueva sigue correspondiendo al detalle de factura y sus controles anteriores. El vínculo no concede cobertura, vigencia ni aprobación y no reemplaza el diagnóstico del fabricante/proveedor.
6. Garantías muestra enlace de regreso a la unidad/instalación sólo a quien tiene permiso de consulta. Cada tarjeta resume los diez últimos vínculos; **Ver historial de vínculos** permite consultar todos por páginas de20, incluidos retirados.

Historial de instalaciones, ventas de origen y candidatos de garantía tienen búsquedas/páginas de20 y totales; `%`, `_` y barras se buscan literalmente. Un vacío no se sustituye por ejemplos. Los formularios conservan borrador ante rechazo, explican envíos inciertos y usan claves técnicas en memoria; recargar/salir puede perder borradores e intenciones. No se guardan en WebStorage. Claro/oscuro y móvil usan los colores del tema.

## Reglas de integridad

- La unidad debe tener cliente. Origen: factura de ingreso no cancelada del mismo cliente, con producto identificado y sin otra unidad asignada. Una unidad sin cliente no puede registrar piezas vendidas.
- No se admite origen con devoluciones o notas de crédito vigentes del mismo producto por conciliar. Es conservador: no intenta asignar automáticamente cantidades devueltas entre renglones repetidos/unidades.
- Fecha ISO con zona, no anterior a la venta ni futura (tolerancia técnica60 segundos). Cantidad positiva, hasta seis decimales; validación contempla notación científica sin producir un error500.
- La suma de instalaciones no anuladas **entre todas las unidades** no supera la cantidad del renglón. El bloqueo transaccional de factura/concepto serializa altas concurrentes y la aritmética de asignación usa `numeric` SQL, no sumas de JavaScript.
- Código/descripción y VIN/ESN se copian al registrar. Cambiar el maestro no reescribe esas instantáneas. El expediente conserva también el ID de concepto/factura; las FK RESTRICT impiden destruir sus orígenes por cascada.
- Una garantía se relaciona con una única instalación activa, del mismo concepto/factura/cliente/unidad y con cantidad no mayor a la instalación. No divide un trámite entre varias unidades. Varios trámites sucesivos pueden figurar en el historial; la cantidad de garantías abiertas sigue controlada por el módulo anterior, sin inventar un derecho acumulado de cobertura.
- Revisión con versión: dos cambios diferentes sobre la misma versión producen una decisión y un409. Repetir la revisión idéntica inmediata no añade versión. No hay edición de cantidad/fecha/origen del reporte: anular el registro incorrecto y capturar otro.
- UUID/huella por intención para alta y vínculo: mismo contenido devuelve ID original; otro contenido con la misma clave devuelve409. Reintentar un alta anulada/vínculo retirado no lo reactiva. Son identificadores técnicos, independientes del timbrado fiscal mock.
- ADMIN puede retirar un vínculo o anular una instalación con motivo; se conserva historia. Una instalación con vínculo activo no se anula hasta corregir esos vínculos. Anular libera su asignación documental, **no prueba desmontaje ni devuelve mercancía al stock**. La misma corrección repetida es segura; otro motivo produce409.
- Cancelación/devolución o cambio de destino comercial posterior no borra el reporte histórico: aparece aviso de origen cambiado/por conciliar. Los vínculos históricos pueden documentar trámites cerrados y no se interpretan como aprobación financiera. La protección fiscal anterior sigue impidiendo cancelar con garantías abiertas.

## Acceso, transacciones y almacenamiento

Reutiliza `crm.unidades.consultar` y `crm.unidades.gestionar` de D01/S01. Consulta permite leer todo el expediente del ERP, no un portal aislado por cliente. Gestión más consulta permite altas/revisiones/vínculos; anular/retirar exige además ADMIN. No hay permisos nuevos ni concesiones a operadores de origen. La ampliación de gestión a D02 debe considerarse al delegar ese permiso.

La cuenta/rol/versión/permisos se comprueban dentro de transacción; escrituras bloquean actor y unidad, y fuentes/vínculos cuando procede. Actor LOCAL y auditoría comparten commit/rollback, con nombre histórico. Lecturas usan snapshot repetible READ ONLY y consultas acotadas, con timeout5 segundos.

101 crea `crm_unidad_pieza` y `crm_unidad_pieza_garantia`, índices y auditoría JSONB protegida existente. No rellena instalaciones históricas, altera aplicaciones/garantías anteriores o genera ventas, cargos, inventario, contabilidad o facturas. Las tablas forman parte del respaldo PostgreSQL; no almacena nuevos binarios, URLs públicas, credenciales o IA. La integridad frente al propietario PostgreSQL y retención conservan los límites de S03/O03.

## API privada

Prefijo `/api/v1/crm/unidades/:unidad/piezas`; GET con `private, no-store`. Los IDs de piezas/vínculos siempre se comprueban dentro de la unidad de la URL.

| Método/ruta | Contrato |
| --- | --- |
| GET raíz | `page`, `term` hasta100 caracteres; historial20 |
| GET `origenes` | Mismos filtros; ventas elegibles/aplicaciones informativas |
| POST raíz | `requestId`, `idConcepto`, `cantidad`, `fecha`, `detalle`, `compatibilidad`, `referencia` |
| POST `:pieza/revision` | `version`, `compatibilidad`, `referencia` |
| POST `:pieza/anular` | `motivo`; ADMIN |
| GET `:pieza/garantias-candidatas` | `page`, `term` por número exacto/motivo;20 |
| GET `:pieza/garantias-historial` | `page`; todos los vínculos,20 por página |
| POST `:pieza/garantias` | `requestId`, `idGarantia`, `motivo` |
| POST `:pieza/garantias/:vinculo/retirar` | `motivo`; ADMIN |

## Instalación y prueba

Respaldo legible → `db:check` con rollback → aceptación en copia restaurada → `db:migrate` → `db:status` → reiniciar backend compatible. No editar101 una vez aplicada. El estado efectivo y respaldos se registran en el README.

```powershell
# Builds backend/frontend previos con Node24; sin otra compilación concurrente
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run test:unit-parts -- --backup=.backups/FECHA/database.dump
```

El verificador usa AppModule/PostgreSQL/HTTP/Angular producción con login real. Restaura exclusivamente una copia propia `verify_parts_*`, aplica migraciones/prepara fixtures allí y la elimina. Rechaza origen remoto/respaldo fuera de `.backups`, no imprime credenciales y no carga ejemplos en origen. Prueba asignación decimal/concurrencia, permisos, snapshot, revisiones, vínculos/correcciones, origen cancelado/devuelto, paginación, rollback y revocación mientras espera bloqueo; UI claro1280/oscuro390/axe/reflujo/error con borrador y operador de consulta. La devolución usa el flujo anterior con garantías cerradas y saldo liquidado sintético únicamente en copia: **no es aceptación de pago/REP**. Los fixtures de volumen también se limitan a la copia. Ver conteos/resultados efectivos en README.

## Límites del alcance local

D02 registra instalaciones **reportadas de piezas vendidas por este ERP**, revisión manual documentada y vínculo con garantía. No certifica instalación física o ajuste mecánico, no sustituye validación técnica del fabricante y no hace trazabilidad de serie individual por pieza, desmontajes/reinstalaciones, trabajos externos sin factura del ERP o reparto de una garantía entre unidades. No calcula duración de garantía, consumo/desgaste o recordatorios y no inventa instalaciones retrospectivas. No se certifica carga/soak, todos los dispositivos o operación fiscal/productiva. D01 sigue teniendo sus propios límites de contadores/documentos/mantenimiento; decisiones WEB05 de privacidad y conexiones bancarias excluidas no cambian.
