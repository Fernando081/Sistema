// backend/src/venta/venta.module.ts
import { Module } from '@nestjs/common';
import { VentaService } from './venta.service';
import { VentaController } from './venta.controller';
import { TicketService } from './ticket.service';

@Module({
  providers: [VentaService, TicketService],
  controllers: [VentaController],
})
export class VentaModule {}
