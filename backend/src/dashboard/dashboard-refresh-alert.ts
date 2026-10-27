import { DataSource } from 'typeorm';

export async function syncDashboardRefreshAlert(
  dataSource: Pick<DataSource, 'query'>,
  failed: boolean,
): Promise<void> {
  if (failed) {
    await dataSource.query(`INSERT INTO app_notification
      (id_user,type,title,message,severity,route,source_type,dedupe_key)
      SELECT id_user,'dashboard_refresh_failed','No se actualizaron las métricas',
        'Falló el refresco del dashboard. Las cifras pueden estar desactualizadas. Revise el servicio antes de usarlas.',
        'critical','/dashboard','analytics_refresh',concat('dashboard-refresh:',id_user)
      FROM auth_user WHERE is_active AND role='admin'
      ON CONFLICT(dedupe_key) DO UPDATE SET
        title=excluded.title,message=excluded.message,severity=excluded.severity,
        read_at=NULL,created_at=clock_timestamp()`);
  } else {
    await dataSource.query(`UPDATE app_notification
      SET read_at=coalesce(read_at,clock_timestamp()),
        title='Métricas actualizadas',severity='info',
        message='El refresco posterior del dashboard terminó correctamente.'
      WHERE type='dashboard_refresh_failed' AND source_type='analytics_refresh'`);
  }
}
