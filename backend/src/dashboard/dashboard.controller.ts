import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { SaludSalidasService } from './salud-salidas.service';
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
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly saludSalidas: SaludSalidasService,
  ) {}

  @Get('refresh-status')
  getRefreshStatus() {
    return this.dashboardService.getRefreshStatus();
  }

  // O01.3a · Acumulación, capacidad y vista previa de retención de las salidas (sólo lectura).
  @Get('salidas')
  getOutputsHealth() {
    return this.saludSalidas.revisar();
  }

  @Get('scheduled-jobs')
  getScheduledJobs() {
    return this.dashboardService.getScheduledJobs();
  }

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
