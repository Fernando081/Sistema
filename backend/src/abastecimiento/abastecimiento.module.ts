import { Module } from '@nestjs/common';
import { AbastecimientoController } from './abastecimiento.controller';
import { AbastecimientoService } from './abastecimiento.service';
@Module({controllers:[AbastecimientoController],providers:[AbastecimientoService],exports:[AbastecimientoService]})
export class AbastecimientoModule{}
