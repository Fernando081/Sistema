// backend/src/pago/pago.controller.ts
import { Body, Controller, Get, Param, Post, Res, ParseIntPipe, Req } from '@nestjs/common';
import type { Response } from 'express';
import { PagoService } from './pago.service';
import { RegistrarPagoDto, RegistrarRepDto } from './pago.dto';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { CancelFiscalDocumentDto } from '../fiscal/fiscal.dto';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';

@Controller('pago')
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  @Post()
  @Permissions('cobranza.registrar')
  registrar(@Body() dto: RegistrarPagoDto, @Req() req: { user: JwtPayload }) {
    return this.pagoService.registrarPago(dto, req.user?.idUser);
  }

  @Get('factura/:id')
  getPagos(@Param('id', ParseIntPipe) id: number) {
    return this.pagoService.getPagosPorFactura(id);
  }

  @Get('pendientes')
  getAllPendientes() {
    return this.pagoService.getAllPendientes();
  }

  @Get('pendientes/:idCliente')
  getPendientes(@Param('idCliente', ParseIntPipe) id: number) {
    return this.pagoService.getPendientesPorCliente(id);
  }

  @Get('pendientes-ppd/:idCliente')
  getPpdPendientes(@Param('idCliente', ParseIntPipe) id: number) {
    return this.pagoService.getPpdPendientesPorCliente(id);
  }

  @Post('rep')
  @Permissions('cobranza.registrar')
  registrarRep(@Body() dto: RegistrarRepDto, @Req() req: { user: JwtPayload }) {
    return this.pagoService.registrarRepComplejo(dto, req.user?.idUser);
  }

  @Get('rep')
  getHistorialReps() {
    return this.pagoService.getHistorialReps();
  }

  @Post('rep/:id/cancelar')
  @Roles(RolUsuario.ADMIN)
  @Permissions('fiscal.timbrar')
  cancelarRep(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelFiscalDocumentDto,
    @Req() req: { user: JwtPayload }) {
    return this.pagoService.cancelarRep(id, dto, req.user?.idUser);
  }

  @Get(':id/pdf')
  async descargarRepPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response
  ) {
    const idPago = id;
    const buffer = await this.pagoService.generarRepPdf(idPago);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=REP_${idPago}.pdf`,
      'X-Fiscal-Mode': process.env.FISCAL_MODE || 'mock',
    });

    res.end(buffer);
  }

  @Get(':id/xml')
  async descargarRepXml(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response
  ) {
    const idPago = id;
    const xmlStr = await this.pagoService.generarRepXml(idPago);

    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename=REP_${idPago}.xml`,
      'X-Fiscal-Mode': process.env.FISCAL_MODE || 'mock',
    });

    res.send(xmlStr);
  }
}
