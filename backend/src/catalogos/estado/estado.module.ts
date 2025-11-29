// backend/src/catalogos/estado/estado.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Estado } from '../entities/estado.entity';
import { EstadoService } from './estado.service';
import { EstadoController } from './estado.controller';
@Module({
  imports: [TypeOrmModule.forFeature([Estado])],
  providers: [EstadoService],
  controllers: [EstadoController],
  exports: [EstadoService] // Exportamos por si acaso
})
export class EstadoModule {}