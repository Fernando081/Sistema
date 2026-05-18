## Objective
Actualizar el módulo de facturación en NestJS y PostgreSQL 18 para soportar Notas de Crédito y la relación de múltiples CFDIs bajo el estándar SAT CFDI 4.0.

## Tasks

### 1. Migraciones y Entidades (PostgreSQL & TypeORM)
- Crea una migración SQL para agregar los campos `tipo_comprobante` (CHAR 1, CHECK 'I' o 'E') y `serie` (VARCHAR 10) a la tabla `factura`.
- En la misma migración, crea la tabla `cfdi_relacionado` (`id_relacion` PK, `id_factura` FK, `tipo_relacion` VARCHAR 2, `uuid_relacionado` VARCHAR 36).
- Actualiza la entidad `Factura` y crea la nueva entidad `CfdiRelacionado` en NestJS.

### 2. DTO y Lógica de Negocio
- Actualiza el DTO de creación de factura para aceptar `tipoComprobante`, `serie` y un array opcional de `cfdisRelacionados`.
- Modifica el servicio de facturación: el cálculo del nuevo folio (consecutivo) ahora debe hacerse ejecutando un `MAX(folio)` filtrando estrictamente por la `serie` recibida.
- Asegúrate de iterar sobre el array de `cfdisRelacionados` y guardarlos haciendo un INSERT en su tabla correspondiente, todo dentro de la misma transacción de base de datos que crea la factura.