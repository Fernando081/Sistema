// backend/verify-outputs-health.js · O01.3a: salud de las salidas con SQL real sobre una copia aislada del respaldo
// más reciente (migraciones hasta 121). Comprueba cifras, niveles, avisos diarios sin duplicar, escalamiento a
// crítico y registro del proceso outputs_health. Elimina la copia al terminar.
// Uso: npm run test:outputs-health [-- --backup=.backups/FECHA/database.dump]
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('./db-config');
const { findPgTool, postgresEnvironment } = require('./backup');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

function latestDump() {
  const arg = process.argv.find((a) => a.startsWith('--backup='));
  const root = path.resolve(__dirname, '..', '.backups');
  if (arg) return path.resolve(arg.slice(9));
  const dirs = fs.readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n) && fs.existsSync(path.join(root, n, 'database.dump'))).sort();
  return path.join(root, dirs[dirs.length - 1], 'database.dump');
}

(async () => {
  const name = `verify_o013a_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const base = databaseConfig();
  const admin = new Client(base);
  await admin.connect();
  let ds, dump;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    const env = { ...postgresEnvironment(), PGDATABASE: name, DB_NAME: name };
    if (base.connectionString) { const url = new URL(base.connectionString); url.pathname = '/' + name; env.DATABASE_URL = url.toString(); } else delete env.DATABASE_URL;
    dump = latestDump();
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, dump], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js'), '--check'], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    check(`respaldo restaurado, db:check y migraciones hasta 121 (${path.basename(path.dirname(dump))})`, true);

    ds = new DataSource({ type: 'postgres', ...(base.connectionString ? { url: env.DATABASE_URL } : { host: base.host, port: base.port, username: base.user, password: base.password, database: name }), ssl: base.ssl });
    await ds.initialize();
    const q = (sql, params) => ds.query(sql, params);
    const [job] = await q("SELECT interval_seconds,grace_seconds FROM operational_job WHERE name='outputs_health'");
    check('121 registra outputs_health (30 min, tolerancia 15)', job && job.interval_seconds === 1800 && job.grace_seconds === 900);

    await q('UPDATE auth_user SET is_active=false');
    const admins = [];
    for (const role of ['admin', 'admin', 'user']) {
      admins.push({ role, id: (await q("INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,'x',$2,true,0) RETURNING id_user", [`o013a_${role}_${randomBytes(4).toString('hex')}`, role]))[0].id_user });
    }
    const adminIds = admins.filter((a) => a.role === 'admin').map((a) => a.id);

    delete process.env.MAIL_MODE;
    const { SaludSalidasService } = require('./dist/dashboard/salud-salidas.service');
    const svc = new SaludSalidasService(ds);
    let salud = await svc.revisar();
    const counts = (await q(`SELECT (SELECT count(*) FROM documento_salida_envio WHERE estado IN ('Pendiente','Reintento'))::int correo,
      (SELECT count(*) FROM crm_reporte_reintento WHERE estado='Pendiente')::int reportes,
      (SELECT count(*) FROM fiscal_documento WHERE estado='Cancelacion solicitada')::int fiscal, pg_database_size(current_database())::bigint base`))[0];
    check('cifras coinciden con las tablas', salud.metricas.correo.pendientes === counts.correo && salud.metricas.reportes.pendientes === counts.reportes &&
      salud.metricas.fiscal.pendientes === counts.fiscal && Math.abs(salud.metricas.almacenamiento.baseBytes - Number(counts.base)) < 5 * 1048576, JSON.stringify(counts));
    check('cinco áreas y correo desactivado por defecto', salud.areas.length === 5 && salud.metricas.correo.modo === 'desactivado');
    check('vista previa de retención con 90 días y valores numéricos', salud.metricas.retencion.dias === 90 && Object.values(salud.metricas.retencion).every((v) => typeof v === 'number'));
    const baseline = salud.areas.find((a) => a.area === 'fiscal').nivel;

    // Fixture: una cancelación que lleva días sin respuesta del SAT (sin triggers: base desechable).
    const [doc] = await q('SELECT id_documento FROM fiscal_documento ORDER BY id_documento LIMIT 1');
    let fiscalDoc = doc?.id_documento;
    if (fiscalDoc) {
      const runner = ds.createQueryRunner();
      await runner.connect();
      try {
        await runner.query('SET session_replication_role=replica');
        await runner.query("UPDATE fiscal_documento SET estado='Cancelacion solicitada',consultas_estado=15,updated_at=clock_timestamp()-interval '100 hours' WHERE id_documento=$1", [fiscalDoc]);
        await runner.query('SET session_replication_role=origin');
      } finally { await runner.release(); }
      salud = await svc.revisar();
      const fiscal = salud.areas.find((a) => a.area === 'fiscal');
      check('cancelación sin respuesta eleva Cancelaciones fiscales a revisión', baseline === 'ok' && fiscal.nivel === 'atencion' && salud.metricas.fiscal.sinRespuesta === 1 && salud.metricas.fiscal.masAntiguoHoras > 99, fiscal.mensajes.join(' '));
      check('nivel general refleja el área', salud.nivel !== 'ok');
    } else check('cancelación sin respuesta eleva Cancelaciones fiscales a revisión', false, 'la copia no tiene documentos fiscales');

    const enviados = await svc.avisar();
    const notifs = await q("SELECT id_user,severity,title,route,dedupe_key FROM app_notification WHERE source_type='outputs_health' ORDER BY id_user");
    check('un aviso por administrador activo, ninguno para otros roles', enviados === adminIds.length && notifs.length === adminIds.length && notifs.every((n) => adminIds.includes(n.id_user)), JSON.stringify(notifs.map((n) => n.id_user)));
    check('aviso de revisión con ruta al panel', notifs.every((n) => n.severity === 'warning' && n.title === 'Cancelaciones fiscales: requiere revisión' && n.route === '/dashboard?salidas=1' && /^salidas:fiscal:\d{4}-\d{2}-\d{2}:\d+$/.test(n.dedupe_key)));
    await q("UPDATE app_notification SET read_at=clock_timestamp() WHERE source_type='outputs_health'");
    check('repetir la revisión el mismo día no duplica ni reabre avisos', (await svc.avisar()) === 0 &&
      (await q("SELECT count(*)::int n FROM app_notification WHERE source_type='outputs_health' AND read_at IS NULL"))[0].n === 0);

    // Escalamiento: el mismo día pasa a crítico; se actualiza el aviso existente y vuelve a quedar sin leer.
    const real = svc.revisar.bind(svc);
    svc.revisar = async () => { const r = await real(); r.areas = r.areas.map((a) => (a.area === 'fiscal' ? { ...a, nivel: 'critico', mensajes: ['Prueba de escalamiento.'] } : a)); return r; };
    const escalados = await svc.avisar();
    const after = await q("SELECT severity,read_at,message,title FROM app_notification WHERE source_type='outputs_health' AND dedupe_key LIKE 'salidas:fiscal:%'");
    check('al empeorar a crítico se actualiza y reabre el aviso del día', escalados === adminIds.length && after.length === adminIds.length && after.every((n) => n.severity === 'critical' && n.read_at === null && n.message === 'Prueba de escalamiento.'));
    check('un aviso crítico no se repite en la misma jornada', (await svc.avisar()) === 0);
    svc.revisar = real;

    const outcome = await svc.programado();
    const runs = await q("SELECT status FROM operational_job_run WHERE job_name='outputs_health'");
    check('el proceso programado registra su ejecución', outcome === 'success' && runs.length === 1 && runs[0].status === 'success', `${outcome} ${JSON.stringify(runs)}`);
    const [status] = await q('SELECT fn_scheduled_job_status(clock_timestamp()) s');
    check('aparece en el estado de procesos automáticos', status.s.some((j) => j.name === 'outputs_health'));
    const { syncScheduledJobAlerts } = require('./dist/common/scheduled-job-alerts');
    await syncScheduledJobAlerts(ds);
    check('el sincronizador de avisos de procesos acepta outputs_health', true);

    process.env.OPERACION_COLA_MAX = '10';
    process.env.MAIL_MODE = 'smtp';
    salud = await svc.revisar();
    check('umbrales y modo de correo se leen del entorno', salud.umbrales.colaMax === 10 && salud.metricas.correo.modo === 'desactivado', 'smtp sin datos válidos queda desactivado');
  } catch (error) {
    check('ejecución sin errores', false, error.stack || error.message);
  } finally {
    if (ds?.isInitialized) await ds.destroy();
    try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); check('copia aislada eliminada', true); } catch (e) { check('copia aislada eliminada', false, e.message); }
    await admin.end();
    const report = { id: 'O01.3a', fecha: new Date().toISOString(), respaldo: dump ? path.basename(path.dirname(dump)) : null, total: results.length, aprobadas: results.filter((r) => r.ok).length, resultados: results };
    fs.mkdirSync(path.resolve(__dirname, '..', '.artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '..', '.artifacts', 'o013a-salud-salidas.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.aprobadas}/${report.total} comprobaciones. Reporte: .artifacts/o013a-salud-salidas.json`);
    if (report.aprobadas !== report.total) process.exitCode = 1;
  }
})();
