import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import {
  MvVentasFacturacion,
  MvInventarioAlmacen,
  MvClientesCobranza,
  MvOperacionesAvanzadas,
} from './dashboard.types';

import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';

@Controller('dashboard')
@Roles(RolUsuario.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getMetrics() {
    return this.dashboardService.getMetrics();
  }

  @Get('ventas')
  getVentas(): Promise<MvVentasFacturacion[]> {
    return this.dashboardService.getVentas();
  }

  @Get('inventario')
  getInventario(): Promise<MvInventarioAlmacen[]> {
    return this.dashboardService.getInventario();
  }

  @Get('clientes')
  getClientes(): Promise<MvClientesCobranza[]> {
    return this.dashboardService.getClientes();
  }

  @Get('operaciones')
  getOperaciones(): Promise<MvOperacionesAvanzadas[]> {
    return this.dashboardService.getOperaciones();
  }
}
