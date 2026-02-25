// backend/src/catalogos/forma-pago/forma-pago.controller.ts
import { Controller, Get } from '@nestjs/common';
import { FormaPagoService } from './forma-pago.service';
@Controller('catalogos/forma-pago')
export class FormaPagoController {
  constructor(private readonly service: FormaPagoService) {}
  @Get()
  findAll() {
    return this.service.findAll();
  }
}
