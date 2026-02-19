// backend/src/catalogos/objeto-impuesto/objeto-impuesto.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ObjetoImpuestoService } from './objeto-impuesto.service';

@Controller('catalogos/objeto-impuesto')
export class ObjetoImpuestoController {
  constructor(private readonly service: ObjetoImpuestoService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }
}
