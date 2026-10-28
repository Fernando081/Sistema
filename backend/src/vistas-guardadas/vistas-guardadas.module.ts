import { Module } from '@nestjs/common';
import { VistasGuardadasController } from './vistas-guardadas.controller';
import { VistasGuardadasService } from './vistas-guardadas.service';

@Module({ controllers: [VistasGuardadasController], providers: [VistasGuardadasService] })
export class VistasGuardadasModule {}
