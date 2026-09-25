// backend/src/catalogos/clave-unidad/clave-unidad.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ClaveUnidadService } from './clave-unidad.service';
import { CatalogoSearchQuery } from '../catalogo-search.dto';
@Controller('catalogos/clave-unidad')
export class ClaveUnidadController {
  constructor(private readonly service: ClaveUnidadService) {}
  @Get('buscar')
  buscar(@Query() query: CatalogoSearchQuery) {
    return this.service.buscar(query.q || '');
  }
}
