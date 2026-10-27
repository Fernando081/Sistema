/* D02: AppModule/PostgreSQL/Angular reales en copia desechable. Nunca imprime secretos. */
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
  const control=new Client(config),database='verify_quotes_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'V01',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
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
    const password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['quote_admin_','quote_operator_'].map(x=>x+randomBytes(5).toString('hex')),users=[];
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
    const product=(await writer.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR",costo_reposicion,margen_minimo,"IdClaveProdOServ","IdClaveUnidad")
      VALUES($1,'V01 Filtro de prueba',$2,100,100,'01',0,false,10,0,(SELECT "IdClaveProdOServ" FROM claveproductooservicio ORDER BY "IdClaveProdOServ" LIMIT 1),(SELECT "IdClaveUnidad" FROM claveunidad ORDER BY "IdClaveUnidad" LIMIT 1))RETURNING "IdProducto" id`,['V01-'+randomBytes(4).toString('hex'),tax])).rows[0].id;
    await call('comercial/clientes/'+client,tokens[0],200,'PUT',{limiteCredito:99999999999,diasCredito:30,bloqueado:false});
    const form=(await writer.query('SELECT "IdFormaPago" id FROM formadepago WHERE "Clave"=\'01\'')).rows[0].id,method=(await writer.query('SELECT "IdMetodoDePago" id FROM metododepago WHERE "Clave"=\'PPD\'')).rows[0].id;
    const proposal=(price=100,qty=1)=>({idCliente:client,nombreReceptor:'V01 Cliente de prueba',rfcReceptor:'XAXX010101000',subtotal:price*qty,totalImpuestos:0,totalRetenciones:0,total:price*qty,conceptos:[{idProducto:product,descripcion:'V01 Filtro de prueba',unidadDescripcion:'Pieza',cantidad:qty,valorUnitario:price,importe:price*qty,importeIva:0,importeRetIsr:0}]});
    const create=async()=> (await call('cotizacion',tokens[0],201,'POST',proposal())).body.id;
    const base=id=>'cotizacion/'+id+'/versiones',state=async id=>(await call(base(id))).body;
    const seal=async id=>(await call(base(id)+'/sellar',tokens[0],201,'POST',{requestId:randomUUID(),motivo:'Ensayo de revisión en copia'})).body;
    const invite=async id=>(await call(base(id)+'/enlaces',tokens[0],201,'POST',{requestId:randomUUID()})).body;
    const pub=async(route,body,status=201,header=true)=>{const r=await fetch(api+'/api/v1/cotizacion-respuesta'+route,{method:'POST',headers:{'Content-Type':'application/json',...(header?{'X-Cotizacion-Respuesta':'1'}:{})},body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,status,'Respuesta HTTP'+r.status+' esperado'+status+(typeof value.message==='string'?' '+value.message:''));return value;};
    const response=token=>({token,requestId:randomUUID(),decision:'Aceptada',nombre:'Cliente declarado de prueba',comentario:'Revisé los productos e importes',confirmacion:true});
    const quote=await create(),source=base(quote);
    await call(source,null,401);assert.equal((await state(quote)).actual,null);assert.equal((await call(source)).cache,'private, no-store');assert.equal((await call(source,tokens[1])).body.gestion,false);
    await call(source+'/sellar',tokens[1],403,'POST',{requestId:randomUUID(),motivo:'No autorizado'});
    const sealBody={requestId:randomUUID(),motivo:'Primera propuesta'},sealed=(await call(source+'/sellar',tokens[0],201,'POST',sealBody)).body;
    assert.equal((await call(source+'/sellar',tokens[0],201,'POST',sealBody)).body.idRevision,sealed.idRevision);await call(source+'/sellar',tokens[0],409,'POST',{...sealBody,motivo:'Otro motivo'});
    const snap=(await state(quote)).snapshot;
    await assert.rejects(writer.query("UPDATE cotizacion_revision SET motivo='Reescritura' WHERE id_revision=$1",[sealed.idRevision]),e=>e.code==='P0001');
    checked('102 en copia; activación explícita sin backfill, consulta privada/permisos/idempotencia, snapshot exacto y evidencia no reescribible por UPDATE');

    const {RegistroPedidoService}=require('./dist/pedido/registro-pedido.service'),orders=app.get(RegistroPedidoService);
    await assert.rejects(orders.createFromQuote(quote,{requestId:randomUUID()},users[0],actor),e=>e.getStatus?.()===409);
    await call('pedidos',tokens[0],409,'POST',{requestId:randomUUID(),idCliente:client,idCotizacion:quote,partidas:[{idProducto:product,cantidad:1,valorUnitario:100}]});
    const convert=async(id,price=100,status=201)=>{const detail=(await call('cotizacion/'+id)).body;return call('cotizacion/'+id+'/convertir',tokens[0],status,'POST',{idFormaPago:form,idMetodoPago:method,articulosAceptados:[{idConcepto:detail.conceptos[0].id_concepto,precioCierre:price}],articulosRechazados:[]});};
    await convert(quote,100,409);checked('Sin aceptación no hay pedido/venta y crear pedido directo con idCotizacion no evade el flujo versionado');
    const intent={requestId:randomUUID()},issued=(await call(source+'/enlaces',tokens[0],201,'POST',intent)).body;
    assert.ok((await call(source+'/enlaces',tokens[0],201,'POST',intent)).body.token===issued.token,'Enlace idempotente');
    const stored=(await writer.query('SELECT * FROM cotizacion_invitacion WHERE id_invitacion=$1',[issued.idInvitacion])).rows[0];assert.ok(!JSON.stringify(stored).includes(issued.token));assert.ok(!JSON.stringify(await state(quote)).includes(issued.token));
    await pub('/consultar',{token:issued.token},403,false);await pub('/consultar',{token:'invalido'},400);const view=await pub('/consultar',{token:issued.token});assert.equal(view.snapshot.total,snap.total);assert.ok(!('rfc'in view.snapshot));assert.ok(!('idCliente'in view.snapshot));assert.ok(!('idProducto'in view.snapshot.conceptos[0]));
    const savedEnv=process.env.NODE_ENV;try{process.env.NODE_ENV='production';await pub('/consultar',{token:issued.token},403);}finally{process.env.NODE_ENV=savedEnv;}
    checked('Emisión HMAC de servidor/hash único sin token en metadata; formulario JSON/cabecera, proyección pública mínima y HTTP rechazado en modo producción');
    await pub('',{...response(issued.token),confirmacion:false},400);
    const yes=response(issued.token),no={...response(issued.token),decision:'Rechazada',comentario:'Revisar propuesta'};
    const race=await Promise.all([yes,no].map(async body=>{const r=await fetch(api+'/api/v1/cotizacion-respuesta',{method:'POST',headers:{'Content-Type':'application/json','X-Cotizacion-Respuesta':'1'},body:JSON.stringify(body)});const data=await r.json();return{status:r.status,body,data};}));assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);const winner=race.find(x=>x.status===201);
    assert.equal((await pub('',winner.body)).respuesta.decision,winner.body.decision);assert.equal((await writer.query('SELECT count(*)::int n FROM cotizacion_respuesta WHERE id_revision=$1',[sealed.idRevision])).rows[0].n,1);
    const responseAudits=(await writer.query("SELECT app_user_id FROM auditoria_jsonb WHERE table_name='cotizacion_respuesta' AND new_record->>'id_revision'=$1",[String(sealed.idRevision)])).rows;assert.ok(responseAudits.length>0&&responseAudits.every(r=>r.app_user_id===null));
    checked('Confirmación explícita, única respuesta concurrente, reintento idéntico sin duplicado y nombre declarado separado de actor autenticado');
    const v2body={...proposal(120),requestId:randomUUID(),revisionAnterior:sealed.idRevision,motivo:'Cambio de precio'},v2=(await call(source,tokens[0],201,'POST',v2body)).body;
    assert.equal((await call(source,tokens[0],201,'POST',v2body)).body.idCotizacion,v2.idCotizacion);assert.equal((await state(v2.idCotizacion)).actual.numero,2);assert.equal((await state(v2.idCotizacion)).actual.respuesta,null);
    await pub('/consultar',{token:issued.token},404);await convert(quote,100,409);await assert.rejects(orders.createFromQuote(quote,{requestId:randomUUID()},users[0],actor),e=>e.getStatus?.()===409);
    const [a,b]=await Promise.all([1,2].map(n=>fetch(api+'/api/v1/'+base(v2.idCotizacion),{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify({...proposal(130),requestId:randomUUID(),revisionAnterior:(null),motivo:'Sin referencia'})}).then(async r=>{await r.arrayBuffer();return r.status;})));assert.equal(a,400);assert.equal(b,400);
    checked('Nueva revisión conserva anterior/cliente, crea cotización atómica, no hereda respuesta y retira enlace/conversión/pedido de la sustituida');
    const v2state=await state(v2.idCotizacion),v3body={...proposal(130),requestId:randomUUID(),revisionAnterior:v2state.actual.idRevision,motivo:'Ajuste concurrente'};
    const revisions=await Promise.all([v3body,{...v3body,requestId:randomUUID(),motivo:'Otro ajuste'}].map(async body=>{const r=await fetch(api+'/api/v1/'+base(v2.idCotizacion),{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}));assert.deepEqual(revisions.map(x=>x.status).sort(),[201,409]);const current=revisions.find(x=>x.status===201).data.idCotizacion;
    const currentState=await state(current),countBefore=(await writer.query('SELECT count(*)::int n FROM cotizacion')).rows[0].n;
    await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_v01_failure CHECK(table_name<>'cotizacion_revision') NOT VALID");try{await call(base(current),tokens[0],400,'POST',{...proposal(140),requestId:randomUUID(),revisionAnterior:currentState.actual.idRevision,motivo:'Rollback'});}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_v01_failure');}
    assert.equal((await writer.query('SELECT count(*)::int n FROM cotizacion')).rows[0].n,countBefore);assert.equal((await state(current)).actual.idCotizacion,current);
    checked('Dos revisiones concurrentes producen una alta/un409; fallo de auditoría revierte cotización nueva y evidencia juntas');
    const exp=await invite(current);await writer.query("UPDATE cotizacion_invitacion SET vence_en=creada_en+interval '1 millisecond' WHERE id_invitacion=$1",[exp.idInvitacion]);await pub('/consultar',{token:exp.token},404);
    const revoked=await invite(current);await call(base(current)+'/enlaces/'+revoked.idInvitacion+'/revocar',tokens[0],201,'POST',{motivo:'Prueba de revocación'});await pub('/consultar',{token:revoked.token},404);
    const beforeDrift=(await state(current)).snapshot;await writer.query('UPDATE cotizacion SET nombre_receptor=$2 WHERE id_cotizacion=$1',[current,'Nombre cambiado tras sello']);await call(base(current)+'/enlaces',tokens[0],409,'POST',{requestId:randomUUID()});assert.equal((await state(current)).coincide,false);await writer.query('UPDATE cotizacion SET nombre_receptor=$2 WHERE id_cotizacion=$1',[current,beforeDrift.nombre]);
    checked('Vencimiento/revocación bloquean consulta; cambios posteriores al sello se detectan sin reescribir la evidencia');
    const acceptedQuote=await create(),acceptedSeal=await seal(acceptedQuote),acceptedLink=await invite(acceptedQuote);await pub('',response(acceptedLink.token));
    await convert(acceptedQuote,101,400);await writer.query('UPDATE producto SET "ObjetoImpuesto"=\'02\',"TasaIVA"=.16 WHERE "IdProducto"=$1',[product]);await convert(acceptedQuote,100,409);await writer.query('UPDATE producto SET "ObjetoImpuesto"=\'01\',"TasaIVA"=0 WHERE "IdProducto"=$1',[product]);await convert(acceptedQuote,100);
    const legacy=await create();await convert(legacy,100);
    checked('Aceptación permite conversión a precio aceptado; precio/impuestos cambiados se rechazan y cotización no versionada conserva conversión anterior');
    const orderQuote=await create();await seal(orderQuote);const orderLink=await invite(orderQuote);await pub('',response(orderLink.token));const order=await orders.createFromQuote(orderQuote,{requestId:randomUUID()},users[0],actor);assert.ok(order.idPedido>0);
    await call(base(orderQuote),tokens[0],409,'POST',{...proposal(),requestId:randomUUID(),revisionAnterior:(await state(orderQuote)).actual.idRevision,motivo:'Pedido ya existe'});
    checked('Pedido desde revisión aceptada funciona y documento ya utilizado no admite nueva revisión');
    const declined=await create();await seal(declined);const declinedLink=await invite(declined);await pub('',{...response(declinedLink.token),decision:'Rechazada',comentario:'Necesito otra propuesta'});
    await assert.rejects(orders.createFromQuote(declined,{requestId:randomUUID()},users[0],actor),e=>e.getStatus?.()===409);
    const declinedState=await state(declined);const renewed=(await call(base(declined),tokens[0],201,'POST',{...proposal(110),requestId:randomUUID(),revisionAnterior:declinedState.actual.idRevision,motivo:'Propuesta corregida'})).body;
    assert.equal((await state(renewed.idCotizacion)).actual.respuesta,null);checked('Rechazo explícito impide pedido y la propuesta corregida exige nueva respuesta');
    let pagedCurrent=current;
    for(let n=0;n<20;n++){const latest=await state(pagedCurrent);pagedCurrent=(await call(base(pagedCurrent),tokens[0],201,'POST',{...proposal(130),requestId:randomUUID(),revisionAnterior:latest.actual.idRevision,motivo:'Historial paginado en copia'})).body.idCotizacion;}
    const page2=(await call(base(pagedCurrent)+'?page=2')).body;assert.equal(page2.revisionTotal,23);assert.equal(page2.revisiones.length,3);assert.equal((await call(base(pagedCurrent)+'?page=3')).body.revisionTotal,23);
    checked('Historial por familia paginado20 conserva anteriores, respuestas y total fuera de rango; documentos de volumen sólo en copia');
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'cotizaciones.versionar',granted:true}],accessVersion:0});tokens[1]=(await auth.login(names[1],password)).access_token;
    const stale=auth.verify(tokens[1]),staleQuote=await create(),versionService=app.get(require('./dist/cotizacion/cotizacion-version.service').CotizacionVersionService);
    await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[1]]);
    const waiting=versionService.seal(staleQuote,{requestId:randomUUID(),motivo:'Revocación durante espera'},stale).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));let blocked=false;
    for(let n=0;n<100;n++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);assert.equal((await state(staleQuote)).actual,null);
    checked('Permiso delegado revalidado en transacción: actor revocado mientras espera no sella cotización');
    const concurrentQuotes=await Promise.all(Array.from({length:8},()=>create()));
    const folios=(await writer.query('SELECT folio FROM cotizacion WHERE id_cotizacion=ANY($1::int[])',[concurrentQuotes])).rows.map(r=>r.folio);assert.equal(folios.length,8);assert.equal(new Set(folios).size,8);
    checked('Ocho cotizaciones concurrentes por HTTP conservan folios distintos; asignación serializada en creación y nuevas revisiones');
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const errors=[];
    for(const [theme,width]of[['light',1280],['dark',390]]){
      const q=await create(),owner=await browser.newContext({viewport:{width,height:1100}}),page=await owner.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.name));await page.addInitScript(v=>localStorage.setItem('theme',v),theme);
      await page.goto(origin+'/login?returnUrl='+encodeURIComponent('/cotizacion/'+q+'/versiones'));await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/versiones');
      await page.getByLabel('Motivo para activar revisiones',{exact:true}).fill('Primera revisión UI '+theme);await page.getByRole('button',{name:'Activar revisiones',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Activar revisiones',exact:true}).click();await expect(page.getByRole('button',{name:'Generar enlace de respuesta',exact:true})).toBeVisible();await page.getByRole('button',{name:'Generar enlace de respuesta',exact:true}).click();await expect(page.getByLabel('Enlace de respuesta generado',{exact:true})).not.toHaveValue('');const link=await page.getByLabel('Enlace de respuesta generado',{exact:true}).inputValue();
      const customer=await browser.newContext({viewport:{width,height:1100}}),guest=await customer.newPage();guest.setDefaultTimeout(15000);guest.on('pageerror',e=>errors.push(e.name));await guest.addInitScript(v=>localStorage.setItem('theme',v),theme);const urls=[];guest.on('request',r=>urls.push(r.url()));await guest.goto(link);await expect(guest.getByRole('heading',{name:'Responder a esta revisión',exact:true})).toBeVisible();assert.equal(new URL(guest.url()).hash,'');
      await expect(guest.getByRole('button',{name:'Registrar respuesta',exact:true})).toBeDisabled();await guest.getByLabel('Decisión',{exact:true}).selectOption('Aceptada');await guest.getByLabel('Tu nombre',{exact:true}).fill('Cliente UI '+theme);await guest.getByLabel('Comentario de respuesta',{exact:true}).fill('Acepto esta propuesta de prueba');await guest.getByRole('checkbox').check();await guest.getByRole('button',{name:'Registrar respuesta',exact:true}).click();await expect(guest.getByRole('heading',{name:'Respuesta registrada: Aceptada',exact:true})).toBeVisible();
      assert.ok(urls.every(u=>!u.includes(new URLSearchParams(new URL(link).hash.slice(1)).get('token'))));assert.equal(await guest.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage})).then(s=>s.includes('token=')),false);
      assert.deepEqual((await new AxeBuilder({page:guest}).include('main').analyze()).violations,[]);assert.ok(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await guest.locator('main').screenshot({path:path.join(root,'.artifacts/v01-response-'+theme+'.png')});await customer.close();
      await page.getByRole('button',{name:'Actualizar historial',exact:true}).click();await expect(page.getByText('Última revisión: 1 · Aceptada',{exact:true})).toBeVisible();await page.getByRole('link',{name:'Preparar nueva revisión',exact:true}).click();await page.waitForURL('**/cotizacion/nueva?revisionDe=*');await expect(page.getByLabel('Cantidad de V01 Filtro de prueba',{exact:true})).toHaveValue('1');await page.getByLabel('Cantidad de V01 Filtro de prueba',{exact:true}).fill('2');await page.getByLabel('Cantidad de V01 Filtro de prueba',{exact:true}).blur();await page.getByLabel('Motivo de la nueva revisión',{exact:true}).fill('Cambio de cantidad UI '+theme);await page.getByRole('button',{name:'Guardar nueva revisión',exact:true}).click();await page.waitForURL('**/versiones');await expect(page.getByText('Última revisión: 2 · Sin respuesta',{exact:true})).toBeVisible();
      assert.deepEqual((await new AxeBuilder({page}).include('.quote-version').analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.quote-version section').first().screenshot({path:path.join(root,'.artifacts/v01-history-'+theme+'.png')});await owner.close();
    }
    assert.deepEqual(errors,[]);checked('Angular producción con login real y destinatario anónimo: sello/enlace/aceptación/nueva revisión, fragmento borrado y sin token en red/almacenamiento; claro1280/oscuro390/axe/reflujo sin errores JS');
    report.passed=true;report.completedAt=new Date().toISOString();

  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_quotes_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/v01-cotizaciones.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de expediente:',error instanceof assert.AssertionError?error.message:[error.name,error.code,error.constraint].filter(Boolean).join(' '),
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/v01-cotizaciones.json; sin secretos en salida.');process.exitCode=1;});
