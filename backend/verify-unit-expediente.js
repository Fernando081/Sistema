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
  const control=new Client(config),database='verify_units_'+randomBytes(8).toString('hex');
  const url=new URL(config.connectionString||'postgresql://127.0.0.1');
  if(!config.connectionString)Object.assign(url,{hostname:config.host,port:String(config.port),username:config.user,password:config.password});url.pathname='/'+database;
  const keys=['DATABASE_URL','DB_NAME','NODE_ENV','JWT_SECRET','ALLOW_ENV_AUTH','FISCAL_MODE','WEB_LEAD_BRIDGE_ENABLED','WEB_INBOX_PURGE_ENABLED','CORS_ORIGINS','AUTH_MFA_ENCRYPTION_KEY'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let created=false,app,writer,server,browser;
  const report={phase:'D01',startedAt:new Date().toISOString(),checks:[],isolatedDatabase:true,apiMocked:false};
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
    const password=randomBytes(24).toString('hex'),hash=await AuthService.hashPassword(password),names=['unit_admin_','unit_operator_'].map(x=>x+randomBytes(5).toString('hex')),users=[];
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
    const client=(await writer.query('SELECT "IdCliente" id FROM cliente ORDER BY "IdCliente" LIMIT 1')).rows[0].id;
    const unit=(await call('crm/clientes/'+client+'/unidades',tokens[0],201,'POST',{esn:'D01-'+randomBytes(6).toString('hex'),numeroEconomico:'D01 Unidad de verificación'})).body.idUnidad;
    const second=(await call('crm/clientes/'+client+'/unidades',tokens[0],201,'POST',{esn:'D01-'+randomBytes(6).toString('hex'),numeroEconomico:'D01 Unidad sin lecturas'})).body.idUnidad;
    const base='crm/unidades/'+unit,other='crm/unidades/'+second,get=async(id=unit)=>(await call('crm/unidades/'+id+'/expediente')).body;
    await call(base+'/expediente',null,401);await call(base+'/expediente',tokens[1],403);
    const initial=await get();assert.equal(initial.kilometrajeActual,null);assert.equal(initial.horasActuales,null);assert.equal(initial.lecturas.total,0);assert.deepEqual(initial.archivos,[]);
    assert.equal((await call(base+'/expediente')).cache,'private, no-store');await call(base+'/expediente?lecturasPage=-1',tokens[0],400);
    checked('100 check/migrate en copia; VIN/ESN existentes conservados; acceso privado401/403, no-store y datos desconocidos sin ceros inventados');
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'crm.unidades.consultar',granted:true}],accessVersion:0});tokens[1]=(await auth.login(names[1],password)).access_token;
    assert.equal((await call(base+'/expediente',tokens[1])).body.permisos.gestionar,false);
    await call(base+'/lecturas',tokens[1],403,'POST',{requestId:randomUUID(),fecha:new Date().toISOString(),kilometraje:10});
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'crm.unidades.consultar',granted:true},{permissionCode:'crm.unidades.gestionar',granted:true}],accessVersion:1});tokens[1]=(await auth.login(names[1],password)).access_token;
    checked('Delegación S01 efectiva: operador sin permiso denegado; consulta sola no permite escritura; gestión se concede explícitamente');
    const date=offset=>new Date(Date.now()-3600000+offset*60000).toISOString();
    const zero={requestId:randomUUID(),fecha:date(0),kilometraje:0,horas:0,notas:'Origen reportado de prueba'};
    const [z1,z2]=await Promise.all([call(base+'/lecturas',tokens[0],201,'POST',zero),call(base+'/lecturas',tokens[0],201,'POST',zero)]);
    assert.equal(z1.body.idLectura,z2.body.idLectura);assert.equal((await get()).lecturas.total,1);assert.equal(Number((await get()).kilometrajeActual),0);
    await call(base+'/lecturas',tokens[0],409,'POST',{...zero,kilometraje:1});
    await call(base+'/lecturas',tokens[0],400,'POST',{requestId:randomUUID(),fecha:date(1)});await call(base+'/lecturas',tokens[0],400,'POST',{requestId:randomUUID(),fecha:'2100-01-01T00:00:00Z',horas:3});
    await call(base+'/lecturas',tokens[0],400,'POST',{requestId:randomUUID(),fecha:date(1),kilometraje:-1});
    await call(base+'/lecturas',tokens[0],400,'POST',{requestId:randomUUID(),fecha:'2026-10-19',horas:3});
    checked('Lectura cero explícita, idempotencia concurrente por UUID/huella y rechazo de contenido distinto, vacíos, fechas futuras/sin zona y negativos');
    const last=(await call(base+'/lecturas',tokens[1],201,'POST',{requestId:randomUUID(),fecha:date(20),kilometraje:200,horas:20})).body.idLectura;
    await call(base+'/lecturas',tokens[0],201,'POST',{requestId:randomUUID(),fecha:date(10),kilometraje:100,horas:10});
    await call(base+'/lecturas',tokens[0],409,'POST',{requestId:randomUUID(),fecha:date(5),kilometraje:300});
    await call(base+'/lecturas',tokens[0],409,'POST',{requestId:randomUUID(),fecha:date(25),kilometraje:199,horas:21});
    await call(base+'/lecturas',tokens[0],201,'POST',{requestId:randomUUID(),fecha:date(30),horas:30});
    const latest=await get();assert.equal(Number(latest.kilometrajeActual),200);assert.equal(Number(latest.horasActuales),30);
    checked('Inserción intermedia respeta vecinos por fecha; reducción rechazada; lecturas parciales conservan último valor de cada medidor');
    await call(base+'/lecturas/'+last+'/anular',tokens[1],403,'POST',{motivo:'Operador no puede anular'});
    await call(base+'/lecturas/'+last+'/anular',tokens[0],201,'POST',{motivo:'Captura equivocada'});await call(base+'/lecturas/'+last+'/anular',tokens[0],201,'POST',{motivo:'Captura equivocada'});
    await call(base+'/lecturas/'+last+'/anular',tokens[0],409,'POST',{motivo:'Otro motivo'});
    await call(other+'/lecturas/'+last+'/anular',tokens[0],404,'POST',{motivo:'Unidad distinta'});
    const afterCancel=await get();assert.equal(Number(afterCancel.kilometrajeActual),100);assert.equal(Number(afterCancel.horasActuales),30);assert.equal(afterCancel.lecturas.total,4);assert.ok(afterCancel.lecturas.data.find(x=>x.idLectura===last).anulada);
    await call('crm/unidades/'+unit,tokens[0],409,'DELETE');
    checked('Anulación ADMIN con motivo conserva historial/reintento y recalcula valores; IDs de otra unidad no operan; unidad con expediente no se elimina');
    const unknown=(await call(other+'/mantenimientos',tokens[0],201,'POST',{requestId:randomUUID(),titulo:'Medidor desconocido',kilometrajeObjetivo:500})).body.idMantenimiento;
    assert.equal((await get(second)).mantenimientos.data.find(x=>x.idMantenimiento===unknown).condicion,'Sin lectura suficiente');
    const today=(await writer.query("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text today,((now() AT TIME ZONE 'America/Mexico_City')::date-1)::text yesterday")).rows[0];
    const planBody={requestId:randomUUID(),titulo:'Revisión por km',kilometrajeObjetivo:100};
    const p1=(await call(base+'/mantenimientos',tokens[0],201,'POST',planBody)).body.idMantenimiento;
    assert.equal((await call(base+'/mantenimientos',tokens[0],201,'POST',planBody)).body.idMantenimiento,p1);
    await call(base+'/mantenimientos',tokens[0],409,'POST',{...planBody,titulo:'Cambio de intención'});
    const due=(await call(base+'/mantenimientos',tokens[0],201,'POST',{requestId:randomUUID(),titulo:'Atender hoy',fechaObjetivo:today.today})).body.idMantenimiento;
    const overdue=(await call(base+'/mantenimientos',tokens[0],201,'POST',{requestId:randomUUID(),titulo:'Fecha anterior',fechaObjetivo:today.yesterday})).body.idMantenimiento;
    await call(base+'/mantenimientos',tokens[0],400,'POST',{requestId:randomUUID(),titulo:'Sin objetivo'});
    const plans=(await get()).mantenimientos.data;assert.equal(plans.find(x=>x.idMantenimiento===p1).condicion,'Vencido');assert.equal(plans.find(x=>x.idMantenimiento===due).condicion,'Vence hoy');assert.equal(plans.find(x=>x.idMantenimiento===overdue).condicion,'Vencido');
    checked('Mantenimiento por fecha/km/horas con objetivos obligatorios, idempotencia y condiciones Vencido/Vence hoy/Sin lectura suficiente');
    await call(base+'/mantenimientos/'+p1+'/cerrar',tokens[0],409,'POST',{version:2,estado:'Cancelado',motivo:'Versión anterior'});
    await call(base+'/mantenimientos/'+p1+'/cerrar',tokens[0],400,'POST',{version:1,estado:'Realizado',motivo:'Falta fecha'});
    const closeA={version:1,estado:'Realizado',motivo:'Reportado por el cliente',fechaRealizada:date(35)},closeB={version:1,estado:'Cancelado',motivo:'Cancelación concurrente'};
    const race=await Promise.all([closeA,closeB].map(async body=>{const r=await fetch(api+'/api/v1/'+base+'/mantenimientos/'+p1+'/cerrar',{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify(body)});await r.arrayBuffer();return{status:r.status,body};}));
    assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);const winner=race.find(x=>x.status===201).body;
    await call(base+'/mantenimientos/'+p1+'/cerrar',tokens[0],201,'POST',winner);
    const closed=(await get()).mantenimientos.data.find(x=>x.idMantenimiento===p1);assert.equal(closed.version,2);assert.equal(closed.estado,winner.estado);
    checked('Cierre versionado con fecha/motivo: una decisión concurrente y un409, repetición idéntica no reabre ni duplica historial');
    const privateMarker='D01_PRIVATE_'+randomBytes(10).toString('hex'),pdf=Buffer.from('%PDF-1.4\n%'+privateMarker+'\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
    const zlib=require('node:zlib'),chunk=(type,data)=>{const tag=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(zlib.crc32(Buffer.concat([tag,data])));return Buffer.concat([head,tag,data,tail]);};
    const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,0,140,255,255]))),chunk('IEND',Buffer.alloc(0))]);
    const upload=async(id,bytes,mime,body,status=201,filename='evidencia.pdf',token=tokens[0])=>{const form=new FormData();form.append('requestId',body.requestId);form.append('titulo',body.titulo);form.append('archivo',new Blob([bytes],{type:mime}),filename);
      const response=await fetch(api+'/api/v1/crm/unidades/'+id+'/archivos',{method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(15000)});const json=await response.json();assert.equal(response.status,status,'upload HTTP'+response.status+' esperado'+status);return json;};
    const attachment={requestId:randomUUID(),titulo:'Documento privado D01'},a1=await upload(unit,pdf,'application/pdf',attachment);
    assert.equal((await upload(unit,pdf,'application/pdf',attachment)).idArchivo,a1.idArchivo);
    await upload(unit,pdf,'application/pdf',{...attachment,titulo:'Otro título'},409);
    const photo=await upload(unit,png,'image/png',{requestId:randomUUID(),titulo:'Foto privada D01'},201,'foto.png');
    const fileRoute=base+'/archivos/'+a1.idArchivo;
    assert.equal((await fetch(api+'/api/v1/'+fileRoute)).status,401);
    const downloaded=await fetch(api+'/api/v1/'+fileRoute,{headers:{Authorization:'Bearer '+tokens[0]}});assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('cache-control'),'private, no-store');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.ok(downloaded.headers.get('content-disposition').startsWith('attachment;'));
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);await call(other+'/archivos/'+a1.idArchivo,tokens[0],404);
    const files=(await get()).archivos;assert.equal(files.length,2);assert.equal(files.find(x=>x.idArchivo===photo.idArchivo).tipo,'Foto');assert.ok(!JSON.stringify(files).includes(privateMarker));
    assert.equal((await writer.query("SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='crm_unidad_archivo_contenido'")).rows[0].n,0);
    assert.equal((await writer.query("SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='crm_unidad_archivo' AND (new_record ? 'contenido' OR old_record ? 'contenido')")).rows[0].n,0);
    checked('PDF/foto privados en BD: bytes íntegros, hash/metadata sin contenido, descarga autenticada attachment/no-store/nosniff, otra unidad404 y reintento único');
    await upload(unit,Buffer.from('<svg onload="alert(1)"></svg>'),'image/png',{requestId:randomUUID(),titulo:'Rechazar SVG'},400,'falso.png');
    await upload(unit,Buffer.from('%PDF-1.4 sin terminación'),'application/pdf',{requestId:randomUUID(),titulo:'Rechazar truncado'},400);
    await upload(unit,Buffer.alloc(5*1024*1024+1),'application/pdf',{requestId:randomUUID(),titulo:'Límite multipart'},413);
    await writer.query('UPDATE crm_unidad_archivo_contenido SET contenido=$2 WHERE id_archivo=$1',[a1.idArchivo,Buffer.from('corrupto')]);await call(fileRoute,tokens[0],503);
    await writer.query('UPDATE crm_unidad_archivo_contenido SET contenido=$2 WHERE id_archivo=$1',[a1.idArchivo,pdf]);
    await call(base+'/archivos/'+a1.idArchivo+'/retirar',tokens[1],403,'POST',{motivo:'No ADMIN'});
    await call(base+'/archivos/'+a1.idArchivo+'/retirar',tokens[0],201,'POST',{motivo:'Documento reemplazado'});await call(fileRoute,tokens[0],404);
    assert.equal((await writer.query('SELECT octet_length(contenido) n FROM crm_unidad_archivo_contenido WHERE id_archivo=$1',[a1.idArchivo])).rows[0].n,pdf.length);
    checked('Rechazo de MIME falso/SVG/PDF truncado/tamaño; corrupción detectada por SHA; retiro ADMIN conserva bytes y bloquea nueva descarga');
    const fileHash=require('node:crypto').createHash('sha256').update(pdf).digest('hex');
    await writer.query(`WITH created AS (INSERT INTO crm_unidad_archivo(id_unidad,request_id,huella,titulo,nombre,tipo,mime,bytes,sha256,id_autor,autor_nombre)
      SELECT $1,md5('D01-file-quota-'||g)::uuid,repeat('a',64),'Cuota de prueba','cuota.pdf','Documento','application/pdf',$2,$3,$4,$5 FROM generate_series(1,50)g RETURNING id_archivo)
      INSERT INTO crm_unidad_archivo_contenido(id_archivo,contenido)SELECT id_archivo,$6 FROM created`,[second,pdf.length,fileHash,users[0],names[0],pdf]);
    await upload(second,pdf,'application/pdf',{requestId:randomUUID(),titulo:'Supera cuota'},409);
    await writer.query(`INSERT INTO crm_unidad_mantenimiento(id_unidad,request_id,huella,titulo,kilometraje_objetivo,id_autor,autor_nombre)
      SELECT $1,md5('D01-plan-quota-'||g)::uuid,repeat('b',64),'Cuota de prueba',1000,$2,$3 FROM generate_series(1,99)g`,[second,users[0],names[0]]);
    await call(other+'/mantenimientos',tokens[0],409,'POST',{requestId:randomUUID(),titulo:'Supera cuota',kilometrajeObjetivo:2000});
    const paged=(await call(other+'/expediente?mantenimientosPage=2')).body;assert.equal(paged.mantenimientos.total,100);assert.equal(paged.mantenimientos.data.length,20);assert.equal(paged.mantenimientos.page,2);
    checked('Cuotas por unidad y paginación20 real; fixtures de cuota solo en copia sin desbordar respuesta o duplicar adjuntos');
    const countBefore=(await get()).lecturas.total;
    await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_d01_audit_failure CHECK(table_name<>'crm_unidad_lectura') NOT VALID");
    try{await call(base+'/lecturas',tokens[0],400,'POST',{requestId:randomUUID(),fecha:date(40),kilometraje:150});}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_d01_audit_failure');}
    assert.equal((await get()).lecturas.total,countBefore);
    const records=(await writer.query("SELECT actor_name FROM auditoria_jsonb WHERE table_name='crm_unidad_lectura' AND new_record->>'id_unidad'=$1 AND app_user_id=$2",[String(unit),users[0]])).rows;assert.ok(records.length>0);assert.ok(records.every(r=>r.actor_name===names[0]));
    checked('Fallo al auditar revierte lectura; eventos de metadata conservan actor y no copian archivos a bitácora');
    const stale=auth.verify(tokens[1]),service=app.get(require('./dist/crm/unidad-expediente.service').UnidadExpedienteService);
    await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[users[1]]);
    const waiting=service.addReading(unit,{requestId:randomUUID(),fecha:date(45),kilometraje:175},stale).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));
    let blocked=false;for(let i=0;i<100;i++){if((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
    await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);assert.equal((await get()).lecturas.total,countBefore);
    checked('Actor revocado durante espera de bloqueo no registra lecturas; comprobación dentro de transacción');
    stage='Angular';server=preview(api,path.join(root,'frontend/dist/frontend/browser'));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=origin;
    browser=await chromium.launch();const browserErrors=[];
    for(const[theme,width]of[['light',1280],['dark',390]]){
      const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>browserErrors.push(e.name));
      await page.addInitScript(value=>localStorage.setItem('theme',value),theme);await page.goto(origin+'/login?returnUrl='+encodeURIComponent('/crm/unidades/'+unit+'/expediente'));
      await page.getByLabel('Usuario',{exact:true}).fill(names[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/expediente');
      stage='UI lectura '+theme;await expect(page.getByRole('heading',{name:'Expediente de unidad',exact:true})).toBeVisible();
      await page.getByLabel('Kilometraje observado',{exact:true}).fill(theme==='light'?'250':'300');await page.getByRole('button',{name:'Guardar lectura',exact:true}).click();await expect(page.getByLabel('Kilometraje observado',{exact:true})).toHaveValue('');
      await page.getByLabel('Mantenimiento a seguir',{exact:true}).fill('Plan UI '+theme);await page.getByLabel('Kilometraje objetivo',{exact:true}).fill('500');await page.getByRole('button',{name:'Programar mantenimiento',exact:true}).click();await expect(page.getByLabel('Mantenimiento a seguir',{exact:true})).toHaveValue('');
      await page.getByRole('button',{name:'Cerrar mantenimiento Plan UI '+theme,exact:true}).click();await page.getByLabel('Detalle del cierre',{exact:true}).fill('Seguimiento del cliente en prueba');await page.getByRole('button',{name:'Confirmar cierre',exact:true}).click();await expect(page.getByRole('heading',{name:'Cerrar Plan UI '+theme,exact:true})).toHaveCount(0);
      stage='UI foto '+theme;await page.getByLabel('Título de evidencia',{exact:true}).fill('Foto UI '+theme);await page.getByLabel('Archivo de la unidad',{exact:true}).setInputFiles({name:'unidad.png',mimeType:'image/png',buffer:png});
      await page.getByRole('button',{name:'Guardar archivo privado',exact:true}).click();await expect(page.getByLabel('Título de evidencia',{exact:true})).toHaveValue('');
      await page.getByRole('button',{name:'Ver foto Foto UI '+theme,exact:true}).click();await expect(page.getByAltText('Foto UI '+theme,{exact:true})).toBeVisible();
      assert.ok(await page.getByAltText('Foto UI '+theme,{exact:true}).evaluate(img=>img.complete&&img.naturalWidth===1));
      const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar Foto UI '+theme,exact:true}).click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.png$/);
      assert.deepEqual((await new AxeBuilder({page}).include('.unit-expediente').analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('.identity').screenshot({path:path.join(root,'.artifacts/d01-unit-'+theme+'.png')});await page.getByAltText('Foto UI '+theme,{exact:true}).screenshot({path:path.join(root,'.artifacts/d01-photo-'+theme+'.png')});await context.close();
    }
    checked('Angular producción/login real: lectura, mantenimiento/cierre, subida/imagen decodificada/descarga privada; claro1280/oscuro390/axe/reflujo sin errores JS');
    const operatorVersion=(await writer.query('SELECT token_version FROM auth_user WHERE id_user=$1',[users[1]])).rows[0].token_version;
    await call('auth/users/'+users[1]+'/permissions',tokens[0],200,'PUT',{permissions:[{permissionCode:'crm.unidades.consultar',granted:true},{permissionCode:'crm.unidades.gestionar',granted:false}],accessVersion:operatorVersion});
    const readerContext=await browser.newContext(),reader=await readerContext.newPage();reader.on('pageerror',e=>browserErrors.push(e.name));
    await reader.goto(origin+'/login?returnUrl='+encodeURIComponent('/crm/unidades/'+unit+'/expediente'));await reader.getByLabel('Usuario',{exact:true}).fill(names[1]);await reader.getByLabel('Contraseña',{exact:true}).fill(password);await reader.getByRole('button',{name:'Entrar',exact:true}).click();await reader.waitForURL('**/expediente');
    await expect(reader.getByText('Expediente de solo consulta. Un administrador puede asignar el permiso para gestionar unidades.',{exact:true})).toBeVisible();
    await expect(reader.getByRole('button',{name:'Guardar lectura',exact:true})).toHaveCount(0);await expect(reader.getByRole('button',{name:'Guardar archivo privado',exact:true})).toHaveCount(0);
    await reader.getByRole('button',{name:'Ver foto Foto privada D01',exact:true}).click();await expect(reader.getByAltText('Foto privada D01',{exact:true})).toBeVisible();await readerContext.close();
    assert.deepEqual(browserErrors,[]);checked('Operador de solo consulta ve expediente/foto autenticada sin controles de gestión; no se confunde rol con permiso efectivo');
    report.passed=true;report.completedAt=new Date().toISOString();
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),app?.close(),writer?.end(),server?.listening?new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();}):undefined]);
    if(created&&/^verify_units_[a-f0-9]{16}$/.test(database)){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);report.copyRemoved=(await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount===0;}
    await control.end();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    report.cleanupPassed=cleanup.every(r=>r.status==='fulfilled');report.lastStage=stage;fs.writeFileSync(path.join(root,'.artifacts/d01-expediente.json'),JSON.stringify(report,null,2)+'\n');assert.ok(report.cleanupPassed);
  }
}
main().catch(error=>{console.error('Falló aceptación de expediente:',error instanceof assert.AssertionError?error.message:error.name,
  (error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).join('\n'),'Revisar etapa en .artifacts/d01-expediente.json; sin secretos en salida.');process.exitCode=1;});
