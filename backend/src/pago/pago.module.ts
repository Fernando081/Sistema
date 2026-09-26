// backend/src/pago/pago.module.ts
import { Module } from '@nestjs/common';
import { PagoService } from './pago.service';
import { PagoController } from './pago.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago } from './pago.entity';
import { FiscalModule } from '../fiscal/fiscal.module';

@Module({
  imports: [TypeOrmModule.forFeature([Pago]), FiscalModule],
  providers: [PagoService],
  controllers: [PagoController],
})
export class PagoModule {}
