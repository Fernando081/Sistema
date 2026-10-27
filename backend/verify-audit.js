/* S03.1: AppModule/PostgreSQL/Angular reales en copia desechable. Nunca imprime secretos. */
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),express=require('express');
const {randomBytes}=require('node:crypto'),{execFileSync}=require('node:child_process'),{once}=require('node:events');
const {Client}=require('pg'),{Test}=require('@nestjs/testing'),{DataSource}=require('typeorm'),{SchedulerRegistry}=require('@nestjs/schedule');
const {chromium,expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const {databaseConfig}=require('./db-config'),{findPgTool,postgresEnvironment}=require('./backup');

function preview(api,directory){const site=express();site.use('/api',(req,res)=>{
  const request=http.request(new URL(req.originalUrl,api),{method:req.method,headers:{...req.headers,host:new URL(api).host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(request);
});site.use(express.static(directory));site.get(/.*/,(_req,res)=>res.sendFile(path.join(directory,'index.html')));return http.createServer(site);}

async function main(){
  assert.equal(process.versions.node.split('.')[0],'24');const root=path.resolve(__dirname,'..');
  const argument=process.argv.find(value=>value.startsWith('--backup='));assert.ok(argument,'Falta --backup bajo .backups');
  const dump=fs.realpathSync(path.resolve(argument.slice(9)));assert.ok(dump.startsWith(fs.realpathSync(path.join(root,'.backups'))+path.sep));
  const config=databaseConfig();assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(config.connectionString?new URL(config.connectionString).hostname:config.host));
  const control=new Client(config),database='verify_audit_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'S03.1',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
  const checked=name=>{report.checks.push(name);console.log('OK:',name);};let stage='restore';
  await control.connect();
  try{
    assert.notEqual((await control.query('SELECT current_database() name')).rows[0].name,database);
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
    execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);
    const historyProbe=new Client({connectionString:url.toString()});await historyProbe.connect();
    const enrichedBackup=(await historyProbe.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='auditoria_jsonb' AND column_name='protection_version') present")).rows[0].present;
    report.restoredMigration098AlreadyPresent=enrichedBackup;
    const historyRecord=enrichedBackup?'to_jsonb(a)':"(to_jsonb(a)-ARRAY['actor_name','protection_version','credential_changed'])";
    const historySql=`SELECT count(*)::int n,COALESCE(max(id),0)::int maximum,md5(COALESCE(string_agg(md5(${historyRecord}::text),'' ORDER BY id),'')) fingerprint FROM auditoria_jsonb a`;
    let originalHistory;try{await historyProbe.query("INSERT INTO auditoria_jsonb(table_name,action,new_record) VALUES('legacy_fixture','INSERT','{\"fixture\":true}'::jsonb)");
      originalHistory=(await historyProbe.query(historySql)).rows[0];}finally{await historyProbe.end();}
    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
    writer=new Client({connectionString:url.toString()});await writer.connect();await writer.query('UPDATE auth_user SET is_active=false');
    const {AuthService}=require('./dist/auth/auth.service');
    const password=randomBytes(24).toString('hex'),username='audit_'+randomBytes(8).toString('hex'),hash=await AuthService.hashPassword(password);
    const id=(await writer.query("INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,'admin',true,0) RETURNING id_user",[username,hash])).rows[0].id_user;
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),
      AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    checked('098 verificada y aplicada solo en copia restaurada; AppModule real, fiscal mock y cron detenido');
    const historyAfter=(await writer.query(historySql+' WHERE id<=$1',[originalHistory.maximum])).rows[0];
    assert.equal(historyAfter.n,originalHistory.n);assert.equal(historyAfter.fingerprint,originalHistory.fingerprint);
    const legacy=(await writer.query("SELECT actor_name,protection_version FROM auditoria_jsonb WHERE table_name='legacy_fixture' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(legacy.actor_name,null);assert.equal(legacy.protection_version,enrichedBackup?1:0);
    checked('Historial anterior conservado campo a campo mediante huella y sin instantáneas/actores retroactivos');
    const call=async(route,token,status,method='GET',body)=>{
      const response=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,status,route+': HTTP'+response.status+' esperado'+status);return {body:await response.json(),cache:response.headers.get('cache-control')};
    };
    let token=(await auth.login(username,password)).access_token,actor=auth.verify(token);
    await call('auditoria',null,401);await call('auditoria/estado',null,401);
    const state=await call('auditoria/estado',token,200);assert.equal(state.cache,'private, no-store');assert.equal(state.body.appendOnly,true);assert.equal(state.body.actorSnapshots,true);assert.equal(state.body.accessTables,7);
    const registered=await call('auth/register',token,201,'POST',{username:'operator_'+randomBytes(6).toString('hex'),password,role:'user'});
    const operatorId=registered.body.idUser,operatorName=registered.body.username,operator=(await auth.login(operatorName,password)).access_token;
    await call('auditoria',operator,403);await call('auditoria/estado',operator,403);
    const profile=await call('auth/access-profiles',token,201,'POST',{name:'Audit '+randomBytes(4).toString('hex'),description:'Solo copia',permissions:['ventas.crear']});
    await call('auth/users/'+operatorId+'/permissions',token,200,'PUT',{permissions:[{permissionCode:'ventas.crear',granted:true}],accessVersion:0});
    await call('auth/users/'+operatorId,token,200,'PATCH',{isActive:false});await call('auth/users/'+operatorId,token,200,'PATCH',{isActive:true});
    const entries=(await writer.query("SELECT * FROM auditoria_jsonb WHERE protection_version=1 AND table_name IN ('auth_user','app_user_permission','app_access_profile','app_access_profile_permission') ORDER BY id DESC")).rows;
    const createdEvent=entries.find(row=>row.table_name==='auth_user'&&row.action==='INSERT'&&row.new_record.id_user===operatorId);
    assert.ok(createdEvent);assert.equal(createdEvent.app_user_id,id);assert.ok(createdEvent.actor_name===username);
    for(const row of entries){
      for(const record of [row.old_record,row.new_record])if(record){assert.ok(!('password_hash' in record));assert.ok(!('secret_box' in record));assert.ok(!JSON.stringify(record).includes(password));}
    }
    const operatorFresh=(await auth.login(operatorName,password)).access_token,newPassword=randomBytes(24).toString('hex');
    await auth.changePassword(auth.verify(operatorFresh),{currentPassword:password,newPassword});
    const credentialEvent=(await writer.query("SELECT * FROM auditoria_jsonb WHERE table_name='auth_user' AND credential_changed ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(credentialEvent.app_user_id,operatorId);assert.ok(credentialEvent.actor_name===operatorName);
    assert.ok(!JSON.stringify(credentialEvent).includes(newPassword));
    checked('API ADMIN privada/operador403; alta, permisos, perfil, estado y contraseña auditados con actor; hashes/secretos excluidos por whitelist');
    const target=createdEvent.id;
    for(const sql of ["UPDATE auditoria_jsonb SET db_user='tamper' WHERE id=$1","DELETE FROM auditoria_jsonb WHERE id=$1"]){
      await assert.rejects(()=>writer.query(sql,[target]),error=>error.code==='42501');
    }
    await assert.rejects(()=>writer.query('TRUNCATE auditoria_jsonb'),error=>error.code==='42501');
    const isSuper=(await writer.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper;
    if(isSuper){await writer.query("SET session_replication_role='replica'");try{await assert.rejects(()=>writer.query('TRUNCATE auditoria_jsonb'),error=>error.code==='42501');}finally{await writer.query("SET session_replication_role='origin'");}}
    assert.equal((await writer.query('SELECT count(*)::int n FROM auditoria_jsonb WHERE id=$1',[target])).rows[0].n,1);
    checked('UPDATE,DELETE y TRUNCATE rechazados por PostgreSQL; guard ALWAYS también bajo replica cuando el rol permite ensayarlo');
    await assert.rejects(()=>writer.query("INSERT INTO auditoria_jsonb(table_name,action,new_record) VALUES('auth_mfa','INSERT','{}'::jsonb)"),error=>error.code==='42501');
    const source=app.get(DataSource),profiles=app.get(require('./dist/auth/access-profile.service').AccessProfileService);
    const countBefore=(await writer.query('SELECT count(*)::int n FROM auditoria_jsonb')).rows[0].n,failedName='Rollback '+randomBytes(5).toString('hex');
    await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_audit_write_failure CHECK(table_name<>'app_access_profile') NOT VALID");
    try{await assert.rejects(()=>profiles.create({name:failedName,description:'Solo copia',permissions:['ventas.crear']},actor));}
    finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_audit_write_failure');}
    assert.equal((await writer.query('SELECT count(*)::int n FROM app_access_profile WHERE name=$1',[failedName])).rows[0].n,0);
    assert.equal((await writer.query('SELECT count(*)::int n FROM auditoria_jsonb')).rows[0].n,countBefore);
    const runner=source.createQueryRunner();await runner.connect();try{
      await runner.startTransaction();await require('./dist/auth/audit-actor').setAuditActor(runner.manager,id);
      assert.ok((await runner.query("SELECT current_setting('app.current_user_id',true) actor"))[0].actor===String(id));
      await runner.commitTransaction();assert.ok(!(await runner.query("SELECT current_setting('app.current_user_id',true) actor"))[0].actor);
    }finally{if(runner.isTransactionActive)await runner.rollbackTransaction();await runner.release();}
    checked('Fallo al escribir auditoría revierte perfil y eventos; contexto LOCAL desaparece al devolver la conexión');
    const updatedName='renamed_'+randomBytes(6).toString('hex');
    await writer.query('UPDATE auth_user SET username=$2 WHERE id_user=$1',[id,updatedName]);
    token=(await auth.login(updatedName,password)).access_token;actor=auth.verify(token);
    const unchanged=(await writer.query('SELECT actor_name,app_user_id FROM auditoria_jsonb WHERE id=$1',[target])).rows[0];
    assert.ok(unchanged.actor_name===username);assert.equal(unchanged.app_user_id,id);
    const temporary=await auth.register('temporary_'+randomBytes(4).toString('hex'),password,'user',actor),temporaryToken=(await auth.login(temporary.username,password)).access_token;
    await auth.changePassword(auth.verify(temporaryToken),{currentPassword:password,newPassword});
    const preserved=(await writer.query("SELECT id FROM auditoria_jsonb WHERE table_name='auth_user' AND app_user_id=$1 ORDER BY id DESC LIMIT 1",[temporary.idUser])).rows[0];
    await writer.query('DELETE FROM auth_user WHERE id_user=$1',[temporary.idUser]);
    const deletedActorEvent=(await writer.query('SELECT actor_name,app_user_id FROM auditoria_jsonb WHERE id=$1',[preserved.id])).rows[0];
    assert.equal(deletedActorEvent.app_user_id,temporary.idUser);assert.ok(deletedActorEvent.actor_name===temporary.username);
    const logs=await call('auditoria',token,200);assert.equal(logs.cache,'private, no-store');assert.ok(logs.body.length<=500);
    assert.ok(logs.body.find(row=>row.id===target).app_username===username);
    checked('Renombrar/eliminar usuarios no reescribe ID o nombre histórico; consulta estable y acotada, sin atribución retroactiva');
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const errors=[],screens=[];
    for(const [theme,width]of [['light',1280],['dark',390]]){
      const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.on('pageerror',e=>{
        errors.push(e.name);report.browserErrors??=[];report.browserErrors.push({name:e.name,code:e.message.match(/NG\d+/)?.[0],
          property:e.message.match(/Cannot read properties of (?:undefined|null) \(reading '[^']{1,50}'\)/)?.[0],frames:(e.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3)});
      });
      await page.addInitScript(value=>localStorage.setItem('theme',value),theme);await page.goto(origin+'/login?returnUrl=%2Freportes%2Fauditoria');
      await page.getByLabel('Usuario',{exact:true}).fill(updatedName);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
      stage='Angular heading '+theme;await page.waitForURL('**/reportes/auditoria');await expect(page.getByRole('heading',{name:'Protección de la bitácora',exact:true})).toBeVisible();
      await expect(page.getByText('Bloqueo de modificación, borrado y vaciado activo.',{exact:true})).toBeVisible();
      stage='Angular paginator '+theme;
      await page.getByRole('combobox').evaluate(element=>element.scrollIntoView({block:'center'}));
      report.uiDiagnostics=await page.getByRole('combobox').evaluate(element=>{
        const rect=element.getBoundingClientRect(),ancestors=[];let parent=element.parentElement;
        while(parent){const box=parent.getBoundingClientRect(),style=getComputedStyle(parent);ancestors.push({tag:parent.tagName,class:parent.className,top:box.top,height:box.height,client:parent.clientHeight,scroll:parent.scrollHeight,overflow:style.overflow});parent=parent.parentElement;}
        return {rect:rect.toJSON(),ancestors,point:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.className};
      });
      // Material coloca su área táctil sobre mat-select y delega open() al mismo control.
      await page.locator('.mat-mdc-paginator-touch-target').click({timeout:15000});
      await page.getByRole('option',{name:'100',exact:true}).click({timeout:15000});
      await page.getByRole('combobox').focus();await page.getByRole('combobox').press('Enter');
      await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Escape');
      stage='Angular snapshot '+theme;await expect(page.getByText(username,{exact:true}).first()).toBeVisible();
      assert.deepEqual((await new AxeBuilder({page}).include('.audit-page').analyze()).violations,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('.audit-status').screenshot({path:path.join(root,'.artifacts','s031-audit-'+theme+'.png')});screens.push(page);
    }
    checked('Angular producción con dos logins reales: instantánea correcta, advertencia de privilegios, temas1280/390, scroll y axe sin infracciones');
    await writer.query('ALTER TABLE auditoria_jsonb DISABLE TRIGGER trg_audit_append_only');
    try{const page=screens[0];await page.getByRole('button',{name:'Actualizar bitácora',exact:true}).click();await expect(page.getByText('Protección incompleta: revisar los controles de PostgreSQL.',{exact:true})).toBeVisible();
      assert.equal((await call('auditoria/estado',token,200)).body.appendOnly,false);
    }finally{await writer.query('ALTER TABLE auditoria_jsonb ENABLE ALWAYS TRIGGER trg_audit_append_only');}
    await screens[0].getByRole('button',{name:'Actualizar bitácora',exact:true}).click();await expect(screens[0].getByText('Bloqueo de modificación, borrado y vaciado activo.',{exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);checked('Deshabilitar control en copia se detecta en API/UI sin afirmar integridad; control restaurado y recursos listos para cierre');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_audit_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/s031-audit.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de auditoría:',error instanceof assert.AssertionError?error.message:error.name,
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/s031-audit.json; sin secretos en salida.');process.exitCode=1;});
