import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { AuditoriaController } from './auditoria.controller';

@Module({
  providers: [AuditoriaService],
  controllers: [AuditoriaController]
})
export class AuditoriaModule {}
