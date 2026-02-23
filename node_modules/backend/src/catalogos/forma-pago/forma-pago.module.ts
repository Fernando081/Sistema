// backend/src/catalogos/forma-pago/forma-pago.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormaPago } from '../entities/forma-pago.entity';
import { FormaPagoService } from './forma-pago.service';
import { FormaPagoController } from './forma-pago.controller';
@Module({
  imports: [TypeOrmModule.forFeature([FormaPago])],
  providers: [FormaPagoService],
  controllers: [FormaPagoController],
  exports: [FormaPagoService], // Exportamos por si acaso
})
export class FormaPagoModule {}
