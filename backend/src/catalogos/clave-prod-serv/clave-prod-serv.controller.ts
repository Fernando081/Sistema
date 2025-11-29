// backend/src/catalogos/clave-prod-serv/clave-prod-serv.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ClaveProdServService } from './clave-prod-serv.service';
@Controller('catalogos/clave-prod-serv')
export class ClaveProdServController {
  constructor(private readonly service: ClaveProdServService) {}
  @Get('buscar')
  buscar(@Query('q') termino: string) {
    return this.service.buscar(termino);
  }
}