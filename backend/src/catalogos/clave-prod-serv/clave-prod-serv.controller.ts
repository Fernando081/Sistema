// backend/src/catalogos/clave-prod-serv/clave-prod-serv.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ClaveProdServService } from './clave-prod-serv.service';
import { CatalogoSearchQuery } from '../catalogo-search.dto';
@Controller('catalogos/clave-prod-serv')
export class ClaveProdServController {
  constructor(private readonly service: ClaveProdServService) {}
  @Get('buscar')
  buscar(@Query() query: CatalogoSearchQuery) {
    return this.service.buscar(query.q || '');
  }
}
