/* S01: AppModule + PostgreSQL restaurado + Angular producción, sin API simulada. */
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto'),{execFileSync}=require('node:child_process');
const http=require('node:http'),express=require('express'),{once}=require('node:events');
const {Client}=require('pg'),{Test}=require('@nestjs/testing'),{DataSource}=require('typeorm');
const {SchedulerRegistry}=require('@nestjs/schedule'),{chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {databaseConfig}=require('./db-config'),{findPgTool,postgresEnvironment}=require('./backup');

function preview(api,directory) {
  const site=express();
  site.use('/api',(req,res)=>{
    const request=http.request(new URL(req.originalUrl,api),{method:req.method,
      headers:{...req.headers,host:new URL(api).host},timeout:10000},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    request.on('timeout',()=>request.destroy());request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(request);
  });
  site.use(express.static(directory));site.get(/.*/,(_req,res)=>res.sendFile(path.join(directory,'index.html')));
  return http.createServer(site);
}

async function main() {
  assert.equal(process.versions.node.split('.')[0],'24');
  const root=path.resolve(__dirname,'..'),argument=process.argv.find(value=>value.startsWith('--backup='));
  assert.ok(argument,'Falta --backup=RUTA bajo .backups');
  const dump=fs.realpathSync(path.resolve(argument.slice(9))),backupRoot=fs.realpathSync(path.join(root,'.backups'));
  assert.ok(dump.startsWith(backupRoot+path.sep)&&fs.statSync(dump).isFile());
  const angular=path.join(root,'frontend/dist/frontend/browser');assert.ok(fs.existsSync(path.join(angular,'index.html')));
  const config=databaseConfig();
  assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(config.connectionString?new URL(config.connectionString).hostname:config.host));
  const admin=new Client(config),database='verify_access_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});
  url.pathname='/'+database;
  const envKeys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS'];
  const saved=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  let created=false,writer,app,server,browser,stage='restore';
  const report={phase:'S01',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
  const checked=name=>{report.checks.push(name);console.log('OK:',name);};
  await admin.connect();
  try {
    assert.notEqual((await admin.query('SELECT current_database() name')).rows[0].name,database);
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
    execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);
    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);
    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
    writer=new Client({connectionString:url.toString()});await writer.connect();
    assert.equal((await writer.query('SELECT current_database() name')).rows[0].name,database);
    assert.equal((await writer.query('SELECT count(*)::int n FROM app_user_access_profile')).rows[0].n,0);
    await writer.query('UPDATE auth_user SET is_active=false');
    const password=randomBytes(24).toString('hex'),{AuthService}=require('./dist/auth/auth.service'),hash=await AuthService.hashPassword(password);
    const users={};
    for(const [name,role] of [['admin','admin'],['otherAdmin','admin'],['operator','user'],['second','user']]) {
      const username='access_'+name+'_'+randomBytes(4).toString('hex');
      const row=(await writer.query(`INSERT INTO auth_user(username,password_hash,role,is_active,token_version)
        VALUES($1,$2,$3,true,0) RETURNING id_user`,[username,hash,role])).rows[0];
      users[name]={username,id:row.id_user};
    }
    checked('Respaldo restaurado y migración verificada/aplicada en copia; accesos anteriores sin asignaciones nuevas');
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),
      ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';
    const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();
    for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    assert.equal((await app.get(DataSource).query('SELECT current_database() name'))[0].name,database);
    await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    const call=async(route,token,status,method='GET',body)=>{
      const response=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
        ...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,status,`${method} ${route}: ${response.status} != ${status}`);
      const json=await response.json();return {body:json,cache:response.headers.get('cache-control')};
    };
    users.admin.token=(await call('auth/login',null,201,'POST',{username:users.admin.username,password})).body.access_token;
    users.operator.token=(await call('auth/login',null,201,'POST',{username:users.operator.username,password})).body.access_token;
    users.second.token=(await auth.login(users.second.username,password)).access_token;
    const token=users.admin.token,base='auth/access-profiles';
    const fresh=async user=>(await auth.login(user.username,password)).access_token;
    const access=async user=>(await call('auth/users',token,200)).body.find(row=>row.idUser===user.id);
    const assign=async(user,idProfile,status=200,version)=>call(`auth/users/${user.id}/access-profile`,token,status,'PUT',
      {idProfile,accessVersion:version??(await access(user)).accessVersion});
    const overrides=async(user,permissions,status=200,version)=>call(`auth/users/${user.id}/permissions`,token,status,'PUT',
      {permissions,accessVersion:version??(await access(user)).accessVersion});
    await call(base,null,401);await call(base,users.operator.token,403);
    await call(base,users.operator.token,403,'POST',{name:'Escalada',description:'',permissions:['ventas.crear']});
    await call('auth/permission-catalog',users.operator.token,403);
    const catalog=await call('auth/permission-catalog',token,200);assert.equal(catalog.cache,'private, no-store');assert.ok(catalog.body.length>=14);
    await call('venta',users.operator.token,400,'POST',{});
    checked('Login real bcrypt/JWT: anónimo401, operador403 en administración; permisos base conservados');
    const body={name:'Mostrador de prueba',description:'Solo en copia aislada',permissions:['ventas.crear']};
    const profile=(await call(base,token,201,'POST',body)).body;
    await call(base,token,409,'POST',{...body,name:' MOSTRADOR DE PRUEBA '});
    await call(base,token,400,'POST',{...body,name:'   '});
    await call(base,token,400,'POST',{...body,name:'Inválido',permissions:['sistema.superadmin']});
    await call(base,token,400,'POST',{...body,name:'Duplicado',permissions:['ventas.crear','ventas.crear']});
    await call(base,token,400,'POST',{...body,role:'admin'});
    await call(`auth/users/${users.operator.id}/access-profile`,token,400,'PUT',{accessVersion:0});
    await assign(users.admin,profile.idProfile,400);
    checked('Catálogo privado y validación de nombres, duplicados, permisos desconocidos, DTO y perfil prohibido para administradores');
    await assign(users.operator,profile.idProfile);await assign(users.second,profile.idProfile);
    await call('auth/me',users.operator.token,401);await call('auth/me',users.second.token,401);
    users.operator.token=await fresh(users.operator);
    users.second.token=await fresh(users.second);
    await call('venta',users.operator.token,400,'POST',{});
    await call('caja',users.operator.token,403);
    assert.equal((await call(base,token,200)).body.find(row=>row.idProfile===profile.idProfile).assignedUsers,2);
    await call(`${base}/${profile.idProfile}`,token,409,'DELETE',{version:1});
    const accessBefore=await access(users.operator);await assign(users.operator,profile.idProfile);
    assert.equal((await access(users.operator)).accessVersion,accessBefore.accessVersion);
    await assign(users.operator,null,409,accessBefore.accessVersion-1);
    checked('Perfil reutilizado por dos operadores; asignación revoca sesiones, no escala a administrador y bloquea eliminación con usuarios');
    await call(`${base}/${profile.idProfile}`,token,200,'PUT',{...body,permissions:[],version:1});
    await call('auth/me',users.operator.token,401);await call('auth/me',users.second.token,401);users.operator.token=await fresh(users.operator);
    await call('venta',users.operator.token,403,'POST',{});
    await call(`${base}/${profile.idProfile}`,token,409,'PUT',{...body,version:1});
    await overrides(users.operator,[{permissionCode:'ventas.crear',granted:true}]);
    await call('auth/me',users.operator.token,401);users.operator.token=await fresh(users.operator);
    await call('venta',users.operator.token,400,'POST',{});
    let settings=(await call(`auth/users/${users.operator.id}/permissions`,token,200)).body;
    assert.deepEqual(settings.find(row=>row.permissionCode==='ventas.crear'),{permissionCode:'ventas.crear',description:'Crear ventas y facturas internas',
      accessVersion:(await access(users.operator)).accessVersion,granted:true,inheritedGranted:false,overridden:true});
    await overrides(users.operator,[],409,settings[0].accessVersion-1);
    await overrides(users.operator,[]);users.operator.token=await fresh(users.operator);
    await call('venta',users.operator.token,403,'POST',{});
    checked('Lista vacía deniega permisos base; excepción concede sobre perfil, retirarla restaura herencia; JWT revocado y editor viejo409');
    const concurrent=await Promise.all([0,1].map(i=>fetch(api+'/api/v1/'+base+'/'+profile.idProfile,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({...body,name:body.name+' '+i,version:2})})));
    assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
    await overrides(users.operator,[{permissionCode:'ventas.crear',granted:false}]);users.operator.token=await fresh(users.operator);
    await call('venta',users.operator.token,403,'POST',{});
    await overrides(users.operator,[]);users.operator.token=await fresh(users.operator);await call('venta',users.operator.token,400,'POST',{});
    checked('Ediciones concurrentes: un commit y un409; denegación individual prevalece sobre perfil permitido');
    await call(`auth/users/${users.second.id}`,token,200,'PATCH',{role:'admin'});
    assert.equal((await access(users.second)).idProfile,null);
    await call('auth/me',users.second.token,401);
    checked('Promoción explícita conserva rol base protegido, retira perfil y revoca JWT previo');
    const staleActor=auth.verify((await auth.login(users.otherAdmin.username,password)).access_token);
    await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users.otherAdmin.id]);
    await assert.rejects(()=>app.get(require('./dist/auth/access-profile.service').AccessProfileService).create({...body,name:'No debe crearse'},staleActor),/administrador vigente/);
    const operatorVersion=(await access(users.operator)).accessVersion;
    await assert.rejects(()=>auth.updateUserPermissions(users.operator.id,[],operatorVersion,staleActor),/administrador vigente/);
    checked('Administrador revocado durante la operación rechazado dentro de transacción de perfiles y excepciones');
    stage='Angular';server=preview(api,angular);server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const errors=[];
    const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/login?returnUrl=%2Fusuarios');
    await page.getByLabel('Usuario',{exact:true}).fill(users.admin.username);await page.getByLabel('Contraseña',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/usuarios');
    await expect(page.getByRole('heading',{name:'Perfiles de acceso',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Nuevo perfil',exact:true}).click();
    await page.getByLabel('Nombre del perfil',{exact:true}).fill('Almacén UI');
    await page.getByLabel('Descripción del perfil',{exact:true}).fill('Creado desde Angular con datos de prueba');
    await page.locator('app-access-profiles label').filter({hasText:'inventario.transferir'}).getByRole('checkbox').check();
    await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Almacén UI',exact:true})).toBeVisible();
    await page.getByLabel('Perfil de '+users.operator.username,{exact:true}).click();await page.getByRole('option',{name:'Almacén UI',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Asignar perfil',exact:true}).click();
    await expect.poll(async()=>(await access(users.operator)).profileName).toBe('Almacén UI');
    const userRow=page.getByRole('row').filter({hasText:users.operator.username});
    await userRow.getByRole('button',{name:'Permisos detallados',exact:true}).click();
    const editor=page.getByRole('region',{name:'Excepciones individuales'});
    await expect(editor).toContainText('Heredado: Almacén UI');
    await editor.locator('label').filter({hasText:'ventas.crear'}).getByRole('checkbox').check();
    await editor.getByRole('button',{name:'Guardar permisos',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Guardar permisos',exact:true}).click();
    await expect.poll(async()=>(await access(users.operator)).overrideCount).toBe(1);
    await userRow.getByRole('button',{name:'Permisos detallados',exact:true}).click();
    await editor.getByRole('button',{name:'Heredar todos los permisos',exact:true}).click();
    await editor.getByRole('button',{name:'Guardar permisos',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Guardar permisos',exact:true}).click();
    await expect.poll(async()=>(await access(users.operator)).overrideCount).toBe(0);
    checked('Angular producción sin mocks: login, crear perfil, asignar operador y guardar/retirar solo excepciones');
    await page.getByRole('button',{name:'Duplicar Almacén UI',exact:true}).click();
    await expect(page.getByLabel('Nombre del perfil',{exact:true})).toHaveValue('Almacén UI (copia)');
    await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Almacén UI (copia)',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Eliminar Almacén UI (copia)',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Eliminar',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Almacén UI (copia)',exact:true})).toHaveCount(0);
    checked('Duplicar y eliminar perfil sin asignaciones desde UI real');
    for(const theme of ['light','dark']) {
      await page.evaluate(value=>localStorage.setItem('theme',value),theme);await page.reload();
      await page.setViewportSize({width:theme==='dark'?390:1280,height:1000});
      await expect(page.getByRole('heading',{name:'Perfiles de acceso',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Editar Almacén UI',exact:true}).click();
      const violations=(await new AxeBuilder({page}).include('app-access-profiles').analyze()).violations;
      assert.deepEqual(violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('.profile-editor').evaluate(element=>element.scrollIntoView({block:'start'}));
      await page.screenshot({path:path.join(root,'.artifacts','s01-profiles-'+theme+'.png')});
    }
    assert.deepEqual(errors,[]);checked('Editor claro/1280 y oscuro/390 sin desbordamiento de página, errores JS ni infracciones axe en panel de perfiles');
    await assign(users.operator,null);await call(`${base}/${profile.idProfile}`,token,200,'DELETE',{version:3});
    await call(`${base}/${profile.idProfile}`,token,404,'DELETE',{version:3});
    checked('Retiro del perfil restaura rol base; perfil sin usuarios eliminable, borrado repetido404');
    report.passed=true;report.completedAt=new Date().toISOString();
  } finally {
    await browser?.close();
    if(server?.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});
    await app?.close();await writer?.end();
    if(created&&/^verify_access_[a-f0-9]{16}$/.test(database)){
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);
      await admin.query(`DROP DATABASE "${database}"`);
      assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);report.copyRemoved=true;
    }
    await admin.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.lastStage=stage;fs.mkdirSync(path.join(root,'.artifacts'),{recursive:true});
    fs.writeFileSync(path.join(root,'.artifacts','s01-access-profiles.json'),JSON.stringify(report,null,2)+'\n');
  }
}
main().catch(error=>{console.error('Falló S01:',error instanceof assert.AssertionError?error.message:error.name,
  'Revisar etapa en .artifacts/s01-access-profiles.json. No se imprimen secretos ni respuestas privadas.');process.exitCode=1;});
