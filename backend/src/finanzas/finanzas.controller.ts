import { Controller, Get, Post, Body, UseGuards, Res } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { CreateGastoDto } from './finanzas.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Response } from 'express';

@Controller('finanzas')
@UseGuards(JwtAuthGuard)
export class FinanzasController {
  constructor(private readonly finanzasService: FinanzasService) {}

  @Post('gastos')
  async crearGasto(@Body() createGastoDto: CreateGastoDto) {
    return this.finanzasService.crearGasto(createGastoDto);
  }

  @Get('gastos')
  async findAllGastos() {
    return this.finanzasService.findAllGastos();
  }

  @Get('saldos')
  async getSaldos() {
    return this.finanzasService.getSaldos();
  }

  @Get('corte-pdf')
  async generarCortePdf(@Res() res: Response) {
    const buffer = await this.finanzasService.generarCortePdf();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="corte-financiero.pdf"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
