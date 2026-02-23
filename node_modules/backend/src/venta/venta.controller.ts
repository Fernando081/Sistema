// backend/src/venta/venta.controller.ts
import { Body, Controller, Get, Post, Param, Res } from '@nestjs/common';
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
  findAll() {
    return this.ventaService.findAll();
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
}
