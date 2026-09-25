import { Module } from '@nestjs/common';
import { AbastecimientoController } from './abastecimiento.controller';
import { AbastecimientoService } from './abastecimiento.service';
@Module({controllers:[AbastecimientoController],providers:[AbastecimientoService]})
export class AbastecimientoModule{}
