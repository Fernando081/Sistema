import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MvVentasFacturacion,
  MvInventarioAlmacen,
  MvClientesCobranza,
  MvOperacionesAvanzadas,
} from './dashboard.types';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getMetrics() {
    const result = await this.dataSource.query(
      'SELECT fn_get_dashboard_metrics() as datos',
    );
    return result[0].datos;
  }

  async getVentas(): Promise<MvVentasFacturacion[]> {
    return this.dataSource.query('SELECT * FROM mv_ventas_facturacion');
  }

  async getInventario(): Promise<MvInventarioAlmacen[]> {
    return this.dataSource.query('SELECT * FROM mv_inventario_almacen');
  }

  async getClientes(): Promise<MvClientesCobranza[]> {
    return this.dataSource.query('SELECT * FROM mv_clientes_cobranza');
  }

  async getOperaciones(): Promise<MvOperacionesAvanzadas[]> {
    return this.dataSource.query('SELECT * FROM mv_operaciones_avanzadas');
  }

  @Cron('0 2 * * *')
  async refreshMaterializedViews() {
    this.logger.log(
      'Iniciando refresco de vistas materializadas (02:00 AM)...',
    );
    try {
      await this.dataSource.query('CALL sp_refresh_analytics_views()');
      this.logger.log('Refresco de vistas completado con éxito.');
    } catch (error) {
      this.logger.error('Error al refrescar las vistas materializadas', error);
    }
  }
}
