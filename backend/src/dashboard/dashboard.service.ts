import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import {
  MvVentasFacturacion,
  MvInventarioAlmacen,
  MvClientesCobranza,
  MvOperacionesAvanzadas,
} from './dashboard.types';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getMetrics() {
    const result = await queryRows<{ datos: unknown }>(this.dataSource,
      'SELECT fn_get_dashboard_metrics() as datos',
    );
    return result[0].datos;
  }

  async getVentas(): Promise<MvVentasFacturacion[]> {
    return queryRows<MvVentasFacturacion>(this.dataSource, 'SELECT * FROM mv_ventas_facturacion');
  }

  async getInventario(): Promise<MvInventarioAlmacen[]> {
    return queryRows<MvInventarioAlmacen>(this.dataSource, 'SELECT * FROM mv_inventario_almacen');
  }

  async getClientes(): Promise<MvClientesCobranza[]> {
    return queryRows<MvClientesCobranza>(this.dataSource, 'SELECT * FROM mv_clientes_cobranza');
  }

  async getOperaciones(): Promise<MvOperacionesAvanzadas[]> {
    return queryRows<MvOperacionesAvanzadas>(this.dataSource, 'SELECT * FROM mv_operaciones_avanzadas');
  }

  @Cron('0 2 * * *', { timeZone: 'America/Mexico_City' })
  async refreshMaterializedViews() {
    this.logger.log(
      'Iniciando refresco de vistas materializadas (02:00 AM)...',
    );
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const result = await queryRows<{ locked: boolean }>(runner, 'SELECT pg_try_advisory_lock(72410, 1) AS locked');
      locked = result[0].locked;
      if (!locked) return;
      // Es una función RETURNS void, no un procedimiento CALL.
      await runner.query('SELECT sp_refresh_analytics_views()');
      this.logger.log('Refresco de vistas completado con éxito.');
    } catch (error) {
      this.logger.error('Error al refrescar las vistas materializadas', error);
    } finally {
      try {
        if (locked) await runner.query('SELECT pg_advisory_unlock(72410, 1)');
      } finally {
        await runner.release();
      }
    }
  }
}
