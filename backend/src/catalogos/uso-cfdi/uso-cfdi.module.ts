// backend/src/catalogos/uso-cfdi/uso-cfdi.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsoCFDI } from '../entities/uso-cfdi.entity';
import { UsoCfdiService } from './uso-cfdi.service';
import { UsoCfdiController } from './uso-cfdi.controller';
@Module({
  imports: [TypeOrmModule.forFeature([UsoCFDI])],
  providers: [UsoCfdiService],
  controllers: [UsoCfdiController],
  exports: [UsoCfdiService] // Exportamos por si acaso
})
export class UsoCfdiModule {}