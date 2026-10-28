// backend/verify-mail-outbox.js · O01.2b: envío de documentos por correo con el ejecutor real y un servidor SMTP LOCAL
// controlado (127.0.0.1, nada sale a terceros). Restaura el respaldo más reciente en una base aislada, migra, prueba y la elimina.
// Uso: npm run test:mail-outbox [-- --backup=.backups/FECHA/database.dump]
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('./db-config');
const { findPgTool, postgresEnvironment } = require('./backup');
const { SmtpLocalPrueba } = require('./dist/common/smtp-local-prueba');
const { NodemailerTransporte } = require('./dist/venta/correo-transporte');
const { SalidaDocumentosService } = require('./dist/venta/salida-documentos.service');
const { SalidaCorreoEjecutorService } = require('./dist/venta/salida-correo-ejecutor.service');
const { DocumentosVentaService } = require('./dist/venta/documentos-venta.service');
const { TicketService } = require('./dist/venta/ticket.service');

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
  const name = `verify_mail_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const base = databaseConfig();
  const admin = new Client(base);
  await admin.connect();
  const smtp = new SmtpLocalPrueba();
  let ds;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    const env = { ...postgresEnvironment(), PGDATABASE: name, DB_NAME: name };
    if (base.connectionString) { const u = new URL(base.connectionString); u.pathname = '/' + name; env.DATABASE_URL = u.toString(); } else delete env.DATABASE_URL;
    const dump = latestDump();
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, dump], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    execFileSync(process.execPath, [path.join(__dirname, 'run-migrations.js')], { env, stdio: 'pipe', windowsHide: true, timeout: 300000 });
    check(`respaldo restaurado y migrado en base aislada (${path.basename(path.dirname(dump))})`, true);
    ds = new DataSource({ type: 'postgres', ...(env.DATABASE_URL ? { url: env.DATABASE_URL } : { host: base.host, port: base.port, username: base.user, password: base.password, database: name }), ssl: base.ssl });
    await ds.initialize();

    const port = await smtp.iniciar();
    const smtpEnv = { MAIL_MODE: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), MAIL_FROM: 'erp@example.invalid', MAIL_MAX_ATTEMPTS: '3' };
    const setEnv = (vars) => { for (const k of ['MAIL_MODE', 'SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM', 'MAIL_MAX_ATTEMPTS', 'MAIL_RECIPIENT_DOMAINS', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS']) delete process.env[k]; Object.assign(process.env, vars); };
    setEnv(smtpEnv);

    const [u] = await ds.query(`SELECT id_user AS "idUser", role, token_version AS version FROM auth_user WHERE role='admin' AND is_active ORDER BY id_user LIMIT 1`);
    const actor = { ...u, sub: 'verificador' };
    const facturas = await ds.query(`SELECT f.id_factura AS id, f.id_cliente AS cliente FROM factura f WHERE f.estatus::text<>'Cancelada' AND f.id_factura_global IS NULL ORDER BY f.id_factura DESC LIMIT 6`);
    if (facturas.length < 6) throw new Error('El respaldo necesita al menos 6 facturas vigentes');
    await ds.query(`UPDATE cliente SET email='cliente@example.invalid' WHERE "IdCliente" = ANY($1::int[])`, [facturas.map((f) => f.cliente)]);

    const docs = new DocumentosVentaService(ds, new TicketService());
    const salida = new SalidaDocumentosService(ds, docs);
    const ejecutor = new SalidaCorreoEjecutorService(ds, salida, new NodemailerTransporte());
    const preparar = async (idFactura, modo = 'Correo') => {
      const p = await salida.preview(idFactura, actor);
      return { ...(await salida.prepare(idFactura, { requestId: randomUUID(), evaluacionSha256: p.evaluacionSha256, confirmacion: true, modo }, actor)), preview: p };
    };
    const envio = async (id) => (await ds.query(`SELECT estado,intentos,proximo_intento,ultimo_error,respuesta_smtp,message_id FROM documento_salida_envio WHERE id=$1`, [id]))[0];
    const cierre = async (id) => (await ds.query(`SELECT accion,motivo,id_actor FROM documento_salida_cierre WHERE id=$1`, [id]))[0];
    const intentos = async (id) => ds.query(`SELECT numero,resultado,codigo_smtp FROM documento_salida_intento WHERE id_salida=$1 ORDER BY numero`, [id]);
    const forzarVencido = (id) => ds.query(`UPDATE documento_salida_envio SET proximo_intento=clock_timestamp()-interval '1 second' WHERE id=$1`, [id]);

    // 1) Vista previa y preparación
    const pv = await salida.preview(facturas[0].id, actor);
    check('vista previa: correo disponible con configuración válida (sin exponer contraseña)', pv.correo.disponible && pv.correo.habilitado && !('pass' in pv.correo) && pv.correo.servidor === `127.0.0.1:${port}`);
    const local = await preparar(facturas[0].id, 'Local');
    check('modo Local sigue igual: sin estado de envío', !(await envio(local.id)));
    check('una solicitud Local no puede cerrarse como Aceptada (guarda en la BD)', true === await expectError(() => ds.query(`INSERT INTO documento_salida_cierre(id,request_id,huella,accion) VALUES($1,$2,$3,'Aceptado')`, [local.id, randomUUID(), 'a'.repeat(64)]), /nunca se envía/));

    // 2) Aceptado
    smtp.conducta = () => 'aceptar';
    const a = await preparar(facturas[0].id);
    check('modo Correo crea envío Pendiente con Message-ID propio', (await envio(a.id)).estado === 'Pendiente' && (await envio(a.id)).message_id === `<salida-${a.id}@example.invalid>`);
    await ejecutor.procesar();
    const ea = await envio(a.id);
    check('ejecutor: servidor acepta → envío y cierre Aceptado, un intento', ea.estado === 'Aceptado' && (await cierre(a.id))?.accion === 'Aceptado' && (await intentos(a.id)).length === 1 && /^250/.test(ea.respuesta_smtp), JSON.stringify(ea));
    const recibido = smtp.recibidos.at(-1);
    check('el servidor recibió destinatario, Message-ID y PDF adjunto', recibido.para[0] === '<cliente@example.invalid>' && recibido.datos.includes(`Message-ID: <salida-${a.id}@example.invalid>`) && recibido.datos.includes('application/pdf'));
    const enviados = smtp.recibidos.length;
    await ejecutor.procesar();
    check('un envío Aceptado no se vuelve a enviar', smtp.recibidos.length === enviados);

    // 3) Temporal → reintento con espera → aceptado
    const t = await preparar(facturas[1].id);
    smtp.conducta = () => 'temporal';
    await ejecutor.procesar();
    const et = await envio(t.id);
    check('4xx: Reintento con espera de 1 minuto, sin cierre', et.estado === 'Reintento' && new Date(et.proximo_intento) > new Date() && !(await cierre(t.id)), JSON.stringify(et));
    await ejecutor.procesar();
    check('antes de la espera no se reintenta', (await envio(t.id)).intentos === 1);
    smtp.conducta = () => 'aceptar';
    await forzarVencido(t.id);
    await ejecutor.procesar();
    check('vencida la espera, segundo intento aceptado (2 intentos registrados)', (await envio(t.id)).estado === 'Aceptado' && (await intentos(t.id)).map((i) => i.resultado).join() === 'Reintento,Aceptado');

    // 4) Agotar intentos
    const g = await preparar(facturas[2].id);
    smtp.conducta = () => 'temporal';
    for (let i = 0; i < 3; i++) { await forzarVencido(g.id); await ejecutor.procesar(); }
    check('agotar 3 intentos temporales → Fallido con motivo', (await envio(g.id)).estado === 'Fallido' && /Agotó 3 intentos/.test((await cierre(g.id))?.motivo || ''), JSON.stringify(await cierre(g.id)));

    // 5) Rechazo permanente
    const r = await preparar(facturas[3].id);
    smtp.conducta = () => 'rechazar';
    await ejecutor.procesar();
    check('5xx: Fallido inmediato, sin reintentos', (await envio(r.id)).estado === 'Fallido' && (await intentos(r.id)).length === 1 && (await intentos(r.id))[0].codigo_smtp === 550);

    // 6) Incierto y conciliación
    const i1 = await preparar(facturas[4].id);
    smtp.conducta = () => 'cortar-tras-datos';
    const antes = smtp.recibidos.length;
    await ejecutor.procesar();
    check('respuesta perdida tras el contenido → Incierto, sin cierre (el servidor sí lo recibió)', (await envio(i1.id)).estado === 'Incierto' && !(await cierre(i1.id)) && smtp.recibidos.length === antes + 1);
    await forzarVencido(i1.id);
    await ejecutor.procesar();
    check('un Incierto nunca se reenvía solo', smtp.recibidos.length === antes + 1 && (await intentos(i1.id)).length === 1);
    check('Incierto no se puede cancelar: se concilia', true === await expectError(() => salida.close(facturas[4].id, i1.id, { requestId: randomUUID(), confirmacion: true, motivo: 'x' }, actor, true), /concílialo/));
    const userActor = { ...actor, role: 'user' };
    check('sólo un administrador concilia', true === await expectError(() => salida.conciliar(facturas[4].id, i1.id, { requestId: randomUUID(), confirmacion: true, accion: 'Reintentar', motivo: 'x' }, userActor), /administrador/));
    smtp.conducta = () => 'aceptar';
    const conc = { requestId: randomUUID(), confirmacion: true, accion: 'Reintentar', motivo: 'Cliente dice que no llegó' };
    await salida.conciliar(facturas[4].id, i1.id, conc, actor);
    await salida.conciliar(facturas[4].id, i1.id, conc, actor); // reintento idempotente de la decisión
    await ejecutor.procesar();
    check('conciliar "Reintentar" reenvía con el mismo Message-ID y queda Aceptado', (await envio(i1.id)).estado === 'Aceptado' && smtp.recibidos.at(-1).datos.includes(`<salida-${i1.id}@example.invalid>`) && (await ds.query('SELECT count(*)::int n FROM documento_salida_conciliacion WHERE id_salida=$1', [i1.id]))[0].n === 1);
    const i2 = await preparar(facturas[4].id);
    smtp.conducta = () => 'cortar-tras-datos';
    await ejecutor.procesar();
    await salida.conciliar(facturas[4].id, i2.id, { requestId: randomUUID(), confirmacion: true, accion: 'ConfirmarAceptado', motivo: 'Visto en la bitácora del servidor' }, actor);
    check('conciliar "Confirmar aceptado" cierra Aceptado con la persona que decidió', (await cierre(i2.id))?.accion === 'Aceptado' && (await cierre(i2.id))?.id_actor === actor.idUser);
    const i3 = await preparar(facturas[4].id);
    await ejecutor.procesar();
    await salida.conciliar(facturas[4].id, i3.id, { requestId: randomUUID(), confirmacion: true, accion: 'DarPorFallido', motivo: 'Se enviará por otro medio' }, actor);
    check('conciliar "Dar por fallido" cierra Fallido con motivo', (await cierre(i3.id))?.accion === 'Fallido' && (await cierre(i3.id))?.motivo === 'Se enviará por otro medio');

    // 7) Proceso interrumpido: reserva vencida
    const v = await preparar(facturas[5].id);
    await ds.query(`UPDATE documento_salida_envio SET estado='EnCurso',reserva_token=gen_random_uuid(),reserva_hasta=clock_timestamp()-interval '1 minute',intentos=1 WHERE id=$1`, [v.id]);
    const res = await ejecutor.procesar();
    check('reserva vencida (proceso caído a mitad) → Incierto con intento registrado, sin reenviar', res.vencidas === 1 && (await envio(v.id)).estado === 'Incierto' && (await intentos(v.id))[0]?.resultado === 'Incierto');

    // 8) Documento cambiado antes de enviar → Obsoleto
    smtp.conducta = () => 'aceptar';
    const o = await preparar(facturas[5].id);
    await ds.query(`UPDATE cliente SET email='otro@example.invalid' WHERE "IdCliente"=$1`, [facturas[5].cliente]);
    const n0 = smtp.recibidos.length;
    await ejecutor.procesar();
    check('si el destinatario cambió, se cierra Obsoleto y no se envía', (await envio(o.id)).estado === 'Obsoleto' && (await cierre(o.id))?.accion === 'Obsoleto' && smtp.recibidos.length === n0);

    // 9) Cancelar en cola, no simular correo
    const c = await preparar(facturas[0].id);
    check('una solicitud de correo no se simula', true === await expectError(() => salida.close(facturas[0].id, c.id, { requestId: randomUUID(), confirmacion: true }, actor), /no se simula/));
    await salida.close(facturas[0].id, c.id, { requestId: randomUUID(), confirmacion: true, motivo: 'Ya no se requiere' }, actor, true);
    await ejecutor.procesar();
    check('cancelar en cola: Cancelado y nunca se envía', (await envio(c.id)).estado === 'Cancelado' && (await cierre(c.id))?.accion === 'Cancelado');

    // 10) Configuración desactivada o con dominio no permitido
    setEnv({});
    check('sin configuración: preparar Correo se rechaza', true === await expectError(() => preparar(facturas[1].id), /no está configurado/));
    setEnv({ ...smtpEnv, MAIL_RECIPIENT_DOMAINS: 'refaccionaria.com.mx' });
    const pd = await salida.preview(facturas[1].id, actor);
    check('dominio fuera de la lista: no disponible y preparar se rechaza', !pd.correo.disponible && true === await expectError(() => preparar(facturas[1].id), /dominio/));
    setEnv(smtpEnv);
    const p2 = await preparar(facturas[1].id);
    setEnv({});
    const n1 = smtp.recibidos.length;
    await ejecutor.procesar();
    check('con el correo desactivado las solicitudes esperan en cola sin enviarse ni fallar', (await envio(p2.id)).estado === 'Pendiente' && smtp.recibidos.length === n1);
    setEnv(smtpEnv);

    // 11) Historial e inmutabilidad
    const hist = await salida.list(facturas[4].id, 1, actor);
    check('historial muestra modo, estado e intentos', hist.data.some((x) => x.modo === 'Correo' && x.estado === 'Aceptado' && x.intentos >= 1));
    check('intentos y conciliaciones son inmutables', true === await expectError(() => ds.query('DELETE FROM documento_salida_intento'), /./) && true === await expectError(() => ds.query('UPDATE documento_salida_conciliacion SET motivo=$1', ['x']), /./));
    check('todo lo enviado fue al servidor local de prueba', smtp.recibidos.every((m) => m.para.every((p) => p.endsWith('@example.invalid>'))));
  } catch (error) {
    check('ejecución sin errores', false, (error.stack || String(error)).slice(0, 1500));
  } finally {
    await smtp.detener().catch(() => {});
    if (ds?.isInitialized) await ds.destroy();
    if (/^verify_mail_\d+_[a-f0-9]{6}$/.test(name)) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    const left = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rows.length;
    await admin.end();
    check('base aislada eliminada', !left);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones aprobadas`);
  process.exit(failed ? 1 : 0);
})();
