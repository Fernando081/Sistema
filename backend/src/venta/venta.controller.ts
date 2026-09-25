// backend/src/venta/venta.controller.ts
import { Body, Controller, Get, Post, Param, Res, Query, DefaultValuePipe, ParseIntPipe, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { VentaService } from './venta.service';
import { CreateVentaDto, ProcesarDevolucionDto } from './venta.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';

@Controller('venta')
export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @Permissions('ventas.crear')
  create(@Body() createVentaDto: CreateVentaDto, @Req() req: { user: JwtPayload }) {
    if (createVentaDto.tipoComprobante === 'E' && req.user?.role !== RolUsuario.ADMIN) {
      throw new ForbiddenException('Solo un administrador puede registrar notas de crédito');
    }
    const idVendedor = req.user?.idUser;
    return this.ventaService.create(createVentaDto, idVendedor);
  }

  @UseGuards(JwtAuthGuard)
  @Get('comisiones')
  @Roles(RolUsuario.ADMIN)
  getComisionesSemanales() {
    return this.ventaService.getComisionesSemanales();
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('term') term?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.ventaService.findAll(page, limit, term, tipo);
  }

  @Get(':id/detalle')
  findDetalle(@Param('id', ParseIntPipe) id: number) {
    return this.ventaService.findDetalle(id);
  }

  @Get(':id/pdf')
  async descargarPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const buffer = await this.ventaService.generarTicketPdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=ticket_${id}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Post(':id/enviar-correo')
  enviarCorreo(@Param('id', ParseIntPipe) id: number) {
    return this.ventaService.enviarFacturaPorCorreo(id);
  }

  @Post(':id/cancelar')
  @Roles(RolUsuario.ADMIN)
  @Permissions('ventas.cancelar')
  cancelarFactura(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    return this.ventaService.cancelarFactura(id, req.user?.idUser);
  }

  @Post(':id/devoluciones')
  @Roles(RolUsuario.ADMIN)
  @Permissions('ventas.cancelar')
  procesarDevolucion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProcesarDevolucionDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.ventaService.procesarDevolucion(id, dto, req.user?.idUser);
  }
}
