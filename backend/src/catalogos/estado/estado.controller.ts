// backend/src/catalogos/estado/estado.controller.ts
import { Controller, Get } from '@nestjs/common';
import { EstadoService } from './estado.service';
@Controller('catalogos/estado')
export class EstadoController {
  constructor(private readonly service: EstadoService) {}
  @Get()
  findAll() {
    return this.service.findAll();
  }
}
