// backend/src/catalogos/unidad/unidad.controller.ts
import { Controller, Get } from '@nestjs/common';
import { UnidadService } from './unidad.service';

@Controller('catalogos/unidad')
export class UnidadController {
  constructor(private readonly service: UnidadService) {}
  
  @Get()
  findAll() { return this.service.findAll(); }
}