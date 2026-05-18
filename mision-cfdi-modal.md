## Objective
Construir un modal interactivo en Angular Material para buscar facturas anteriores y conectarlo directamente con el FormArray de CFDIs relacionados.

## Tasks

### 1. Modal de Búsqueda (`BuscadorFacturasDialogComponent`)
- Crea un componente Standalone que reciba `idCliente` por `MAT_DIALOG_DATA`.
- Al iniciar, consume el endpoint `/cliente/:idCliente/relacionables` y llena un `MatTableDataSource`.
- Agrega un input para filtrar resultados. La tabla debe mostrar: Serie/Folio, Fecha, Total, UUID y un botón "Seleccionar".
- Al "Seleccionar", ejecuta `dialogRef.close(uuidSeleccionado)`.

### 2. Integración en el FormArray
- En el HTML del formulario principal, dentro del ciclo del `FormArray` de CFDIs relacionados, coloca un `mat-icon-button` (lupa) junto al input del UUID.
- Enlázalo a la función `abrirBuscadorFacturas(index: number)`.
- En TypeScript, `abrirBuscadorFacturas` debe:
  1. Validar que exista un cliente seleccionado (mostrar un Snackbar si no lo hay).
  2. Abrir el modal pasándole el `idCliente`.
  3. Al cerrarse, si recibe un UUID, usar `patchValue()` para inyectarlo exactamente en el `FormGroup` de la posición `index` dentro del `FormArray`.