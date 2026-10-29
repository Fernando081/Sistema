import { DataSource } from 'typeorm';
import { queryRows } from './database/typed-query';

// One persisted incident per job/admin. Acknowledging it does not imply
// recovery. A newer successful terminal run is required to resolve it.
export async function syncScheduledJobAlerts(
  source: Pick<DataSource, 'transaction'>,
): Promise<void> {
  await source.transaction(async (manager) => {
    await manager.query("SET LOCAL statement_timeout='5s'");
    const [guard] = await queryRows<{ locked: boolean }>(
      manager,
      'SELECT pg_try_advisory_xact_lock(72410,4) AS locked',
    );
    if (!guard?.locked) return;
    await manager.query(`WITH checked AS MATERIALIZED (SELECT clock_timestamp() AS at),
      jobs AS MATERIALIZED (
        SELECT value->>'name' AS name,(value->>'overdue')::boolean AS overdue,
          CASE value->>'name' WHEN 'operational_alerts' THEN 'Generación de alertas'
            WHEN 'dashboard_freshness' THEN 'Revisión de frescura'
            WHEN 'crm_reports' THEN 'Reportes comerciales'
            WHEN 'document_mail' THEN 'Envío de documentos por correo'
            WHEN 'fiscal_followup' THEN 'Seguimiento de cancelaciones fiscales'
            WHEN 'campaign_simulation' THEN 'Simulación de campañas' END AS label,
          terminal.status,terminal.finished_at
        FROM checked CROSS JOIN LATERAL jsonb_array_elements(fn_scheduled_job_status(checked.at))
        LEFT JOIN LATERAL (
          SELECT status,finished_at FROM operational_job_run
          WHERE job_name=value->>'name' AND status IN ('success','failed')
          ORDER BY started_at DESC,id DESC LIMIT 1
        ) terminal ON true
        WHERE value->>'name' IN ('operational_alerts','dashboard_freshness','crm_reports','document_mail','fiscal_followup','campaign_simulation')
      ), resolved AS (
        UPDATE app_notification n SET type='scheduled_job_recovered',severity='info',
          title=j.label || ': proceso recuperado',
          message='Una ejecución posterior terminó correctamente y el proceso está al día. Consulte el historial en Procesos automáticos.',
          read_at=coalesce(n.read_at,clock_timestamp())
        FROM jobs j WHERE n.source_type='scheduled_job'
          AND n.type IN ('scheduled_job_failed','scheduled_job_overdue')
          AND n.dedupe_key=concat('scheduled-job:',j.name,':',n.id_user)
          AND NOT j.overdue AND j.status='success' AND j.finished_at>=n.created_at
        RETURNING n.id_notification
      )
      INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,dedupe_key)
      SELECT u.id_user,
        CASE WHEN j.status='failed' THEN 'scheduled_job_failed' ELSE 'scheduled_job_overdue' END,
        j.label || CASE WHEN j.status='failed' THEN ': falló el proceso' ELSE ': ejecución atrasada' END,
        CASE WHEN j.status='failed'
          THEN 'El último intento finalizado falló. Puede faltar información de seguimiento. Revise el historial y el servicio en Procesos automáticos.'
          ELSE 'No hay éxito confirmado para la ejecución esperada después de la tolerancia. El intento pendiente no confirma recuperación. Revise Procesos automáticos.' END,
        CASE WHEN j.status='failed' THEN 'critical' ELSE 'warning' END,
        '/dashboard?procesos=1','scheduled_job',concat('scheduled-job:',j.name,':',u.id_user)
      FROM jobs j CROSS JOIN auth_user u WHERE u.is_active AND u.role='admin'
        AND (j.status='failed' OR j.overdue)
      ON CONFLICT(dedupe_key) DO UPDATE SET type=excluded.type,title=excluded.title,
        message=excluded.message,severity=excluded.severity,route=excluded.route,
        read_at=NULL,created_at=clock_timestamp()
      WHERE (app_notification.type,app_notification.title,app_notification.message,app_notification.severity,app_notification.route)
        IS DISTINCT FROM (excluded.type,excluded.title,excluded.message,excluded.severity,excluded.route)`);
  });
}
