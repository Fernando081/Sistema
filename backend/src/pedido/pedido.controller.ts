import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.types';
import { VentaService } from '../venta/venta.service';
import { CreatePedidoDto, CreatePedidoFromCotizacionDto, EntregarPedidoDto, FacturarPedidoDto, PedidoQueryDto, SurtirPedidoDto } from './pedido.dto';
import { PedidoService } from './pedido.service';
import { Permissions } from '../auth/permissions.decorator';

@Controller('pedidos')
export class PedidoController {
  constructor(private readonly service: PedidoService, private readonly ventaService: VentaService) {}
  @Get() findAll(@Query() query: PedidoQueryDto) { return this.service.findAll(query); }
  @Get('backorders') backorders() { return this.service.backorders(); }
  @Get('reservas/vencidas') expiredReservations() { return this.service.expiredReservations(); }
  @Post('reservas/vencidas/liberar') @Permissions('pedidos.cancelar') releaseExpiredReservations(@Req() req: { user: JwtPayload }) {
    return this.service.releaseExpiredReservations(req.user?.idUser);
  }
  @Get('disponibilidad/:idProducto') availability(@Param('idProducto', ParseIntPipe) id: number) { return this.service.availability(id); }
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post('desde-cotizacion/:idCotizacion') fromQuote(
    @Param('idCotizacion', ParseIntPipe) idCotizacion: number,
    @Body() dto: CreatePedidoFromCotizacionDto,
    @Req() req: { user: JwtPayload },
  ) { return this.service.createFromQuote(idCotizacion, dto, req.user?.idUser, req.user); }
  @Post() create(@Body() dto: CreatePedidoDto, @Req() req: { user: JwtPayload }) { return this.service.create(dto, req.user?.idUser, req.user); }
  @Post(':id/confirmar') confirm(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) { return this.service.confirm(id, req.user?.idUser); }
  @Post(':id/surtir') @Permissions('pedidos.surtir') fulfill(@Param('id', ParseIntPipe) id: number, @Body() dto: SurtirPedidoDto, @Req() req: { user: JwtPayload }) { return this.service.fulfill(id, dto, req.user?.idUser); }
  @Post(':id/entregar') @Permissions('pedidos.entregas') deliver(@Param('id', ParseIntPipe) id: number, @Body() dto: EntregarPedidoDto, @Req() req: { user: JwtPayload }) { return this.service.deliver(id, dto, req.user?.idUser, req.user); }
  @Post(':id/facturar') @Permissions('ventas.crear') async invoice(@Param('id', ParseIntPipe) id: number, @Body() dto: FacturarPedidoDto, @Req() req: { user: JwtPayload }) {
    return this.ventaService.create(await this.service.prepareInvoice(id, dto), req.user?.idUser, req.user);
  }
  @Post(':id/cancelar') @Permissions('pedidos.cancelar') cancel(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) { return this.service.cancel(id, req.user?.idUser); }
}
