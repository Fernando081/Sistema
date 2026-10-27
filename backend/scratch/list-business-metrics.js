const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
async function osProcesses(pids) {
  assert.ok(pids.every((x) => Number.isInteger(x) && x > 0));
  if (process.platform !== 'win32')
    return { available: false, reason: 'Herramienta Windows' };
  if (!pids.length) return { available: true, rows: [] };
  try {
    const filter = pids.map((id) => 'ProcessId = ' + id).join(' OR ');
    const command = `$rows=@(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,ReadTransferCount,WriteTransferCount); ConvertTo-Json -InputObject $rows -Compress`;
    const output = await new Promise((resolve, reject) =>
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true, timeout: 10000, encoding: 'utf8' },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    const parsed = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (
      rows.some((r) =>
        [
          'KernelModeTime',
          'UserModeTime',
          'ReadTransferCount',
          'WriteTransferCount',
          'WorkingSetSize',
        ].some((key) => r[key] == null || !Number.isFinite(Number(r[key]))),
      )
    )
      return {
        available: false,
        reason: 'Contadores de proceso no disponibles',
      };
    return { available: true, rows };
  } catch {
    return {
      available: false,
      reason: 'No se pudieron leer contadores de Windows',
    };
  }
}
async function businessMetrics(client, name) {
  assert.match(name, /^sistema_http_\d+_[a-f0-9]{6}$/);
  assert.equal(
    (await client.query('SELECT current_database() name')).rows[0].name,
    name,
  );
  await client.query('SELECT pg_stat_clear_snapshot()');
  const tables = (
    await client.query(
      `SELECT coalesce(sum(n_dead_tup),0)::float8 "deadTuples",coalesce(sum(autovacuum_count),0)::float8 "autovacuumCount",coalesce(sum(n_live_tup),0)::float8 "liveTuples" FROM pg_stat_user_tables WHERE schemaname='public'`,
    )
  ).rows[0];
  const pids = (
    await client.query('SELECT pid FROM pg_stat_activity WHERE datname=$1', [
      name,
    ])
  ).rows.map((x) => x.pid);
  const wal = (await client.query('SELECT pg_current_wal_lsn() lsn')).rows[0]
    .lsn;
  return { tables, os: await osProcesses(pids), wal };
}
function tracker() {
  const previous = new Map();
  const result = {
    samples: 0,
    availableSamples: 0,
    unavailableSamples: 0,
    workingSetSumPeakBytes: 0,
    cpuMillisecondsDelta: 0,
    readTransferBytesDelta: 0,
    writeTransferBytesDelta: 0,
    maxDeadTuples: 0,
    maxLiveTuples: 0,
    autovacuumCountPeak: 0,
  };
  return {
    result,
    add(sample) {
      result.samples++;
      result.maxDeadTuples = Math.max(
        result.maxDeadTuples,
        sample.tables.deadTuples,
      );
      result.maxLiveTuples = Math.max(
        result.maxLiveTuples,
        sample.tables.liveTuples,
      );
      result.autovacuumCountPeak = Math.max(
        result.autovacuumCountPeak,
        sample.tables.autovacuumCount,
      );
      if (!sample.os.available) {
        result.unavailableSamples++;
        return;
      }
      result.availableSamples++;
      let rss = 0;
      for (const row of sample.os.rows) {
        rss += Number(row.WorkingSetSize);
        const key = row.ProcessId + ':' + row.CreationDate;
        const current = {
          cpu: (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 10000,
          read: Number(row.ReadTransferCount),
          write: Number(row.WriteTransferCount),
        };
        const old = previous.get(key);
        if (old) {
          result.cpuMillisecondsDelta += Math.max(0, current.cpu - old.cpu);
          result.readTransferBytesDelta += Math.max(0, current.read - old.read);
          result.writeTransferBytesDelta += Math.max(
            0,
            current.write - old.write,
          );
        }
        previous.set(key, current);
      }
      result.workingSetSumPeakBytes = Math.max(
        result.workingSetSumPeakBytes,
        rss,
      );
    },
  };
}
module.exports = { businessMetrics, tracker };
