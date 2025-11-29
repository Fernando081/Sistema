// backend/src/catalogos/regimen-fiscal/regimen-fiscal.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegimenFiscal } from '../entities/regimen-fiscal.entity';
import { RegimenFiscalService } from './regimen-fiscal.service';
import { RegimenFiscalController } from './regimen-fiscal.controller';
@Module({
  imports: [TypeOrmModule.forFeature([RegimenFiscal])],
  providers: [RegimenFiscalService],
  controllers: [RegimenFiscalController],
  exports: [RegimenFiscalService] // Exportamos por si acaso
})
export class RegimenFiscalModule {}