import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { queryRows } from './database/typed-query';
import { syncScheduledJobAlerts } from './scheduled-job-alerts';

export type ScheduledJobName =
  | 'operational_alerts'
  | 'dashboard_freshness'
  | 'crm_reports'
  | 'document_mail'
  | 'fiscal_followup'
  | 'campaign_simulation';
const locks: Record<ScheduledJobName, number> = {
  operational_alerts: 2,
  dashboard_freshness: 3,
  crm_reports: 5,
  document_mail: 6,
  fiscal_followup: 7,
  campaign_simulation: 8,
};

// The guard transaction owns only the lock. Run history is committed separately.
export async function runScheduledJob(
  source: DataSource,
  name: ScheduledJobName,
  work: () => Promise<void>,
  reportError: (message: string) => void,
): Promise<'success' | 'skipped'> {
  const runner = source.createQueryRunner();
  const id = randomUUID();
  let recorded = false;
  try {
    await runner.connect();
    await runner.startTransaction();
    const [result] = await queryRows<{ locked: boolean }>(
      runner,
      'SELECT pg_try_advisory_xact_lock(72410,$1) AS locked',
      [locks[name]],
    );
    if (!result.locked) return 'skipped';
    await source.query(
      "INSERT INTO operational_job_run(id,job_name,status) VALUES($1,$2,'running')",
      [id, name],
    );
    recorded = true;
    await work();
    await source.query(
      "UPDATE operational_job_run SET status='success',finished_at=clock_timestamp() WHERE id=$1 AND status='running'",
      [id],
    );
    return 'success';
  } catch (error) {
    if (recorded) {
      try {
        await source.query(
          "UPDATE operational_job_run SET status='failed',finished_at=clock_timestamp() WHERE id=$1 AND status='running'",
          [id],
        );
      } catch {
        reportError('No se pudo cerrar el registro del job programado');
      }
    }
    throw error;
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
    if (recorded) {
      try {
        await syncScheduledJobAlerts(source);
      } catch {
        reportError('No se pudieron revisar avisos de procesos automáticos');
      }
    }
  }
}

export interface ScheduledJobStatus {
  name: ScheduledJobName;
  checkedAt: string;
  expectedAt: string;
  lastSuccessAt: string | null;
  overdue: boolean;
  lastRun: ScheduledJobRun | null;
  recentRuns: ScheduledJobRun[];
}
interface ScheduledJobRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed';
}
export async function readScheduledJobStatus(source: DataSource) {
  const [row] = await queryRows<{ jobs: ScheduledJobStatus[] }>(
    source,
    'SELECT fn_scheduled_job_status() AS jobs',
  );
  return row.jobs;
}
