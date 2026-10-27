/* S02.3: AppModule/PostgreSQL/Angular reales en copia desechable. Nunca imprime secretos. */
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
  const control=new Client(config),database='verify_mfa_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'S02.3',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
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
    const password=randomBytes(24).toString('hex'),username='mfa_'+randomBytes(8).toString('hex'),hash=await AuthService.hashPassword(password);
    const id=(await writer.query("INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,'admin',true,0) RETURNING id_user",[username,hash])).rows[0].id_user;
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),
      AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    checked('Respaldo restaurado,096 check/migrate solo en copia; AppModule real, cron detenido y fiscal mock');
    const call=async(route,token,status,body,headers={})=>{
      const response=await fetch(api+'/api/v1/auth/'+route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,status,`${route}: HTTP${response.status} esperado${status}`);return {body:await response.json(),cookie:response.headers.get('set-cookie'),cache:response.headers.get('cache-control')};
    };
    await call('mfa/status',null,401);const first=(await auth.login(username,password)).access_token,other=(await auth.login(username,password)).access_token;
    const state=await call('mfa/status',first,200);assert.deepEqual(state.body,{enabled:false,available:true,recoveryCodesRemaining:0});assert.equal(state.cache,'private, no-store');
    await call('mfa/setup',null,401,{currentPassword:password});await call('mfa/setup',first,400,{currentPassword:'wrong-password'});
    const key=process.env.AUTH_MFA_ENCRYPTION_KEY;delete process.env.AUTH_MFA_ENCRYPTION_KEY;
    await assert.rejects(()=>auth.mfa.begin(auth.verify(first),password));assert.equal((await writer.query('SELECT count(*)::int n FROM auth_mfa WHERE id_user=$1',[id])).rows[0].n,0);
    process.env.AUTH_MFA_ENCRYPTION_KEY=key;await call('me',first,200);
    checked('MFA opcional, estado privado sin secretos y configuración exige sesión/contraseña actual');
    server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const desktop=await browser.newContext({viewport:{width:1280,height:1000}}),mobile=await browser.newContext({viewport:{width:390,height:1000}}),page=await desktop.newPage(),phone=await mobile.newPage();
    await page.clock.install();
    await phone.addInitScript(()=>localStorage.setItem('theme','dark'));const errors=[];for(const p of [page,phone])p.on('pageerror',e=>errors.push(e.name));
    async function passwordLogin(p){await p.goto(origin+'/login?returnUrl=%2Fperfil');await p.getByLabel('Usuario',{exact:true}).fill(username);await p.getByLabel('Contraseña',{exact:true}).fill(password);await p.getByRole('button',{name:'Entrar',exact:true}).click();}
    stage='enrollment UI';await passwordLogin(page);await page.waitForURL('**/perfil');
    const panel=page.locator('app-account-mfa');await panel.getByLabel('Contraseña actual para verificación',{exact:true}).fill(password);
    const [setupResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/auth/mfa/setup')),panel.getByRole('button',{name:'Configurar verificación en dos pasos',exact:true}).click()]);
    assert.equal(setupResponse.status(),201);const setup=await setupResponse.json(),secret=setup.secret;assert.ok(/^[A-Z2-7]{32}$/.test(secret));
    const row=(await writer.query('SELECT * FROM auth_mfa WHERE id_user=$1',[id])).rows[0];assert.ok(!row.secret_box.includes(secret));assert.equal(row.enabled_at,null);
    assert.ok(!(await call('mfa/status',first,200)).body.enabled);await call('me',first,200);
    await writer.query("UPDATE auth_mfa SET pending_expires_at=clock_timestamp()-interval '1 second' WHERE id_user=$1",[id]);
    await call('mfa/confirm',first,400,{code:totp(secret,Date.now()/1000)});await writer.query("UPDATE auth_mfa SET pending_expires_at=clock_timestamp()+interval '10 minutes' WHERE id_user=$1",[id]);
    const enrolledCode=totp(secret,Date.now()/1000);await panel.getByLabel('Código del autenticador',{exact:true}).fill(enrolledCode);
    const [confirmed]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/auth/mfa/confirm')),panel.getByRole('button',{name:'Confirmar activación',exact:true}).click()]);
    assert.equal(confirmed.status(),201);const codes=(await confirmed.json()).recoveryCodes;assert.equal(codes.length,10);assert.equal(new Set(codes).size,10);
    await page.waitForURL('**/login/respaldos');await expect(page.getByLabel('Códigos de respaldo',{exact:true})).toBeVisible();
    assert.equal(await page.locator('app-authenticated-shell').count(),0);
    let backgroundRequests=0;const countBackground=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))backgroundRequests++;};
    page.on('request',countBackground);await page.clock.fastForward(61000);page.off('request',countBackground);
    assert.equal(backgroundRequests,0);assert.ok(page.url().endsWith('/login/respaldos'));await expect(page.getByLabel('Códigos de respaldo',{exact:true})).toBeVisible();
    assert.equal((await desktop.cookies(origin+'/api/v1/')).some(c=>c.name==='erp_session'),false);await call('me',first,401);await call('me',other,401);
    const stored=(await writer.query('SELECT code_hash,used_at FROM auth_mfa_recovery WHERE id_user=$1',[id])).rows;assert.equal(stored.length,10);
    assert.ok(stored.every(r=>codes.some(c=>digest(normalizeRecovery(c))===r.code_hash)));assert.ok(!JSON.stringify(stored).includes(codes[0]));
    checked('Activación por formulario real, vencimiento pendiente, secreto cifrado,10 respaldos hasheados mostrados una vez y todas las sesiones/cookie revocadas');
    await page.getByRole('button',{name:'Ya guardé mis códigos · Iniciar sesión',exact:true}).click();await page.waitForURL('**/login');
    await page.goto(origin+'/login/respaldos');await page.waitForURL('**/login');assert.equal(await page.getByLabel('Códigos de respaldo',{exact:true}).count(),0);
    stage='challenge defenses';const challenged=await call('login',null,201,{username,password},{'X-ERP-Browser':'1',Origin:origin});
    assert.deepEqual(Object.keys(challenged.body).sort(),['challenge','expiresIn','mfaRequired']);assert.equal(challenged.cookie,null);const challenge=challenged.body.challenge;
    await call('me',challenge,401);await call('mfa/login',null,403,{challenge,code:codes[0]},{'X-ERP-Browser':'1',Origin:'https://outside.example'});
    await call('mfa/login',null,401,{challenge,code:enrolledCode});
    const bad=totp(secret,Date.now()/1000)==='000000'?'111111':'000000';
    for(let n=0;n<4;n++)await assert.rejects(()=>auth.completeMfa(challenge,bad));
    assert.equal((await writer.query('SELECT failures FROM auth_mfa WHERE id_user=$1',[id])).rows[0].failures,5);
    await assert.rejects(()=>auth.login(username,password));await assert.rejects(()=>auth.completeMfa(challenge,codes[0]));
    assert.equal((await writer.query('SELECT count(*)::int n FROM auth_mfa_recovery WHERE id_user=$1 AND used_at IS NOT NULL',[id])).rows[0].n,0);
    checked('Contraseña sola no crea JWT/cookie; reto no autoriza API, CSRF rechazado, TOTP usado no se repite y cinco fallos bloquean la cuenta sin consumir respaldo');
    await writer.query("UPDATE auth_mfa SET blocked_until=clock_timestamp()-interval '1 second' WHERE id_user=$1",[id]);
    const expiring=await auth.login(username,password);await writer.query("UPDATE auth_mfa_challenge SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[digest(expiring.challenge)]);
    await assert.rejects(()=>auth.completeMfa(expiring.challenge,codes[0]));
    const stale=await auth.login(username,password);await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[id]);await assert.rejects(()=>auth.completeMfa(stale.challenge,codes[0]));
    checked('Retos vencidos y versiones revocadas se rechazan antes de consumir el segundo factor');
    stage='TOTP login UI';await passwordLogin(page);await expect(page.getByRole('heading',{name:'Verificación en dos pasos',exact:true})).toBeVisible();
    assert.equal(await page.getByLabel('Contraseña',{exact:true}).count(),0);assert.equal((await desktop.cookies(origin+'/api/v1/')).some(c=>c.name==='erp_session'),false);
    // Espera solo hasta el siguiente intervalo real; no se modifica last_step para eludir anti-replay.
    const lastStep=Number((await writer.query('SELECT last_step FROM auth_mfa WHERE id_user=$1',[id])).rows[0].last_step);
    const wait=Math.max(0,(lastStep+1)*30000-Date.now()+150);if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    await page.getByLabel('Código de verificación o respaldo',{exact:true}).fill(totp(secret,Date.now()/1000));
    const [mfaLogin]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/auth/mfa/login')),page.getByRole('button',{name:'Verificar e ingresar',exact:true}).click()]);
    assert.equal(mfaLogin.status(),201);assert.deepEqual(Object.keys(await mfaLogin.json()).sort(),['expiresAt','profile']);await page.waitForURL('**/perfil');
    const cookie=(await desktop.cookies(origin+'/api/v1/')).find(c=>c.name==='erp_session');assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Strict');
    await page.reload();await expect(page.locator('app-account-mfa').getByText('Códigos de respaldo disponibles: 10.',{exact:false})).toBeVisible();
    checked('Login TOTP real desde Angular no revela JWT, limpia contraseña, instala cookie HttpOnly/Strict y restaura al recargar');
    stage='recovery UI';await passwordLogin(phone);await expect(phone.getByRole('heading',{name:'Verificación en dos pasos',exact:true})).toBeVisible();
    assert.deepEqual((await new AxeBuilder({page:phone}).include('app-login').analyze()).violations,[]);assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await phone.screenshot({path:path.join(root,'.artifacts/s023-login-challenge-dark.png')});
    await phone.getByLabel('Código de verificación o respaldo',{exact:true}).fill(codes[0]);await phone.getByRole('button',{name:'Verificar e ingresar',exact:true}).click();await phone.waitForURL('**/perfil');
    await expect(phone.locator('app-account-mfa').getByText('Códigos de respaldo disponibles: 9.',{exact:false})).toBeVisible();
    const concurrentChallenge=await auth.login(username,password);const results=await Promise.allSettled([auth.completeMfa(concurrentChallenge.challenge,codes[1]),auth.completeMfa(concurrentChallenge.challenge,codes[1])]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const replay=await auth.login(username,password);await assert.rejects(()=>auth.completeMfa(replay.challenge,codes[0]));
    checked('Respaldo inicia sesión móvil real y descuenta una vez; repetición y dos verificaciones concurrentes no duplican acceso');
    for(const [p,theme]of [[page,'light'],[phone,'dark']]){
      assert.deepEqual((await new AxeBuilder({page:p}).include('app-account-mfa').analyze()).violations,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok(await p.evaluate(()=>!localStorage.getItem('access_token')&&!sessionStorage.getItem('access_token')));
      await p.locator('app-account-mfa').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(root,'.artifacts','s023-mfa-'+theme+'.png')});
    }
    checked('Panel claro1280/oscuro390 sin desbordamiento ni infracciones axe; sin credenciales en Web Storage; capturas sin secretos');
    stage='disable UI';const disable=phone.locator('app-account-mfa');await disable.getByLabel('Contraseña actual para verificación',{exact:true}).fill('incorrect-password');
    await disable.getByLabel('Código del autenticador o respaldo',{exact:true}).fill(codes[2]);await disable.getByRole('button',{name:'Desactivar verificación',exact:true}).click();
    await expect(disable.getByRole('alert')).toContainText('Contraseña actual incorrecta');assert.ok(phone.url().endsWith('/perfil'));
    assert.deepEqual((await new AxeBuilder({page:phone}).include('app-account-mfa').analyze()).violations,[]);
    await disable.getByLabel('Contraseña actual para verificación',{exact:true}).fill(password);await disable.getByLabel('Código del autenticador o respaldo',{exact:true}).fill(codes[2]);
    await disable.getByRole('button',{name:'Desactivar verificación',exact:true}).click();await phone.waitForURL('**/login');
    assert.equal((await mobile.cookies(origin+'/api/v1/')).some(c=>c.name==='erp_session'),false);assert.equal((await writer.query('SELECT count(*)::int n FROM auth_mfa WHERE id_user=$1',[id])).rows[0].n,0);
    assert.equal((await writer.query('SELECT count(*)::int n FROM auth_mfa_recovery WHERE id_user=$1',[id])).rows[0].n,0);
    const normal=await auth.login(username,password);assert.ok(normal.access_token);await call('me',normal.access_token,200);assert.deepEqual(errors,[]);
    checked('Desactivar exige contraseña y segundo factor; error local conserva pantalla, éxito borra secretos/respaldos y revoca sesiones; login normal restaurado');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_mfa_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/s023-mfa.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación MFA:',error instanceof assert.AssertionError?error.message:error.name,'Revisar etapa en .artifacts/s023-mfa.json; sin secretos en salida.');process.exitCode=1;});
