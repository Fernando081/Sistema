// backend/src/catalogos/objeto-impuesto/objeto-impuesto.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObjetoImpuesto } from '../entities/objeto-impuesto.entity';
import { ObjetoImpuestoService } from './objeto-impuesto.service';
import { ObjetoImpuestoController } from './objeto-impuesto.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ObjetoImpuesto])],
  providers: [ObjetoImpuestoService],
  controllers: [ObjetoImpuestoController],
  exports: [ObjetoImpuestoService], // Exportamos por si acaso
})
export class ObjetoImpuestoModule {}