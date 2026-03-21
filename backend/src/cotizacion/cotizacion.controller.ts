
// backend/src/cotizacion/cotizacion.controller.ts
import { Body, Controller, Get, Param, Post, Res, Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { CotizacionService } from './cotizacion.service';
import { CreateCotizacionDto, ConvertirCotizacionDto } from './cotizacion.dto';
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
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('term') term?: string,
  ) {
    return this.service.findAll(page, limit, term);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
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
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConvertirCotizacionDto,
    @Req() req: any
  ) {
    const idVendedor = req.user?.idUser;
    return this.service.convertirParcial(id, dto, dto.idFormaPago, dto.idMetodoPago, idVendedor);
  }
}
