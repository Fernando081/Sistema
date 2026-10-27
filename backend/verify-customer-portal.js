/* V03.1: AppModule/PostgreSQL/Angular reales en copia desechable. Nunca imprime secretos. */
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
  const control=new Client(config),database='verify_portal_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const publications=process.argv.includes('--publications'),reportName=publications?'v032-publicaciones.json':'v03-portal.json';
  const report={phase:publications?'V03.2':'V03.1',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
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
    const password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['portal_staff_','portal_operator_'].map(x=>x+randomBytes(5).toString('hex')),users=[];
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
    const service=app.get(require('./dist/portal/portal-identity.service').PortalIdentityService);
    const clients=[];for(const [i,name]of ['Cliente Portal Alfa','Cliente Portal Beta'].entries()){
      clients.push((await writer.query(`INSERT INTO cliente("RFC","RazonSocial","Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI")
       SELECT $1,$2,"Pais","CodigoPostal","IdMetodoDePago","IdFormaPago","IdRegimenFiscal","IdUsoCFDI" FROM cliente ORDER BY "IdCliente" LIMIT 1 RETURNING "IdCliente" AS id`,['PR'+(i===0?'A':'B')+'010101AA1',name])).rows[0].id);
      await call('comercial/clientes/'+clients[i],tokens[0],200,'PUT',{limiteCredito:99999999999,diasCredito:30,bloqueado:false});
    }
    const aliases=['portal_alfa_','portal_beta_'].map(x=>x+randomBytes(4).toString('hex')),portalPassword=randomBytes(18).toString('hex');
    const accountPath=id=>'clientes/'+id+'/portal-accesos';const invitation=(i=0)=>({requestId:randomUUID(),alias:aliases[i],nombre:'Contacto autorizado '+i,motivo:'Piloto aislado autorizado'});
    await call(accountPath(clients[0]),null,401);await call(accountPath(clients[0]),tokens[1],403);assert.equal((await call(accountPath(clients[0]))).body.total,0);
    const createBody=invitation(),a=(await call(accountPath(clients[0]),tokens[0],201,'POST',createBody)).body,b=(await call(accountPath(clients[1]),tokens[0],201,'POST',invitation(1))).body;
    assert.ok(a.token);assert.ok((await call(accountPath(clients[0]),tokens[0],201,'POST',createBody)).body.token===a.token,'Invitación idempotente');await call(accountPath(clients[0]),tokens[0],409,'POST',{...createBody,nombre:'Otro nombre'});
    const stored=(await writer.query('SELECT * FROM portal_invitacion WHERE id_acceso=$1',[a.idAcceso])).rows[0];assert.ok(!JSON.stringify(stored).includes(a.token));assert.ok(!JSON.stringify((await call(accountPath(clients[0]))).body).includes(a.token));
    checked('104 sólo en copia sin inscripción automática; administración401/403, permiso ADMIN, invitación UUID/huella idempotente y token sólo hash sin aparecer en listados');
    let origin='http://127.0.0.1:4300';
    const portal=async(route,cookie='',status=200,method='GET',body,headers={})=>{
      const r=await fetch(api+'/api/v1/portal/'+route,{method,headers:{Origin:origin,'X-Portal-Browser':'1',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const data=await r.json();assert.equal(r.status,status,'Portal '+route+' HTTP'+r.status+' esperado'+status+(typeof data.message==='string'?' '+data.message:''));return{data,response:r};
    };
    await portal('sesion','',401);await portal('sesion','erp_session='+tokens[0],401);
    await portal('sesion','',403,'GET',undefined,{'X-Portal-Browser':''});await portal('sesion','',403,'GET',undefined,{Origin:'https://outside.example.test'});
    await portal('activar','',201,'POST',{token:a.token,password:portalPassword});await portal('activar','',401,'POST',{token:a.token,password:portalPassword});await portal('activar','',201,'POST',{token:b.token,password:portalPassword});
    const ca=await portal('login','',201,'POST',{alias:aliases[0],password:portalPassword}),cb=await portal('login','',201,'POST',{alias:aliases[1],password:portalPassword});
    const cookieA=ca.response.headers.get('set-cookie').split(';')[0],cookieB=cb.response.headers.get('set-cookie').split(';')[0],rawA=cookieA.split('=')[1];
    assert.match(ca.response.headers.get('set-cookie'),/HttpOnly/);assert.match(ca.response.headers.get('set-cookie'),/SameSite=Strict/);assert.match(ca.response.headers.get('set-cookie'),/Path=\/api\/v1\/portal/);assert.deepEqual(Object.keys(ca.data),['venceEn']);
    assert.equal((await portal('sesion',cookieA)).data.cliente,'Cliente Portal Alfa');assert.equal((await portal('sesion',cookieB)).data.cliente,'Cliente Portal Beta');
    await call('cliente',rawA,401);const erp=await fetch(api+'/api/v1/auth/me',{headers:{Cookie:cookieA}});assert.equal(erp.status,401);await erp.arrayBuffer();
    assert.equal((await portal('sesion',cookieA+'; erp_session='+tokens[0])).data.cliente,'Cliente Portal Alfa');
    assert.equal((await fetch(api+'/api/v1/auth/me',{headers:{Cookie:cookieA+'; erp_session='+tokens[0]}})).status,200);
    await portal('salir',cookieA,403,'POST',{}, {Origin:'https://outside.example.test'});await portal('sesion',cookieA);
    checked('Activación única, cookies HttpOnly/Strict propias sin token JSON; dos clientes aislados, credencial del portal rechazada en ERP y coexistencia sin impersonación; origen/cabecera CSRF exigidos');
    const tax=(await writer.query('SELECT "IdObjetoImpuesto" id FROM objetoimpuesto WHERE "Clave"=\'01\'')).rows[0].id;
    const product=(await writer.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR",costo_reposicion,margen_minimo)
      VALUES($1,'V03 Pieza de prueba',$2,100,1000,'01',0,false,10,0)RETURNING "IdProducto" id`,['V03-'+randomBytes(4).toString('hex'),tax])).rows[0].id;
    const form=(await writer.query('SELECT "IdFormaPago" id FROM formadepago WHERE "Clave"=\'01\'')).rows[0].id,method=(await writer.query('SELECT "IdMetodoDePago" id FROM metododepago WHERE "Clave"=\'PPD\'')).rows[0].id;
    const fixtures=[];
    for(const [i,client]of clients.entries()){
      const unit=(await call('crm/clientes/'+client+'/unidades',tokens[0],201,'POST',{esn:'V03-'+i+'-'+randomBytes(5).toString('hex'),numeroEconomico:'Unidad portal '+i,notas:'NO_PUBLICAR_NOTA_UNIDAD'})).body.idUnidad;
      const quote=(await call('cotizacion',tokens[0],201,'POST',{idCliente:client,nombreReceptor:'Portal '+i,rfcReceptor:'XAXX010101000',subtotal:100,totalImpuestos:0,totalRetenciones:0,total:100,conceptos:[{idProducto:product,descripcion:'Propuesta portal '+i,unidadDescripcion:'Pieza',cantidad:1,valorUnitario:100,importe:100,importeIva:0,importeRetIsr:0}]})).body.id;
      await call('cotizacion/'+quote+'/versiones/sellar',tokens[0],201,'POST',{requestId:randomUUID(),motivo:'NO_PUBLICAR_MOTIVO_INTERNO'});
      const order=(await call('pedidos',tokens[0],201,'POST',{requestId:randomUUID(),idCliente:client,notas:'NO_PUBLICAR_NOTA_PEDIDO',partidas:[{idProducto:product,cantidad:1,valorUnitario:100}]})).body.idPedido;await call('pedidos/'+order+'/confirmar',tokens[0],201,'POST',{});
      const invoice=(await call('venta',tokens[0],201,'POST',{requestId:randomUUID(),idCliente:client,rfcReceptor:'XAXX010101000',nombreReceptor:'Portal '+i,cpReceptor:'89318',regimenReceptor:'616',usoCfdi:'S01',idFormaPago:form,idMetodoPago:method,moneda:'MXN',tipoCambio:1,subtotal:100,totalImpuestosTrasladados:0,totalImpuestosRetenidos:0,total:100,conceptos:[{idProducto:product,claveProdServ:'01010101',claveUnidad:'H87',objetoImpuesto:'01',codigo:'V03',descripcion:'Venta portal '+i,unidadDescripcion:'Pieza',cantidad:1,valorUnitario:100,importe:100,descuento:0,baseIva:0,tasaIva:0,importeIva:0}]})).body.idFactura;
      const concept=(await writer.query('SELECT id_concepto FROM conceptofactura WHERE id_factura=$1',[invoice])).rows[0].id_concepto;
      const warranty=(await call('garantias',tokens[0],201,'POST',{idFactura:invoice,idConcepto:concept,motivo:'NO_PUBLICAR_MOTIVO_GARANTIA',cantidad:1,destinoProducto:'Revision'})).body;
      await writer.query("UPDATE factura SET estatus='Timbrada' WHERE id_factura=$1",[invoice]); // Fixture de estado, NO timbre/PAC real.
      const warrantyId=(await writer.query('SELECT id_garantia FROM garantia WHERE id_factura=$1',[invoice])).rows[0].id_garantia;void warranty;
      fixtures.push({unidades:unit,cotizaciones:quote,pedidos:order,facturas:invoice,garantias:warrantyId});
    }
    if(publications){stage='publicaciones';await require('./verify-portal-publications').verifyApi({app,writer,clients,fixtures,call,portal,cookieA,cookieB,actor,tokens,checked,root,api});}
    stage='tenant-read';
    for(const kind of Object.keys(fixtures[0])){
      await portal('documentos/'+kind,'',401);const list=await portal('documentos/'+kind,cookieA);assert.equal(list.response.headers.get('cache-control'),'private, no-store');assert.equal(list.data.total,1);assert.equal(list.data.data[0].id,fixtures[0][kind]);
      const detail=(await portal('documentos/'+kind+'/'+fixtures[0][kind],cookieA)).data;assert.equal(detail.id,fixtures[0][kind]);
      await portal('documentos/'+kind+'/'+fixtures[1][kind],cookieA,404);await portal('documentos/'+kind+'/'+fixtures[1][kind]+'/resumen',cookieA,404);
      await portal('documentos/'+kind+'?idCliente='+clients[1],cookieA,400);const text=JSON.stringify([list.data,detail]);for(const hidden of ['NO_PUBLICAR','password_hash','token_hash','costo_unitario_snapshot','idProveedor','comision','idCliente','notas'])assert.ok(!text.includes(hidden),kind+' contiene '+hidden);
      const response=await fetch(api+'/api/v1/portal/documentos/'+kind+'/'+fixtures[0][kind]+'/resumen',{headers:{Origin:origin,'X-Portal-Browser':'1',Cookie:cookieA}});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');if(kind==='pedidos')fs.writeFileSync(path.join(root,'.artifacts/v03-resumen.pdf'),bytes);
    }
    await portal('documentos/usuarios',cookieA,404);await portal('documentos/pedidos?page=-1',cookieA,400);assert.equal((await portal('documentos/unidades?q=%25',cookieA)).data.total,0);
    const esn=(await writer.query('SELECT esn FROM crm_unidad_cliente WHERE id_unidad=$1',[fixtures[0].unidades])).rows[0].esn;assert.equal((await portal('documentos/unidades?q='+encodeURIComponent(esn),cookieA)).data.total,1);
    checked('Cinco secciones con listados/detalle/PDF ligados a cliente del servidor: cruces devuelven404, idCliente inyectado400, proyección mínima sin costos/notas/proveedores/secretos y respuestas privadas');
    const draft=(await call('pedidos',tokens[0],201,'POST',{requestId:randomUUID(),idCliente:clients[0],partidas:[{idProducto:product,cantidad:1,valorUnitario:100}]})).body.idPedido;await portal('documentos/pedidos/'+draft,cookieA,404);
    const unsealed=(await call('cotizacion',tokens[0],201,'POST',{idCliente:clients[0],nombreReceptor:'Borrador no publicado',rfcReceptor:'XAXX010101000',subtotal:100,totalImpuestos:0,totalRetenciones:0,total:100,conceptos:[{idProducto:product,descripcion:'Borrador',unidadDescripcion:'Pieza',cantidad:1,valorUnitario:100,importe:100,importeIva:0,importeRetIsr:0}]})).body.id;await portal('documentos/cotizaciones/'+unsealed,cookieA,404);
    for(let i=0;i<21;i++)await writer.query('INSERT INTO crm_unidad_cliente(id_cliente,esn,numero_economico)VALUES($1,$2,$3)',[clients[0],'V03-PAGE-'+i+'-'+randomBytes(3).toString('hex'),'Página '+i]);
    assert.equal((await portal('documentos/unidades',cookieA)).data.data.length,20);const second=(await portal('documentos/unidades?page=2',cookieA)).data;assert.equal(second.total,22);assert.equal(second.data.length,2);
    checked('Borradores de pedido/cotización no publicados; consultas paginadas20 con total, búsqueda literal y sección desconocida no amplían alcance');
    stage='access-controls';
    const reset={requestId:randomUUID(),version:(await call(accountPath(clients[1]))).body.data[0].version,motivo:'Restablecimiento en copia'};
    const resetPath=accountPath(clients[1])+'/'+b.idAcceso+'/restablecer',replacement=(await call(resetPath,tokens[0],201,'POST',reset)).body;
    assert.ok((await call(resetPath,tokens[0],201,'POST',reset)).body.token===replacement.token,'Restablecimiento idempotente');await portal('sesion',cookieB,401);await service.activate({token:replacement.token,password:portalPassword});
    await assert.rejects(service.activate({token:b.token,password:portalPassword}),e=>e.getStatus?.()===401);
    const beta=await service.login({alias:aliases[1],password:portalPassword});const betaCookie='portal_session='+beta.token;
    const suspend={requestId:randomUUID(),version:(await call(accountPath(clients[1]))).body.data[0].version,motivo:'Suspensión de piloto'};
    const suspendPath=accountPath(clients[1])+'/'+b.idAcceso+'/suspender';await call(suspendPath,tokens[0],201,'POST',suspend);await call(suspendPath,tokens[0],201,'POST',suspend);await portal('sesion',betaCookie,401);
    await call(accountPath(clients[0])+'/'+b.idAcceso+'/restablecer',tokens[0],404,'POST',reset);
    checked('Restablecer/suspender versionados e idempotentes revocan sesiones/enlaces y credencial; no se administra una cuenta desde otro cliente');
    const lockBody=invitation();lockBody.alias='lock_'+randomBytes(5).toString('hex');const locked=(await call(accountPath(clients[0]),tokens[0],201,'POST',lockBody)).body;await service.activate({token:locked.token,password:portalPassword});
    for(let i=0;i<5;i++)await assert.rejects(service.login({alias:lockBody.alias,password:'incorrecta'}),e=>e.getStatus?.()===401);await assert.rejects(service.login({alias:lockBody.alias,password:portalPassword}),e=>e.getStatus?.()===401);
    assert.ok((await writer.query('SELECT bloqueado_hasta>clock_timestamp() bloqueado FROM portal_credencial WHERE id_acceso=$1',[locked.idAcceso])).rows[0].bloqueado);
    const sessions=[];for(let i=0;i<6;i++)sessions.push(await service.login({alias:aliases[0],password:portalPassword}));await portal('sesion','portal_session='+sessions[0].token,401);await portal('sesion','portal_session='+sessions.at(-1).token);
    const current=sessions.at(-1).token,newPassword=randomBytes(20).toString('hex');await portal('password','portal_session='+current,201,'POST',{actual:portalPassword,nueva:newPassword});await portal('sesion','portal_session='+current,401);await assert.rejects(service.login({alias:aliases[0],password:portalPassword}),e=>e.getStatus?.()===401);
    const latest=await service.login({alias:aliases[0],password:newPassword});const portalPasswordForUi=newPassword;
    checked('Cinco fallos bloquean15min de forma persistente, máximo5 sesiones vivas y cambio de contraseña revoca todas sin cambiar credenciales ERP');
    const audits=(await writer.query("SELECT table_name,app_user_id,new_record::text AS data FROM auditoria_jsonb WHERE table_name IN ('portal_acceso','portal_evento','portal_credencial','portal_sesion','portal_invitacion')")).rows;
    assert.ok(audits.length>0);assert.ok(audits.every(r=>['portal_acceso','portal_evento'].includes(r.table_name)));assert.ok(audits.filter(r=>r.data.includes('Activación')).every(r=>r.app_user_id===null));assert.ok(audits.some(r=>r.table_name==='portal_acceso'&&r.app_user_id===users[0]));
    const serialized=JSON.stringify(audits);for(const secret of[a.token,b.token,rawA,portalPassword,newPassword])assert.ok(!serialized.includes(secret));
    await assert.rejects(writer.query("UPDATE portal_acceso SET id_cliente=$2 WHERE id_acceso=$1",[a.idAcceso,clients[1]]),e=>e.code==='P0001');await assert.rejects(writer.query('TRUNCATE portal_evento'),e=>e.code==='P0001');
    await assert.rejects(writer.query("INSERT INTO auditoria_jsonb(table_name,action,new_record)VALUES('portal_sesion','INSERT','{}')"),e=>e.code==='P0001');
    checked('Cliente/alias inmutables, eventos conservados y auditoría sin hashes/tokens/contraseñas; activación externa no hereda actor ERP');
    const rollbackBody=invitation();rollbackBody.alias='rollback_'+randomBytes(4).toString('hex');await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_v03_failure CHECK(table_name<>'portal_evento') NOT VALID");
    try{await call(accountPath(clients[0]),tokens[0],400,'POST',rollbackBody);}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_v03_failure');}assert.equal((await writer.query('SELECT count(*)::int n FROM portal_acceso WHERE alias=$1',[rollbackBody.alias])).rows[0].n,0);
    checked('Fallo real de auditoría revierte alta, credencial e invitación juntas');
    const expiredBody=invitation();expiredBody.alias='expiry_'+randomBytes(4).toString('hex');const expired=(await call(accountPath(clients[0]),tokens[0],201,'POST',expiredBody)).body;
    await writer.query("UPDATE portal_invitacion SET vence_en=creada_en+interval '1 millisecond' WHERE id_acceso=$1",[expired.idAcceso]);await assert.rejects(service.activate({token:expired.token,password:portalPassword}),e=>e.getStatus?.()===401);
    await writer.query("UPDATE portal_sesion SET vence_en=creada_en+interval '1 millisecond' WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[latest.token]);await portal('sesion','portal_session='+latest.token,401);
    await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[0]]);
    const staleBody=invitation();staleBody.alias='stale_'+randomBytes(4).toString('hex');const waiting=service.create(clients[0],staleBody,actor).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));let blocked=false;
    for(let n=0;n<100;n++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);tokens[0]=(await auth.login(names[0],password)).access_token;
    assert.equal((await writer.query('SELECT count(*)::int n FROM portal_acceso WHERE alias=$1',[staleBody.alias])).rows[0].n,0);
    checked('Invitación/sesión vencidas no autentican y revocación de personal mientras espera se revalida sin crear acceso');
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const errors=[];
    for(const[theme,width]of[['light',1280],['dark',390]]){
      const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.name));await page.addInitScript(v=>localStorage.setItem('theme',v),theme);
      await page.goto(origin+'/login?returnUrl=%2Fcliente');await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/cliente');
      // El directorio usa paginación remota; filtrar el cliente creado exclusivamente en la copia.
      await page.getByLabel('Buscar cliente',{exact:true}).fill('Cliente Portal Alfa');
      const row=width<600?page.locator('.mobile-client-card').filter({hasText:'Cliente Portal Alfa'}):page.getByRole('row').filter({hasText:'Cliente Portal Alfa'});
      await row.getByRole('button',{name:width<600?'Portal':'Accesos al portal de clientes',exact:true}).click();const dialog=page.getByRole('dialog').last();await expect(dialog.getByRole('heading',{name:/Accesos al portal/})).toBeVisible();await expect(dialog.getByRole('status')).toBeHidden();
      const alias='ui_'+theme+'-'+randomBytes(3).toString('hex');await dialog.getByLabel('Alias de acceso',{exact:true}).fill(alias);await dialog.getByLabel('Nombre del contacto autorizado',{exact:true}).fill('Contacto UI '+theme);await dialog.getByLabel('Motivo de alta o cambio',{exact:true}).fill('Alta autorizada de prueba UI');stage='Angular '+theme+' invitacion';await dialog.getByRole('button',{name:'Crear invitación',exact:true}).click().catch(async error=>{
        const fields=await dialog.locator('input,textarea,button').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,name:node.getAttribute('name'),type:node.getAttribute('type'),disabled:node.disabled,validity:node.validity?{valid:node.validity.valid,valueMissing:node.validity.valueMissing,patternMismatch:node.validity.patternMismatch,tooLong:node.validity.tooLong}:null})));
        fs.writeFileSync(path.join(root,'.artifacts/v03-ui-form-diagnostic.json'),JSON.stringify({stage,fields},null,2)+'\n');throw error;
      });await expect(dialog.getByLabel('Enlace de activación',{exact:true})).not.toHaveValue('');const link=await dialog.getByLabel('Enlace de activación',{exact:true}).inputValue();
      assert.deepEqual((await new AxeBuilder({page}).include('app-portal-access-dialog').analyze()).violations,[]);
      const customer=await browser.newContext({viewport:{width,height:1100}}),guest=await customer.newPage();guest.setDefaultTimeout(15000);guest.on('pageerror',e=>errors.push(e.name));await guest.addInitScript(v=>localStorage.setItem('theme',v),theme);const urls=[];guest.on('request',r=>urls.push(r.url()));await guest.goto(link);await expect(guest.getByRole('heading',{name:'Activar acceso al portal',exact:true})).toBeVisible();assert.ok(new URL(guest.url()).hash==='','Se borra el fragmento de activación');
      await guest.getByLabel('Contraseña nueva',{exact:true}).fill(portalPasswordForUi);await guest.getByLabel('Confirmar contraseña',{exact:true}).fill(portalPasswordForUi);await guest.getByRole('button',{name:'Activar acceso',exact:true}).click();await expect(guest.getByText(/Acceso activado/)).toBeVisible();assert.ok(urls.every(u=>!u.includes(new URLSearchParams(new URL(link).hash.slice(1)).get('token'))));
      await guest.getByRole('link',{name:'Ir al inicio de sesión',exact:true}).click();await guest.getByLabel('Alias de acceso',{exact:true}).fill(alias);await guest.getByLabel('Contraseña',{exact:true}).fill(portalPasswordForUi);await guest.getByRole('button',{name:'Entrar al portal',exact:true}).click();await expect(guest.getByRole('heading',{name:'Hola, Contacto UI '+theme,exact:true})).toBeVisible();
      if(publications){stage='Angular publicaciones '+theme;await require('./verify-portal-publications').verifyUi({page,guest,row,client:clients[0],theme,root});}
      await expect(guest.getByRole('heading',{name:'Pedido '+(await writer.query('SELECT folio FROM pedido_venta WHERE id_pedido=$1',[fixtures[0].pedidos])).rows[0].folio,exact:true})).toBeVisible();await guest.getByRole('button',{name:'Ver detalle',exact:true}).first().click();const download=guest.waitForEvent('download');await guest.getByRole('button',{name:'Descargar resumen PDF',exact:true}).click();assert.match((await download).suggestedFilename(),/\.pdf$/);
      await guest.getByRole('button',{name:'Mis unidades',exact:true}).click();await expect(guest.getByText('22 registros',{exact:false})).toBeVisible();await guest.reload();await expect(guest.getByRole('heading',{name:'Hola, Contacto UI '+theme,exact:true})).toBeVisible();
      assert.deepEqual((await new AxeBuilder({page:guest}).include('main').analyze()).violations,[]);assert.ok(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await guest.locator('main').screenshot({path:path.join(root,'.artifacts/v03-portal-'+theme+'.png')});
      const storage=await guest.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.ok(!storage.includes('portal_session'));assert.ok(!storage.includes(portalPasswordForUi));assert.ok(!storage.includes(new URLSearchParams(new URL(link).hash.slice(1)).get('token')));
      await guest.getByRole('button',{name:'Cerrar sesión del portal',exact:true}).click();await expect(guest.getByRole('heading',{name:'Bienvenido a tu portal',exact:true})).toBeVisible();
      // Cuenta del personal en otro contexto no se cierra por el401 del portal.
      await page.goto(origin+'/portal');await expect(page.getByRole('heading',{name:'Bienvenido a tu portal',exact:true})).toBeVisible();await page.goto(origin+'/cliente');await expect(page.getByText('Gestión de Clientes',{exact:true})).toBeVisible();const personal=await page.request.get(origin+'/api/v1/auth/browser-state',{headers:{'X-ERP-Browser':'1'}});assert.equal(personal.status(),200);
      await customer.close();await context.close();
    }
    if(publications)checked('Angular real: preparar, descargar revisión, confirmar publicación, cliente descarga copia etiquetada y retiro desaparece; claro1280/oscuro390, axe y reflujo');
    assert.deepEqual(errors,[]);checked('Angular/login personal y cliente reales: administrar invitación, activar desde fragmento borrado, login, consulta/PDF, recarga/salida y sesión ERP conservada; claro1280/oscuro390, axe/reflujo y sin secretos en Web Storage');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_portal_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts',reportName),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación del portal:',error instanceof assert.AssertionError?error.message.replace(/#token=[A-Za-z0-9_-]+/g,'#token=[REDACTADO]'):[error.name,error.code,error.constraint].filter(Boolean).join(' '),
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/v03-portal.json o v032-publicaciones.json; sin secretos en salida.');process.exitCode=1;});
