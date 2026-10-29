// backend/src/venta/venta.module.ts
import { Module } from '@nestjs/common';
import { VentaService } from './venta.service';
import { VentaController } from './venta.controller';
import { FacturaController } from './factura.controller';
import { TicketService } from './ticket.service';
import { AuthModule } from '../auth/auth.module';
import { FiscalModule } from '../fiscal/fiscal.module';

import { RegistroVentaService } from './registro-venta.service';
import { ConsultasVentaService } from './consultas-venta.service';
import { DocumentosVentaService } from './documentos-venta.service';
import { ReversionVentaService } from './reversion-venta.service';
import { FacturaGlobalService } from './factura-global.service';
import { DescargasVentaService } from './descargas-venta.service';
import { SalidaDocumentosService } from './salida-documentos.service';
import { SalidaDocumentosController } from './salida-documentos.controller';
import { SalidaCorreoEjecutorService } from './salida-correo-ejecutor.service';
import { CORREO_TRANSPORTE, NodemailerTransporte } from './correo-transporte';
@Module({
  imports: [AuthModule, FiscalModule],
  providers: [
    VentaService,
    TicketService,
    RegistroVentaService,
    ConsultasVentaService,
    DocumentosVentaService,
    ReversionVentaService,
    FacturaGlobalService,
    DescargasVentaService,
    SalidaDocumentosService,
    SalidaCorreoEjecutorService,
    { provide: CORREO_TRANSPORTE, useClass: NodemailerTransporte },
  ],
  controllers: [VentaController, FacturaController, SalidaDocumentosController],
  exports: [VentaService, ReversionVentaService],
})
export class VentaModule {}
