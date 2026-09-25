import { Controller, Get, Post, Query, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { VentaService } from './venta.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { FacturaGlobalQueryDto, GenerarFacturaGlobalDto } from './venta.dto';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';

@Controller('factura')
export class FacturaController {
  constructor(private readonly ventaService: VentaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('cliente/:idCliente/relacionables')
  getFacturasRelacionables(@Param('idCliente', ParseIntPipe) idCliente: number) {
    return this.ventaService.getFacturasRelacionables(idCliente);
  }

  @UseGuards(JwtAuthGuard)
  @Get('global/tickets-pendientes')
  getTicketsPendientesGlobal(
    @Query() query: FacturaGlobalQueryDto,
  ) {
    return this.ventaService.getTicketsPendientesGlobal(query.fechaInicio, query.fechaFin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('global/generar')
  @Roles(RolUsuario.ADMIN)
  @Permissions('fiscal.timbrar')
  generarFacturaGlobal(
    @Body() body: GenerarFacturaGlobalDto,
    @Req() req: { user: JwtPayload },
  ) {
    const idVendedor = req.user?.idUser;
    return this.ventaService.generarFacturaGlobal(body.fechaInicio, body.fechaFin, body.idsTickets, idVendedor);
  }
}
