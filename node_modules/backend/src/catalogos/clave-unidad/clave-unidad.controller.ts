// backend/src/catalogos/clave-unidad/clave-unidad.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ClaveUnidadService } from './clave-unidad.service';
@Controller('catalogos/clave-unidad')
export class ClaveUnidadController {
  constructor(private readonly service: ClaveUnidadService) {}
  @Get('buscar')
  buscar(@Query('q') termino: string) {
    return this.service.buscar(termino);
  }
}
