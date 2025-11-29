// backend/src/catalogos/metodo-pago/metodo-pago.controller.ts
import { Controller, Get } from '@nestjs/common';
import { MetodoPagoService } from './metodo-pago.service';
@Controller('catalogos/metodo-pago')
export class MetodoPagoController {
  constructor(private readonly service: MetodoPagoService) {}
  @Get()
  findAll() { return this.service.findAll(); }
}