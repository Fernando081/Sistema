import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import {
  MvVentasFacturacion,
  MvInventarioAlmacen,
  MvClientesCobranza,
  MvOperacionesAvanzadas,
} from './dashboard.types';

import { Public } from '../auth/public.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Public()
  @Get()
  getMetrics() {
    return this.dashboardService.getMetrics();
  }

  @Public()
  @Get('ventas')
  getVentas(): Promise<MvVentasFacturacion[]> {
    return this.dashboardService.getVentas();
  }

  @Public()
  @Get('inventario')
  getInventario(): Promise<MvInventarioAlmacen[]> {
    return this.dashboardService.getInventario();
  }

  @Public()
  @Get('clientes')
  getClientes(): Promise<MvClientesCobranza[]> {
    return this.dashboardService.getClientes();
  }

  @Public()
  @Get('operaciones')
  getOperaciones(): Promise<MvOperacionesAvanzadas[]> {
    return this.dashboardService.getOperaciones();
  }
}
