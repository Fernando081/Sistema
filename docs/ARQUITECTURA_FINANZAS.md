# Arquitectura de Finanzas

Actualizado: 29 de septiembre de 2026. Refactor Q03.1; no modifica rutas ni requiere migraciones.

`FinanzasController` conserva su dependencia de `FinanzasService`. Este servicio mantiene gastos y saldos y delega operaciones a proveedores especializados registrados en `FinanzasModule`.

| Servicio | Responsabilidad |
| --- | --- |
| `ContabilidadService` | Cuentas, pólizas, estados financieros, periodos, centros de costos, presupuestos, flujo y CSV |
| `ConciliacionService` | Candidatos, conciliación manual/agrupada, reversión, ignorar movimientos y ajustes |
| `TesoreriaService` | Cuentas propias, movimientos, importación CSV e historial |
| `TransferenciasCierresService` | Transferencias y cierres de tesorería |
| `CorteFinancieroService` | Documento PDF de corte financiero |

## Transacciones y contratos

La separación conserva los cuerpos SQL, validaciones y límites de las transacciones. Tesorería entrega el mismo `EntityManager` de su transacción a `ConciliacionService.crearConciliacionExacta`; ese método es una colaboración interna y no una nueva ruta HTTP. No debe abrir una transacción independiente al conciliar una importación.

La fachada tipa sus delegaciones mediante `Parameters` y `ReturnType` del servicio responsable. Los controladores y consumidores conservan sus métodos públicos. Al agregar proveedores, mantener el registro Nest y actualizar los consumidores que construyen la fachada directamente en pruebas.

## Validación

Pruebas unitarias del dominio, prueba de resolución de proveedores Nest y verificación aislada de operaciones de tesorería. `npm run verify` cubre compilación, lint y suites de backend/frontend/navegador; `scripts/verify-latest-backup.ps1` restaura un respaldo en una base temporal y comprueba flujos transaccionales.

Q03 permanece parcial: esta separación cubre Finanzas. Otros servicios grandes y tipos restantes del frontend se registran en el README. La tesorería sigue siendo local; no se incorporan conexiones bancarias.

## Frontend — Q03.3.4 (30/09/2026)

Gastos y saldos describen los campos reales de las entidades serializadas,
con importes number|string y relaciones nullable. Q03 cerró los dominios y
la eliminación de any explícitos previstos; el guard check:no-any se ejecuta
con verify. Esto no equivale a validación de respuestas JSON en ejecución ni
al tipado estricto de todos los formularios. Los resultados finales están en
README.md; la tesorería continúa exclusivamente local.
