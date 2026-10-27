import { randomUUID } from 'node:crypto';
import {
  readDashboardRefreshStatus,
  syncMissedDashboardAlert,
} from './dashboard-job-status';
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
import { syncDashboardRefreshAlert } from './dashboard-refresh-alert';
import {
  readScheduledJobStatus,
  runScheduledJob,
} from '../common/scheduled-job';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getMetrics() {
    const result = await queryRows<{ datos: unknown }>(
      this.dataSource,
      'SELECT fn_get_dashboard_metrics() as datos',
    );
    return result[0].datos;
  }

  async getVentas(): Promise<MvVentasFacturacion[]> {
    return queryRows<MvVentasFacturacion>(
      this.dataSource,
      'SELECT * FROM mv_ventas_facturacion',
    );
  }

  async getInventario(): Promise<MvInventarioAlmacen[]> {
    return queryRows<MvInventarioAlmacen>(
      this.dataSource,
      `
      SELECT i.id,i.valor_total_inventario,i.merma_shrinkage,i.tasa_rotacion_inventario,
        i.indice_quiebre_stock,i.dias_inventario,i.costo_aterrizado,
        i.mercancia_lento_movimiento,i.shrinkage_historico_json,
        fn_gmroi_90d() AS retorno_inversion_inventario,
        (SELECT count(*)::int FROM analytics_inventario_diario
          WHERE fecha BETWEEN (now() AT TIME ZONE 'America/Mexico_City')::date-89
            AND (now() AT TIME ZONE 'America/Mexico_City')::date) AS gmroi_dias_historial
      FROM mv_inventario_almacen i`,
    );
  }

  async getClientes(): Promise<MvClientesCobranza[]> {
    return queryRows<MvClientesCobranza>(
      this.dataSource,
      'SELECT * FROM mv_clientes_cobranza',
    );
  }

  async getOperaciones(): Promise<MvOperacionesAvanzadas[]> {
    return queryRows<MvOperacionesAvanzadas>(
      this.dataSource,
      'SELECT * FROM mv_operaciones_avanzadas',
    );
  }

  @Cron('0 2 * * *', { timeZone: 'America/Mexico_City' })
  async refreshMaterializedViews() {
    this.logger.log(
      'Iniciando refresco de vistas materializadas (02:00 AM)...',
    );
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    const runId = randomUUID();
    let recorded = false;
    try {
      await runner.connect();
      const result = await queryRows<{ locked: boolean }>(
        runner,
        'SELECT pg_try_advisory_lock(72410, 1) AS locked',
      );
      locked = result[0].locked;
      if (!locked) return;
      await runner.query(
        "INSERT INTO operational_job_run(id,job_name,status) VALUES ($1,'dashboard_refresh','running')",
        [runId],
      );
      recorded = true;
      // Es una función RETURNS void, no un procedimiento CALL.
      await runner.query('SELECT sp_refresh_analytics_views()');
      await runner.query(
        "UPDATE operational_job_run SET status='success',finished_at=clock_timestamp() WHERE id=$1",
        [runId],
      );
      this.logger.log('Refresco de vistas completado con éxito.');
      await this.reportRefreshStatus(false);
    } catch {
      this.logger.error('Error al refrescar las vistas materializadas');
      if (recorded) {
        try {
          await runner.query(
            "UPDATE operational_job_run SET status='failed',finished_at=clock_timestamp() WHERE id=$1 AND status='running'",
            [runId],
          );
        } catch {
          this.logger.error('No se pudo cerrar el registro del refresco');
        }
      }
      await this.reportRefreshStatus(true);
    } finally {
      try {
        if (locked) await runner.query('SELECT pg_advisory_unlock(72410, 1)');
      } finally {
        await runner.release();
      }
    }
  }

  getRefreshStatus() {
    return readDashboardRefreshStatus(this.dataSource);
  }

  getScheduledJobs() {
    return readScheduledJobStatus(this.dataSource);
  }

  @Cron('0 */10 * * * *')
  async checkRefreshFreshness() {
    try {
      await runScheduledJob(
        this.dataSource,
        'dashboard_freshness',
        () => syncMissedDashboardAlert(this.dataSource),
        (message) => this.logger.error(message),
      );
    } catch {
      this.logger.error('No se pudo verificar la frescura del dashboard');
    }
  }

  private async reportRefreshStatus(failed: boolean): Promise<void> {
    try {
      await syncDashboardRefreshAlert(this.dataSource, failed);
    } catch {
      this.logger.error(
        'No se pudo registrar el estado del refresco en notificaciones',
      );
    }
  }
}
