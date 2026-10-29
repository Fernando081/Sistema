import { Module } from '@nestjs/common';
import { FiscalModule } from '../fiscal/fiscal.module';
import { PagoModule } from '../pago/pago.module';
import { VentaModule } from '../venta/venta.module';
import { SeguimientoFiscalService } from './seguimiento-fiscal.service';

/** O01.2c · Seguimiento en segundo plano de cancelaciones fiscales pendientes del SAT. */
@Module({
  imports: [FiscalModule, VentaModule, PagoModule],
  providers: [SeguimientoFiscalService],
})
export class FiscalSeguimientoModule {}
