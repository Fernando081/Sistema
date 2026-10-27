import { CotizacionQueryDto } from './cotizacion-query';

// backend/src/cotizacion/cotizacion.controller.ts
import { Body, Controller, Get, Param, Post, Res, Req, UseGuards, Query, StreamableFile, ParseIntPipe } from '@nestjs/common';
import { CotizacionService } from './cotizacion.service';
import { CreateCotizacionDto, ConvertirCotizacionDto } from './cotizacion.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Response } from 'express';
import { JwtPayload } from '../auth/auth.types';

@Controller('cotizacion')
export class CotizacionController {
  constructor(private readonly service: CotizacionService) {}

  @Post()
  create(@Body() dto: CreateCotizacionDto,@Req()req:{user:JwtPayload}) {
    return this.service.create(dto,req.user);
  }

  @Get()
  findAll(@Query() query: CotizacionQueryDto) {
    return this.service.findAll(query.page, query.limit, query.term, query.sortBy, query.sortOrder, query.estado, query.desde, query.hasta);
  }

  @Get('exportar')
  async exportCsv(@Query() query: CotizacionQueryDto) {
    return new StreamableFile(Buffer.from(await this.service.exportCsv(query), 'utf8'), {
      type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="cotizaciones.csv"',
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get(':id/pdf')
  async descargarPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
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
    @Req() req: { user: JwtPayload }
  ) {
    const idVendedor = req.user?.idUser;
    return this.service.convertirParcial(id, dto, dto.idFormaPago, dto.idMetodoPago, idVendedor, req.user);
  }
}
