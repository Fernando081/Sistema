import { Module } from '@nestjs/common';
import { GarantiaController } from './garantia.controller';
import { GarantiaService } from './garantia.service';

@Module({ controllers: [GarantiaController], providers: [GarantiaService] })
export class GarantiaModule {}
