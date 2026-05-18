import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { VentaService } from './venta.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('factura')
export class FacturaController {
  constructor(private readonly ventaService: VentaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('cliente/:idCliente/relacionables')
  getFacturasRelacionables(@Param('idCliente', ParseIntPipe) idCliente: number) {
    return this.ventaService.getFacturasRelacionables(idCliente);
  }
}
