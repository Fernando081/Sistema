import { Controller, Get, Post, Query, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
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

  @UseGuards(JwtAuthGuard)
  @Get('global/tickets-pendientes')
  getTicketsPendientesGlobal(
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
  ) {
    return this.ventaService.getTicketsPendientesGlobal(fechaInicio, fechaFin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('global/generar')
  generarFacturaGlobal(
    @Body() body: { fechaInicio: string; fechaFin: string; idsTickets: number[] },
    @Req() req: any,
  ) {
    const idVendedor = req.user?.idUser;
    return this.ventaService.generarFacturaGlobal(body.fechaInicio, body.fechaFin, body.idsTickets, idVendedor);
  }
}
