CREATE TABLE operational_job (
  name text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO operational_job(name) VALUES ('dashboard_refresh');
CREATE TABLE operational_job_run (
  id uuid PRIMARY KEY,
  job_name text NOT NULL REFERENCES operational_job(name),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','success','failed')),
  CHECK ((status='running' AND finished_at IS NULL) OR
    (status<>'running' AND finished_at IS NOT NULL AND finished_at>=started_at))
);
CREATE INDEX idx_job_run_latest ON operational_job_run(job_name,started_at DESC);
CREATE INDEX idx_job_run_success ON operational_job_run(job_name,finished_at DESC) WHERE status='success';

CREATE FUNCTION fn_dashboard_refresh_status(p_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH local_time AS (SELECT p_now AT TIME ZONE 'America/Mexico_City' AS t),
schedule AS (SELECT ((t::date + time '02:00') -
  CASE WHEN t::time < time '02:00' THEN interval '1 day' ELSE interval '0' END)
  AT TIME ZONE 'America/Mexico_City' AS expected FROM local_time),
last_run AS (SELECT * FROM operational_job_run WHERE job_name='dashboard_refresh' ORDER BY started_at DESC,id DESC LIMIT 1),
success AS (SELECT max(finished_at) AS at FROM operational_job_run WHERE job_name='dashboard_refresh' AND status='success'),
state AS (SELECT s.expected,j.installed_at,su.at AS last_success,
  (s.expected>=j.installed_at AND p_now>=s.expected+interval '30 minutes'
    AND (su.at IS NULL OR su.at<s.expected)) AS overdue
  FROM schedule s CROSS JOIN success su JOIN operational_job j ON j.name='dashboard_refresh')
SELECT jsonb_build_object('checkedAt',p_now,'expectedAt',expected,
  'lastSuccessAt',last_success,'overdue',overdue,
  'freshness',CASE WHEN overdue THEN 'overdue' WHEN last_success>=expected THEN 'current' ELSE 'pending' END,
  'lastRun',(SELECT jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status) FROM last_run),
  'recentRuns',coalesce((SELECT jsonb_agg(r.data ORDER BY r.started_at DESC,r.id DESC) FROM
    (SELECT id,started_at,jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status) AS data
     FROM operational_job_run WHERE job_name='dashboard_refresh' ORDER BY started_at DESC,id DESC LIMIT 20) r),'[]'::jsonb))
FROM state;
$$;
