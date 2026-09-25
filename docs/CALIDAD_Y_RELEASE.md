# Calidad y liberación

## Capas de prueba

El proyecto usa controles complementarios. Ninguno escribe sobre la base operativa durante las pruebas automatizadas de interfaz.

1. **Unitarias backend y frontend**: validan reglas y componentes aislados.
2. **HTTP**: valida autenticación, autorización, revocación, límites y contratos de error.
3. **Playwright UI**: inicia Angular en el puerto 4400 y usa un estado API nuevo por prueba. Verifica autenticación, navegación, búsqueda por VIN/ESN, pedidos, abastecimiento, accesibilidad WCAG A/AA y diseño móvil.
4. **PostgreSQL aislado**: restaura el respaldo más reciente en una base temporal, aplica migraciones y ejecuta transacciones reales. La base temporal se elimina al terminar.

## Comandos

```powershell
# Control habitual de código y UI
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify

# Antes de una liberación o migración importante
npm run db:backup
powershell -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify:release
```

`verify:release` cubre adicionalmente:

- concurrencia de apertura y cierre de caja;
- idempotencia de ventas y compras;
- devoluciones exactas, notas de crédito y REP;
- cotizaciones sin conversión duplicada;
- pedido con VIN/ESN, reserva, surtido, entrega, factura y garantía;
- backorder, solicitud, orden de compra, recepción y apartado automático.

## Datos de las pruebas UI

`frontend/tests/helpers/erp-api.mock.ts` mantiene los datos dentro del proceso de Playwright. Cada prueba recibe un estado limpio con un cliente, una unidad VIN/ESN, un producto y un proveedor. Estos datos no se insertan en PostgreSQL y nunca aparecen en la operación real.

## CI

GitHub Actions usa Node.js 24, instala Chromium, ejecuta build, lint, pruebas unitarias, pruebas HTTP, Playwright y auditoría de dependencias. La restauración de respaldo se conserva como control local de liberación porque los respaldos operativos no deben copiarse a GitHub Actions.

## Criterio de liberación

Una versión se puede etiquetar cuando:

- `npm run verify` termina sin errores;
- `npm run verify:release` restaura y elimina correctamente la base temporal;
- no existen migraciones pendientes;
- el bundle inicial permanece dentro del presupuesto configurado;
- los documentos fiscales siguen marcados como prueba mientras `FISCAL_MODE=mock`.
