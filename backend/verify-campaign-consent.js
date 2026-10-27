/* C01.1: AppModule/SQL/Angular reales en copia propia. No envía comunicaciones. */
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),express=require('express');
const {randomBytes,randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process'),{once}=require('node:events');
const {Client}=require('pg'),{Test}=require('@nestjs/testing'),{DataSource}=require('typeorm'),{SchedulerRegistry}=require('@nestjs/schedule');
const {chromium,expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const {databaseConfig}=require('./db-config'),{findPgTool,postgresEnvironment}=require('./backup');
function preview(api,directory){const site=express();site.use('/api',(req,res)=>{const request=http.request(new URL(req.originalUrl,api),{method:req.method,headers:{...req.headers,host:new URL(api).host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(request);});site.use(express.static(directory));site.get(/.*/,(_req,res)=>res.sendFile(path.join(directory,'index.html')));return http.createServer(site);}
async function main(){
 const root=path.resolve(__dirname,'..');assert.equal(process.versions.node.split('.')[0],'24');
 const arg=process.argv.find(a=>a.startsWith('--backup='));assert.ok(arg,'Falta respaldo local');const dump=fs.realpathSync(path.resolve(arg.slice(9)));assert.ok(dump.startsWith(fs.realpathSync(path.join(root,'.backups'))+path.sep));
 const config=databaseConfig();assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(config.connectionString?new URL(config.connectionString).hostname:config.host));
 const control=new Client(config),database='verify_campaigns_'+randomBytes(8).toString('hex'),url=new URL(config.connectionString||'postgresql://127.0.0.1');
 if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
 const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const report={phase:'C01.1',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false,externalDeliveryEnabled:false};
 const checked=name=>{report.checks.push(name);console.log('OK:',name);};let created=false,app,writer,browser,server,stage='restore';
 await control.connect();try{
  await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
  const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
  execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);
  execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
  writer=new Client({connectionString:url.toString()});await writer.connect();assert.equal((await writer.query('SELECT current_database() name')).rows[0].name,database);
  await writer.query('UPDATE auth_user SET is_active=false');
  // Cohorte sintética aislada: el respaldo puede contener otras oportunidades Taller.
  await writer.query("UPDATE crm_oportunidad SET tipo_cliente='Otro' WHERE tipo_cliente='Taller'");
  const {AuthService}=require('./dist/auth/auth.service'),password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['campaign_admin_','campaign_user_'].map(n=>n+randomBytes(4).toString('hex')),users=[];
  for(const[i,name]of names.entries())users.push((await writer.query('INSERT INTO auth_user(username,password_hash,role,is_active,token_version)VALUES($1,$2,$3,true,0)RETURNING id_user',[name,hash,i?'user':'admin'])).rows[0].id_user);
  Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
  stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
  const ds=app.get(DataSource);assert.equal((await ds.query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService),tokens=await Promise.all(names.map(async n=>(await auth.login(n,password)).access_token)),actor=auth.verify(tokens[0]);
  const service=app.get(require('./dist/crm/campana-consentimiento.service').CampanaConsentimientoService),policy=require('./dist/crm/campana-consentimiento-policy');
  const call=async(route,status=200,method='GET',body,token=tokens[0])=>{const r=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json();assert.equal(r.status,status,route+': HTTP'+r.status+' esperado'+status+(typeof data.message==='string'?' '+data.message:''));return{data,cache:r.headers.get('cache-control')};};
  stage='fixtures';const clients=[];for(const[i,name]of['Cliente C01 Alfa','Cliente C01 Beta','Cliente C01 Sin contactos'].entries()){
   clients.push((await writer.query(`INSERT INTO cliente("RFC","RazonSocial","Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI") SELECT $1,$2,"Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI" FROM cliente ORDER BY "IdCliente" LIMIT 1 RETURNING "IdCliente" AS id`,['C0'+i+'010101AA1',name])).rows[0].id);
   await call('crm/oportunidades',201,'POST',{idCliente:clients[i],empresa:name,tipoCliente:i===1?'Otro':'Taller',etapa:'Prospecto',montoEstimado:0});
  }
  const contact=async(client,nombre,email,telefono='8331234567')=>(await call('cliente/'+client+'/contactos',201,'POST',{nombre,email,telefono,canalPreferido:'Email',esPrincipal:false})).data.idContacto;
  const contacts={ana:await contact(clients[0],'Ana principal','Shared@EXAMPLE.TEST'),duplicado:await contact(clients[0],'Ana duplicada','shared@example.test'),sin:await contact(clients[0],'Contacto sin permiso','sin@example.test'),vencido:await contact(clients[0],'Contacto vencido','vence@example.test'),invalido:await contact(clients[0],'Contacto inválido',null,'incompleto'),beta:await contact(clients[1],'Beta compartido','SHARED@example.test')};
  const segment=(await call('crm/segmentos',201,'POST',{nombre:'C01 Segmento '+randomBytes(4).toString('hex'),tipoCliente:'Taller'})).data.idSegmento;
  const template=(await call('crm/plantillas',201,'POST',{nombre:'C01 Plantilla',canal:'Correo',asunto:'Piezas disponibles',contenido:'Contenido de prueba para revisión, sin envío.'})).data.idPlantilla;
  const campaign=(await call('crm/campanas',201,'POST',{nombre:'C01 Campaña '+randomBytes(3).toString('hex'),idSegmento:segment,idPlantilla:template,objetivo:'Preparación local sin envío'})).data.idCampana;
  const cp=client=>'clientes/'+client+'/consentimiento-comercial',ep='crm/campanas-locales/'+campaign;
  const query={page:1,q:''},cq={...query,canal:'Correo'};
  await call(ep+'/destinatarios',401,'GET',undefined,null);await call(ep+'/destinatarios',403,'GET',undefined,tokens[1]);await call(cp(clients[0]),403,'GET',undefined,tokens[1]);
  await call(cp(clients[0])+'?canal=Visita',400);await call(ep+'/destinatarios?idCliente='+clients[1],400);
  let review=(await call(ep+'/destinatarios')).data;assert.equal(review.metricas.elegibles,0);assert.equal(review.metricas.clientesSinContacto,1);assert.equal(review.metricas.contactosEvaluados,5);assert.equal((await call(cp(clients[0]))).cache,'private, no-store');
  checked('106 sin consentimiento implícito; permiso independiente401/403, DTO/tipos cerrados/no idCliente inyectado, clientes sin contactos y destinos inválidos excluidos');
  // Estado comercial sintético sobre factura sin partidas en la copia: no se timbra ni mueve inventario.
  await writer.query('UPDATE crm_segmento SET dias_inactivo=30 WHERE id_segmento=$1',[segment]);
  const invoice=(await writer.query(`INSERT INTO factura(id_cliente,serie,folio,estatus,rfc_receptor,nombre_receptor,codigo_postal_receptor,regimen_fiscal_receptor_clave,uso_cfdi_clave)
   VALUES($1,'C01',$2,'Cancelada','XAXX010101000','Fixture de segmentación','89318','616','S01')RETURNING id_factura`,[clients[0],randomBytes(3).readUIntBE(0,3)])).rows[0].id_factura;
  const segmentCount=async()=>{const s=(await call('crm/segmentos')).data.find(s=>s.idSegmento===segment),p=await service.preview(campaign,query,actor);assert.equal(s.clientes,p.metricas.clientesSegmento);return s.clientes;};
  assert.equal(await segmentCount(),2);await writer.query("UPDATE factura SET estatus='Pendiente' WHERE id_factura=$1",[invoice]);assert.equal(await segmentCount(),2);
  await writer.query("UPDATE factura SET estatus='Timbrada' WHERE id_factura=$1",[invoice]);assert.equal(await segmentCount(),1);
  await writer.query("UPDATE factura SET tipo_comprobante='E' WHERE id_factura=$1",[invoice]);assert.equal(await segmentCount(),2);
  const cutoff="(((transaction_timestamp() AT TIME ZONE 'America/Mexico_City')::date-30)::timestamp AT TIME ZONE 'America/Mexico_City')";
  await writer.query(`UPDATE factura SET tipo_comprobante='I',estatus='Pagada',fecha_emision=${cutoff}-interval '1 microsecond' WHERE id_factura=$1`,[invoice]);assert.equal(await segmentCount(),2);
  await writer.query(`UPDATE factura SET fecha_emision=${cutoff} WHERE id_factura=$1`,[invoice]);assert.equal(await segmentCount(),1);
  await writer.query("UPDATE factura SET estatus='Cancelada' WHERE id_factura=$1",[invoice]);await writer.query('UPDATE crm_segmento SET dias_inactivo=NULL WHERE id_segmento=$1',[segment]);
  checked('Segmentación compartida: canceladas/pendientes/notas de crédito no reinician inactividad; ingresos Timbrada/Pagada sí, con corte exacto de fecha Tampico');
  const decision=async(client,id,estado='Autorizado',extra={})=>{const row=(await service.contacts(client,cq,actor)).data.find(c=>c.id===id);assert.ok(row);return{requestId:randomUUID(),canal:'Correo',estado,versionAnterior:row.version,destinoHuella:row.destinoHuella,ocurridaEn:new Date(Date.now()-1000).toISOString(),fuente:'Documento',referencia:'C01 evidencia declarada en copia',motivo:'Prueba autorizada',confirmacion:true,...extra};};
  const first=await decision(clients[0],contacts.ana);const record=(await call(cp(clients[0])+'/'+contacts.ana,201,'POST',first)).data;
  assert.equal((await call(cp(clients[0])+'/'+contacts.ana,201,'POST',first)).data.id,record.id);
  await call(cp(clients[0])+'/'+contacts.ana,409,'POST',{...first,motivo:'otro'});
  await call(cp(clients[0])+'/'+contacts.ana,400,'POST',{...first,requestId:randomUUID(),confirmacion:false});
  await call(cp(clients[0])+'/'+contacts.ana,400,'POST',{...first,requestId:randomUUID(),destino:'inyectado@example.test'});
  await call(cp(clients[1])+'/'+contacts.ana,404,'POST',{...first,requestId:randomUUID()});
  await call(cp(clients[0])+'/'+contacts.ana,400,'POST',{...first,requestId:randomUUID(),versionAnterior:1,ocurridaEn:new Date(Date.now()+3600000).toISOString()});
  await service.consent(clients[0],contacts.duplicado,await decision(clients[0],contacts.duplicado),actor);
  const expiry=new Date(Date.now()+1500);await service.consent(clients[0],contacts.vencido,await decision(clients[0],contacts.vencido,'Autorizado',{venceEn:expiry.toISOString()}),actor);await new Promise(r=>setTimeout(r,Math.max(0,expiry.getTime()-Date.now()+50)));
  review=(await call(ep+'/destinatarios')).data;assert.equal(review.metricas.elegibles,1);assert.equal(review.metricas.motivos.Duplicado,1);assert.equal(review.metricas.motivos.Vencido,1);assert.equal(review.metricas.motivos['Sin autorización'],1);assert.equal(review.metricas.motivos['Destino inválido'],1);assert.ok(review.data.every(r=>!('destinoHash'in r)&&!r.destino.includes('shared@')));
  const segmentRow=(await call('crm/segmentos')).data.find(s=>s.idSegmento===segment);assert.equal(segmentRow.clientes,review.metricas.clientesSegmento);
  checked('Autorización declarada/versionada e idempotente; sin campos de destino libres, fecha futura rechazada, contacto ajeno404; vigencia real vencida, deduplicación y conteo de segmento consistente');
  const prep={requestId:randomUUID(),evaluacionSha256:review.evaluacionSha256,motivo:'Revisión antes de conservar',confirmacion:true};
  const savedPrep=(await call(ep+'/preparar',201,'POST',prep)).data;assert.ok(savedPrep.actual);assert.equal((await call(ep+'/preparar',201,'POST',prep)).data.id,savedPrep.id);
  const countBefore=(await writer.query('SELECT count(*)::int n FROM crm_comunicacion')).rows[0].n;
  assert.equal((await writer.query('SELECT estado FROM crm_campana WHERE id_campana=$1',[campaign])).rows[0].estado,'Borrador');
  const snapshot=(await writer.query('SELECT snapshot FROM crm_campana_preparacion WHERE id_preparacion=$1',[savedPrep.id])).rows[0].snapshot;const serialized=JSON.stringify(snapshot);assert.ok(!serialized.includes('shared@example.test'));assert.ok(!serialized.includes('Ana principal'));
  checked('Preparación local conservada/idempotente con huella y referencias técnicas; campaña sigue Borrador y no crea comunicaciones ni duplica datos de contacto');
  const betaBaja=await decision(clients[1],contacts.beta,'Baja',{ocurridaEn:new Date(Date.now()-5000).toISOString()});await service.consent(clients[1],contacts.beta,betaBaja,actor);
  review=(await call(ep+'/destinatarios')).data;assert.equal(review.metricas.elegibles,0);assert.equal(review.metricas.motivos.Baja,2);assert.ok(!review.ultima.actual);
  await assert.rejects(service.prepare(campaign,{...prep,requestId:randomUUID()},actor),e=>e.getStatus?.()===409);assert.ok(!(await service.prepare(campaign,prep,actor)).actual);
  // Otra autorización del mismo destino en Alfa no levanta la baja de Beta.
  await service.consent(clients[0],contacts.ana,await decision(clients[0],contacts.ana),actor);assert.equal((await service.preview(campaign,query,actor)).metricas.elegibles,0);
  await assert.rejects(service.consent(clients[1],contacts.beta,await decision(clients[1],contacts.beta,'Autorizado',{ocurridaEn:betaBaja.ocurridaEn}),actor),e=>e.getStatus?.()===409);
  await service.consent(clients[1],contacts.beta,await decision(clients[1],contacts.beta),actor);assert.equal((await service.preview(campaign,query,actor)).metricas.elegibles,1);
  // Baja de contacto eliminado sigue suprimiendo variantes del mismo correo.
  await service.consent(clients[1],contacts.beta,await decision(clients[1],contacts.beta,'Baja'),actor);await call('cliente/'+clients[1]+'/contactos/'+contacts.beta,200,'DELETE');assert.equal((await service.preview(campaign,query,actor)).metricas.elegibles,0);
  checked('Baja global por destino/canal aun fuera del segmento; invalida preparación, reintento no la resucita, autorización antigua rechazada y eliminar contacto no quita la baja');
  // Dirección modificada invalida consentimiento de ese contacto y formulario anterior.
  const prior=await decision(clients[0],contacts.sin);await writer.query('UPDATE cliente_contacto SET email=$2 WHERE id_contacto=$1',[contacts.sin,'nuevo@example.test']);await assert.rejects(service.consent(clients[0],contacts.sin,prior,actor),e=>e.getStatus?.()===409);
  const nowDecision=await decision(clients[0],contacts.sin);const outcomes=await Promise.allSettled([service.consent(clients[0],contacts.sin,nowDecision,actor),service.consent(clients[0],contacts.sin,{...nowDecision,requestId:randomUUID()},actor)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.getStatus(),409);
  review=await service.preview(campaign,query,actor);const request={requestId:randomUUID(),evaluacionSha256:review.evaluacionSha256,motivo:'Concurrencia de preparación',confirmacion:true};const same=await Promise.all([service.prepare(campaign,request,actor),service.prepare(campaign,request,actor)]);assert.equal(same[0].id,same[1].id);
  await writer.query('UPDATE crm_plantilla SET contenido=$2 WHERE id_plantilla=$1',[template,'Plantilla modificada en copia']);assert.ok(!(await service.preview(campaign,query,actor)).ultima.actual);await assert.rejects(service.prepare(campaign,{...request,requestId:randomUUID()},actor),e=>e.getStatus?.()===409);
  checked('Cambio de dirección bloquea formulario viejo; dos decisiones concurrentes no sobrescriben versiones; preparación concurrente única y plantilla modificada invalida huella');
  const extra=(await writer.query(`INSERT INTO cliente_contacto(id_cliente,nombre,email) SELECT $1,'C01 exceso '||n,'exceso'||n||'@example.test' FROM generate_series(1,1001)n RETURNING id_contacto`,[clients[0]])).rows.map(r=>r.id_contacto);
  const over=await service.preview(campaign,query,actor);assert.ok(over.bloqueos.some(s=>s.includes('1000')));assert.equal(over.data.length,0);await writer.query('DELETE FROM cliente_contacto WHERE id_contacto=ANY($1::int[])',[extra]);
  const missing=(await call('crm/campanas',201,'POST',{nombre:'C01 sin configuración'})).data.idCampana;assert.ok((await service.preview(missing,query,actor)).bloqueos.length>=2);
  assert.equal((await call(cp(clients[0])+'?q=%25')).data.total,0);
  checked('Límite1000 sin lista parcial, borrador sin segmento/plantilla bloqueado y búsqueda literal/paginación privada');
  for(const table of['crm_consentimiento_comercial','crm_campana_preparacion'])await assert.rejects(writer.query('TRUNCATE '+table),e=>e.code==='P0001');
  await assert.rejects(writer.query("UPDATE crm_consentimiento_comercial SET estado='Baja' WHERE id_consentimiento=$1",[record.id]),e=>e.code==='P0001');
  const audit=(await writer.query("SELECT app_user_id,new_record::text data FROM auditoria_jsonb WHERE table_name IN('crm_consentimiento_comercial','crm_campana_preparacion')")).rows;assert.ok(audit.length>0);assert.ok(audit.every(a=>a.app_user_id===users[0]));assert.ok(audit.every(a=>!a.data.includes('shared@example.test')));
  const rollback=await decision(clients[0],contacts.sin,'Baja');await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_c01_failure CHECK(table_name<>'crm_consentimiento_comercial') NOT VALID");
  try{await assert.rejects(service.consent(clients[0],contacts.sin,rollback,actor),e=>e.code==='23514');}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_c01_failure');}assert.equal((await writer.query('SELECT count(*)::int n FROM crm_consentimiento_comercial WHERE request_id=$1',[rollback.requestId])).rows[0].n,0);
  checked('Historial append-only/ALWAYS y auditoría nominal sin destinos duplicados; fallo de auditoría revierte la decisión completa');
  await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[0]]);
  const waiting=service.consent(clients[0],contacts.sin,await decisionNoRead(rollback),actor).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));let blocked=false;
  for(let i=0;i<100;i++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);tokens[0]=(await auth.login(names[0],password)).access_token;
  checked('Personal revocado mientras espera bloqueo no registra decisiones; preparación no consume inventario, factura ni crea envíos');
  stage='ventana HTTP';console.log('Ventana real del limitador antes de UI; no se desactiva ni amplía.');
  for(let part=0;part<2;part++)await new Promise(r=>setTimeout(r,30500));
  stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;browser=await chromium.launch();const errors=[];
  for(const[theme,width]of[['light',1280],['dark',390]]){
   stage='Angular '+theme;const uiName='Contacto UI '+theme;await contact(clients[0],uiName,'ui-'+theme+'@example.test');
   const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.name));await page.addInitScript(t=>localStorage.setItem('theme',t),theme);
   await page.goto(origin+'/login?returnUrl=%2Fcliente%2F'+clients[0]);await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/cliente/'+clients[0]);
   const openConsent=async()=>{await page.getByRole('button',{name:'Consentimiento comercial',exact:true}).click();const dialog=page.getByRole('dialog').last();await expect(dialog.getByRole('heading',{name:/Consentimiento comercial/})).toBeVisible();await expect(dialog.getByText('Consultando o guardando…',{exact:true})).toBeHidden();await dialog.getByLabel('Buscar contacto',{exact:true}).fill(uiName);await dialog.getByRole('button',{name:'Buscar contactos',exact:true}).click();const row=dialog.locator('article').filter({hasText:uiName});await expect(row).toHaveCount(1);await row.getByRole('button',{name:'Registrar decisión',exact:true}).click();return dialog;};
   const fillDecision=async(dialog,state)=>{await dialog.getByLabel('Decisión',{exact:true}).selectOption(state);await dialog.getByLabel('Referencia de evidencia',{exact:true}).fill('Evidencia declarada en prueba UI');await dialog.getByLabel('Motivo del registro',{exact:true}).fill('Prueba '+theme+' '+state);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Guardar decisión',exact:true}).click();await expect(dialog.getByText(/Decisión registrada/)).toBeVisible();await expect(dialog.getByText('Consultando o guardando…',{exact:true})).toBeHidden();};
   let dialog=await openConsent();await fillDecision(dialog,'Autorizado');await expect(dialog.locator('article').filter({hasText:uiName})).toContainText('Autorizado');assert.deepEqual((await new AxeBuilder({page}).include('app-consentimiento-comercial-dialog').analyze()).violations,[]);await dialog.screenshot({path:path.join(root,'.artifacts/c01-consentimiento-'+theme+'.png')});await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
   await page.goto(origin+'/crm/campanas?campana='+campaign);await expect(page.getByRole('heading',{name:'Preparación de campañas',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:/C01 Campaña/})).toBeVisible();await page.getByLabel('Motivo de preparación',{exact:true}).fill('Revisión UI '+theme);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Conservar preparación',exact:true}).click();const confirmation=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Conservar preparación local',exact:true})});await confirmation.getByRole('button',{name:'Conservar preparación',exact:true}).click();await expect(page.getByText(/Preparación \d+ conservada/)).toBeVisible();await expect(page.getByText('Coincide con la revisión actual',{exact:true})).toBeVisible();
   assert.deepEqual((await new AxeBuilder({page}).include('app-campanas-locales').analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   // El ERP tiene scroll interno: capturar viewport, no un elemento más alto que el scrollport.
   const bottom=page.getByRole('heading',{name:'Preparación local',exact:true});await bottom.scrollIntoViewIfNeeded();await expect(bottom).toBeInViewport();await page.screenshot({path:path.join(root,'.artifacts/c01-campanas-revision-'+theme+'.png')});
   const heading=page.getByRole('heading',{name:'Preparación de campañas',exact:true});await heading.scrollIntoViewIfNeeded();await expect(heading).toBeInViewport();await page.screenshot({path:path.join(root,'.artifacts/c01-campanas-'+theme+'.png')});await page.reload();await expect(page.getByText('Coincide con la revisión actual',{exact:true})).toBeVisible();
   await page.goto(origin+'/cliente/'+clients[0]);dialog=await openConsent();await fillDecision(dialog,'Baja');await dialog.getByRole('button',{name:'Historial de decisiones',exact:true}).click();await expect(dialog.locator('article').filter({hasText:uiName}).filter({hasText:'Baja'})).toBeVisible();await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();await page.goto(origin+'/crm/campanas?campana='+campaign);await expect(page.getByText('Obsoleta: cambió la campaña o sus destinatarios',{exact:true})).toBeVisible();await context.close();
  }
  assert.deepEqual(errors,[]);assert.equal((await writer.query('SELECT count(*)::int n FROM crm_comunicacion')).rows[0].n,countBefore);checked('Angular real claro1280/oscuro390: Cliente360 registra autorización/baja, historial y preparación con revisión/confirmación/recarga/obsolescencia; axe/reflujo y sin comunicaciones creadas');
  report.passed=true;report.completedAt=new Date().toISOString();
 }finally{
  const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
  if(created&&/^verify_campaigns_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
  await control.end();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/c01-consentimiento.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
 }
}
async function decisionNoRead(dto){return{...dto,requestId:randomUUID()};}
main().catch(error=>{console.error('Falló aceptación C01:',error instanceof assert.AssertionError?error.message:[error.name,error.code,error.constraint].filter(Boolean).join(' '),(error.stack||'').split('\n').filter(l=>/^\s+at /.test(l)).slice(0,3).join('\n'),'Etapa en .artifacts/c01-consentimiento.json; sin secretos.');process.exitCode=1;});
