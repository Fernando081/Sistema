## Objective
Preparar el frontend de Angular 21 (Formulario de Facturación) con los nuevos controles fiscales y crear el endpoint en NestJS que alimentará el futuro modal de búsqueda de UUIDs.

## Tasks

### 1. Endpoint de Búsqueda (Backend)
- Crea el endpoint `GET /api/v1/factura/cliente/:idCliente/relacionables`.
- El servicio debe retornar solo las facturas de ese cliente que tengan un `uuid` no nulo.
- Selecciona solo: `id_factura`, `serie`, `folio`, `uuid`, `fecha_emision` y `total`. Ordena por fecha descendente.

### 2. Formulario Reactivo (Frontend)
- En el componente de creación de Venta/Factura, agrega un selector de 'Tipo de Comprobante' ('I' - Ingreso, 'E' - Egreso).
- Agrega un selector de 'Serie'. Lógica dinámica: Si el tipo es 'I', selecciona 'F' por defecto. Si es 'E', selecciona 'NC' por defecto.
- Implementa un `FormArray` para 'CFDIs Relacionados'. Debe permitir agregar dinámicamente filas con un `mat-select` para 'Tipo de Relación' (ej. 01, 04) y un `mat-input` para el 'UUID Relacionado'.
- Mapea estos valores al DTO antes de hacer el submit.