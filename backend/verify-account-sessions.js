/* S02.1: sesiones reales en copia restaurada, AppModule y Angular producción. */
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const http=require('node:http'),express=require('express'),{once}=require('node:events');
const {Client}=require('pg'),{Test}=require('@nestjs/testing'),{DataSource}=require('typeorm');
const {SchedulerRegistry}=require('@nestjs/schedule'),{chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {databaseConfig}=require('./db-config'),{findPgTool,postgresEnvironment}=require('./backup');

function preview(api,directory){
  const site=express();site.use('/api',(req,res)=>{
    const request=http.request(new URL(req.originalUrl,api),{method:req.method,headers:{...req.headers,host:new URL(api).host},timeout:10000},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });request.on('timeout',()=>request.destroy());request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(request);
  });site.use(express.static(directory));site.get(/.*/,(_req,res)=>res.sendFile(path.join(directory,'index.html')));return http.createServer(site);
}

async function main(){
  assert.equal(process.versions.node.split('.')[0],'24');
  const root=path.resolve(__dirname,'..'),argument=process.argv.find(value=>value.startsWith('--backup='));
  assert.ok(argument,'Falta --backup=RUTA bajo .backups');
  const dump=fs.realpathSync(path.resolve(argument.slice(9))),backupRoot=fs.realpathSync(path.join(root,'.backups'));
  assert.ok(dump.startsWith(backupRoot+path.sep)&&fs.statSync(dump).isFile());
  const angular=path.join(root,'frontend/dist/frontend/browser');assert.ok(fs.existsSync(path.join(angular,'index.html')));
  const config=databaseConfig();assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(config.connectionString?new URL(config.connectionString).hostname:config.host));
  const control=new Client(config),database='verify_sessions_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let created=false,writer,app,server,browser,stage='restore';
  const browserMode=process.argv.includes('--browser-auth');
  const report={phase:browserMode?'S02.2':'S02.1',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
  const checked=name=>{report.checks.push(name);console.log('OK:',name);};
  await control.connect();
  try{
    assert.notEqual((await control.query('SELECT current_database() name')).rows[0].name,database);
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
    execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);
    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);
    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
    writer=new Client({connectionString:url.toString()});await writer.connect();
    assert.equal((await writer.query('SELECT current_database() name')).rows[0].name,database);
    assert.equal((await writer.query('SELECT count(*)::int n FROM auth_session')).rows[0].n,0);
    await writer.query('UPDATE auth_user SET is_active=false');
    const password=randomBytes(24).toString('hex'),{AuthService}=require('./dist/auth/auth.service'),hash=await AuthService.hashPassword(password),users={};
    for(const [name,role]of [['alice','user'],['bob','user'],['admin','admin']]){
      const username='session_'+name+'_'+randomBytes(4).toString('hex');
      const row=(await writer.query(`INSERT INTO auth_user(username,password_hash,role,is_active,token_version)
        VALUES($1,$2,$3,true,0) RETURNING id_user`,[username,hash,role])).rows[0];users[name]={username,id:row.id_user};
    }
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),
      ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();
    for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name,database);
    await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    checked('Respaldo restaurado; check/migrate solo en copia, AppModule completo con guards, fiscal mock y cron detenido');
    const call=async(route,token,status,method='GET',body,ua)=>{
      const response=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
        ...(body===undefined?{}:{'Content-Type':'application/json'}),...(ua?{'User-Agent':ua}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,status,`${method} ${route}: ${response.status} != ${status}`);
      return {body:await response.json(),cache:response.headers.get('cache-control')};
    };
    const login=async(user,ua)=>(await call('auth/login',null,201,'POST',{username:user.username,password},ua)).body.access_token;
    const fresh=async(user,ua)=>(await auth.login(user.username,password,ua)).access_token;
    const first=await login(users.alice,'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 private@example.test');
    const second=await fresh(users.alice,'Mozilla/5.0 (Linux) Firefox/140.0'),bob=await login(users.bob,'Mozilla/5.0 (Android) Chrome/140.0');
    const firstClaims=auth.verify(first),secondClaims=auth.verify(second);assert.notEqual(firstClaims.sid,secondClaims.sid);
    const legacyClaims={...firstClaims};delete legacyClaims.sid;
    await call('auth/me',auth.sign(legacyClaims),401);
    await call('auth/me',auth.sign({...auth.verify(bob),sid:firstClaims.sid}),401);
    await call('auth/sessions',null,401);const listed=await call('auth/sessions',first,200);assert.equal(listed.cache,'private, no-store');
    assert.equal(listed.body.length,2);assert.equal(listed.body[0].current,true);assert.equal(listed.body[0].clientLabel,'Chrome · Windows');
    assert.equal((await call('auth/sessions',second,200)).body.find(row=>row.idSession===secondClaims.sid).current,true);
    const allowed=['clientLabel','createdAt','current','expiresAt','idSession','lastSeenAt'].sort();
    for(const row of listed.body)assert.deepEqual(Object.keys(row).sort(),allowed);
    assert.ok(!JSON.stringify(listed.body).includes('private@example.test'));
    assert.equal((await call('auth/sessions',bob,200)).body.length,1);
    checked('Login HTTP bcrypt/JWT crea sesiones distintas; lista privada aislada, sesión actual correcta y metadata reducida sin tokens/IP/User-Agent completo');
    await call(`auth/sessions/${auth.verify(bob).sid}/revoke`,first,404,'POST',{});
    await call(`auth/sessions/${randomUUID()}/revoke`,first,404,'POST',{});
    await call('auth/sessions/invalid/revoke',first,400,'POST',{});
    await call(`auth/sessions/${secondClaims.sid}/revoke`,first,201,'POST',{});
    await call(`auth/sessions/${secondClaims.sid}/revoke`,first,201,'POST',{});
    await call('auth/me',second,401);await call('auth/me',first,200);await call('auth/me',bob,200);
    checked('Cierre individual idempotente; sesión ajena404/UUID inválido400 y JWT revocado401 sin cerrar otras cuentas o sesiones');
    const before=(await writer.query('SELECT last_seen_at FROM auth_session WHERE id_session=$1',[firstClaims.sid])).rows[0].last_seen_at;
    await call('auth/me',first,200);
    assert.equal((await writer.query('SELECT last_seen_at FROM auth_session WHERE id_session=$1',[firstClaims.sid])).rows[0].last_seen_at.toISOString(),before.toISOString());
    await writer.query("UPDATE auth_session SET last_seen_at=clock_timestamp()-interval '2 minutes' WHERE id_session=$1",[firstClaims.sid]);
    await call('auth/me',first,200);
    const touched=(await writer.query('SELECT last_seen_at FROM auth_session WHERE id_session=$1',[firstClaims.sid])).rows[0].last_seen_at;
    assert.ok(touched>before);await call('auth/me',first,200);
    assert.equal((await writer.query('SELECT last_seen_at FROM auth_session WHERE id_session=$1',[firstClaims.sid])).rows[0].last_seen_at.toISOString(),touched.toISOString());
    checked('Actividad aproximada actualiza tras un minuto y evita escribir en cada solicitud');
    const upper=await fresh(users.alice);
    assert.equal((await call(`auth/sessions/${auth.verify(upper).sid.toUpperCase()}/revoke`,upper,201,'POST',{})).body.current,true);
    await call('auth/me',upper,401);
    const concurrent=await fresh(users.alice);await call('auth/logout',first,201,'POST',{});
    await call('auth/me',first,401);await call('auth/me',concurrent,200);
    const expired=await fresh(users.alice);
    await writer.query("UPDATE auth_session SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE id_session=$1",[auth.verify(expired).sid]);
    await call('auth/me',expired,401);
    checked('Logout normal cierra solo su sesión; vencimiento en PostgreSQL rechaza JWT todavía no vencido');
    await call('auth/logout-all',concurrent,201,'POST',{});await call('auth/me',concurrent,401);await call('auth/me',bob,200);
    assert.equal((await writer.query('SELECT count(*)::int n FROM auth_session WHERE id_user=$1 AND revoked_at IS NULL',[users.alice.id])).rows[0].n,0);
    let active=await fresh(users.alice);await call('auth/me',active,200);
    checked('Cerrar todas incrementa versión y revoca registros de la cuenta; nuevo login funciona y otra cuenta sigue activa');
    const adminToken=await fresh(users.admin),profile=(await call('auth/access-profiles',adminToken,201,'POST',{name:'Sesiones prueba',description:'Copia',permissions:['ventas.crear']})).body;
    const alice=(await call('auth/users',adminToken,200)).body.find(row=>row.idUser===users.alice.id);
    await call(`auth/users/${users.alice.id}/access-profile`,adminToken,200,'PUT',{idProfile:profile.idProfile,accessVersion:alice.accessVersion});
    await call('auth/me',active,401);active=await fresh(users.alice);
    assert.equal((await call('auth/sessions',active,200)).body.length,1);
    await call(`auth/users/${users.alice.id}`,adminToken,200,'PATCH',{isActive:false});await call('auth/me',active,401);
    await call(`auth/users/${users.alice.id}`,adminToken,200,'PATCH',{isActive:true});await call('auth/me',active,401);
    checked('Cambios S01 de perfil y desactivación siguen invalidando sesiones; versiones anteriores no aparecen como activas');
    const tokens=await Promise.all(Array.from({length:24},()=>fresh(users.alice)));
    const activeRows=(await writer.query(`SELECT id_session FROM auth_session WHERE id_user=$1 AND revoked_at IS NULL
      AND token_version=(SELECT token_version FROM auth_user WHERE id_user=$1) AND expires_at>clock_timestamp()`,[users.alice.id])).rows;
    assert.equal(activeRows.length,20);const validIds=new Set(activeRows.map(row=>row.id_session));
    active=tokens.find(token=>validIds.has(auth.verify(token).sid));const evicted=tokens.find(token=>!validIds.has(auth.verify(token).sid));
    assert.ok(active&&evicted);await call('auth/me',evicted,401);assert.equal((await call('auth/sessions',active,200)).body.length,20);
    checked('Veinticuatro logins concurrentes respetan límite20 y revocan accesos antiguos en servidor');
    const old=randomUUID(),recent=randomUUID();
    await writer.query(`INSERT INTO auth_session(id_session,id_user,token_version,client_label,created_at,last_seen_at,expires_at)
      VALUES($1,$3,0,'Anterior',clock_timestamp()-interval '40 days',clock_timestamp()-interval '40 days',clock_timestamp()-interval '39 days'),
      ($2,$3,0,'Reciente',clock_timestamp()-interval '3 days',clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days')`,[old,recent,users.alice.id]);
    await fresh(users.alice);assert.equal((await writer.query('SELECT 1 FROM auth_session WHERE id_session=$1',[old])).rowCount,0);
    assert.equal((await writer.query('SELECT 1 FROM auth_session WHERE id_session=$1',[recent])).rowCount,1);
    checked('Limpieza al login elimina solo sesiones propias vencidas con antigüedad mayor30 días');
    await auth.logoutAll(auth.verify(await fresh(users.alice)));
    stage='Angular';server=preview(api,angular);server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;browser=await chromium.launch();
    const screens=[],errors=[],apiHeaders=[];
    for(const [theme,width]of [['light',1280],['dark',390]]){
      const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/v1/'))apiHeaders.push({bearer:!!request.headers().authorization,client:request.headers()['x-erp-browser']==='1'});});
      await page.addInitScript(value=>{localStorage.setItem('theme',value);localStorage.setItem('access_token','legacy-fixture');sessionStorage.setItem('access_token','legacy-fixture');},theme);
      await page.goto(origin+'/perfil');await page.waitForURL(/\/login\?returnUrl=/);
      await page.getByLabel('Usuario',{exact:true}).fill(users.alice.username);
      await page.getByLabel('Contraseña',{exact:true}).fill(password);
      const [response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/auth/login'),
        page.getByRole('button',{name:'Entrar',exact:true}).click()]);
      assert.equal(response.status(),201);assert.deepEqual(Object.keys(await response.json()).sort(),['expiresAt','profile']);
      await page.waitForURL('**/perfil');
      await expect(page.getByRole('heading',{name:'Sesiones activas',exact:true})).toBeVisible();screens.push({page,theme});
    }
    report.browserAuth=await require('./test-support/browser-auth-acceptance').verifyBrowserAuth({api,origin,screens});
    assert.ok(apiHeaders.length>0&&apiHeaders.every(row=>!row.bearer&&row.client));
    checked('S02.2: cookie HttpOnly/Strict, sin JWT en JS/respuesta/Storage, restauración, CSRF/origen/cabecera, CORS externo y cookie ambigua rechazados');
    for(const {page,theme}of screens){
      await page.getByRole('button',{name:'Actualizar sesiones',exact:true}).click();
      await expect(page.locator('app-account-sessions article')).toHaveCount(2);
      assert.deepEqual((await new AxeBuilder({page}).include('app-account-sessions').analyze()).violations,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('app-account-sessions').evaluate(element=>element.scrollIntoView({block:'start'}));
      await page.screenshot({path:path.join(root,'.artifacts','s021-sessions-'+theme+'.png')});
    }
    checked('Dos navegadores con login real y Angular producción: sesiones correctas, claro1280/oscuro390 sin desbordamiento ni infracciones axe en panel');
    const desktop=screens[0].page,mobile=screens[1].page;
    await mobile.getByRole('button',{name:'Cerrar esta sesión',exact:true}).click();
    await mobile.getByRole('dialog').getByRole('button',{name:'Cerrar sesión',exact:true}).click();await mobile.waitForURL(/\/login(?:\?|$)/);
    assert.equal((await mobile.context().cookies(origin+'/api/v1/')).some(row=>row.name==='erp_session'),false);
    await desktop.getByRole('button',{name:'Actualizar sesiones',exact:true}).click();await expect(desktop.locator('app-account-sessions article')).toHaveCount(1);
    const extra=await fresh(users.alice,'Firefox/140 (Linux)');await desktop.getByRole('button',{name:'Actualizar sesiones',exact:true}).click();
    await expect(desktop.locator('app-account-sessions article')).toHaveCount(2);
    await desktop.getByRole('button',{name:'Cerrar sesión en Firefox · Linux',exact:true}).click();
    await desktop.getByRole('dialog').getByRole('button',{name:'Cerrar sesión',exact:true}).click();
    await expect(desktop.locator('app-account-sessions article')).toHaveCount(1);await call('auth/me',extra,401);
    await desktop.getByRole('button',{name:'Cerrar todas mis sesiones',exact:true}).click();
    await desktop.getByRole('dialog').getByRole('button',{name:'Cerrar todas',exact:true}).click();await desktop.waitForURL(/\/login(?:\?|$)/);
    assert.equal((await desktop.context().cookies(origin+'/api/v1/')).some(row=>row.name==='erp_session'),false);
    report.browserAuth.cookieClearedOnLogout=true;
    assert.deepEqual(errors,[]);checked('UI real cierra sesión actual móvil, otra sesión y todas las sesiones; confirmaciones, redirección y revocación SQL comprobadas');
    const passToken=await fresh(users.alice),otherPass=await fresh(users.alice),newPassword=randomBytes(24).toString('hex');
    const snapshot=await app.get(DataSource).getRepository(require('./dist/auth/auth-user.entity').AuthUser).findOneByOrFail({idUser:users.alice.id});
    await call('auth/password',passToken,201,'POST',{currentPassword:password,newPassword});
    await call('auth/me',passToken,401);await call('auth/me',otherPass,401);
    const store=new(require('./dist/auth/auth-session.store').AuthSessionStore)(app.get(DataSource).manager);
    await assert.rejects(()=>store.create(snapshot,Math.floor(Date.now()/1000)+3600),/cuenta cambió/);
    const afterPassword=(await auth.login(users.alice.username,newPassword)).access_token;await call('auth/me',afterPassword,200);
    checked('Cambio de contraseña revoca sesiones previas y exige nueva contraseña para crear una sesión');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_sessions_[a-f0-9]{16}$/.test(database)){
      await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);
      assert.equal((await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);report.copyRemoved=true;
    }
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(result=>result.status==='fulfilled');report.lastStage=stage;
    fs.mkdirSync(path.join(root,'.artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'.artifacts',browserMode?'s022-browser-auth.json':'s021-account-sessions.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de seguridad:',error instanceof assert.AssertionError?error.message:error.name,
  process.argv.includes('--browser-auth')?'Revisar .artifacts/s022-browser-auth.json.':'Revisar .artifacts/s021-account-sessions.json.',
  'No se imprimen secretos o respuestas privadas.');process.exitCode=1;});
