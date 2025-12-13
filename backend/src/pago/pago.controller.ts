// backend/src/pago/pago.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PagoService } from './pago.service';
import { RegistrarPagoDto } from './pago.dto';

@Controller('pago')
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  @Post()
  registrar(@Body() dto: RegistrarPagoDto) {
    return this.pagoService.registrarPago(dto);
  }

  @Get('factura/:id')
  getPagos(@Param('id') id: number) {
    return this.pagoService.getPagosPorFactura(id);
  }

  @Get('pendientes/:idCliente')
  getPendientes(@Param('idCliente') id: number) {
    return this.pagoService.getPendientesPorCliente(id);
  }
}