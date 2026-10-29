// backend/verify-pac-campaigns.js · O01.2c: seguimiento de cancelaciones fiscales (PAC mock) y simulación de campañas,
// con AppModule/PostgreSQL/HTTP reales sobre una copia aislada del respaldo más reciente. Nada sale del equipo.
// Uso: npm run test:pac-campaigns [-- --backup=.backups/FECHA/database.dump]
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { Test } = require('@nestjs/testing');
const { SchedulerRegistry } = require('@nestjs/schedule');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('./db-config');
const { findPgTool, postgresEnvironment } = require('./backup');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + detail}`); };
const expectError = async (fn, pattern) => { try { await fn(); return 'sin error'; } catch (e) { return pattern.test(e.message) ? true : e.message; } };

function latestDump() {
  const arg = process.argv.find((a) => a.startsWith('--backup='));
  const root = path.resolve(__dirname, '..', '.backups');
  if (arg) return path.resolve(arg.slice(9));
  const dirs = fs.readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n) && fs.existsSync(path.join(root, n, 'database.dump'))).sort();
  return path.join(root, dirs[dirs.length - 1], 'database.dump');
}

(async () => {
  const name = `verify_o012c_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const base = databaseConfig();
  const admin = new Client(base);
  await admin.connect();
  let app, writer;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    const env = { ...postgresEnvironment(), PGDATABASE: name, DB_NAME: name };
    const url = base.connectionString ? new URL(base.connectionString) : new URL(`postgres://${encodeURIComponent(base.user)}:${encodeURIComponent(base.password ?? '')}@${base.host}:${base.port}/`);
    url.pathname = '/' + name; env.DATABASE_URL = url.toString();
    const dump = latestDump();
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, dump], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js'), '--check'], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    check(`respaldo restaurado, db:check y migración 120 en base aislada (${path.basename(path.dirname(dump))})`, true);

    writer = new Client({ connectionString: env.DATABASE_URL, ssl: base.ssl });
    writer.on('error', () => undefined);
    await writer.connect();
    await writer.query('UPDATE auth_user SET is_active=false');
    const { AuthService } = require('./dist/auth/auth.service');
    const password = randomBytes(24).toString('hex'), hash = await AuthService.hashPassword(password);
    const names = ['o012c_admin_', 'o012c_user_'].map((n) => n + randomBytes(4).toString('hex'));
    const users = [];
    for (const [i, n] of names.entries()) users.push((await writer.query('INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,$3,true,0) RETURNING id_user', [n, hash, i ? 'user' : 'admin'])).rows[0].id_user);
    Object.assign(process.env, { DATABASE_URL: env.DATABASE_URL, DB_NAME: name, NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'), AUTH_MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      ALLOW_ENV_AUTH: 'false', FISCAL_MODE: 'mock', FISCAL_MOCK_CANCELACION: 'pendiente', MAIL_MODE: 'desactivado', WEB_LEAD_BRIDGE_ENABLED: 'false', WEB_INBOX_PURGE_ENABLED: 'false' });
    const module = await Test.createTestingModule({ imports: [require('./dist/app.module').AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    require('./dist/configure-app').configureApp(app);
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    const ds = app.get(DataSource);
    check('AppModule conectado a la copia aislada', (await ds.query('SELECT current_database() AS n'))[0].n === name);
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl(), auth = app.get(AuthService);
    const tokens = await Promise.all(names.map(async (n) => (await auth.login(n, password)).access_token));
    const actor = auth.verify(tokens[0]);
    const call = async (route, method = 'GET', body, token = tokens[0]) => {
      const r = await fetch(api + '/api/v1/' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      return { status: r.status, data: await r.json().catch(() => null), cache: r.headers.get('cache-control') };
    };

    // ---------------- 1 · Seguimiento de cancelaciones fiscales ----------------
    const { FiscalService } = require('./dist/fiscal/fiscal.service');
    const { FISCAL_PROVIDER } = require('./dist/fiscal/fiscal.types');
    const { ReversionVentaService } = require('./dist/venta/reversion-venta.service');
    const { SeguimientoFiscalService } = require('./dist/fiscal-seguimiento/seguimiento-fiscal.service');
    const fiscal = app.get(FiscalService), provider = app.get(FISCAL_PROVIDER), reversion = app.get(ReversionVentaService), seguimiento = app.get(SeguimientoFiscalService);
    const candidatas = (await ds.query(`SELECT f.id_factura AS id FROM factura f LEFT JOIN fiscal_documento d ON d.id_factura=f.id_factura
       WHERE f.estatus::text='Pendiente' AND d.id_documento IS NULL AND f.id_factura_global IS NULL AND f.id_factura_origen IS NULL
         AND NOT EXISTS(SELECT 1 FROM factura nc WHERE nc.id_factura_origen=f.id_factura)
         AND NOT EXISTS(SELECT 1 FROM devolucion dv WHERE dv.id_factura=f.id_factura)
         AND NOT EXISTS(SELECT 1 FROM rep_factura rf WHERE rf.id_factura=f.id_factura) ORDER BY f.id_factura DESC LIMIT 12`)).map((r) => r.id);
    const timbradas = [];
    for (const id of candidatas) { if (timbradas.length === 4) break; try { await fiscal.stamp('FACTURA', id, actor.idUser); timbradas.push(id); } catch { /* datos incompletos para XML: se prueba otra */ } }
    if (timbradas.length < 4) throw new Error(`Se necesitan 4 facturas timbrables en mock; hubo ${timbradas.length}`);
    const doc = async (id) => (await ds.query(`SELECT id_documento AS id,estado,proxima_consulta,consultas_estado,ultimo_error FROM fiscal_documento WHERE id_factura=$1`, [id]))[0];
    const factura = async (id) => (await ds.query(`SELECT estatus::text AS estatus FROM factura WHERE id_factura=$1`, [id]))[0].estatus;
    const eventos = async (docId) => (await ds.query(`SELECT tipo,exito,detalle FROM fiscal_evento WHERE id_documento=$1 ORDER BY id_evento`, [docId]));
    const vencer = (docId) => ds.query(`UPDATE fiscal_documento SET proxima_consulta=clock_timestamp()-interval '1 second' WHERE id_documento=$1`, [docId]);
    const avisos = async (docId) => ds.query(`SELECT id_user,severity,title FROM app_notification WHERE source_type='fiscal_documento' AND source_id=$1`, [docId]);

    const [f1, f2, f3, f4] = timbradas;
    const r1 = await reversion.cancelarFactura(f1, actor.idUser, { motivo: '02' });
    const d1 = await doc(f1);
    check('cancelación pendiente del SAT: no revierte y programa la consulta en ~15 min',
      !r1.cancelled && d1.estado === 'Cancelacion solicitada' && (await factura(f1)) === 'Pendiente' && d1.consultas_estado === 0
      && Math.abs(new Date(d1.proxima_consulta).getTime() - Date.now() - 15 * 60000) < 120000, JSON.stringify(d1));
    let res = await seguimiento.procesar();
    check('antes de su hora no se consulta', res.consultados === 0 && (await doc(f1)).estado === 'Cancelacion solicitada', JSON.stringify(res));
    await vencer(d1.id);
    res = await seguimiento.procesar();
    const ev1 = await eventos(d1.id);
    check('SAT confirma → estado Cancelado y la factura se revierte automáticamente',
      res.cancelados === 1 && res.revertidos === 1 && (await doc(f1)).estado === 'Cancelado' && (await factura(f1)) === 'Cancelada' && (await doc(f1)).proxima_consulta === null, JSON.stringify(res));
    check('bitácora fiscal marca la conciliación como automática', ev1.some((e) => e.tipo === 'ESTADO_CONCILIADO' && e.exito && e.detalle.automatico === true));
    const a1 = await avisos(d1.id);
    check('avisa a quien pidió la cancelación (info)', a1.length === 1 && a1[0].id_user === actor.idUser && a1[0].severity === 'info', JSON.stringify(a1));
    res = await seguimiento.procesar();
    check('un segundo ciclo no vuelve a consultar ni revertir', res.consultados === 0 && (await avisos(d1.id)).length === 1);

    provider.cancellation = 'rechazada';
    await reversion.cancelarFactura(f2, actor.idUser, { motivo: '02' });
    const d2 = await doc(f2); await vencer(d2.id);
    res = await seguimiento.procesar();
    const a2 = await avisos(d2.id);
    check('receptor rechaza → CFDI vuelve a Timbrado, la factura no cambia y se avisa (warning)',
      res.rechazados === 1 && (await doc(f2)).estado === 'Timbrado' && (await factura(f2)) === 'Pendiente'
      && (await eventos(d2.id)).some((e) => e.tipo === 'CANCELACION_RECHAZADA') && a2.length === 1 && a2[0].severity === 'warning', JSON.stringify(res));

    provider.cancellation = 'pendiente';
    await reversion.cancelarFactura(f3, actor.idUser, { motivo: '02' });
    const d3 = await doc(f3);
    const original = provider.queryStatus.bind(provider);
    provider.queryStatus = () => Promise.reject(new Error('Servicio SAT no disponible (simulado)'));
    await vencer(d3.id);
    res = await seguimiento.procesar();
    const d3b = await doc(f3);
    check('falla de consulta → sigue pendiente, cuenta el intento y reprograma (sin revertir)',
      d3b.estado === 'Cancelacion solicitada' && d3b.consultas_estado === 1 && new Date(d3b.proxima_consulta) > new Date() && (await factura(f3)) === 'Pendiente'
      && (await eventos(d3.id)).some((e) => e.tipo === 'CONSULTA_ERROR' && !e.exito), JSON.stringify(d3b));
    provider.queryStatus = original;
    const manual = await reversion.cancelarFactura(f3, actor.idUser, { motivo: '02' });
    const sinProgramar = (await doc(f3)).proxima_consulta === null;
    await vencer(d3.id);
    res = await seguimiento.procesar();
    check('si el usuario concilia a mano primero, el proceso no repite la reversión', manual.cancelled && sinProgramar && (await factura(f3)) === 'Cancelada' && res.consultados === 0);

    await ds.query(`UPDATE fiscal_documento SET estado='Procesando',ultimo_error=NULL,updated_at=clock_timestamp()-interval '20 minutes' WHERE id_factura=$1`, [f4]);
    const d4 = await doc(f4);
    res = await seguimiento.procesar();
    check('timbrado interrumpido (>15 min sin respuesta) queda en Error con mensaje y evento', res.interrumpidos === 1 && (await doc(f4)).estado === 'Error'
      && /interrumpió/.test((await doc(f4)).ultimo_error) && (await eventos(d4.id)).some((e) => e.tipo === 'TIMBRADO_INTERRUMPIDO'));
    const reintento = await fiscal.stamp('FACTURA', f4, actor.idUser);
    check('el documento interrumpido se vuelve a timbrar con la misma solicitud', reintento.estado === 'Timbrado');
    check('proceso automático fiscal_followup registra su ejecución', (await seguimiento.programado()) === 'success'
      && (await ds.query(`SELECT 1 FROM operational_job_run WHERE job_name='fiscal_followup' AND status='success'`)).length === 1);

    // ---------------- 2 · Simulación de campañas ----------------
    const { CampanaConsentimientoService } = require('./dist/crm/campana-consentimiento.service');
    const { CampanaEjecucionEjecutor } = require('./dist/crm/campana-ejecucion.ejecutor');
    const policy = require('./dist/crm/campana-consentimiento-policy');
    const consent = app.get(CampanaConsentimientoService), ejecutor = app.get(CampanaEjecucionEjecutor);
    // Cohorte sintética aislada: el tipo de cliente es una lista cerrada; se retira de las oportunidades del respaldo.
    const tipo = 'Transportista';
    await writer.query(`UPDATE crm_oportunidad SET tipo_cliente='Otro' WHERE tipo_cliente=$1`, [tipo]);
    const clientes = [];
    for (const rs of ['Cliente O012c Alfa', 'Cliente O012c Beta']) {
      const id = (await writer.query(`INSERT INTO cliente("RFC","RazonSocial","Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI")
        SELECT $1,$2,"Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI" FROM cliente ORDER BY "IdCliente" LIMIT 1 RETURNING "IdCliente" AS id`, ['OCC' + randomBytes(3).toString('hex').toUpperCase() + 'AA1', rs])).rows[0].id;
      await writer.query(`INSERT INTO crm_oportunidad(id_cliente,empresa,tipo_cliente,etapa,monto_estimado) VALUES($1,$2,$3,'Prospecto',0)`, [id, rs, tipo]);
      clientes.push(id);
    }
    const contacto = async (cliente, nombre, email) => (await writer.query(`INSERT INTO cliente_contacto(id_cliente,nombre,email) VALUES($1,$2,$3) RETURNING id_contacto`, [cliente, nombre, email])).rows[0].id_contacto;
    const c = { ana: await contacto(clientes[0], 'Ana', 'ana@example.test'), beto: await contacto(clientes[0], 'Beto', 'beto@example.test'), carla: await contacto(clientes[1], 'Carla', 'carla@example.test'),
      dani: await contacto(clientes[1], 'Dani', 'dani@example.test'), eli: await contacto(clientes[1], 'Eli sin permiso', 'eli@example.test') };
    const decidir = async (cliente, idContacto, email, estado, version) => consent.consent(cliente, idContacto, { requestId: randomUUID(), canal: 'Correo', estado, versionAnterior: version,
      destinoHuella: policy.destinationHash('Correo', email), ocurridaEn: new Date(Date.now() - 60000).toISOString(), fuente: 'Documento', referencia: 'Verificación O01.2c', motivo: 'Fixture local', confirmacion: true }, actor);
    await decidir(clientes[0], c.ana, 'ana@example.test', 'Autorizado', 0);
    await decidir(clientes[0], c.beto, 'beto@example.test', 'Autorizado', 0);
    await decidir(clientes[1], c.carla, 'carla@example.test', 'Autorizado', 0);
    await decidir(clientes[1], c.dani, 'dani@example.test', 'Autorizado', 0);
    const segmento = (await writer.query(`INSERT INTO crm_segmento(nombre,tipo_cliente) VALUES($1,$2) RETURNING id_segmento`, ['Segmento O01.2c ' + randomBytes(3).toString('hex'), tipo])).rows[0].id_segmento;
    const plantilla = (await writer.query(`INSERT INTO crm_plantilla(nombre,canal,asunto,contenido) VALUES('Plantilla O01.2c','Correo','Hola {{nombre}}','Promoción para {{cliente}}') RETURNING id_plantilla`)).rows[0].id_plantilla;
    const campana = (await writer.query(`INSERT INTO crm_campana(nombre,id_segmento,id_plantilla,objetivo) VALUES($1,$2,$3,'Simulación local') RETURNING id_campana`, ['Campaña O01.2c ' + randomBytes(3).toString('hex'), segmento, plantilla])).rows[0].id_campana;
    const ep = 'crm/campanas-locales/' + campana;
    const preparar = async () => {
      const p = (await call(ep + '/destinatarios')).data;
      const r = await call(ep + '/preparar', 'POST', { requestId: randomUUID(), evaluacionSha256: p.evaluacionSha256, motivo: 'Preparación O01.2c', confirmacion: true });
      return { p, r };
    };
    const { p: pv, r: prep } = await preparar();
    check('fixture: 4 elegibles y 1 sin autorización; preparación conservada', pv.metricas.elegibles === 4 && pv.metricas.motivos['Sin autorización'] === 1 && prep.status === 201, JSON.stringify(pv.metricas));

    const cuerpo = (extra = {}) => ({ requestId: randomUUID(), idPreparacion: prep.data.id, motivo: 'Simulación de prueba', confirmacion: true, ...extra });
    const sinToken = await call(ep + '/ejecuciones', 'POST', cuerpo(), null);
    const sinPermiso = await call(ep + '/ejecuciones', 'POST', cuerpo(), tokens[1]);
    const sinConfirmar = await call(ep + '/ejecuciones', 'POST', cuerpo({ confirmacion: false }));
    const otraPrep = await call(ep + '/ejecuciones', 'POST', cuerpo({ idPreparacion: prep.data.id + 999 }));
    check('permisos y validación: 401 sin sesión, 403 sin permiso, 400 sin confirmar, 409 con otra preparación',
      sinToken.status === 401 && sinPermiso.status === 403 && sinConfirmar.status === 400 && otraPrep.status === 409, [sinToken.status, sinPermiso.status, sinConfirmar.status, otraPrep.status].join(','));
    const body = cuerpo();
    const inicio = await call(ep + '/ejecuciones', 'POST', body);
    const repetida = await call(ep + '/ejecuciones', 'POST', body);
    const otroCuerpo = await call(ep + '/ejecuciones', 'POST', { ...body, motivo: 'Otro motivo' });
    const segunda = await call(ep + '/ejecuciones', 'POST', cuerpo());
    check('inicia con 4 destinatarios; reintento idempotente; mismo UUID con otro contenido 409; una sola en curso',
      inicio.status === 201 && inicio.data.destinatarios === 4 && repetida.data.id === inicio.data.id && repetida.data.repetida && otroCuerpo.status === 409 && segunda.status === 409 && inicio.cache === 'private, no-store',
      JSON.stringify([inicio.status, inicio.data, repetida.data, otroCuerpo.status, segunda.status]));
    const idEj = inicio.data.id;

    // Cambios después de iniciar: el proceso debe revalidar al momento de procesar.
    await decidir(clientes[1], c.carla, 'carla@example.test', 'Baja', 1);
    await writer.query(`UPDATE cliente_contacto SET email='dani.nuevo@example.test' WHERE id_contacto=$1`, [c.dani]);
    const salidasAntes = (await ds.query('SELECT count(*)::int n FROM documento_salida'))[0].n;
    const corrida = await ejecutor.programado();
    const destinos = await ds.query(`SELECT id_contacto,estado,motivo,mensaje_sha256 FROM crm_campana_ejecucion_destino WHERE id_ejecucion=$1`, [idEj]);
    const de = (id) => destinos.find((d) => d.id_contacto === id);
    check('proceso automático: Ana y Beto simulados con huella del mensaje personalizado', corrida === 'success'
      && de(c.ana).estado === 'Simulado' && de(c.beto).estado === 'Simulado' && /^[a-f0-9]{64}$/.test(de(c.ana).mensaje_sha256) && de(c.ana).mensaje_sha256 !== de(c.beto).mensaje_sha256, JSON.stringify(destinos));
    check('baja registrada después de iniciar → Omitido "Baja"', de(c.carla).estado === 'Omitido' && de(c.carla).motivo === 'Baja');
    check('correo cambiado después de iniciar → Omitido "Destino cambiado"', de(c.dani).estado === 'Omitido' && de(c.dani).motivo === 'Destino cambiado');
    const ej = (await ds.query(`SELECT estado,terminada_en FROM crm_campana_ejecucion WHERE id_ejecucion=$1`, [idEj]))[0];
    check('la simulación termina sola y nada se envía (sin documentos de salida nuevos)', ej.estado === 'Terminada' && ej.terminada_en
      && (await ds.query('SELECT count(*)::int n FROM documento_salida'))[0].n === salidasAntes
      && (await ds.query(`SELECT 1 FROM operational_job_run WHERE job_name='campaign_simulation' AND status='success'`)).length >= 1);
    check('el texto y el destino no se guardan, sólo huellas', !Object.keys(destinos[0]).some((k) => /email|destino$|contenido|texto/.test(k)));

    check('BD: un destinatario procesado no se reescribe', true === await expectError(() => ds.query(`UPDATE crm_campana_ejecucion_destino SET estado='Simulado',mensaje_sha256=$2 WHERE id_ejecucion=$1 AND id_contacto=$3`, [idEj, 'a'.repeat(64), c.carla]), /ya fue procesado/));
    check('BD: no se borran ejecuciones ni se reabren', true === await expectError(() => ds.query(`DELETE FROM crm_campana_ejecucion WHERE id_ejecucion=$1`, [idEj]), /se conservan/)
      && true === await expectError(() => ds.query(`UPDATE crm_campana_ejecucion SET estado='En curso',terminada_en=NULL WHERE id_ejecucion=$1`, [idEj]), /ya terminó/));
    check('BD: sólo existe el modo Simulación', true === await expectError(() => ds.query(`INSERT INTO crm_campana_ejecucion(id_campana,id_preparacion,request_id,huella,modo,canal,plantilla_sha256,motivo,id_user)
      VALUES($1,$2,$3,$4,'Correo','Correo',$4,'x',$5)`, [campana, prep.data.id, randomUUID(), 'b'.repeat(64), actor.idUser]), /check/i));

    // La baja cambió la evaluación: la preparación vieja ya no sirve.
    const vieja = await call(ep + '/ejecuciones', 'POST', cuerpo());
    check('con la preparación desactualizada no se puede iniciar (409)', vieja.status === 409 && /ya no coincide/.test(vieja.data.message), JSON.stringify(vieja.data));
    const { r: prep2 } = await preparar();
    const inicio2 = await call(ep + '/ejecuciones', 'POST', { requestId: randomUUID(), idPreparacion: prep2.data.id, motivo: 'Para cancelar', confirmacion: true });
    const cancelar = await call(`${ep}/ejecuciones/${inicio2.data.id}/cancelar`, 'POST', { motivo: 'Prueba de cancelación', confirmacion: true });
    const cancelar2 = await call(`${ep}/ejecuciones/${inicio2.data.id}/cancelar`, 'POST', { motivo: 'Otra vez', confirmacion: true });
    const est2 = await ds.query(`SELECT estado,motivo FROM crm_campana_ejecucion_destino WHERE id_ejecucion=$1`, [inicio2.data.id]);
    check('cancelar: pendientes quedan Cancelado, la simulación Cancelada; cancelar de nuevo 409',
      cancelar.status === 201 && cancelar.data.cancelados === est2.length && est2.every((d) => d.estado === 'Cancelado') && cancelar2.status === 409, JSON.stringify([cancelar.status, cancelar.data, cancelar2.status]));

    const limitado = await call(ep + '/ejecuciones', 'POST', { requestId: randomUUID(), idPreparacion: prep2.data.id, motivo: 'Límite', confirmacion: true });
    check('el inicio respeta el límite de 10 solicitudes por minuto (429)', limitado.status === 429, String(limitado.status));
    // El límite es por IP/handler; el tercer inicio usa el servicio real directamente.
    const ejecuciones = app.get(require('./dist/crm/campana-ejecucion.service').CampanaEjecucionService);
    const inicio3 = await ejecuciones.start(campana, { requestId: randomUUID(), idPreparacion: prep2.data.id, motivo: 'Plantilla cambiará', confirmacion: true }, actor);
    await writer.query(`UPDATE crm_plantilla SET contenido='Texto distinto' WHERE id_plantilla=$1`, [plantilla]);
    await ejecuciones.procesar();
    const est3 = await ds.query(`SELECT estado,motivo FROM crm_campana_ejecucion_destino WHERE id_ejecucion=$1`, [inicio3.id]);
    const ej3 = (await ds.query(`SELECT estado,motivo_cierre FROM crm_campana_ejecucion WHERE id_ejecucion=$1`, [inicio3.id]))[0];
    check('plantilla cambiada después de iniciar → nada se simula y la ejecución cierra con ese motivo',
      est3.length === 2 && est3.every((d) => d.estado === 'Omitido' && d.motivo === 'Plantilla cambiada') && ej3.estado === 'Terminada' && ej3.motivo_cierre === 'Plantilla cambiada', JSON.stringify([est3, ej3]));

    const lista = await call(ep + '/ejecuciones');
    const l1 = lista.data.find((e) => e.id === idEj);
    check('historial: 3 simulaciones con conteos y motivos de omisión', lista.status === 200 && lista.data.length === 3 && l1.simulados === 2 && l1.omitidos === 2
      && l1.motivos.Baja === 1 && l1.motivos['Destino cambiado'] === 1 && lista.cache === 'private, no-store', JSON.stringify(l1));
    const auditadas = (await ds.query(`SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='crm_campana_ejecucion'`))[0].n;
    check('auditoría registra alta y cierre de cada simulación', auditadas >= 6, String(auditadas));
  } catch (error) {
    check('ejecución completa sin excepción', false, error.stack || error.message);
  } finally {
    if (writer) await writer.end().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch((e) => check('copia eliminada', false, e.message));
    const quedan = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rows.length;
    check('base aislada eliminada', quedan === 0);
    await admin.end();
    const failed = results.filter((r) => !r.ok);
    fs.mkdirSync(path.join(__dirname, '..', '.artifacts'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', '.artifacts', 'o012c-pac-campanas.json'), JSON.stringify({ passed: failed.length === 0, total: results.length, results: results.map(({ name: n, ok }) => ({ name: n, ok })) }, null, 2));
    console.log(`\n${results.length - failed.length}/${results.length} verificaciones correctas`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
