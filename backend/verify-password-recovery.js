/* S02.4: AppModule/PostgreSQL/Angular reales en copia desechable. Nunca imprime secretos. */
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
  const control=new Client(config),database='verify_pwreset_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'S02.4',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
  const checked=name=>{report.checks.push(name);console.log('OK:',name);};let stage='restore';
  await control.connect();
  try{
    assert.notEqual((await control.query('SELECT current_database() name')).rows[0].name,database);
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
    execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);
    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
    writer=new Client({connectionString:url.toString()});await writer.connect();await writer.query('UPDATE auth_user SET is_active=false');
    const {AuthService}=require('./dist/auth/auth.service'),{totp,digest,normalizeRecovery}=require('./dist/auth/mfa-crypto');
    const password=randomBytes(24).toString('hex'),username='recovery_'+randomBytes(8).toString('hex'),hash=await AuthService.hashPassword(password);
    const id=(await writer.query("INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,'admin',true,0) RETURNING id_user",[username,hash])).rows[0].id_user;
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),
      AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    const {PasswordRecoveryService}=require('./dist/auth/password-recovery.service'),recovery=app.get(PasswordRecoveryService);
    checked('Respaldo restaurado,097 check/migrate solo en copia; AppModule completo, fiscal mock y cron detenido');
    const call=async(route,token,status,body,headers={})=>{
      const response=await fetch(api+'/api/v1/auth/'+route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,status,route+': HTTP'+response.status+' esperado'+status);return {body:await response.json(),cookie:response.headers.get('set-cookie'),cache:response.headers.get('cache-control')};
    };
    const first=(await auth.login(username,password)).access_token,actor=auth.verify(first);
    await call('password-recovery/status',null,401);await call('password-recovery/setup',null,401,{currentPassword:password});
    const status=await call('password-recovery/status',first,200);assert.equal(status.cache,'private, no-store');assert.equal(status.body.configured,false);
    const replacementPassword=randomBytes(24).toString('hex'),unknownKey='RTT-PWD-'+randomBytes(32).toString('base64url');
    const input=(user,key,pwd=replacementPassword,code)=>({username:user,recoveryKey:key,newPassword:pwd,confirmation:pwd,...(code?{code}:{})});
    const unknown=await call('password-recovery/complete',null,400,input('unknown_'+randomBytes(8).toString('hex'),unknownKey));
    const absent=await call('password-recovery/complete',null,400,input(username,unknownKey));assert.deepEqual(unknown.body,absent.body);
    await assert.rejects(()=>recovery.begin(actor,{currentPassword:'incorrect-password'}));assert.equal((await writer.query('SELECT count(*)::int n FROM auth_password_recovery WHERE id_user=$1',[id])).rows[0].n,0);
    checked('Estado privado sin secretos, inscripción exige sesión/contraseña y recuperación desconocida/incorrecta responde igual sin modificar cuenta');
    stage='Angular setup';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const desktop=await browser.newContext({viewport:{width:1280,height:1100}}),mobile=await browser.newContext({viewport:{width:390,height:1100}}),page=await desktop.newPage(),phone=await mobile.newPage();
    await phone.addInitScript(()=>localStorage.setItem('theme','dark'));const errors=[];for(const p of [page,phone])p.on('pageerror',e=>errors.push(e.name));
    async function login(p,user,pwd,code){await p.goto(origin+'/login?returnUrl=%2Fperfil');await p.getByLabel('Usuario',{exact:true}).fill(user);await p.getByLabel('Contraseña',{exact:true}).fill(pwd);await p.getByRole('button',{name:'Entrar',exact:true}).click();
      if(code){await p.getByLabel('Código de verificación o respaldo',{exact:true}).fill(code);await p.getByRole('button',{name:'Verificar e ingresar',exact:true}).click();}await p.waitForURL('**/perfil');}
    const beginUi=async(p,pwd,code='')=>{const panel=p.locator('app-password-recovery-settings');await panel.getByLabel('Contraseña actual para recuperar acceso',{exact:true}).fill(pwd);
      if(code)await panel.getByLabel('Código MFA, si está activado',{exact:true}).fill(code);
      const [response]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/password-recovery/setup')),panel.getByRole('button',{name:/^(Generar|Reemplazar) clave de recuperación$/}).click()]);
      assert.equal(response.status(),201);return (await response.json()).recoveryKey;};
    const confirmUi=async(p,key)=>{const panel=p.locator('app-password-recovery-settings');await panel.getByLabel('Repite la clave que guardaste',{exact:true}).fill(key);
      await panel.getByRole('button',{name:'Confirmar que guardé mi clave',exact:true}).click();await expect(panel.getByText('Clave de recuperación configurada y vigente.',{exact:true})).toBeVisible();assert.equal(await panel.getByLabel('Clave de recuperación pendiente',{exact:true}).count(),0);};
    const temporary=await recovery.begin(actor,{currentPassword:password});assert.equal((await recovery.status(actor)).configured,false);
    await writer.query("UPDATE auth_password_recovery SET pending_expires_at=clock_timestamp()-interval '1 second' WHERE id_user=$1",[id]);await assert.rejects(()=>recovery.confirm(actor,temporary.recoveryKey));
    await login(page,username,password);const key=await beginUi(page,password);
    assert.ok(/^RTT-PWD-[A-Za-z0-9_-]{43}$/.test(key));await assert.rejects(()=>recovery.confirm(actor,temporary.recoveryKey));await confirmUi(page,key);
    const stored=(await writer.query('SELECT * FROM auth_password_recovery WHERE id_user=$1',[id])).rows[0];assert.ok(stored.active_hash===digest(key));assert.ok(!JSON.stringify(stored).includes(key));
    const rotated=await recovery.begin(actor,{currentPassword:password});assert.ok(rotated.recoveryKey!==key);
    assert.ok((await writer.query('SELECT active_hash FROM auth_password_recovery WHERE id_user=$1',[id])).rows[0].active_hash===digest(key));
    await writer.query("UPDATE auth_password_recovery SET pending_expires_at=clock_timestamp()-interval '1 second' WHERE id_user=$1",[id]);await assert.rejects(()=>recovery.confirm(actor,rotated.recoveryKey));
    assert.equal((await recovery.status(actor)).configured,true);
    await call('password-recovery/complete',null,403,input(username,key),{'X-ERP-Browser':'1',Origin:'https://outside.example'});
    checked('Inscripción por formulario real, pendiente10min/confirmación/rotación sin perder clave anterior, hash sin plaintext y CSRF rechazado');
    const panel=page.locator('app-password-recovery-settings');await panel.scrollIntoViewIfNeeded();
    assert.deepEqual((await new AxeBuilder({page}).include('app-password-recovery-settings').analyze()).violations,[]);await page.screenshot({path:path.join(root,'.artifacts/s024-settings-light.png')});
    async function recoverUi(p,user,key,pwd,code=''){await p.goto(origin+'/login/recuperar');await p.getByLabel('Usuario de la cuenta',{exact:true}).fill(user);
      await p.getByLabel('Clave de recuperación de contraseña',{exact:true}).fill(key);await p.getByLabel('Nueva contraseña de la cuenta',{exact:true}).fill(pwd);
      await p.getByLabel('Repetir nueva contraseña de la cuenta',{exact:true}).fill(pwd);if(code)await p.getByLabel('Código MFA para recuperar, si está activado',{exact:true}).fill(code);
      const [response]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/password-recovery/complete')),p.getByRole('button',{name:'Recuperar mi contraseña',exact:true}).click()]);
      assert.equal(response.status(),201);assert.deepEqual(Object.keys(await response.json()),['message']);await expect(p.getByRole('link',{name:'Iniciar sesión con la nueva contraseña',exact:true})).toBeVisible();
      assert.ok(p.url().endsWith('/login/recuperar'));assert.equal((await p.context().cookies(origin+'/api/v1/')).some(c=>c.name==='erp_session'),false);
    }
    stage='plain recovery UI';await recoverUi(page,username,key,replacementPassword);
    await call('me',first,401);await assert.rejects(()=>auth.login(username,password));await assert.rejects(()=>recovery.recover(input(username,key)));
    assert.equal((await writer.query('SELECT count(*)::int n FROM auth_password_recovery WHERE id_user=$1',[id])).rows[0].n,0);
    await login(page,username,replacementPassword);await expect(page.locator('app-password-recovery-settings').getByText('No tienes una clave de recuperación vigente.',{exact:true})).toBeVisible();
    checked('Recuperación pública real consume clave/pendientes, cambia bcrypt, revoca sesiones/cookie y contraseña anterior, sin login automático');
    stage='edge cases';const edgeName='edge_'+randomBytes(8).toString('hex'),edgeId=(await writer.query("INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,'user',true,0) RETURNING id_user",[edgeName,hash])).rows[0].id_user;
    let edgeToken=(await auth.login(edgeName,password)).access_token,edgeActor=auth.verify(edgeToken);
    const enroll=async(a,pwd= password)=>{const value=await recovery.begin(a,{currentPassword:pwd});await recovery.confirm(a,value.recoveryKey);return value.recoveryKey;};
    const edgeKey=await enroll(edgeActor);
    await writer.query("UPDATE auth_password_recovery SET confirmed_at=clock_timestamp()-interval '2 years',expires_at=clock_timestamp()-interval '1 day' WHERE id_user=$1",[edgeId]);await assert.rejects(()=>recovery.recover(input(edgeName,edgeKey)));
    await writer.query("UPDATE auth_password_recovery SET expires_at=clock_timestamp()+interval '1 day' WHERE id_user=$1",[edgeId]);
    await writer.query('UPDATE auth_user SET is_active=false WHERE id_user=$1',[edgeId]);await assert.rejects(()=>recovery.recover(input(edgeName,edgeKey)));
    await writer.query('UPDATE auth_user SET is_active=true WHERE id_user=$1',[edgeId]);await auth.changePassword(edgeActor,{currentPassword:password,newPassword:replacementPassword});
    await assert.rejects(()=>recovery.recover(input(edgeName,edgeKey)));edgeToken=(await auth.login(edgeName,replacementPassword)).access_token;edgeActor=auth.verify(edgeToken);
    assert.equal((await recovery.status(edgeActor)).configured,false);
    await enroll(edgeActor,replacementPassword);const pending=await recovery.begin(edgeActor,{currentPassword:replacementPassword});await auth.logoutAll(edgeActor);await assert.rejects(()=>recovery.confirm(edgeActor,pending.recoveryKey));
    edgeToken=(await auth.login(edgeName,replacementPassword)).access_token;edgeActor=auth.verify(edgeToken);
    const retained=await recovery.status(edgeActor);assert.equal(retained.configured,true);assert.equal(retained.pending,false);
    const toRevoke=await enroll(edgeActor,replacementPassword);await recovery.revoke(edgeActor,{currentPassword:replacementPassword});await assert.rejects(()=>recovery.recover(input(edgeName,toRevoke)));
    const concurrentKey=await enroll(edgeActor,replacementPassword);
    const beforeFailure=(await writer.query('SELECT password_hash,token_version FROM auth_user WHERE id_user=$1',[edgeId])).rows[0];
    await writer.query("ALTER TABLE app_notification ADD CONSTRAINT verify_recovery_notification_failure CHECK(source_type IS DISTINCT FROM 'account_recovery') NOT VALID");
    try{await assert.rejects(()=>recovery.recover(input(edgeName,concurrentKey)));}
    finally{await writer.query('ALTER TABLE app_notification DROP CONSTRAINT verify_recovery_notification_failure');}
    const afterFailure=(await writer.query('SELECT password_hash,token_version FROM auth_user WHERE id_user=$1',[edgeId])).rows[0];
    assert.ok(beforeFailure.password_hash===afterFailure.password_hash);assert.equal(beforeFailure.token_version,afterFailure.token_version);
    await auth.authenticate(edgeToken);assert.ok((await writer.query('SELECT active_hash FROM auth_password_recovery WHERE id_user=$1',[edgeId])).rows[0].active_hash===digest(concurrentKey));
    const concurrent=await Promise.allSettled([recovery.recover(input(edgeName,concurrentKey)),recovery.recover(input(edgeName,concurrentKey))]);
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
    checked('Caducidad/inactividad/credencial/sesión/retirada, fallo SQL final revierte contraseña/clave/sesiones y dos resets concurrentes solo consumen una vez');
    stage='MFA setup';const mfaName='mfa_recovery_'+randomBytes(6).toString('hex'),mfaId=(await writer.query("INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,'admin',true,0) RETURNING id_user",[mfaName,hash])).rows[0].id_user;
    const beforeMfa=(await auth.login(mfaName,password)).access_token,mfaSetup=await auth.mfa.begin(auth.verify(beforeMfa),password);
    const codes=(await auth.mfa.confirm(auth.verify(beforeMfa),totp(mfaSetup.secret,Date.now()/1000))).recoveryCodes;
    const challenge=await auth.login(mfaName,password),mfaToken=(await auth.completeMfa(challenge.challenge,codes[0])).access_token,mfaActor=auth.verify(mfaToken);
    await assert.rejects(()=>recovery.begin(mfaActor,{currentPassword:password}));assert.equal((await writer.query('SELECT count(*)::int n FROM auth_password_recovery WHERE id_user=$1',[mfaId])).rows[0].n,0);
    await login(phone,mfaName,password,codes[1]);const mfaKey=await beginUi(phone,password,codes[2]);await confirmUi(phone,mfaKey);
    const encrypted=(await writer.query('SELECT secret_box FROM auth_mfa WHERE id_user=$1',[mfaId])).rows[0].secret_box;
    const mfaInput=input(mfaName,mfaKey,replacementPassword);await assert.rejects(()=>recovery.recover(mfaInput));
    const bad='ffffffff-ffffffff-ffffffff-ffffffff';for(let n=0;n<5;n++)await assert.rejects(()=>recovery.recover({...mfaInput,code:bad}));
    assert.equal((await writer.query('SELECT failures FROM auth_mfa WHERE id_user=$1',[mfaId])).rows[0].failures,5);
    await assert.rejects(()=>recovery.recover({...mfaInput,code:codes[3]}));assert.equal((await writer.query('SELECT count(*)::int n FROM auth_password_recovery WHERE id_user=$1',[mfaId])).rows[0].n,1);
    await writer.query("UPDATE auth_mfa SET blocked_until=clock_timestamp()-interval '1 second' WHERE id_user=$1",[mfaId]);
    checked('Inscripción con MFA exige reautenticación; clave offline no sustituye factor; cinco fallos persisten/bloquean sin consumir clave ni respaldo válido');
    const mfaPanel=phone.locator('app-password-recovery-settings');await mfaPanel.scrollIntoViewIfNeeded();assert.deepEqual((await new AxeBuilder({page:phone}).include('app-password-recovery-settings').analyze()).violations,[]);
    await phone.screenshot({path:path.join(root,'.artifacts/s024-settings-dark.png')});await phone.goto(origin+'/login/recuperar');
    assert.deepEqual((await new AxeBuilder({page:phone}).include('app-recover-password').analyze()).violations,[]);assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await phone.screenshot({path:path.join(root,'.artifacts/s024-recover-dark.png')});
    stage='MFA recovery UI';const unusedBefore=(await writer.query('SELECT count(*)::int n FROM auth_mfa_recovery WHERE id_user=$1 AND used_at IS NULL',[mfaId])).rows[0].n;
    await recoverUi(phone,mfaName,mfaKey,replacementPassword,codes[3]);await call('me',mfaToken,401);
    const after=(await writer.query('SELECT enabled_at,secret_box,failures FROM auth_mfa WHERE id_user=$1',[mfaId])).rows[0];assert.ok(after.enabled_at);assert.ok(after.secret_box===encrypted);assert.equal(after.failures,0);
    assert.equal((await writer.query('SELECT count(*)::int n FROM auth_mfa_recovery WHERE id_user=$1 AND used_at IS NULL',[mfaId])).rows[0].n,unusedBefore-1);
    const afterChallenge=await auth.login(mfaName,replacementPassword);assert.equal(afterChallenge.mfaRequired,true);assert.ok(!afterChallenge.access_token);
    await login(phone,mfaName,replacementPassword,codes[4]);
    const notices=(await writer.query("SELECT type,title,message FROM app_notification WHERE source_type='account_recovery' AND id_user=$1",[mfaId])).rows;
    assert.ok(notices.some(n=>n.title==='Contraseña recuperada'));assert.ok(!JSON.stringify(notices).includes(mfaKey));assert.ok(!JSON.stringify(notices).includes(replacementPassword));
    checked('Reset MFA real consume solo un respaldo, mantiene autenticador/MFA y obliga login completo; notificación interna sin secretos');
    for(const [p,theme]of [[page,'light'],[phone,'dark']]){
      assert.deepEqual((await new AxeBuilder({page:p}).include('app-password-recovery-settings').analyze()).violations,[]);
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await p.evaluate(()=>!localStorage.getItem('access_token')&&!sessionStorage.getItem('access_token')));
    }
    const limited=await fetch(api+'/api/v1/auth/password-recovery/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input(username,unknownKey))});assert.equal(limited.status,429);await limited.arrayBuffer();
    assert.deepEqual(errors,[]);checked('Claro1280/oscuro390, formularios/panel/axe y sin desbordamiento, secretos fuera de Web Storage y límite HTTP real de cinco intentos');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_pwreset_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/s024-password-recovery.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de recuperación:',error instanceof assert.AssertionError?error.message:error.name,'Revisar etapa en .artifacts/s024-password-recovery.json; sin secretos en salida.');process.exitCode=1;});
