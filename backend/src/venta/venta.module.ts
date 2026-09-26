// backend/src/venta/venta.module.ts
import { Module } from '@nestjs/common';
import { VentaService } from './venta.service';
import { VentaController } from './venta.controller';
import { FacturaController } from './factura.controller';
import { TicketService } from './ticket.service';
import { AuthModule } from '../auth/auth.module';
import { FiscalModule } from '../fiscal/fiscal.module';

@Module({
  imports: [AuthModule, FiscalModule],
  providers: [VentaService, TicketService],
  controllers: [VentaController, FacturaController],
  exports: [VentaService],
})
export class VentaModule {}
