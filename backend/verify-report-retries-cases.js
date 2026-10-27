const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
exports.backend=async({app,writer,control,database,call,users,tokens,auth,actor,names,password,checked})=>{
 const service=app.get(require('./dist/crm/crm-reportes.service').CrmReportesService),queue=app.get(require('./dist/crm/crm-reportes-cola.service').CrmReportesColaService),inbox=app.get(require('./dist/crm/crm-bandeja.service').CrmBandejaService);
 const base='crm/reportes-programados',future=new Date(Date.now()+2*86400000),read=inbox.inSnapshot.bind(inbox),create={nombre:'Recuperación O011',frecuencia:'Diaria',hora:0,minuto:0,tipo:'todos',plazo:'todos'};
 let seq=0;
 const state=async id=>(await writer.query('SELECT * FROM crm_reporte_reintento WHERE id_resultado=$1',[id])).rows[0];
 const events=async id=>(await writer.query('SELECT * FROM crm_reporte_intento_evento WHERE id_resultado=$1 ORDER BY creada_en,id',[id])).rows;
 const makeError=async({legacy=false}={})=>{
  const p=(await service.create({...create,nombre:create.nombre+' '+(++seq),requestId:randomUUID()},actor)).id;
  inbox.inSnapshot=async()=>{throw new Error('SQL-PRIVADO-INTENCIONAL');};
  try{await assert.rejects(service.generateOne(p,future));}finally{inbox.inSnapshot=read;}
  if(legacy){const slot=(await writer.query(`SELECT (((($1::timestamptz AT TIME ZONE zona)::date)::timestamp+make_interval(hours=>hora,mins=>minuto)) AT TIME ZONE zona) at FROM crm_reporte_programa WHERE id_programa=$2`,[future,p])).rows[0].at;
   await writer.query("INSERT INTO crm_reporte_resultado(id_programa,programada_en,estado,codigo)VALUES($1,$2,'Error','GENERACION_FALLIDA')",[p,slot]);
  }else await service.recordFailure(p,future);
  const r=(await service.history(p,1,actor)).data[0];return{p,id:r.id};
 };
 // Sólo en la copia: adelantar disponibilidad/lease simula el paso del reloj,
 // sin exponer relojes o bypass de guardas por HTTP en producción.
 const time=async(id,expired=false)=>{await writer.query('ALTER TABLE crm_reporte_reintento DISABLE TRIGGER crm_reporte_cola_control');try{
  await writer.query(expired?"UPDATE crm_reporte_reintento SET lease_hasta=clock_timestamp()-interval '1 second' WHERE id_resultado=$1":"UPDATE crm_reporte_reintento SET disponible_en=clock_timestamp()-interval '1 second' WHERE id_resultado=$1",[id]);
 }finally{await writer.query('ALTER TABLE crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_control');}};
 const old=await makeError({legacy:true}),path=(f,action)=>`${base}/${f.p}/resultados/${f.id}/${action}`;
 await call(path(old,'reintentar'),401,'POST',{confirmacion:true},'');await call(path(old,'reintentar'),403,'POST',{confirmacion:true},tokens[1]);
 for(const data of[{confirmacion:false},{confirmacion:true,idPropietario:users[1]},{confirmacion:true,sql:'SELECT 1'}])await call(path(old,'reintentar'),400,'POST',data);
 const otherName='retries_admin_'+randomUUID().slice(0,8);await writer.query("INSERT INTO auth_user(username,password_hash,role,is_active,token_version)SELECT $1,password_hash,'admin',true,0 FROM auth_user WHERE id_user=$2",[otherName,users[0]]);const otherToken=(await auth.login(otherName,password)).access_token;
 await call(path(old,'reintentar'),404,'POST',{confirmacion:true},otherToken);await call(`${base}/${old.p}/historial`,404,'GET',undefined,otherToken);
 await call(path(old,'reintentar'),201,'POST',{confirmacion:true});await call(path(old,'reintentar'),201,'POST',{confirmacion:true});assert.equal((await state(old.id)).intentos,0);
 assert.equal((await call(`${base}/${old.p}/historial`)).cache,'private, no-store');
 checked('HTTP/login reales: contrato cerrado/confirmación/401/403/propietario incluso otro ADMIN, caché y puesta en cola histórica idempotente');
 await Promise.all([queue.processDue(),queue.processDue()]);let h=(await service.history(old.p,1,actor)).data[0];
 assert.equal(h.estado,'Error');assert.equal(h.snapshot,null);assert.equal(h.reintento.estado,'Completado');assert.equal(h.reintento.intentos,1);assert.equal(h.recuperacion.snapshot.total,(await inbox.list({page:1,q:'',tipo:'todos',plazo:'todos'},actor)).total);
 assert.equal((await events(old.id)).length,2);const saved=JSON.stringify(h.recuperacion);await queue.processDue();assert.equal(JSON.stringify((await service.history(old.p,1,actor)).data[0].recuperacion),saved);
 assert.equal((await writer.query('SELECT count(*)::int n FROM crm_reporte_recuperacion WHERE id_resultado=$1',[old.id])).rows[0].n,1);
 checked('Dos consumidores reales conservan una sola recuperación atómica y snapshot posterior; Error original inmutable y lecturas sin recalcular');
 const fail=await makeError();assert.equal((await state(fail.id)).estado,'Pendiente');
 inbox.inSnapshot=async()=>{throw new Error('SQL-PRIVADO-INTENCIONAL');};
 try{for(let i=1;i<=3;i++){await assert.rejects(queue.processDue());const q=await state(fail.id);assert.equal(q.intentos,i);assert.equal(q.estado,i===3?'Agotado':'Pendiente');assert.equal((await events(fail.id)).length,i*2);
  if(i<3){assert.ok(q.disponible_en.getTime()>Date.now()+(i===1?9:19)*60000);await queue.processDue();assert.equal((await state(fail.id)).intentos,i);await time(fail.id);}
 }}finally{inbox.inSnapshot=read;}
 await queue.processDue();assert.equal((await state(fail.id)).estado,'Agotado');assert.equal((await service.history(fail.p,1,actor)).data[0].recuperacion,null);assert.ok(!JSON.stringify(await service.history(fail.p,1,actor)).includes('SQL-PRIVADO'));
 checked('Fallo real con rollback, espera10/20min adelantada sólo en copia, tres intentos y Agotado sin bucle ni SQL privado');
 const interrupted=await makeError(),claim=await queue.claim();assert.equal(claim.id,interrupted.id);await time(interrupted.id,true);await queue.processDue();assert.equal((await state(interrupted.id)).estado,'Pendiente');assert.equal((await events(interrupted.id)).at(-1).fase,'Interrumpido');
 await queue.execute(claim);assert.equal((await state(interrupted.id)).estado,'Pendiente');await time(interrupted.id);await queue.processDue();assert.equal((await state(interrupted.id)).estado,'Completado');assert.equal((await state(interrupted.id)).intentos,2);
 checked('Claim persistido, lease vencido, evento Interrumpido, token antiguo rechazado y recuperación con nuevo intento');
 const canceled=await makeError(),q=await state(canceled.id);
 await call(path(canceled,'cancelar-reintento'),409,'POST',{confirmacion:true,expectedVersion:q.version+1});await call(path(canceled,'cancelar-reintento'),201,'POST',{confirmacion:true,expectedVersion:q.version});await call(path(canceled,'cancelar-reintento'),201,'POST',{confirmacion:true,expectedVersion:q.version});await queue.processDue();assert.equal((await state(canceled.id)).estado,'Cancelado');assert.equal((await state(canceled.id)).intentos,0);
 const activeCancel=await makeError(),running=await queue.claim();assert.equal(running.id,activeCancel.id);await queue.cancel(activeCancel.p,activeCancel.id,(await state(activeCancel.id)).version,actor);await queue.execute(running);assert.equal((await state(activeCancel.id)).estado,'Cancelado');assert.equal((await service.history(activeCancel.p,1,actor)).data[0].recuperacion,null);
 checked('Cancelación confirmada/versionada/idempotente pendiente y tras claim impide resultado tardío; bitácora conservada');
 const suspended=await makeError();await service.control(suspended.p,{activa:false,expectedVersion:1},actor);await queue.processDue();assert.equal((await state(suspended.id)).estado,'Cancelado');
 const revoked=await makeError();await writer.query("DELETE FROM app_role_permission WHERE role='admin' AND permission_code='crm.reportes.programar'");try{await queue.processDue();assert.equal((await state(revoked.id)).estado,'Cancelado');}finally{await writer.query("INSERT INTO app_role_permission(role,permission_code)VALUES('admin','crm.reportes.programar')");}
 checked('Suspensión y pérdida de permiso efectivo cancelan sin exponer datos o generar snapshots');
 const blocked=await makeError(),blockedClaim=await queue.claim();assert.equal(blockedClaim.id,blocked.id);await writer.query('BEGIN');await writer.query('SELECT 1 FROM crm_reporte_programa WHERE id_programa=$1 FOR UPDATE',[blocked.p]);
 const waiting=queue.execute(blockedClaim);let locked=false;for(let i=0;i<100;i++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){locked=true;break;}await new Promise(r=>setTimeout(r,20));}
 await writer.query("DELETE FROM app_role_permission WHERE role='admin' AND permission_code='crm.reportes.programar'");await writer.query('COMMIT');await waiting;try{assert.ok(locked);assert.equal((await state(blocked.id)).estado,'Cancelado');}finally{await writer.query("INSERT INTO app_role_permission(role,permission_code)VALUES('admin','crm.reportes.programar')");}
 checked('Revocación de permiso mientras espera bloqueo real se observa después de esperar; sin autoridad de snapshot antiguo');
 const rollback=await makeError();await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT o011_audit_failure CHECK(table_name<>'crm_reporte_recuperacion') NOT VALID");try{await assert.rejects(queue.processDue());}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT o011_audit_failure');}
 assert.equal((await state(rollback.id)).estado,'Pendiente');assert.equal((await writer.query('SELECT count(*)::int n FROM crm_reporte_recuperacion WHERE id_resultado=$1',[rollback.id])).rows[0].n,0);await time(rollback.id);await queue.processDue();assert.equal((await state(rollback.id)).estado,'Completado');
 for(const table of['crm_reporte_recuperacion','crm_reporte_intento_evento'])for(const sql of['UPDATE '+table+' SET id_resultado=id_resultado WHERE false','DELETE FROM '+table+' WHERE false','TRUNCATE '+table])await assert.rejects(writer.query(sql),e=>e.code==='P0001');
 await assert.rejects(writer.query('DELETE FROM crm_reporte_reintento WHERE false'),e=>e.code==='P0001');await assert.rejects(writer.query("UPDATE crm_reporte_reintento SET estado='Pendiente',version=version+1 WHERE id_resultado=$1",[old.id]),e=>e.code==='P0001');
 const audits=(await writer.query("SELECT table_name,app_user_id FROM auditoria_jsonb WHERE table_name IN('crm_reporte_recuperacion','crm_reporte_reintento')")).rows;assert.ok(audits.some(a=>a.table_name==='crm_reporte_reintento'&&a.app_user_id===users[0]));assert.ok(audits.filter(a=>a.table_name==='crm_reporte_recuperacion').every(a=>a.app_user_id==null));
 checked('Fallo de auditoría revierte snapshot/éxito; recuperación posterior, guardas ALWAYS/terminal y auditoría humana separada del ejecutor');
 const originalGenerate=service.generateDue.bind(service);service.generateDue=async()=>{throw new Error('Fallo inicial controlado');};const cron=await makeError();try{assert.equal(await service.scheduled(),'failed');assert.equal((await state(cron.id)).estado,'Completado');}finally{service.generateDue=originalGenerate;}
 assert.ok((await writer.query("SELECT 1 FROM operational_job_run WHERE job_name='crm_reports' AND status='failed'")).rowCount);
 checked('Cron/guardia/historial O02 existentes procesan cola aunque falle generación inicial, sin otro scheduler ni envíos');
 const noQueue=await makeError({legacy:true}),uiCancel=await makeError();
 return{service,queue,inbox,makeError,old,fail,noQueue,uiCancel};
};
