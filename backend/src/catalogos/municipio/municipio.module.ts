// backend/src/catalogos/municipio/municipio.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Municipio } from '../entities/municipio.entity';
import { MunicipioService } from './municipio.service';
import { MunicipioController } from './municipio.controller';
@Module({
  imports: [TypeOrmModule.forFeature([Municipio])],
  providers: [MunicipioService],
  controllers: [MunicipioController],
  exports: [MunicipioService], // Exportamos por si acaso
})
export class MunicipioModule {}
