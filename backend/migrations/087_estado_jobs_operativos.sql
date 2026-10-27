ALTER TABLE operational_job ADD COLUMN interval_seconds integer CHECK(interval_seconds>0);
ALTER TABLE operational_job ADD COLUMN grace_seconds integer NOT NULL DEFAULT 0 CHECK(grace_seconds>=0);
INSERT INTO operational_job(name,interval_seconds,grace_seconds)
VALUES ('operational_alerts',600,300),('dashboard_freshness',600,300);

CREATE FUNCTION fn_scheduled_job_status(p_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT coalesce(jsonb_agg(data ORDER BY name),'[]'::jsonb) FROM (
  SELECT j.name,jsonb_build_object(
    'name',j.name,'checkedAt',p_now,'expectedAt',s.expected,
    'lastSuccessAt',success.at,'overdue',
      s.expected>=j.installed_at AND p_now>=s.expected+make_interval(secs=>j.grace_seconds)
        AND (success.at IS NULL OR success.at<s.expected),
    'lastRun',(SELECT jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status)
      FROM operational_job_run WHERE job_name=j.name ORDER BY started_at DESC,id DESC LIMIT 1),
    'recentRuns',coalesce((SELECT jsonb_agg(r.data ORDER BY r.started_at DESC,r.id DESC) FROM
      (SELECT id,started_at,jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status) AS data
       FROM operational_job_run WHERE job_name=j.name ORDER BY started_at DESC,id DESC LIMIT 20) r),'[]'::jsonb)
  ) AS data FROM operational_job j
  CROSS JOIN LATERAL (SELECT to_timestamp(floor(extract(epoch FROM p_now)/j.interval_seconds)*j.interval_seconds) AS expected) s
  CROSS JOIN LATERAL (SELECT max(finished_at) AS at FROM operational_job_run WHERE job_name=j.name AND status='success') success
  WHERE j.interval_seconds IS NOT NULL
) rows;
$$;
