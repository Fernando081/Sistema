// backend/src/catalogos/municipio/municipio.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { MunicipioService } from './municipio.service';
@Controller('catalogos/municipio')
export class MunicipioController {
  constructor(private readonly service: MunicipioService) {}
  @Get('por-estado/:claveEstado')
  findByEstado(@Param('claveEstado') claveEstado: string) {
    return this.service.findByEstado(claveEstado);
  }
}
