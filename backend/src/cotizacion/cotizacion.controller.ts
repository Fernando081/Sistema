// backend/src/cotizacion/cotizacion.controller.ts
import { Body, Controller, Get, Param, Post, Res, Req, UseGuards } from '@nestjs/common';
import { CotizacionService } from './cotizacion.service';
import { CreateCotizacionDto } from './cotizacion.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

  @UseGuards(JwtAuthGuard)
  @Post(':id/convertir')
  convertir(
    @Param('id') id: number,
    @Body() body: { idFormaPago: number; idMetodoPago: number },
    @Req() req: any
  ) {
    const idVendedor = req.user?.idUser;
    return this.service.convertirAVenta(id, body.idFormaPago, body.idMetodoPago, idVendedor);
  }
}
