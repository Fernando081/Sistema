// backend/src/cotizacion/cotizacion.controller.ts
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { CotizacionService } from './cotizacion.service';
import { CreateCotizacionDto } from './cotizacion.dto';
import type { Response } from 'express';

@Controller('cotizacion')
export class CotizacionController {
  constructor(private readonly service: CotizacionService) {}

  @Post()
  create(@Body() dto: CreateCotizacionDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id/pdf')
  async descargarPdf(@Param('id') id: number, @Res() res: Response) {
    const buffer = await this.service.generarPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=cotizacion_${id}.pdf`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Post(':id/convertir')
  convertir(@Param('id') id: number) {
    return this.service.convertirAVenta(id);
  }
}