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
  const control=new Client(config),database='verify_commercial_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'S03.2',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
  const checked=name=>{report.checks.push(name);console.log('OK:',name);};let stage='restore';
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
    // Baseline de fixtures SOLO en esta copia; admite respaldo anterior o posterior a099.
    await writer.query("UPDATE solicitud_autorizacion_comercial SET estado='Cancelada' WHERE estado IN ('Pendiente','Aprobada')");
    await writer.query('DELETE FROM comercial_limite_aprobador');
    await writer.query("UPDATE comercial_regla_aprobacion SET monto_maximo=NULL,requiere_distinto=false,vigencia_maxima_horas=24,version=1,motivo='Baseline aislado S032'");
    await writer.query("INSERT INTO app_role_permission(role,permission_code) SELECT 'admin',unnest(ARRAY['credito.autorizar','ventas.crear','comercial.configurar_aprobaciones']) ON CONFLICT DO NOTHING");
    await writer.query('UPDATE auth_user SET is_active=false');
    const {AuthService}=require('./dist/auth/auth.service');const password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password);
    const names=['owner_','reviewer_','operator_'].map(x=>x+randomBytes(5).toString('hex')),ids=[];
    for(const [i,name]of names.entries())ids.push((await writer.query('INSERT INTO auth_user(username,password_hash,role,is_active,token_version) VALUES($1,$2,$3,true,0) RETURNING id_user',[name,hash,i===2?'user':'admin'])).rows[0].id_user);
    Object.assign(process.env,{DATABASE_URL:url.toString(),DB_NAME:database,NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),AUTH_MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ALLOW_ENV_AUTH:'false',FISCAL_MODE:'mock',WEB_LEAD_BRIDGE_ENABLED:'false',WEB_INBOX_PURGE_ENABLED:'false'});
    stage='AppModule';const module=await Test.createTestingModule({imports:[require('./dist/app.module').AppModule]}).compile();
    app=module.createNestApplication({logger:false});require('./dist/configure-app').configureApp(app);await app.init();for(const job of app.get(SchedulerRegistry).getCronJobs().values())job.stop();
    const ds=app.get(DataSource);assert.equal((await ds.query('SELECT current_database() name'))[0].name,database);await app.listen(0,'127.0.0.1');const api=await app.getUrl(),auth=app.get(AuthService);
    let tokens=await Promise.all(names.map(async name=>(await auth.login(name,password)).access_token));let actors=tokens.map(t=>auth.verify(t));
    const call=async(route,token,status=200,method='GET',body)=>{
      const response=await fetch(api+'/api/v1/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const data=await response.json();assert.equal(response.status,status,route+': HTTP'+response.status+' esperado'+status+(typeof data.message==='string'?' '+data.message:''));return{body:data,cache:response.headers.get('cache-control')};
    };
    const policy=async()=>(await call('comercial/politica-aprobaciones',tokens[0])).body;
    await call('comercial/politica-aprobaciones',null,401);await call('comercial/politica-aprobaciones',tokens[2],403);
    const initial=await policy();assert.equal(initial.reglas.length,9);assert.ok(initial.reglas.every(r=>!r.requiereDistinto&&r.montoMaximo===null&&r.version===1));assert.equal(initial.limites.length,0);
    assert.equal((await call('comercial/politica-aprobaciones',tokens[0])).cache,'private, no-store');
    checked('099 check/migrate en copia; nueve reglas compatibles sin límites inventados; API privada ADMIN y operador403');
    const client=(await writer.query('SELECT "IdCliente" id FROM cliente ORDER BY "IdCliente" LIMIT 1')).rows[0].id;
    await writer.query('UPDATE cliente SET "RazonSocial"=$2 WHERE "IdCliente"=$1',[client,'S032 Cliente de verificación']);
    const tax=(await writer.query('SELECT "IdObjetoImpuesto" id FROM objetoimpuesto WHERE "Clave"=\'01\'')).rows[0].id;
    const product=(await writer.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR",costo_reposicion,margen_minimo) VALUES($1,'S032 Producto de verificación',$2,100,100,'01',0,false,80,.15) RETURNING "IdProducto" id`,['000S032-'+randomBytes(4).toString('hex'),tax])).rows[0].id;
    const form=(await writer.query('SELECT "IdFormaPago" id FROM formadepago WHERE "Clave"=\'01\'')).rows[0].id;
    const method=(await writer.query('SELECT "IdMetodoDePago" id FROM metododepago WHERE "Clave"=\'PPD\'')).rows[0].id;
    await call('comercial/clientes/'+client,tokens[0],200,'PUT',{limiteCredito:99999999999,diasCredito:30,bloqueado:false});
    const list=(await call('comercial/listas',tokens[0],201,'POST',{nombre:'S032 '+randomBytes(4).toString('hex')})).body.idLista;
    await call('comercial/listas/'+list+'/precios',tokens[0],200,'PUT',{idProducto:product,cantidadMinima:1,precio:100});
    await call('comercial/precios-especiales',tokens[0],200,'PUT',{idCliente:client,idProducto:product,precio:100});
    const audits=(await writer.query("SELECT actor_name,app_user_id FROM auditoria_jsonb WHERE table_name IN ('cliente_comercial','lista_precio','lista_precio_detalle','precio_especial_cliente') AND app_user_id=$1 ORDER BY id DESC LIMIT 4",[ids[0]])).rows;
    assert.equal(audits.length,4);assert.ok(audits.every(x=>x.actor_name===names[0]));
    checked('Crédito/listas/escalas/precios especiales se confirman con actor vigente y auditoría en la misma transacción');
    const rule=async(op,type,patch)=>{const old=(await policy()).reglas.find(r=>r.operacion===op&&r.tipo===type);return call('comercial/reglas-aprobacion',tokens[0],200,'PUT',{...old,...patch,montoMaximo:patch.montoMaximo===undefined?old.montoMaximo:patch.montoMaximo,motivo:'Ensayo aislado S032'});};
    const request=async(op='Venta',amount=500,type='Margen bajo',value=70,who=0)=> (await call('comercial/autorizaciones',tokens[who],201,'POST',{tipo:type,idCliente:client,...(type==='Exceso credito'?{}:{idProducto:product}),valorSolicitado:value,valorReferencia:100,motivo:'Ensayo aislado S032',operacionDestino:op,montoOperacion:amount})).body.idAutorizacion;
    const approve=async(id,who=0,hours=24,status=201)=>call('comercial/autorizaciones/'+id+'/resolver',tokens[who],status,'POST',{estado:'Aprobada',resolucion:'Validado en copia S032',vigenciaHoras:hours});
    const {validateCommercialPolicy}=require('./dist/comercial/commercial-policy');
    const validate=(op,total=70,price=70,extra={})=>ds.transaction(manager=>validateCommercialPolicy(manager,{idCliente:client,operacion:op,total,lineas:[{idProducto:product,cantidad:total/price,precio:price}],validarCredito:false,...extra}));
    const ordinary=await request();await approve(ordinary);
    assert.deepEqual(await validate('Venta'),[ordinary]);await assert.rejects(()=>validate('Venta',500.01),e=>e.getStatus?.()===409);
    await writer.query("UPDATE solicitud_autorizacion_comercial SET expires_at=now()-interval '1 minute' WHERE id_autorizacion=$1",[ordinary]);
    await assert.rejects(()=>validate('Venta'),e=>e.getStatus?.()===409);
    await writer.query("UPDATE solicitud_autorizacion_comercial SET expires_at=now()+interval '1 day' WHERE id_autorizacion=$1",[ordinary]);
    await assert.rejects(()=>validate('Pedido'),e=>e.getStatus?.()===409);await assert.rejects(()=>validate('Venta',70,70,{moneda:'USD',tipoCambio:20}),e=>e.getStatus?.()===409);
    await call('comercial/autorizaciones',tokens[0],400,'POST',{tipo:'Margen bajo',idCliente:client,idProducto:product,valorSolicitado:70,valorReferencia:100,motivo:'Sin alcance'});
    const tooLong=await request();await approve(tooLong,0,25,400);
    checked('Un administrador puede aprobar inicialmente; destino/tope total/vigencia y DTO no se omiten; moneda no comparable rechazada');
    await rule('Venta','Margen bajo',{requiereDistinto:true,montoMaximo:1000,vigenciaMaximaHoras:12});
    await assert.rejects(()=>validate('Venta'),e=>e.getStatus?.()===409);
    const separated=await request('Venta',70);await approve(separated,0,12,403);
    await call('comercial/limites-aprobacion/'+ids[1],tokens[0],200,'PUT',{operacion:'Venta',montoMaximo:100,version:0,motivo:'Tope del revisor'});
    const over=await request('Venta',101);await approve(over,1,12,403);await approve(separated,1,12);
    const aboveRule=await request('Venta',1001,'Margen bajo',70,2);await approve(aboveRule,0,12,403);
    await call('comercial/autorizaciones/'+aboveRule+'/resolver',tokens[0],201,'POST',{estado:'Rechazada',resolucion:'Fuera de límite',vigenciaHoras:12});
    await call('comercial/limites-aprobacion/'+ids[1],tokens[0],200,'PUT',{operacion:'Venta',montoMaximo:69,version:1,motivo:'Reducción posterior'});
    await assert.rejects(()=>validate('Venta'),e=>e.getStatus?.()===409);
    await call('comercial/limites-aprobacion/'+ids[1],tokens[0],409,'PUT',{operacion:'Venta',montoMaximo:null,version:1,motivo:'Versión anterior'});
    await call('comercial/limites-aprobacion/'+ids[1],tokens[0],200,'PUT',{operacion:'Venta',montoMaximo:100,version:2,motivo:'Restaurar límite de ensayo'});
    checked('Cambio de versión invalida autorizaciones anteriores; separación y menor límite entre regla/aprobador se verifican al resolver');
    await writer.query("INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,'credito.autorizar',false)",[ids[1]]);
    await assert.rejects(()=>validate('Venta'),e=>e.getStatus?.()===409);
    const service=app.get(require('./dist/comercial/comercial.service').ComercialService);
    await assert.rejects(()=>service.resolve(over,{estado:'Aprobada',resolucion:'Prueba',vigenciaHoras:12},actors[1]),e=>e.getStatus?.()===403);
    await writer.query("DELETE FROM app_user_permission WHERE id_user=$1 AND permission_code='credito.autorizar'",[ids[1]]);
    checked('Revocar permiso impide resolver incluso desde servicio y usar una autorización ya aprobada');
    const saleBody=(quantity=1,discount=0)=>{const unit=discount?100:70,subtotal=(unit-discount)*quantity;return {requestId:require('node:crypto').randomUUID(),idCliente:client,rfcReceptor:'XAXX010101000',nombreReceptor:'S032 Cliente de verificación',cpReceptor:'89318',regimenReceptor:'616',usoCfdi:'S01',idFormaPago:form,idMetodoPago:method,moneda:'MXN',tipoCambio:1,subtotal,totalImpuestosTrasladados:0,totalImpuestosRetenidos:0,total:subtotal,conceptos:[{idProducto:product,claveProdServ:'01010101',claveUnidad:'H87',objetoImpuesto:'01',codigo:'S032',descripcion:'S032 verificación',unidadDescripcion:'Pieza',cantidad:quantity,valorUnitario:unit,importe:unit*quantity,descuento:discount*quantity,baseIva:0,tasaIva:0,importeIva:0}]};};
    const beforeStock=Number((await writer.query('SELECT "Existencia" n FROM producto WHERE "IdProducto"=$1',[product])).rows[0].n);
    await call('venta',tokens[0],409,'POST',saleBody(2));
    assert.equal(Number((await writer.query('SELECT "Existencia" n FROM producto WHERE "IdProducto"=$1',[product])).rows[0].n),beforeStock);
    const body=saleBody(1,30),sale=(await call('venta',tokens[0],201,'POST',body)).body;
    assert.equal((await call('venta',tokens[0],201,'POST',body)).body.idFactura,sale.idFactura);
    const used=(await writer.query('SELECT estado,operacion_tipo,operacion_id FROM solicitud_autorizacion_comercial WHERE id_autorizacion=$1',[separated])).rows[0];
    assert.equal(used.estado,'Utilizada');assert.equal(used.operacion_tipo,'Venta');assert.equal(Number(used.operacion_id),sale.idFactura);
    assert.equal(Number((await writer.query('SELECT "Existencia" n FROM producto WHERE "IdProducto"=$1',[product])).rows[0].n),beforeStock-1);
    await call('venta',tokens[0],409,'POST',saleBody(1,30));
    checked('Venta HTTP valida precio neto después de descuento y total real; rechazos revierten stock; consumo único y reintento conservan factura/stock');
    const quoteApproval=await request('Cotizacion',70);await approve(quoteApproval);
    const quoteBody={idCliente:client,nombreReceptor:'S032 Cliente de verificación',rfcReceptor:'XAXX010101000',subtotal:70,totalImpuestos:0,totalRetenciones:0,total:70,conceptos:[{idProducto:product,descripcion:'S032',unidadDescripcion:'Pieza',cantidad:1,valorUnitario:70,importe:70,importeIva:0,importeRetIsr:0}]};
    await call('cotizacion',tokens[0],201,'POST',quoteBody);
    assert.equal((await writer.query('SELECT estado FROM solicitud_autorizacion_comercial WHERE id_autorizacion=$1',[quoteApproval])).rows[0].estado,'Aprobada');
    const orderBody={requestId:require('node:crypto').randomUUID(),idCliente:client,partidas:[{idProducto:product,cantidad:1,valorUnitario:70}]};
    await call('pedidos',tokens[0],409,'POST',orderBody);const orderApproval=await request('Pedido',70);await approve(orderApproval);
    const order=(await call('pedidos',tokens[0],201,'POST',orderBody)).body;
    assert.equal((await writer.query('SELECT estado FROM solicitud_autorizacion_comercial WHERE id_autorizacion=$1',[orderApproval])).rows[0].estado,'Utilizada');
    assert.equal((await call('pedidos',tokens[0],201,'POST',orderBody)).body.idPedido,order.idPedido);
    checked('Cotización valida sin gastar; pedido exige su propio alcance, consume una sola vez y conserva idempotencia por HTTP');
    await call('comercial/clientes/'+client,tokens[0],200,'PUT',{limiteCredito:0,diasCredito:30,bloqueado:false});
    const credit=await request('Venta',70,'Exceso credito',70);await approve(credit);
    assert.deepEqual(await validate('Venta',70,100,{validarPrecios:false,validarCredito:true,idMetodoPago:method}),[credit]);
    await assert.rejects(()=>validate('Venta',71,100,{validarPrecios:false,validarCredito:true,idMetodoPago:method}),e=>e.getStatus?.()===409);
    const discount=await request('Pedido',95,'Descuento',95);await approve(discount);
    assert.deepEqual(await validate('Pedido',95,95),[discount]);
    checked('Descuento y exceso de crédito conservan sus tipos; crédito compara total del documento con el alcance aprobado');
    const legacy=(await writer.query("INSERT INTO solicitud_autorizacion_comercial(tipo,id_cliente,id_producto,valor_solicitado,valor_referencia,motivo,id_solicitante,id_autorizador,estado,resolved_at,expires_at)VALUES('Descuento',$1,$2,96,100,'Histórico de copia',$3,$3,'Aprobada',now(),now()+interval '1 day')RETURNING id_autorizacion id",[client,product,ids[0]])).rows[0].id;
    assert.deepEqual(await validate('Pedido',96,96),[legacy]);await rule('Pedido','Descuento',{montoMaximo:500});
    await assert.rejects(()=>validate('Pedido',96,96),e=>e.getStatus?.()===409);
    checked('Históricos aprobados se conservan y funcionan bajo regla inicial compatible; modificar esa regla exige nueva solicitud con alcance');
    const concurrent=await request('Pedido',97,'Descuento',97);
    const races=await Promise.all([0,1].map(who=>fetch(api+'/api/v1/comercial/autorizaciones/'+concurrent+'/resolver',{method:'POST',headers:{Authorization:'Bearer '+tokens[who],'Content-Type':'application/json'},body:JSON.stringify({estado:'Aprobada',resolucion:'Resolución concurrente',vigenciaHoras:24})}).then(async r=>{await r.arrayBuffer();return r.status;})));
    assert.deepEqual(races.sort(),[201,409]);
    const original=(await policy()).reglas.find(r=>r.operacion==='Cotizacion'&&r.tipo==='Exceso credito');
    const ruleRaces=await Promise.all([1,2].map(i=>fetch(api+'/api/v1/comercial/reglas-aprobacion',{method:'PUT',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify({...original,motivo:'Cambio concurrente '+i})}).then(async r=>{await r.arrayBuffer();return r.status;})));
    assert.deepEqual(ruleRaces.sort(),[200,409]);
    checked('Dos resoluciones y dos ediciones concurrentes producen un solo commit y un409; versiones no se sobrescriben');
    const previous=(await policy()).reglas.find(r=>r.operacion==='Venta'&&r.tipo==='Descuento');
    await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_s032_audit_failure CHECK(table_name<>'comercial_regla_aprobacion') NOT VALID");
    try{await call('comercial/reglas-aprobacion',tokens[0],400,'PUT',{...previous,motivo:'Rollback aislado',montoMaximo:123});}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_s032_audit_failure');}
    assert.deepEqual((await policy()).reglas.find(r=>r.operacion==='Venta'&&r.tipo==='Descuento'),previous);
    checked('Fallo de auditoría revierte cambio de regla y versión; la bitácora protegida no se evita');
    await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[ids[1]]);
    const waiting=service.setSpecial({idCliente:client,idProducto:product,precio:99},actors[1]).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));
    let blocked=false;for(let i=0;i<100;i++){const found=await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND pid<>pg_backend_pid()",[database]);if(found.rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
    await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);
    assert.equal(Number((await writer.query('SELECT precio FROM precio_especial_cliente WHERE id_cliente=$1 AND id_producto=$2',[client,product])).rows[0].precio),100);
    tokens[1]=(await auth.login(names[1],password)).access_token;actors[1]=auth.verify(tokens[1]);
    checked('Actor revocado mientras esperaba el bloqueo se revalida dentro de la transacción y no cambia precios');
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const browserErrors=[];
    for(const [theme,width]of [['light',1280],['dark',390]]){
      const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.name));page.setDefaultTimeout(15000);
      await page.addInitScript(value=>localStorage.setItem('theme',value),theme);await page.goto(origin+'/login?returnUrl=%2Fcomercial');
      await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/comercial');
      stage='UI reglas '+theme;await page.getByRole('tab',{name:'Reglas de aprobación',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Reglas y límites de aprobación',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Editar regla Venta Descuento',exact:true}).click();
      await page.getByLabel('Tope de la regla MXN',{exact:true}).fill('2000');await page.getByLabel('Motivo del cambio de regla',{exact:true}).fill('Revisión UI aislada');
      await page.getByRole('button',{name:'Guardar regla',exact:true}).click();await expect(page.getByText('Regla guardada. Las aprobaciones de versiones anteriores requieren una nueva solicitud.',{exact:true})).toBeVisible();
      await page.getByLabel('Administrador aprobador',{exact:true}).click();await page.getByRole('option',{name:names[1],exact:true}).click();
      await page.getByLabel('Operación del aprobador',{exact:true}).click();await page.getByRole('option',{name:'Pedido',exact:true}).click();
      await page.getByLabel('Tope del aprobador MXN',{exact:true}).fill('1200');await page.getByLabel('Motivo del límite',{exact:true}).fill('Límite UI aislado');
      await page.getByRole('button',{name:'Guardar límite',exact:true}).click();await expect(page.getByText('Límite guardado. También se comprueba al utilizar la autorización.',{exact:true})).toBeVisible();
      await expect(page.locator('.rule-list article')).toHaveCount(9);
      assert.deepEqual((await new AxeBuilder({page}).include('.approval-policy').analyze()).violations,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('.approval-policy header').screenshot({path:path.join(root,'.artifacts/s032-rules-'+theme+'.png')});
      stage='UI solicitud '+theme;await page.getByRole('tab',{name:/^Autorizaciones/}).click();
      await page.getByLabel('Cliente de la solicitud',{exact:true}).click();await page.getByRole('option',{name:'S032 Cliente de verificación',exact:true}).click();
      await page.getByLabel('Producto de la excepción',{exact:true}).click();await page.getByRole('option').filter({hasText:'S032 Producto de verificación'}).click();
      await page.getByLabel('Precio unitario solicitado',{exact:true}).fill('70');await page.getByLabel('Valor de referencia',{exact:true}).fill('100');
      await page.getByLabel('Total máximo de la operación MXN',{exact:true}).fill('70');await page.getByLabel('Motivo de la solicitud',{exact:true}).fill('Solicitud UI '+theme);
      await page.getByRole('button',{name:'Enviar solicitud',exact:true}).click();await expect(page.getByLabel('Motivo de la solicitud',{exact:true})).toHaveValue('');
      const card=page.locator('.cards article').filter({hasText:'Solicitud UI '+theme});await card.getByRole('button',{name:'Aprobar',exact:true}).click();
      await page.getByLabel('Motivo de la resolución',{exact:true}).fill('No debe permitir autoaprobación');await page.getByRole('button',{name:'Confirmar aprobación',exact:true}).click();
      await expect(page.locator('.commercial-error')).toContainText('aprobador distinto');await expect(page.getByLabel('Motivo de la resolución',{exact:true})).toHaveValue('No debe permitir autoaprobación');
      assert.deepEqual((await new AxeBuilder({page}).include('.request-panel').analyze()).violations,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.getByRole('button',{name:'Cancelar resolución',exact:true}).click();
      await page.locator('.request-panel').first().screenshot({path:path.join(root,'.artifacts/s032-request-'+theme+'.png')});await context.close();
    }
    assert.deepEqual(browserErrors,[]);
    checked('Angular producción con login real: reglas guardadas, solicitud completa, error de autoaprobación conserva borrador; claro1280/oscuro390/axe/reflujo sin fallos');
    const operatorContext=await browser.newContext(),operatorPage=await operatorContext.newPage();
    await operatorPage.goto(origin+'/login?returnUrl=%2Fcomercial');await operatorPage.getByLabel('Usuario',{exact:true}).fill(names[2]);await operatorPage.getByLabel('Contraseña',{exact:true}).fill(password);await operatorPage.getByRole('button',{name:'Entrar',exact:true}).click();await operatorPage.waitForURL('**/comercial');
    await expect(operatorPage.getByRole('tab',{name:'Reglas de aprobación',exact:true})).toHaveCount(0);await operatorPage.getByRole('tab',{name:/^Autorizaciones/}).click();
    await expect(operatorPage.getByRole('heading',{name:'Solicitar excepción comercial',exact:true})).toBeVisible();await expect(operatorPage.getByRole('button',{name:'Aprobar',exact:true})).toHaveCount(0);await operatorContext.close();
    checked('Operador autenticado conserva solicitud/consulta; configuración y resolución no se ofrecen ni se autorizan');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_commercial_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/s032-approvals.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación comercial:',error instanceof assert.AssertionError?error.message:error.name,
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/s032-approvals.json; sin secretos en salida.');process.exitCode=1;});
