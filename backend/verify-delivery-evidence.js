/* V02: AppModule/PostgreSQL/Angular reales en copia desechable. Nunca imprime secretos. */
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
  const control=new Client(config),database='verify_deliveries_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'V02',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
  const checked=name=>{report.checks.push(name);console.log('OK:',name);};let stage='restore';
  await control.connect();
  try{
    assert.notEqual((await control.query('SELECT current_database() name')).rows[0].name,database);
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const child={env:{...postgresEnvironment(),DATABASE_URL:url.toString(),DB_NAME:database,PGDATABASE:database},windowsHide:true,stdio:'pipe',timeout:180000,cwd:__dirname};
    execFileSync(findPgTool('pg_restore'),['--exit-on-error','--no-owner','--no-acl','--dbname',database,dump],child);

    execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],child);execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],child);
    writer=new Client({connectionString:url.toString()});await writer.connect();assert.equal((await writer.query('SELECT current_database() name')).rows[0].name,database);
    await writer.query('UPDATE auth_user SET is_active=false');
    await writer.query("INSERT INTO app_role_permission(role,permission_code) SELECT 'admin',unnest(ARRAY['crm.unidades.consultar','crm.unidades.gestionar']) ON CONFLICT DO NOTHING");
    const {AuthService}=require('./dist/auth/auth.service'),{randomUUID}=require('node:crypto');
    const password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['delivery_admin_','delivery_operator_'].map(x=>x+randomBytes(5).toString('hex')),users=[];
    for(const [i,name]of names.entries())users.push((await writer.query('INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,$3,true,0)RETURNING id_user',[name,hash,i===0?'admin':'user'])).rows[0].id_user);
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    const ds=app.get(DataSource);assert.equal((await ds.query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    const tokens=await Promise.all(names.map(async name=>(await auth.login(name,password)).access_token));const actor=auth.verify(tokens[0]);
    const call=async(route,token=tokens[0],status=200,method='GET',body)=>{
      const response=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const data=await response.json();assert.equal(response.status,status,route+': HTTP'+response.status+' esperado'+status+(typeof data.message==='string'?' '+data.message:''));return{body:data,cache:response.headers.get('cache-control')};
    };

    stage='fixtures';
    const client=(await writer.query('SELECT "IdCliente" id FROM cliente ORDER BY "IdCliente" LIMIT 1')).rows[0].id;
    const tax=(await writer.query('SELECT "IdObjetoImpuesto" id FROM objetoimpuesto WHERE "Clave"=\'01\'')).rows[0].id;
    const product=(await writer.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR",costo_reposicion,margen_minimo)
      VALUES($1,'V02 Filtro de prueba',$2,100,1000,'01',0,false,10,0)RETURNING "IdProducto" id`,['V02-'+randomBytes(4).toString('hex'),tax])).rows[0].id;
    await call('comercial/clientes/'+client,tokens[0],200,'PUT',{limiteCredito:99999999999,diasCredito:30,bloqueado:false});
    const create=async(ready=true)=>{const order=(await call('pedidos',tokens[0],201,'POST',{requestId:randomUUID(),idCliente:client,partidas:[{idProducto:product,cantidad:1,valorUnitario:100}]})).body;
      if(ready){const confirmed=(await call('pedidos/'+order.idPedido+'/confirmar',tokens[0],201,'POST',{})).body;
        await call('pedidos/'+order.idPedido+'/surtir',tokens[0],201,'POST',{partidas:[{idDetalle:confirmed.partidas[0].idDetalle,cantidad:1}]});}
      return (await call('pedidos/'+order.idPedido)).body;};
    const base=id=>'pedidos/'+id+'/entrega';
    const get=async id=>(await call(base(id))).body;
    const fields=order=>({requestId:randomUUID(),version:order.version,recibidoPor:'Receptor declarado V02',notas:'Revisión de empaque',confirmacion:'true'});
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/iE0AAAAASUVORK5CYII=','base64');
    let attempts=0;
    const multipart=async(id,body,files={},status=201,token=tokens[0])=>{
      if(attempts>=8){console.log('Esperando ventana real del limitador de entregas en la copia.');await new Promise(r=>setTimeout(r,61000));attempts=0;}attempts++;
      const form=new FormData();for(const[k,v]of Object.entries(body))form.set(k,String(v));for(const[k,v]of Object.entries(files))form.set(k,new Blob([v.bytes??png],{type:v.type??'image/png'}),k+'.png');
      const r=await fetch(api+'/api/v1/'+base(id)+'/evidencia',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:form});
      const value=await r.json();assert.equal(r.status,status,'Entrega HTTP'+r.status+' esperado'+status+(typeof value.message==='string'?' '+value.message:''));return value;
    };
    const order=await create(),id=order.idPedido;
    await call(base(id),null,401);await call(base(id),tokens[1],403);
    assert.equal((await call(base(id))).cache,'private, no-store');assert.equal((await get(id)).evidencia,null);
    await multipart(id,fields(order),{},403,tokens[1]);
    await call('pedidos/'+id+'/entregar',tokens[1],403,'POST',{});
    checked('103 restaurada/aplicada sólo en copia; sin backfill, lectura no-store, permiso nuevo y ruta anterior restringida');
    await multipart(id,{...fields(order),confirmacion:'false'},{},400);
    await multipart(id,fields(order),{},400);
    await multipart(id,fields(order),{foto:{bytes:Buffer.from('<svg>script</svg>'),type:'image/png'}},400);
    await multipart(id,{...fields(order),latitud:22.2},{foto:{}},400);
    await multipart(id,{...fields(order),latitud:22.2,longitud:-97.8,precision:12,ubicacionFecha:'2020-01-01T00:00:00Z'},{foto:{}},400);
    assert.equal((await get(id)).estado,'Surtido');
    checked('Confirmación/receptor/evidencia o motivo, formato de imagen y ubicación completa/reciente se validan sin cambiar estado');
    const draft=await create(false);await multipart(draft.idPedido,{...fields(draft),motivoSinEvidencia:'Sin evidencia'}, {},409);
    await multipart(id,{...fields(order),version:order.version+1,motivoSinEvidencia:'Sin evidencia'}, {},409);
    const counter=async()=> (await writer.query('SELECT "Existencia"::text n FROM producto WHERE "IdProducto"=$1',[product])).rows[0].n;
    const before=await counter(),body={...fields(order),latitud:22.2,longitud:-97.8,precision:12,ubicacionFecha:new Date().toISOString()};
    const savedDelivery=await multipart(id,body,{firma:{},foto:{}});assert.ok(savedDelivery.idEntrega);assert.equal(await counter(),before);
    const state=await get(id);assert.equal(state.estado,'Entregado');assert.equal(Number(state.evidencia.snapshot.partidas[0].cantidad),1);assert.equal(state.evidencia.snapshot.archivos.length,2);
    assert.equal((await multipart(id,body,{firma:{},foto:{}})).idEntrega,savedDelivery.idEntrega);
    await multipart(id,{...body,recibidoPor:'Otro receptor'},{firma:{},foto:{}},409);
    checked('Surtido/version exigidos; firma/foto/ubicación/snapshot y entrega atómicos, sin consumir stock otra vez; reintento idéntico y rechazo de UUID alterado');
    for(const kind of ['firma','foto']){const r=await fetch(api+'/api/v1/'+base(id)+'/archivos/'+kind,{headers:{Authorization:'Bearer '+tokens[0]}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);}
    const pdf=await fetch(api+'/api/v1/'+base(id)+'/comprobante',{headers:{Authorization:'Bearer '+tokens[0]}});assert.equal(pdf.status,200);const pdfBytes=Buffer.from(await pdf.arrayBuffer());assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(path.join(root,'.artifacts/v02-comprobante.pdf'),pdfBytes);
    await call(base(id)+'/archivos/otro',tokens[0],404);
    const audits=(await writer.query("SELECT app_user_id,new_record::text data FROM auditoria_jsonb WHERE table_name='pedido_entrega_evidencia' AND new_record->>'id_entrega'=$1",[savedDelivery.idEntrega])).rows;assert.equal(audits.length,1);assert.equal(audits[0].app_user_id,users[0]);assert.ok(!audits[0].data.includes(png.toString('base64')));
    assert.equal((await writer.query("SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='pedido_entrega_archivo'")).rows[0].n,0);
    checked('Descargas privadas autenticadas de originales/PDF, no-store/nosniff/attachment y auditoría de metadata atribuida sin duplicar bytes');
    for(const sql of ["UPDATE pedido_entrega_evidencia SET autor_nombre='Cambio'",'DELETE FROM pedido_entrega_archivo','TRUNCATE pedido_entrega_archivo',`UPDATE entrega_pedido SET recibido_por='Otro' WHERE id_entrega=${savedDelivery.idEntrega}`])await assert.rejects(writer.query(sql),e=>e.code==='P0001');
    await writer.query('UPDATE cliente SET "RazonSocial"=$2 WHERE "IdCliente"=$1',[client,'Nombre posterior V02']);assert.equal((await get(id)).evidencia.snapshot.cliente,state.evidencia.snapshot.cliente);
    checked('Triggers ALWAYS bloquean UPDATE/DELETE/TRUNCATE y reescritura de entrega; cambios al cliente no alteran snapshot');
    const rollback=await create();await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_v02_failure CHECK(table_name<>'pedido_entrega_evidencia') NOT VALID");
    try{await multipart(rollback.idPedido,{...fields(rollback),motivoSinEvidencia:'Rollback en copia'}, {},400);}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_v02_failure');}
    assert.equal((await get(rollback.idPedido)).estado,'Surtido');assert.equal((await get(rollback.idPedido)).evidencia,null);
    assert.equal((await writer.query('SELECT count(*)::int n FROM entrega_pedido WHERE id_pedido=$1',[rollback.idPedido])).rows[0].n,0);
    checked('Fallo real de auditoría revierte entrega/estado/evidencia juntos');
    const racing=await create(),raceBody={...fields(racing),motivoSinEvidencia:'Sin imagen en mostrador'};
    const [winner,repeated]=await Promise.all([multipart(racing.idPedido,raceBody),multipart(racing.idPedido,raceBody)]);assert.equal(winner.idEntrega,repeated.idEntrega);await multipart(racing.idPedido,{...raceBody,requestId:randomUUID()}, {},409);
    await multipart(order.idPedido,{...raceBody,requestId:raceBody.requestId},{},409);
    assert.equal((await writer.query('SELECT count(*)::int n FROM entrega_pedido WHERE id_pedido=$1',[racing.idPedido])).rows[0].n,1);
    const legacy=await create();await call('pedidos/'+legacy.idPedido+'/entregar',tokens[0],201,'POST',{recibidoPor:'Receptor anterior',notas:'Ruta compatible'});assert.equal((await get(legacy.idPedido)).entregaAnterior.recibidoPor,'Receptor anterior');await call(base(legacy.idPedido)+'/comprobante',tokens[0],404);
    checked('Una entrega por pedido, UUID global ligado al contenido/pedido y ruta anterior conservada sin inventar comprobante V02');
    const service=app.get(require('./dist/pedido/entrega-evidencia.service').EntregaEvidenciaService),revoked=await create();
    await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[0]]);
    const waiting=service.register(revoked.idPedido,{...fields(revoked),motivoSinEvidencia:'Actor obsoleto'}, {},actor).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));let blocked=false;
    for(let n=0;n<100;n++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);tokens[0]=(await auth.login(names[0],password)).access_token;
    assert.equal((await get(revoked.idPedido)).estado,'Surtido');checked('Revocación mientras espera revalidada bajo bloqueo de cuenta; no entrega con actor obsoleto');
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    console.log('Esperando ventana real del limitador antes de UI.');await new Promise(r=>setTimeout(r,61000));
    browser=await chromium.launch();const errors=[];
    for(const [theme,width]of[['light',1280],['dark',390]]){
      const o=await create(),owner=await browser.newContext({viewport:{width,height:1100},geolocation:{latitude:22.2,longitude:-97.8},permissions:['geolocation']}),page=await owner.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.name));await page.addInitScript(v=>localStorage.setItem('theme',v),theme);
      await page.goto(origin+'/login?returnUrl='+encodeURIComponent('/pedidos'));await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/pedidos');
      await page.getByRole('button',{name:'PED-'+o.folio,exact:true}).click();await page.getByRole('button',{name:'Registrar entrega',exact:true}).click();
      const dialog=page.getByRole('dialog').last();await expect(dialog.getByRole('heading',{name:'Evidencias de entrega · Pedido '+o.idPedido,exact:true})).toBeVisible();
      await expect(dialog.getByRole('button',{name:'Registrar entrega y conservar evidencias',exact:true})).toBeDisabled();
      await dialog.getByLabel('Adjuntar firma PNG',{exact:true}).setInputFiles({name:'firma.png',mimeType:'image/png',buffer:png});
      await dialog.getByRole('button',{name:'Limpiar firma',exact:true}).click();await expect(dialog.getByLabel('Adjuntar firma PNG',{exact:true})).toHaveValue('');
      await dialog.getByLabel('Nombre de quien recibe',{exact:true}).fill('Receptor UI '+theme);await dialog.getByLabel('Foto de entrega (hasta5MiB)',{exact:true}).setInputFiles({name:'foto.png',mimeType:'image/png',buffer:png});
      const canvas=dialog.locator('canvas'),box=await canvas.boundingBox();await page.mouse.move(box.x+20,box.y+50);await page.mouse.down();await page.mouse.move(box.x+100,box.y+70,{steps:10});await page.mouse.up();
      await dialog.getByRole('button',{name:'Agregar ubicación del dispositivo',exact:true}).click();await expect(dialog.getByText(/Ubicación capturada/)).toBeVisible();
      await dialog.getByRole('checkbox').check();assert.deepEqual((await new AxeBuilder({page}).include('app-entrega-dialog').analyze()).violations,[]);
      assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await dialog.screenshot({path:path.join(root,'.artifacts/v02-form-'+theme+'.png')});
      await dialog.getByRole('button',{name:'Registrar entrega y conservar evidencias',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Entrega registrada',exact:true})).toBeVisible();
      const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Descargar comprobante PDF',exact:true}).click();assert.match((await download).suggestedFilename(),/\.pdf$/);
      assert.deepEqual((await new AxeBuilder({page}).include('app-entrega-dialog').analyze()).violations,[]);await dialog.screenshot({path:path.join(root,'.artifacts/v02-registered-'+theme+'.png')});if(theme==='dark')await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();await expect(page.getByRole('button',{name:'Evidencias de entrega',exact:true})).toBeVisible();await owner.close();
    }
    assert.deepEqual(errors,[]);checked('Angular producción/login/API/PostgreSQL reales: captura firma/foto, ubicación simulada explícita, registro/PDF/recarga; claro1280/oscuro390, axe y reflujo sin errores JS');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_deliveries_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/v02-entregas.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de entregas:',error instanceof assert.AssertionError?error.message:[error.name,error.code,error.constraint].filter(Boolean).join(' '),
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/v02-entregas.json; sin secretos en salida.');process.exitCode=1;});
