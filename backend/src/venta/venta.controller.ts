import { FacturaQueryDto } from './factura-query';
// backend/src/venta/venta.controller.ts
import { Body, Controller, Get, Post, Param, Res, Query, StreamableFile, ParseIntPipe, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { VentaService } from './venta.service';
import { CreateVentaDto, ProcesarDevolucionDto } from './venta.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { CancelFiscalDocumentDto } from '../fiscal/fiscal.dto';
import { DescargasVentaService, parseIdsLote } from './descargas-venta.service';

@Controller('venta')
export class VentaController {
  constructor(
    private readonly ventaService: VentaService,
    private readonly descargas: DescargasVentaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @Permissions('ventas.crear')
  create(@Body() createVentaDto: CreateVentaDto, @Req() req: { user: JwtPayload }) {
    if (createVentaDto.tipoComprobante === 'E' && req.user?.role !== RolUsuario.ADMIN) {
      throw new ForbiddenException('Solo un administrador puede registrar notas de crédito');
    }
    const idVendedor = req.user?.idUser;
    return this.ventaService.create(createVentaDto, idVendedor, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('comisiones')
  @Roles(RolUsuario.ADMIN)
  getComisionesSemanales() {
    return this.ventaService.getComisionesSemanales();
  }

  @Get()
  findAll(@Query() query: FacturaQueryDto) {
    return this.ventaService.findAll(query.page, query.limit, query.term, query.tipo, query.sortBy, query.sortOrder, query.estado, query.desde, query.hasta);
  }

  @Get('exportar')
  async exportCsv(@Query() query: FacturaQueryDto) {
    return new StreamableFile(Buffer.from(await this.ventaService.exportCsv(query), 'utf8'), {
      type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="facturas.csv"',
    });
  }

  @Get(':id/detalle')
  findDetalle(@Param('id', ParseIntPipe) id: number) {
    return this.ventaService.findDetalle(id);
  }

  /** U02.3 · PDF + XML timbrado de varias facturas en un ZIP (mismo acceso que la descarga individual). */
  @UseGuards(JwtAuthGuard)
  @Get('documentos-lote')
  async documentosLote(@Query('ids') ids: string | undefined, @Res() res: Response) {
    const { zip } = await this.descargas.zipFacturas(parseIdsLote(ids));
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename=facturas.zip',
      'Content-Length': zip.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(zip);
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

  @Post(':id/cancelar')
  @Roles(RolUsuario.ADMIN)
  @Permissions('ventas.cancelar')
  cancelarFactura(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload },
    @Body() dto: CancelFiscalDocumentDto) {
    return this.ventaService.cancelarFactura(id, req.user?.idUser, dto);
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
