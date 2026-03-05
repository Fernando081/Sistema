// backend/src/venta/venta.controller.ts
import { Body, Controller, Get, Post, Param, Res, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import type { Response } from 'express';
import { VentaService } from './venta.service';
import { CreateVentaDto } from './venta.dto';

@Controller('venta')
export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  @Post()
  create(@Body() createVentaDto: CreateVentaDto) {
    return this.ventaService.create(createVentaDto);
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.ventaService.findAll(page, limit);
  }

  @Get(':id/detalle')
  findDetalle(@Param('id') id: number) {
    return this.ventaService.findDetalle(id);
  }

  @Get(':id/pdf')
  async descargarPdf(@Param('id') id: number, @Res() res: Response) {
    const buffer = await this.ventaService.generarTicketPdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=ticket_${id}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Post(':id/enviar-correo')
  enviarCorreo(@Param('id') id: number) {
    return this.ventaService.enviarFacturaPorCorreo(id);
  }

  @Post(':id/cancelar')
  cancelarFactura(@Param('id', ParseIntPipe) id: number) {
    return this.ventaService.cancelarFactura(id);
  }
}
