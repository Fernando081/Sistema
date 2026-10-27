import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';

export interface DashboardRefreshStatus {
  checkedAt: string;
  expectedAt: string;
  lastSuccessAt: string | null;
  overdue: boolean;
  freshness: 'current' | 'pending' | 'overdue';
  lastRun: DashboardRun | null;
  recentRuns: DashboardRun[];
}
interface DashboardRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed';
}
export async function readDashboardRefreshStatus(dataSource: DataSource) {
  const rows = await queryRows<{ status: DashboardRefreshStatus }>(
    dataSource,
    'SELECT fn_dashboard_refresh_status() AS status',
  );
  return rows[0].status;
}
export async function syncMissedDashboardAlert(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(`WITH s AS (SELECT fn_dashboard_refresh_status() AS value)
    INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,dedupe_key)
    SELECT u.id_user,'dashboard_refresh_missing','Métricas pendientes de actualización',
      'No hay un refresco exitoso para la última ejecución esperada. Las cifras pueden estar desactualizadas.',
      'warning','/dashboard','analytics_refresh',
      concat('dashboard-missing:',s.value->>'expectedAt',':',u.id_user)
    FROM s CROSS JOIN auth_user u WHERE u.is_active AND u.role='admin'
      AND (s.value->>'overdue')::boolean
    ON CONFLICT(dedupe_key) DO NOTHING`);
  await dataSource.query(`UPDATE app_notification SET read_at=coalesce(read_at,clock_timestamp()),
    title='Métricas actualizadas',message='El refresco posterior del dashboard terminó correctamente.',severity='info'
    WHERE type='dashboard_refresh_missing' AND source_type='analytics_refresh'
      AND NOT (fn_dashboard_refresh_status()->>'overdue')::boolean`);
}
