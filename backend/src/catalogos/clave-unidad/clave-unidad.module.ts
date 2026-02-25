// backend/src/catalogos/clave-unidad/clave-unidad.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaveUnidad } from '../entities/clave-unidad.entity';
import { ClaveUnidadService } from './clave-unidad.service';
import { ClaveUnidadController } from './clave-unidad.controller';
@Module({
  imports: [TypeOrmModule.forFeature([ClaveUnidad])],
  providers: [ClaveUnidadService],
  controllers: [ClaveUnidadController],
  exports: [ClaveUnidadService], // Exportamos por si acaso
})
export class ClaveUnidadModule {}
