// backend/verify-supplier-adjustment.js · F02a: propuesta de ajuste de Proveedores (compras de contado sin pago
// contable) con SQL real sobre una copia aislada del respaldo más reciente. Comprueba la detección, la póliza en
// Borrador, la exclusividad ante dos solicitudes simultáneas y que F03 deja de reportar la diferencia sólo después
// de contabilizarla. Elimina la copia al terminar. Uso: npm run test:supplier-adjustment [-- --backup=...]
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
const rejects = async (fn, pattern) => { try { await fn(); return false; } catch (e) { return pattern.test(e.message) || e.message; } };

function latestDump() {
  const arg = process.argv.find((a) => a.startsWith('--backup='));
  const root = path.resolve(__dirname, '..', '.backups');
  if (arg) return path.resolve(arg.slice(9));
  const dirs = fs.readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n) && fs.existsSync(path.join(root, n, 'database.dump'))).sort();
  return path.join(root, dirs[dirs.length - 1], 'database.dump');
}

(async () => {
  const name = `verify_f02a_${Date.now()}_${randomBytes(3).toString('hex')}`;
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
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    check(`copia aislada restaurada y migrada (${path.basename(path.dirname(dump))})`, true);
    ds = new DataSource({ type: 'postgres', ...(base.connectionString ? { url: env.DATABASE_URL } : { host: base.host, port: base.port, username: base.user, password: base.password, database: name }), ssl: base.ssl, extra: { max: 6 } });
    await ds.initialize();
    const q = (sql, params) => ds.query(sql, params);
    const { AjusteProveedoresService } = require('./dist/finanzas/ajuste-proveedores.service');
    const { DpoContableService } = require('./dist/finanzas/dpo-contable.service');
    const { ContabilidadService } = require('./dist/finanzas/contabilidad.service');
    const svc = new AjusteProveedoresService(ds);
    const dpo = new DpoContableService(ds);
    const conta = new ContabilidadService(ds);

    const before = await dpo.calcular();
    const p0 = await svc.propuesta();
    const ids = p0.compras.map((c) => c.idCompra);
    check('detecta las compras de contado sin pago y su abono a Proveedores', p0.compras.length > 0 && p0.ajustes.length === 0 && p0.compras.every((c) => c.abonoProveedores > 0 && c.folioPoliza),
      `${p0.compras.length} compras, ${p0.total.toFixed(2)}`);
    const causa = before.conciliacionProveedores;
    check('la propuesta coincide con la diferencia explicada de F03', causa.aplica && causa.diferenciaExplicada && Math.abs(causa.diferencia - p0.total) < 0.01, `F03 ${causa.diferencia} · propuesta ${p0.total}`);

    const [caja] = await q("SELECT id_cuenta FROM cuenta_contable WHERE codigo='1100'");
    const [prov] = await q("SELECT id_cuenta FROM cuenta_contable WHERE codigo='2100'");
    const [agrupadora] = await q('SELECT id_cuenta FROM cuenta_contable WHERE NOT acepta_movimientos LIMIT 1');
    const today = before.periodo.fin; // fecha de negocio (México), la misma con la que corta F03
    const dto = (extra = {}) => ({ fecha: today, idCuentaContrapartida: caja.id_cuenta, motivo: 'Verificación aislada F02a', compras: ids, ...extra });
    check('rechaza Proveedores como contrapartida', await rejects(() => svc.crear(dto({ idCuentaContrapartida: prov.id_cuenta })), /no puede ser Proveedores/));
    check('rechaza una cuenta que no acepta movimientos', await rejects(() => svc.crear(dto({ idCuentaContrapartida: agrupadora.id_cuenta })), /no acepta movimientos/));
    check('rechaza una compra que no está en la propuesta', await rejects(() => svc.crear(dto({ compras: [...ids, 999999] })), /999999/));
    check('una solicitud rechazada no deja pólizas', (await svc.propuesta()).ajustes.length === 0);

    // Dos solicitudes simultáneas por las mismas compras: sólo una crea la póliza.
    const outcomes = await Promise.allSettled([svc.crear(dto()), svc.crear(dto())]);
    const ok = outcomes.filter((o) => o.status === 'fulfilled');
    const conflict = outcomes.filter((o) => o.status === 'rejected' && /ya tienen ajuste/.test(o.reason.message));
    check('dos solicitudes simultáneas: una póliza y un conflicto', ok.length === 1 && conflict.length === 1, outcomes.map((o) => o.status).join(','));
    const creada = ok[0]?.value;
    const lines = await q('SELECT d.debe::float AS debe, d.haber::float AS haber, d.referencia, c.codigo FROM poliza_contable_detalle d JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta WHERE id_poliza=$1 ORDER BY id_detalle', [creada.idPoliza]);
    const [head] = await q('SELECT estado, automatica, tipo, concepto FROM poliza_contable WHERE id_poliza=$1', [creada.idPoliza]);
    const debe = lines.reduce((s, l) => s + l.debe, 0), haber = lines.reduce((s, l) => s + l.haber, 0);
    check('póliza manual en Borrador, cuadrada, un cargo a 2100 por compra y un abono a Caja', head.estado === 'Borrador' && !head.automatica && head.tipo === 'Diario' &&
      lines.length === ids.length + 1 && lines.slice(0, -1).every((l) => l.codigo === '2100' && l.debe > 0 && /^F02:compra:\d+$/.test(l.referencia)) &&
      lines.at(-1).codigo === '1100' && Math.abs(debe - haber) < 0.005 && Math.abs(debe - p0.total) < 0.005, `${head.concepto}`);

    const p1 = await svc.propuesta();
    check('la propuesta ya no ofrece las compras y muestra el ajuste en Borrador', p1.compras.length === 0 && p1.ajustes.length === 1 && p1.ajustes[0].estado === 'Borrador' && p1.ajustes[0].compras.length === ids.length);
    const draft = (await dpo.calcular()).conciliacionProveedores;
    check('mientras siga en Borrador, F03 conserva la diferencia', Math.abs(draft.diferencia - causa.diferencia) < 0.01 && draft.diferenciaExplicada);

    await conta.contabilizarPoliza(creada.idPoliza);
    const after = (await dpo.calcular()).conciliacionProveedores;
    check('al contabilizarla, el mayor de Proveedores cuadra con el auxiliar', Math.abs(after.diferencia) < 0.01 && Math.abs(after.mayor - (causa.mayor - p0.total)) < 0.01 && !after.causas.some((c) => /de contado/.test(c)),
      `mayor ${after.mayor} · auxiliar ${after.auxiliar} · diferencia ${after.diferencia}`);
    check('después de contabilizar no se puede volver a proponer', await rejects(() => svc.crear(dto()), /ya tienen ajuste/));
    check('el ajuste queda como póliza manual normal (sin origen automático)', (await q('SELECT origen_tipo FROM poliza_contable WHERE id_poliza=$1', [creada.idPoliza]))[0].origen_tipo === null);
  } catch (error) {
    check('ejecución sin errores', false, error.stack || error.message);
  } finally {
    if (ds?.isInitialized) await ds.destroy();
    try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); check('copia aislada eliminada', true); } catch (e) { check('copia aislada eliminada', false, e.message); }
    await admin.end();
    const report = { id: 'F02a', fecha: new Date().toISOString(), respaldo: dump ? path.basename(path.dirname(dump)) : null, total: results.length, aprobadas: results.filter((r) => r.ok).length, resultados: results };
    fs.mkdirSync(path.resolve(__dirname, '..', '.artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '..', '.artifacts', 'f02a-ajuste-proveedores.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.aprobadas}/${report.total} comprobaciones. Reporte: .artifacts/f02a-ajuste-proveedores.json`);
    if (report.aprobadas !== report.total) process.exitCode = 1;
  }
})();
