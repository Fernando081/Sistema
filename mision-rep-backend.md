## Objective
Implement the CFDI 4.0 (Complemento de Pago 2.0) PDF generation logic using `pdfmake` and expose it via a REST endpoint in the NestJS backend.

## Context
Tech Stack: Node.js 25.7.0, NestJS, TypeScript 5.9.3, PostgreSQL 18.
Target Files: 
- `backend/src/pago/pago.service.ts`
- `backend/src/pago/pago.controller.ts`

## Tasks
1. **PDF Generation Service (`pago.service.ts`):**
   - Import `pdfmake` at the top (`const PdfPrinter = require('pdfmake');`). Ensure types do not conflict.
   - Add the new method `async generarRepPdf(idPago: number): Promise<Buffer>`.
   - Use `this.dataSource.query()` to fetch payment, invoice, and client data.
   - Implement the provided `docDefinition` structure exactly as specified, ensuring the concept is mapped to '84111506' with value '$0.00' and 'CP01' usage, complying with SAT CFDI 4.0 rules.
   - Return the PDF as a Promise resolving a `Buffer`.
   - **Crucial:** DO NOT delete or overwrite existing methods like `registrarPago`, `getPagosPorFactura`, or `getPendientesPorCliente`.

2. **REST Endpoint (`pago.controller.ts`):**
   - Import `Res` from `@nestjs/common` and `Response` from `express`.
   - Add a new `@Get(':id/pdf')` endpoint named `descargarRepPdf`.
   - Call `this.pagoService.generarRepPdf(id)`.
   - Set HTTP headers: `'Content-Type': 'application/pdf'` and `'Content-Disposition': inline; filename=REP_{id}.pdf`.
   - Send the buffer using `res.end(buffer)`.