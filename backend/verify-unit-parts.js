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
  const control=new Client(config),database='verify_parts_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'D02',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
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
    const password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['parts_admin_','parts_operator_'].map(x=>x+randomBytes(5).toString('hex')),users=[];
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
    const makeUnit=async name=>(await call('crm/clientes/'+client+'/unidades',tokens[0],201,'POST',{esn:'D02-'+randomBytes(6).toString('hex'),numeroEconomico:name})).body.idUnidad;
    const unit=await makeUnit('D02 Historial de verificación'),second=await makeUnit('D02 Segunda unidad'),uiUnit=await makeUnit('D02 Unidad UI');
    const base='crm/unidades/'+unit+'/piezas',other='crm/unidades/'+second+'/piezas';
    const tax=(await writer.query('SELECT "IdObjetoImpuesto" id FROM objetoimpuesto WHERE "Clave"=\'01\'')).rows[0].id;
    const product=(await writer.query(`INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR",costo_reposicion,margen_minimo)
      VALUES($1,'D02 Pieza de verificación',$2,100,100,'01',0,false,10,0) RETURNING "IdProducto" id`,['D02-'+randomBytes(4).toString('hex'),tax])).rows[0].id;
    await writer.query("INSERT INTO producto_aplicacion(id_producto,fabricante_equipo,modelo,motor,restricciones)VALUES($1,'Fabricante de prueba','Modelo de prueba','Motor de prueba','Confirmar por serie')",[product]);
    const form=(await writer.query('SELECT "IdFormaPago" id FROM formadepago WHERE "Clave"=\'01\'')).rows[0].id,method=(await writer.query('SELECT "IdMetodoDePago" id FROM metododepago WHERE "Clave"=\'PPD\'')).rows[0].id;
    await call('comercial/clientes/'+client,tokens[0],200,'PUT',{limiteCredito:99999999999,diasCredito:30,bloqueado:false});
    const sale=async(qty=4)=>{
      const body={requestId:randomUUID(),idCliente:client,rfcReceptor:'XAXX010101000',nombreReceptor:'D02 Cliente de prueba',cpReceptor:'89318',regimenReceptor:'616',usoCfdi:'S01',idFormaPago:form,idMetodoPago:method,moneda:'MXN',tipoCambio:1,subtotal:100*qty,totalImpuestosTrasladados:0,totalImpuestosRetenidos:0,total:100*qty,conceptos:[{idProducto:product,claveProdServ:'01010101',claveUnidad:'H87',objetoImpuesto:'01',codigo:'D02',descripcion:'D02 Pieza vendida',unidadDescripcion:'Pieza',cantidad:qty,valorUnitario:100,importe:100*qty,descuento:0,baseIva:0,tasaIva:0,importeIva:0}]};
      const id=(await call('venta',tokens[0],201,'POST',body)).body.idFactura;return (await writer.query('SELECT f.id_factura AS id,f.estatus::text AS estado,cf.id_concepto AS concepto,concat(f.serie,\'-\',f.folio) AS folio FROM factura f JOIN conceptofactura cf USING(id_factura)WHERE f.id_factura=$1',[id])).rows[0];
    };
    const origin=await sale(),decimalOrigin=await sale(.3),warrantyOrigin=await sale(),uiOrigin=await sale(10);
    const initialStock=(await writer.query('SELECT "Existencia" value FROM producto WHERE "IdProducto"=$1',[product])).rows[0].value;
    const get=async(id=unit,query='')=>(await call('crm/unidades/'+id+'/piezas'+query)).body;
    const body=(concept=origin.concepto,quantity=1)=>({requestId:randomUUID(),idConcepto:concept,cantidad:quantity,fecha:new Date().toISOString(),detalle:'Instalación reportada en copia',compatibilidad:'Pendiente',referencia:'Falta revisión técnica por serie'});
    await call(base,null,401);await call(base,tokens[1],403);assert.equal((await get()).total,0);assert.equal((await call(base)).cache,'private, no-store');await call(base+'?page=-1',tokens[0],400);
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'crm.unidades.consultar',granted:true}],accessVersion:0});tokens[1]=(await auth.login(names[1],password)).access_token;
    await call(base,tokens[1]);await call(base,tokens[1],403,'POST',body());
    checked('101 verificada/aplicada solo en copia; ventas existentes no generan instalaciones; privado401/403, no-store, paginación validada y consulta no permite gestionar');
    const sources=(await call(base+'/origenes')).body;assert.equal(sources.data.find(x=>x.idConcepto===origin.concepto).aplicacionesTotal,1);assert.equal(sources.data.find(x=>x.idConcepto===origin.concepto).aplicaciones[0].restricciones,'Confirmar por serie');
    assert.equal((await call(base+'/origenes?term=%25')).body.total,0);
    await writer.query('UPDATE factura SET id_unidad=$2 WHERE id_factura=$1',[origin.id,second]);assert.ok(!(await call(base+'/origenes')).body.data.some(x=>x.idConcepto===origin.concepto));await call(base,tokens[0],409,'POST',body());await writer.query('UPDATE factura SET id_unidad=NULL WHERE id_factura=$1',[origin.id]);
    checked('Orígenes acotados al cliente/unidad, aplicaciones/restricciones informativas existentes y comodines literales; factura de otra unidad rechazada');
    await call(base,tokens[0],400,'POST',{...body(),cantidad:0});await call(base,tokens[0],400,'POST',{...body(),cantidad:.0000001});await call(base,tokens[0],400,'POST',{...body(),fecha:'2100-01-01T00:00:00Z'});await call(base,tokens[0],400,'POST',{...body(),fecha:'2026-10-20'});await call(base,tokens[0],409,'POST',{...body(),fecha:'2000-01-01T00:00:00Z'});await call(base,tokens[0],400,'POST',{...body(),referencia:' '});
    const intent=body(),[one,again]=await Promise.all([call(base,tokens[0],201,'POST',intent),call(base,tokens[0],201,'POST',intent)]),piece=one.body.idPieza;assert.equal(piece,again.body.idPieza);await call(base,tokens[0],409,'POST',{...intent,cantidad:2});assert.equal((await get()).total,1);
    checked('Fecha/precisión/cantidad/fuente obligatorias, fecha anterior a venta rechazada y UUID/huella concurrente sin duplicado ni cambio de intención');
    const races=await Promise.all([base,other].map(route=>fetch(api+'/api/v1/'+route,{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify(body(origin.concepto,2))}).then(async r=>({status:r.status,body:await r.json()}))));assert.deepEqual(races.map(x=>x.status).sort(),[201,409]);
    await call(base,tokens[0],201,'POST',body(decimalOrigin.concepto,.1));await call(other,tokens[0],201,'POST',body(decimalOrigin.concepto,.2));await call(base,tokens[0],409,'POST',body(decimalOrigin.concepto,.000001));
    assert.equal((await writer.query('SELECT sum(cantidad)::text value FROM crm_unidad_pieza WHERE id_concepto=$1 AND NOT anulada',[decimalOrigin.concepto])).rows[0].value,'0.300000');
    checked('Asignación global por renglón serializada entre unidades: una alta y un409 concurrentes; suma decimal exacta0.1+0.2 y exceso rechazado');
    const before=(await get()).data.find(x=>x.idPieza===piece);
    await call('crm/unidades/'+unit,tokens[0],200,'PATCH',{esn:'D02-ESN-ACTUALIZADO'});await writer.query('UPDATE producto SET "Codigo"=$2 WHERE "IdProducto"=$1',[product,'D02-CODIGO-ACTUAL']);
    const snapshot=(await get()).data.find(x=>x.idPieza===piece);assert.equal(snapshot.esn,before.esn);assert.equal(snapshot.codigo,before.codigo);assert.notEqual(snapshot.esn,'D02-ESN-ACTUALIZADO');
    await call(other+'/'+piece+'/revision',tokens[0],404,'POST',{version:1,compatibilidad:'Verificada',referencia:'No pertenece'});
    const reviews=await Promise.all(['Verificada','Incompatible'].map(compatibilidad=>{const value={version:1,compatibilidad,referencia:'Revisión '+compatibilidad};return fetch(api+'/api/v1/'+base+'/'+piece+'/revision',{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify(value)}).then(async r=>({status:r.status,body:value,response:await r.json()}));}));assert.deepEqual(reviews.map(x=>x.status).sort(),[201,409]);
    const won=reviews.find(x=>x.status===201);assert.equal((await call(base+'/'+piece+'/revision',tokens[0],201,'POST',won.body)).body.version,2);await call(base+'/'+piece+'/revision',tokens[0],409,'POST',{version:1,compatibilidad:'Pendiente',referencia:'Versión vieja'});
    checked('VIN/ESN/código originales sobreviven cambios del maestro; revisión manual versionada concurrente y reintento sin nueva versión; IDs de otra unidad404');
    const warranty=async(origin,qty=1)=>(await call('garantias',tokens[0],201,'POST',{idFactura:origin.id,idConcepto:origin.concepto,cantidad:qty,motivo:'D02 Falla reportada',destinoProducto:'Revision'})).body.idGarantia;
    const g=await warranty(origin),tooMuch=await warranty(origin,2),wrong=await warranty(decimalOrigin,.1);
    await call(base+'/'+piece+'/garantias',tokens[0],409,'POST',{requestId:randomUUID(),idGarantia:tooMuch,motivo:'Cantidad incorrecta'});await call(base+'/'+piece+'/garantias',tokens[0],409,'POST',{requestId:randomUUID(),idGarantia:wrong,motivo:'Renglón incorrecto'});
    assert.ok((await call(base+'/'+piece+'/garantias-candidatas')).body.data.some(x=>x.idGarantia===g));
    const linkBody={requestId:randomUUID(),idGarantia:g,motivo:'Misma pieza reportada'},linked=(await call(base+'/'+piece+'/garantias',tokens[0],201,'POST',linkBody)).body.idVinculo;
    assert.equal((await call(base+'/'+piece+'/garantias',tokens[0],201,'POST',linkBody)).body.idVinculo,linked);await call(base+'/'+piece+'/garantias',tokens[0],409,'POST',{...linkBody,motivo:'Otra intención'});await call(base+'/'+piece+'/anular',tokens[0],409,'POST',{motivo:'Vínculo activo'});
    const wp=(await call(base,tokens[0],201,'POST',body(warrantyOrigin.concepto,2))).body.idPieza,wp2=(await call(other,tokens[0],201,'POST',body(warrantyOrigin.concepto,2))).body.idPieza,wg=await warranty(warrantyOrigin);
    const links=await Promise.all([[base,wp],[other,wp2]].map(([route,p])=>fetch(api+'/api/v1/'+route+'/'+p+'/garantias',{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),idGarantia:wg,motivo:'Concurrencia de vínculo'})}).then(async r=>{await r.arrayBuffer();return r.status;})));assert.deepEqual(links.sort(),[201,409]);
    checked('Vínculos a garantías existentes validan venta y cantidad; vínculo único concurrente entre unidades, UUID estable y anulación bloqueada con vínculo activo');
    const visible=(await call('garantias')).body.find(x=>x.idGarantia===g);assert.equal(visible.idUnidad,unit);assert.equal(visible.idPieza,piece);
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[],accessVersion:1});tokens[1]=(await auth.login(names[1],password)).access_token;
    assert.equal((await call('garantias',tokens[1])).body.find(x=>x.idGarantia===g).idUnidad,null);
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'crm.unidades.consultar',granted:true},{permissionCode:'crm.unidades.gestionar',granted:true}],accessVersion:2});tokens[1]=(await auth.login(names[1],password)).access_token;
    await call(base+'/'+piece+'/garantias/'+linked+'/retirar',tokens[1],403,'POST',{motivo:'No ADMIN'});
    await call(base+'/'+piece+'/garantias/'+linked+'/retirar',tokens[0],201,'POST',{motivo:'Corrección de vínculo'});assert.equal((await call(base+'/'+piece+'/garantias',tokens[0],201,'POST',linkBody)).body.idVinculo,linked);
    assert.equal((await get()).data.find(x=>x.idPieza===piece).garantias[0].retirado,true);
    await call(base+'/'+piece+'/anular',tokens[1],403,'POST',{motivo:'No ADMIN'});await call(base+'/'+piece+'/anular',tokens[0],201,'POST',{motivo:'Registro equivocado'});await call(base+'/'+piece+'/anular',tokens[0],201,'POST',{motivo:'Registro equivocado'});await call(base+'/'+piece+'/anular',tokens[0],409,'POST',{motivo:'Otro motivo'});
    assert.equal((await call(base,tokens[0],201,'POST',intent)).body.idPieza,piece);assert.equal((await get()).data.find(x=>x.idPieza===piece).anulada,true);await call('crm/unidades/'+unit,tokens[0],409,'DELETE');
    checked('Garantías sólo expone enlace a quien tiene consulta; retiro/anulación ADMIN con motivo conservan historia, reintentos no reactivan y unidad con piezas no se elimina');
    await call('garantias/'+wg,tokens[0],200,'PATCH',{estado:'Rechazada',resolucion:'Cierre de fixture para probar origen cancelado'});
    await call('garantias/'+wg,tokens[0],200,'PATCH',{estado:'Cerrada',resolucion:'Cierre de fixture para probar origen cancelado'});
    await writer.query("UPDATE factura SET estatus='Cancelada' WHERE id_factura=$1",[warrantyOrigin.id]);assert.equal((await get()).data.find(x=>x.idPieza===wp).estadoFactura,'Cancelada');await call(base,tokens[0],409,'POST',body(warrantyOrigin.concepto,.1));await writer.query("UPDATE factura SET estatus=$2 WHERE id_factura=$1",[warrantyOrigin.id,warrantyOrigin.estado]);
    // Existing warranty records and exact unit/client matching remain historical; no financial operation is triggered by D02.
    const count=(await get()).total;
    await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_d02_audit_failure CHECK(table_name<>'crm_unidad_pieza') NOT VALID");
    try{await call(base,tokens[0],400,'POST',body(uiOrigin.concepto,.1));}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_d02_audit_failure');}assert.equal((await get()).total,count);
    const audit=(await writer.query("SELECT actor_name FROM auditoria_jsonb WHERE table_name='crm_unidad_pieza' AND app_user_id=$1",[users[0]])).rows;assert.ok(audit.length>0);assert.ok(audit.every(x=>x.actor_name===names[0]));
    assert.equal((await writer.query('SELECT "Existencia" value FROM producto WHERE "IdProducto"=$1',[product])).rows[0].value,initialStock);
    checked('Origen cancelado visible sin borrar historia y bloquea nuevas instalaciones; fallo de auditoría revierte alta, actor registrado y stock sin movimientos D02');
    await call('garantias/'+g,tokens[0],200,'PATCH',{estado:'Rechazada',resolucion:'Fixture de devolución'});await call('garantias/'+g,tokens[0],200,'PATCH',{estado:'Cerrada',resolucion:'Fixture de devolución'});
    await call('garantias/'+tooMuch,tokens[0],200,'PATCH',{estado:'Rechazada',resolucion:'Fixture de devolución'});await call('garantias/'+tooMuch,tokens[0],200,'PATCH',{estado:'Cerrada',resolucion:'Fixture de devolución'});
    // Synthetic settled balance only in our disposable DB; this is not a payment/REP acceptance test.
    await writer.query('UPDATE factura SET saldo_pendiente=0 WHERE id_factura=$1',[origin.id]);
    await call('venta/'+origin.id+'/devoluciones',tokens[0],201,'POST',{metodoReembolso:'Saldo a Favor',articulos:[{idProducto:product,cantidad:.1}]});
    assert.equal((await get()).data.find(x=>x.idPieza===piece).conDevoluciones,true);await call(base,tokens[0],409,'POST',body(origin.concepto,.1));assert.ok(!(await call(base+'/origenes')).body.data.some(x=>x.idConcepto===origin.concepto));
    checked('Devolución real del flujo existente marca origen por conciliar, lo retira de candidatos y bloquea altas sin borrar historial de instalación');
    const stale=auth.verify(tokens[1]),service=app.get(require('./dist/crm/unidad-piezas.service').UnidadPiezasService);
    await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[1]]);
    const waiting=service.create(unit,body(uiOrigin.concepto,.1),stale).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));let blocked=false;
    for(let i=0;i<100;i++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);assert.equal((await get()).total,count);
    checked('Actor revocado durante bloqueo no registra instalación; permisos/versiones revalidados dentro de la transacción');
    const pagedUnit=await makeUnit('D02 Paginación');
    await writer.query(`INSERT INTO crm_unidad_pieza(id_unidad,id_concepto,request_id,huella,cantidad,fecha,detalle,codigo,descripcion,compatibilidad,referencia,id_autor,autor_nombre,revision_nombre)
      SELECT $1,$2,md5('D02-page-'||g)::uuid,repeat('a',64),.000001,now(),'Fixture paginado','D02-PAGE','Sólo copia','Pendiente','Por revisar',$3,$4,$4 FROM generate_series(1,25)g`,[pagedUnit,uiOrigin.concepto,users[0],names[0]]);
    const paged=await get(pagedUnit,'?page=2');assert.equal(paged.total,25);assert.equal(paged.data.length,5);assert.equal((await get(pagedUnit,'?page=3')).total,25);assert.equal((await get(pagedUnit,'?page=3')).data.length,0);
    checked('Historial acotado/paginado20 con total correcto incluso fuera de rango; fixtures de volumen exclusivamente en copia');
    await writer.query(`INSERT INTO crm_unidad_pieza_garantia(id_pieza,id_garantia,request_id,huella,motivo,id_autor,autor_nombre,retirado,motivo_retiro)
      SELECT $1,$2,md5('D02-link-page-'||g)::uuid,repeat('b',64),'Fixture histórico',$3,$4,true,'Sólo copia' FROM generate_series(1,25)g`,[piece,g,users[0],names[0]]);
    const linksPage=(await call(base+'/'+piece+'/garantias-historial?page=2')).body;assert.equal(linksPage.total,26);assert.equal(linksPage.data.length,6);await call(other+'/'+piece+'/garantias-historial',tokens[0],404);
    checked('Historial completo de vínculos accesible por páginas20, incluidos retirados; resumen10 explícito e IDs de otra unidad404');
    const uiGuarantee=await warranty(uiOrigin),uiCode='D02-CODIGO-ACTUAL';
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const originUrl='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=originUrl;
    browser=await chromium.launch();const browserErrors=[];
    for(const [theme,width]of[['light',1280],['dark',390]]){
      const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>browserErrors.push(e.name));await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
      await page.goto(originUrl+'/login?returnUrl='+encodeURIComponent('/crm/unidades/'+uiUnit+'/expediente'));await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/expediente');
      const area=page.locator('.unit-parts');await expect(area.getByRole('heading',{name:'Piezas instaladas y garantías',exact:true})).toBeVisible();await area.getByRole('button',{name:'Registrar instalación',exact:true}).click();
      await area.getByLabel('Buscar venta por folio, parte o descripción',{exact:true}).fill(uiOrigin.folio);await area.getByRole('button',{name:'Buscar ventas de origen',exact:true}).click();await expect(area.getByRole('button',{name:'Buscar ventas de origen',exact:true})).toBeEnabled();
      await area.getByLabel('Renglón de factura',{exact:true}).click();await page.getByRole('option').filter({hasText:uiOrigin.folio}).click();
      await area.getByLabel('Cantidad instalada',{exact:true}).fill('999');await area.getByLabel('Trabajo o instalación reportada',{exact:true}).fill('Instalación UI '+theme);await area.getByLabel('Fuente y motivo de compatibilidad',{exact:true}).fill('Pendiente de documento técnico '+theme);
      await area.getByRole('button',{name:'Guardar instalación',exact:true}).click();await expect(area.getByRole('alert')).toContainText('cantidad instalada');await expect(area.getByLabel('Trabajo o instalación reportada',{exact:true})).toHaveValue('Instalación UI '+theme);
      await area.getByLabel('Cantidad instalada',{exact:true}).fill('1');await area.getByRole('button',{name:'Guardar instalación',exact:true}).click();await expect(area.getByRole('heading',{name:'Nueva instalación reportada',exact:true})).toHaveCount(0);await expect(area.getByText('Instalación UI '+theme,{exact:true})).toBeVisible();
      const saved=(await get(uiUnit)).data.find(x=>x.detalle==='Instalación UI '+theme);
      await area.getByRole('button',{name:'Revisar compatibilidad instalación '+saved.idPieza,exact:true}).click();await area.getByLabel('Resultado de revisión',{exact:true}).click();await page.getByRole('option',{name:'Verificada manualmente',exact:true}).click();await area.getByLabel('Referencia de revisión',{exact:true}).fill('Documento técnico revisado '+theme);await area.getByRole('button',{name:'Guardar revisión',exact:true}).click();await expect(area.locator('.history article').filter({hasText:'Instalación #'+saved.idPieza+' ·'}).getByText('Compatibilidad: Verificada · Revisión 2',{exact:true})).toBeVisible();
      if(theme==='light'){
        await area.getByRole('button',{name:'Vincular garantía instalación '+saved.idPieza,exact:true}).click();await area.getByLabel('Garantía existente',{exact:true}).click();await page.getByRole('option').filter({hasText:'#'+uiGuarantee+' ·'}).click();await area.getByLabel('Motivo del vínculo',{exact:true}).fill('Falla relacionada con instalación reportada');await area.getByRole('button',{name:'Guardar vínculo de garantía',exact:true}).click();await expect(area.getByText(new RegExp('Garantía #'+uiGuarantee+' · Recibida'))).toBeVisible();
        await page.goto(originUrl+'/garantias');const back=page.getByRole('link',{name:'Instalación #'+saved.idPieza+' · Unidad #'+uiUnit,exact:true});await expect(back).toBeVisible();await back.click();await page.waitForURL('**/expediente');
      }
      await area.getByRole('button',{name:'Ver todos los vínculos instalación '+saved.idPieza,exact:true}).click();await expect(area.getByRole('heading',{name:'Historial de vínculos de la instalación #'+saved.idPieza,exact:true})).toBeVisible();await expect(area.getByRole('button',{name:'Más vínculos',exact:true})).toBeDisabled();await area.getByRole('button',{name:'Cerrar historial de vínculos',exact:true}).click();
      assert.deepEqual((await new AxeBuilder({page}).include('.unit-parts').analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await area.locator('.history article').filter({hasText:'Instalación #'+saved.idPieza+' ·'}).screenshot({path:path.join(root,'.artifacts/d02-pieces-'+theme+'.png')});await context.close();
    }
    assert.deepEqual(browserErrors,[]);checked('Angular producción/login real: buscar venta, error con borrador, alta/revisión y vínculo de garantía con regreso desde Garantías; claro1280/oscuro390/axe/reflujo sin errores JS');
    const version=(await writer.query('SELECT token_version FROM auth_user WHERE id_user=$1',[users[1]])).rows[0].token_version;
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'crm.unidades.consultar',granted:true},{permissionCode:'crm.unidades.gestionar',granted:false}],accessVersion:version});
    const context=await browser.newContext(),page=await context.newPage();await page.goto(originUrl+'/login?returnUrl='+encodeURIComponent('/crm/unidades/'+uiUnit+'/expediente'));await page.getByLabel('Usuario',{exact:true}).fill(names[1]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/expediente');await expect(page.locator('.unit-parts').getByText('Instalación UI light',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Registrar instalación',exact:true})).toHaveCount(0);await context.close();
    checked('Operador real de sólo consulta ve historial sin alta/revisión/vínculo; no se confunde permiso efectivo con rol');
    report.passed=true;report.completedAt=new Date().toISOString();

  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_parts_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/d02-piezas.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de expediente:',error instanceof assert.AssertionError?error.message:[error.name,error.code,error.constraint].filter(Boolean).join(' '),
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/d02-piezas.json; sin secretos en salida.');process.exitCode=1;});
