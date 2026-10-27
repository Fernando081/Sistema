/* C02.1: AppModule/SQL/Angular reales en copia propia. No envía comunicaciones. */
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),express=require('express');
const {randomBytes,randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process'),{once}=require('node:events');
const {Client}=require('pg'),{Test}=require('@nestjs/testing'),{DataSource}=require('typeorm'),{SchedulerRegistry}=require('@nestjs/schedule');
const {chromium,expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const {databaseConfig}=require('./db-config'),{findPgTool,postgresEnvironment}=require('./backup');
function preview(api,directory){const site=express();site.use('/api',(req,res)=>{const request=http.request(new URL(req.originalUrl,api),{method:req.method,headers:{...req.headers,host:new URL(api).host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(request);});site.use(express.static(directory));site.get(/.*/,(_req,res)=>res.sendFile(path.join(directory,'index.html')));return http.createServer(site);}
async function main(){
 const root=path.resolve(__dirname,'..'),withRules=process.argv.includes('--rules'),withControl=withRules||process.argv.includes('--control');assert.equal(process.versions.node.split('.')[0],'24');
 const arg=process.argv.find(a=>a.startsWith('--backup='));assert.ok(arg,'Falta respaldo local');const dump=fs.realpathSync(path.resolve(arg.slice(9)));assert.ok(dump.startsWith(fs.realpathSync(path.join(root,'.backups'))+path.sep));
 const config=databaseConfig();assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(config.connectionString?new URL(config.connectionString).hostname:config.host));
 const control=new Client(config),database='verify_sequences_'+randomBytes(8).toString('hex'),url=new URL(config.connectionString||'postgresql://127.0.0.1');
 if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
 const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const report={phase:withRules?'C02.2b':withControl?'C02.2a':'C02.1',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false,externalDeliveryEnabled:false};
 const checked=name=>{report.checks.push(name);console.log('OK:',name);};let created=false,app,writer,browser,server,stage='restore';
 await control.connect();try{
  await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
  const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
  execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);
  execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
  writer=new Client({connectionString:url.toString()});await writer.connect();assert.equal((await writer.query('SELECT current_database() name')).rows[0].name,database);
  await writer.query('UPDATE auth_user SET is_active=false');
  const {AuthService}=require('./dist/auth/auth.service'),password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['campaign_admin_','campaign_user_'].map(n=>n+randomBytes(4).toString('hex')),users=[];
  for(const[i,name]of names.entries())users.push((await writer.query('INSERT INTO auth_user(username,password_hash,role,is_active,token_version)VALUES($1,$2,$3,true,0)RETURNING id_user',[name,hash,i?'user':'admin'])).rows[0].id_user);
  Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
  stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
  const ds=app.get(DataSource);assert.equal((await ds.query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService),tokens=await Promise.all(names.map(async n=>(await auth.login(n,password)).access_token)),actor=auth.verify(tokens[0]);
  const service=app.get(require('./dist/crm/crm-secuencias.service').CrmSecuenciasService);
  const call=async(route,status=200,method='GET',body,token=tokens[0])=>{const r=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json();assert.equal(r.status,status,route+': HTTP'+r.status+' esperado'+status+(typeof data.message==='string'?' '+data.message:''));return{data,cache:r.headers.get('cache-control')};};
  stage='fixtures';const clients=[];
  for(const[i,name]of['Cliente C02 Alfa','Cliente C02 Beta'].entries())clients.push((await writer.query(`INSERT INTO cliente("RFC","RazonSocial","Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI") SELECT $1,$2,"Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI" FROM cliente ORDER BY "IdCliente" LIMIT 1 RETURNING "IdCliente" AS id`,['S2'+i+'010101AA1',name])).rows[0].id);
  const base='crm/secuencias',query={page:1,q:''},step=(titulo,horas=0)=>({titulo,descripcion:'Instrucción interna de prueba',prioridad:'Media',horas});
  const modelDto={requestId:randomUUID(),nombre:'C02 Seguimiento de cotización',pasos:[step('Revisar aplicación'),step('Confirmar propuesta',48),step('Evaluar resultado',24)]};
  const before=(await writer.query('SELECT (SELECT count(*) FROM crm_comunicacion)::int comunicaciones,(SELECT count(*) FROM factura)::int facturas,(SELECT count(*) FROM crm_tarea)::int tareas')).rows[0];
  const standalone=(await call('crm/tareas',201,'POST',{titulo:'Tarea independiente C02',prioridad:'Media',fechaVencimiento:new Date(Date.now()+86400000).toISOString(),idResponsable:users[0],idCliente:clients[0]})).data;
  await call('crm/tareas/'+standalone.idTarea,200,'PATCH',{estado:'Completada',expectedVersion:1});assert.equal((await writer.query('SELECT estado,id_secuencia FROM crm_tarea WHERE id_tarea=$1',[standalone.idTarea])).rows[0].id_secuencia,null);
  await call(base,401,'GET',undefined,null);await call(base,403,'GET',undefined,tokens[1]);await call(base+'?page=0',400);await call(base+'?extra=1',400);
  await call(base+'/modelos',400,'POST',{...modelDto,pasos:[]});await call(base+'/modelos',400,'POST',{...modelDto,pasos:Array(9).fill(step('Demasiados'))});
  await call(base+'/modelos',400,'POST',{...modelDto,pasos:[step('Plazo inválido',721)]});await call(base+'/modelos',400,'POST',{...modelDto,pasos:[{...step('Campo desconocido'),canal:'WhatsApp'}]});
  assert.equal((await call(base)).cache,'private, no-store');checked('HTTP real401/403, DTO cerrado con pasos1–8/plazos0–720 y consultas privadas; sin inscripción por migración');
  const model=(await call(base+'/modelos',201,'POST',modelDto)).data;assert.equal((await call(base+'/modelos',201,'POST',modelDto)).data.id,model.id);
  await call(base+'/modelos',409,'POST',{...modelDto,nombre:'Otra intención'});
  assert.equal((await call(base+'/clientes?q=Cliente%20C02')).data.total,2);assert.equal((await call(base+'/clientes?q=%25')).data.total,0);
  const startDto={requestId:randomUUID(),idModelo:model.id,idCliente:clients[0],idResponsable:users[0],motivo:'Dar seguimiento a solicitud de cliente',confirmacion:true};
  const starts=await Promise.all([service.start(startDto,actor),service.start(startDto,actor)]);assert.equal(starts[0].id,starts[1].id);
  await call(base,409,'POST',{...startDto,requestId:randomUUID()});await call(base,400,'POST',{...startDto,requestId:randomUUID(),confirmacion:false});
  const counts=async id=>(await writer.query('SELECT (SELECT count(*) FROM crm_tarea WHERE id_secuencia=$1)::int tareas,(SELECT count(*) FROM crm_secuencia_evento WHERE id_secuencia=$1)::int eventos',[id])).rows[0];
  assert.deepEqual(await counts(startDto.requestId),{tareas:1,eventos:1});checked('Modelos conservados e idempotentes; búsqueda literal de cliente; inicio concurrente crea exactamente una tarea y rechaza duplicado activo');
  let d=(await call(base+'/'+startDto.requestId)).data,t=d.pasos[0].tarea;
  assert.ok(Math.abs(new Date(t.venceEn).getTime()-Date.now())<20000);assert.equal(d.pasos[1].tarea,null);
  await call('crm/tareas/'+t.id,409,'PATCH',{titulo:'Cambiar contenido',expectedVersion:t.version});
  const transition={idTarea:t.id,expectedVersion:t.version,estado:'Completada'};
  const finished=await Promise.allSettled([service.transition(d.id,transition,actor),service.transition(d.id,transition,actor)]);
  if(!finished.some(r=>r.status==='fulfilled'))console.error('Diagnóstico de avance:',finished.map(r=>r.status==='rejected'?[r.reason.name,r.reason.code,r.reason.message]:r.status));
  assert.equal(finished.filter(r=>r.status==='fulfilled').length,1);assert.equal(finished.find(r=>r.status==='rejected').reason.getStatus(),409);
  d=(await call(base+'/'+d.id)).data;assert.equal(d.pasoActual,2);assert.deepEqual(await counts(d.id),{tareas:2,eventos:3});
  assert.ok(Math.abs(new Date(d.pasos[1].tarea.venceEn).getTime()-Date.now()-48*3600000)<20000);
  await call('crm/tareas/'+t.id,409,'PATCH',{estado:'Pendiente',expectedVersion:2});
  t=d.pasos[1].tarea;await call('crm/tareas/'+t.id,200,'PATCH',{estado:'Completada',expectedVersion:t.version});d=(await call(base+'/'+d.id)).data;assert.equal(d.pasoActual,3);
  t=d.pasos[2].tarea;await call(base+'/'+d.id+'/tarea',200,'PATCH',{idTarea:t.id,estado:'Completada',expectedVersion:t.version});d=(await call(base+'/'+d.id)).data;
  assert.equal(d.estado,'Completada');assert.equal(d.eventos.length,6);assert.ok(d.cerradaEn);checked('Completar concurrentemente produce un solo siguiente paso/plazo; recorrido HTTP heredado también avanza; cierre final y rechazo de reapertura/contexto');
  await writer.query("INSERT INTO app_role_permission(role,permission_code) VALUES('user','crm.secuencias.gestionar')");const user=auth.verify(tokens[1]);
  await call(base+'/'+d.id,404,'GET',undefined,tokens[1]);assert.equal((await call(base,200,'GET',undefined,tokens[1])).data.total,0);
  await call(base,403,'POST',{...startDto,requestId:randomUUID(),idCliente:clients[1]},tokens[1]);
  const own=await service.start({...startDto,requestId:randomUUID(),idCliente:clients[1],idResponsable:users[1]},user);let ownDetail=await service.detail(own.id,user);
  await call(base+'/'+own.id+'/tarea',404,'PATCH',{idTarea:d.pasos[0].tarea.id,expectedVersion:1,estado:'Cancelada'},tokens[1]);
  const ownTask=ownDetail.pasos[0].tarea;await writer.query('UPDATE auth_user SET is_active=false WHERE id_user=$1',[users[1]]);
  await call(base+'/'+own.id+'/tarea',400,'PATCH',{idTarea:ownTask.id,expectedVersion:1,estado:'Completada'});assert.deepEqual(await counts(own.id),{tareas:1,eventos:1});
  await call(base+'/'+own.id+'/tarea',200,'PATCH',{idTarea:ownTask.id,expectedVersion:1,estado:'Cancelada'});assert.equal((await service.detail(own.id,actor)).estado,'Cancelada');
  await writer.query('UPDATE auth_user SET is_active=true WHERE id_user=$1',[users[1]]);checked('ACL404 ajeno, permiso delegable y asignación protegida; responsable inactivo impide crear siguiente paso pero permite cancelar sin perder historia');
  const rollback=await service.start({...startDto,requestId:randomUUID()},actor);const rollbackDetail=await service.detail(rollback.id,actor),rt=rollbackDetail.pasos[0].tarea;
  await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_c02_failure CHECK(table_name<>'crm_secuencia_evento') NOT VALID");
  try{await assert.rejects(service.transition(rollback.id,{idTarea:rt.id,expectedVersion:1,estado:'Completada'},actor),e=>e.code==='23514');}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_c02_failure');}
  assert.deepEqual(await counts(rollback.id),{tareas:1,eventos:1});assert.equal((await service.detail(rollback.id,actor)).pasos[0].tarea.estado,'Pendiente');
  for(const table of['crm_secuencia_modelo','crm_secuencia_evento']){await assert.rejects(writer.query('TRUNCATE '+table+' CASCADE'),e=>e.code==='P0001');await assert.rejects(writer.query('DELETE FROM '+table+' WHERE false'),e=>e.code==='P0001');}
  await assert.rejects(writer.query('DELETE FROM crm_tarea WHERE id_tarea=$1',[rt.id]),e=>e.code==='P0001');
  const audit=(await writer.query("SELECT app_user_id FROM auditoria_jsonb WHERE table_name IN('crm_secuencia_modelo','crm_secuencia','crm_secuencia_evento')")).rows;assert.ok(audit.length);assert.ok(audit.every(a=>[users[0],users[1]].includes(a.app_user_id)));
  checked('Historial/modelos inmutables, tarea preservada, auditoría con actor y fallo forzado revierte estado/evento/siguiente tarea completos');
  const notification=app.get(require('./dist/notification/notification.service').NotificationService);await notification.refreshOperationalAlerts();
  assert.equal((await writer.query("SELECT count(*)::int n FROM app_notification WHERE type='crm_task_overdue' AND source_id=$1",[rt.id])).rows[0].n,1);await notification.refreshOperationalAlerts();
  assert.equal((await writer.query("SELECT count(*)::int n FROM app_notification WHERE type='crm_task_overdue' AND source_id=$1",[rt.id])).rows[0].n,1);
  await service.transition(rollback.id,{idTarea:rt.id,expectedVersion:1,estado:'Cancelada'},actor);await notification.refreshOperationalAlerts();assert.ok((await writer.query("SELECT read_at FROM app_notification WHERE type='crm_task_overdue' AND source_id=$1",[rt.id])).rows[0].read_at);
  checked('Reutilización real del generador de alertas: vencida deduplicada y atendida al cancelar, sin cron nuevo');
  const revokedDto={...startDto,requestId:randomUUID(),idCliente:clients[1]};await writer.query('BEGIN');await writer.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-secuencias:v1',0))");
  const waiting=service.start(revokedDto,actor).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));let blocked=false;
  for(let i=0;i<100;i++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
  await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[0]]);await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);
  assert.equal((await writer.query('SELECT count(*)::int n FROM crm_secuencia WHERE id_secuencia=$1',[revokedDto.requestId])).rows[0].n,0);tokens[0]=(await auth.login(names[0],password)).access_token;checked('Revocación mientras espera guardia real: vuelve a validar la cuenta antes de escribir');
  if(withControl){stage='C02.2a controles';await require('./verify-crm-sequence-control').backend({app,writer,control,database,service,auth,tokens,users,clients,call,checked,names,password});}
  if(withRules){stage='C02.2b reglas';await require('./verify-crm-sequence-rules').backend({app,writer,control,database,sequences:service,auth,tokens,users,clients,call,checked,names,password});}
  stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;browser=await chromium.launch();const errors=[];
  for(const[theme,width]of[['light',1280],['dark',390]]){
   const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.name));await page.addInitScript(t=>localStorage.setItem('theme',t),theme);
   await page.goto(origin+'/login?returnUrl=%2Fcrm%2Fsecuencias');await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/crm/secuencias');
   await expect(page.getByText('Consultando o guardando…',{exact:true})).toBeHidden();const modelName='Modelo UI '+theme;
   await page.getByLabel('Nombre del modelo',{exact:true}).fill(modelName);await page.getByLabel('Título del paso 1',{exact:true}).fill('Revisar datos de unidad');if(withControl)await page.getByLabel('Horas para completar el paso 1',{exact:true}).fill('0');await page.getByRole('button',{name:'Agregar paso',exact:true}).click();await page.getByLabel('Título del paso 2',{exact:true}).fill('Revisar cotización');await page.getByLabel('Horas para completar el paso 2',{exact:true}).fill('48');await page.getByRole('button',{name:'Guardar modelo',exact:true}).click();
   await expect(page.getByText('Consultando o guardando…',{exact:true})).toBeHidden();await expect(page.getByText(/Modelo guardado/)).toBeVisible();await page.getByLabel('Modelo de seguimiento',{exact:true}).selectOption({label:modelName});
   await page.getByLabel('Buscar cliente por nombre o RFC',{exact:true}).fill('Cliente C02 Alfa');await page.getByRole('button',{name:'Buscar clientes',exact:true}).click();await expect(page.getByText('Consultando o guardando…',{exact:true})).toBeHidden();await page.getByLabel('Cliente de la secuencia',{exact:true}).selectOption({label:'Cliente C02 Alfa · S20010101AA1'});
   await page.getByLabel('Motivo del seguimiento',{exact:true}).fill('Seguimiento UI '+theme);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Iniciar secuencia',exact:true}).click();let dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Iniciar secuencia interna',exact:true})});await dialog.getByRole('button',{name:'Iniciar secuencia',exact:true}).click();
   await expect(page.getByRole('heading',{name:modelName,exact:true})).toBeVisible();await expect(page.getByText('Activa · Paso 1 de 2',{exact:true})).toBeVisible();if(withControl)await require('./verify-crm-sequence-control').ui({page,names,theme,expect,root});await page.getByRole('button',{name:'Completar paso',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Completar paso',exact:true})});await dialog.getByRole('button',{name:'Completar paso',exact:true}).click();await expect(page.getByText('Activa · Paso 2 de 2',{exact:true})).toBeVisible();
   assert.deepEqual((await new AxeBuilder({page}).include('app-crm-secuencias').analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('heading',{name:'Secuencias de seguimiento',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'.artifacts/'+(withControl?'c022-control-':'c02-secuencias-')+theme+'.png')});
   await page.getByRole('button',{name:'Cancelar secuencia',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Cancelar secuencia',exact:true})});await dialog.getByRole('button',{name:'Cancelar secuencia',exact:true}).click();await expect(page.getByText('Cancelada · Paso 2 de 2',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Cancelada · Paso 2 de 2',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Volver a ejecuciones',exact:true}).click();await expect(page.getByText('Consultando o guardando…',{exact:true})).toBeHidden();const row=page.locator('app-crm-secuencias article').filter({has:page.getByRole('heading',{name:modelName,exact:true})});await row.getByRole('button',{name:'Ver seguimiento',exact:true}).click();await expect(page.getByText('Cancelada · Paso 2 de 2',{exact:true})).toBeVisible();if(withRules)await require('./verify-crm-sequence-rules').ui({page,theme,expect,root,call,clients,modelId:model.id});await context.close();
  }
  assert.deepEqual(errors,[]);checked(withControl?'Angular real claro1280/oscuro390: modelo/cliente/inicio, pausa y recarga, reanudación/reasignación/historial, avance/cancelación, axe/reflujo/errores JS':'Angular real claro1280/oscuro390: crear modelo, buscar cliente, revisar/iniciar/completar/cancelar y recargar historial; axe/reflujo/errores JS');
  if(withRules)checked('Angular real reglas claro1280/oscuro390: crear/revisar, evento real API, confirmar inicio, origen/procesado/historial, navegar/cancelar secuencia y recargar; axe/reflujo');
  const after=(await writer.query('SELECT (SELECT count(*) FROM crm_comunicacion)::int comunicaciones,(SELECT count(*) FROM factura)::int facturas')).rows[0];assert.equal(after.comunicaciones,before.comunicaciones);assert.equal(after.facturas,before.facturas);checked('No crea comunicaciones ficticias, facturas ni envíos externos; cohortes sólo en copia propia');
  report.passed=true;report.completedAt=new Date().toISOString();

 }finally{
  const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
  if(created&&/^verify_sequences_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
  await control.end();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,withRules?'.artifacts/c022b-reglas.json':withControl?'.artifacts/c022-control.json':'.artifacts/c02-secuencias.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
 }
}
main().catch(error=>{console.error('Falló aceptación C02:',error instanceof assert.AssertionError?error.message:[error.name,error.code,error.constraint].filter(Boolean).join(' '),(error.stack||'').split('\n').filter(l=>/^\s+at /.test(l)).slice(0,3).join('\n'),'Etapa en '+(process.argv.includes('--rules')?'.artifacts/c022b-reglas.json':process.argv.includes('--control')?'.artifacts/c022-control.json':'.artifacts/c02-secuencias.json')+'; sin secretos.');process.exitCode=1;});
