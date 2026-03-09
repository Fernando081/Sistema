## Objective
Update the Angular 21.2.0 frontend to download the generated PDF as a Blob and integrate a "View Receipt" action within the success Snackbar upon payment registration.

## Context
Target Files:
- `frontend/src/app/services/pago.service.ts`
- `frontend/src/app/pago/cobranza/cobranza.component.ts`

## Tasks
1. **HTTP Service (`pago.service.ts`):**
   - Add a new method `descargarRepPdf(idPago: number): Observable<Blob>`.
   - Use the Angular `HttpClient` to call `GET ${this.apiUrl}/${idPago}/pdf` with `{ responseType: 'blob' }`.

2. **UI Integration (`cobranza.component.ts`):**
   - Locate the `registrarPago()` method.
   - Modify the success callback (`next: (res) => {...}`) of the `this.pagoService.registrar` subscription.
   - Update the `snackBar.open` call to include the action text `'Ver Recibo (REP)'`.
   - Subscribe to `snackRef.onAction()` to trigger `this.pagoService.descargarRepPdf(res.idPago)`.
   - Convert the received Blob into an Object URL (`window.URL.createObjectURL(blob)`) and open it in a new browser tab (`window.open(url)`).