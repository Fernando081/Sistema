// backend/src/catalogos/clave-prod-serv/clave-prod-serv.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaveProdServ } from '../entities/clave-prod-serv.entity';
import { ClaveProdServService } from './clave-prod-serv.service';
import { ClaveProdServController } from './clave-prod-serv.controller';
@Module({
  imports: [TypeOrmModule.forFeature([ClaveProdServ])],
  providers: [ClaveProdServService],
  controllers: [ClaveProdServController],
  exports: [ClaveProdServService] // Exportamos por si acaso
})
export class ClaveProdServModule {}