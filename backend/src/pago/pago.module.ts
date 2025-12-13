// backend/src/pago/pago.module.ts
import { Module } from '@nestjs/common';
import { PagoService } from './pago.service';
import { PagoController } from './pago.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago } from './pago.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Pago])],
  providers: [PagoService],
  controllers: [PagoController]
})
export class PagoModule {}