const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
exports.backend=async function({writer,call,users,tokens,service,inboxService,actor,checked}){
 const marker='C031-'+randomUUID().slice(0,8),client=(await writer.query('SELECT "IdCliente" id FROM cliente ORDER BY "IdCliente" LIMIT 1')).rows[0].id;
 const task=async(title,owner,creator,deadline,state='Pendiente')=>(await writer.query(`INSERT INTO crm_tarea(titulo,prioridad,fecha_vencimiento,id_responsable,id_creador,id_cliente,estado,completada_at) VALUES($1,'Media',${deadline},$2,$3,$4,$5,CASE WHEN $5::varchar='Completada' THEN clock_timestamp() END) RETURNING id_tarea::text id`,[marker+' '+title,owner,creator,client,state])).rows[0].id;
 const own=await task('Tarea propia',users[1],users[0],"now()-interval '2 days'");
 const foreign=await task('Ajena',users[0],users[0],"now()-interval '1 day'");
 const creator=await task('Creada por mí',users[0],users[1],"now()+interval '2 days'");
 await task('Cerrada',users[1],users[0],"now()-interval '2 days'",'Completada');
 const scheduled=await task('Para hoy',users[1],users[0],"((now() AT TIME ZONE 'America/Mexico_City')::date+1)::timestamp AT TIME ZONE 'America/Mexico_City'-interval '1 millisecond'");
 const opportunities=[];
 for(const[title,owner,stage,date]of[['Oportunidad propia',users[1],'Cotizando',null],['Oportunidad ajena',users[0],'Prospecto',null],['Sin asignar',null,'Prospecto',null],['Cerrada',users[1],'Ganada',null]]){
  opportunities.push((await writer.query(`INSERT INTO crm_oportunidad(empresa,tipo_cliente,etapa,monto_estimado,siguiente_accion,id_responsable,fecha_siguiente_accion) VALUES($1,'Taller',$2,0,$3,$4,$5) RETURNING id_oportunidad id`,[marker+' '+title,stage,'Revisar '+marker,owner,date])).rows[0].id);
 }
 const literal=await task('100%_literal',users[1],users[0],"now()+interval '9 days'");
 const web=[];
 for(const[expired,payload,state,linked]of[[false,true,'Pendiente',false],[true,true,'Pendiente',false],[false,false,'Pendiente',false],[false,true,'Descartada',false],[false,true,'Revisada',true]]){
  const id=randomUUID();web.push(id);await writer.query(`INSERT INTO crm_solicitud_web(request_id,fingerprint,payload,estado,expires_at,id_oportunidad) VALUES($1,repeat('a',64),$2::jsonb,$3,now()+$4::interval,$5)`,[id,payload?JSON.stringify({origin:'public-web',contact:{name:'NO DEBE SALIR',value:'privado@example.invalid'},items:[{code:'PRIVADO'}]}):null,state,expired?'-1 day':'3 days',linked?opportunities[0]:null]);
 }
 const inbox=async(query='',token=tokens[0])=>(await call('crm/bandeja?'+query,200,'GET',undefined,token)).data;
 let r=await inbox('q='+marker,tokens[1]);assert.ok(r.data.some(i=>i.id===own&&i.tipo==='tarea'));assert.ok(r.data.some(i=>i.id===creator));assert.ok(!r.data.some(i=>i.id===foreign&&i.tipo==='tarea'));assert.ok(r.data.some(i=>i.id===String(opportunities[0])&&i.tipo==='oportunidad'));assert.ok(!r.data.some(i=>i.id===String(opportunities[1])&&i.tipo==='oportunidad'));assert.ok(r.data.every(i=>['tarea','oportunidad'].includes(i.tipo)));assert.equal(r.administrador,false);
 await call('crm/bandeja?tipo=web',403,'GET',undefined,tokens[1]);await call('crm/bandeja?tipo=cotizacion',403,'GET',undefined,tokens[1]);checked('ACL real: tareas propias/creadas, oportunidad asignada, otras fuentes administrativas403');
 r=await inbox('q='+marker);assert.ok(r.data.some(i=>i.id===foreign&&i.tipo==='tarea'));assert.ok(r.data.some(i=>i.id===String(opportunities[2])&&i.tipo==='oportunidad'));assert.ok(!r.data.some(i=>i.cuenta===marker+' Cerrada'||i.titulo===marker+' Cerrada'));checked('ADMIN incluye asuntos sin asignar y ajenos; excluye tareas/oportunidades cerradas');
 assert.equal((await inbox('q='+encodeURIComponent(marker+' 100%_literal'))).data[0].id,literal);assert.equal((await inbox('q='+encodeURIComponent(marker+" ' OR 1=1 --"))).total,0);checked('Búsqueda literal de comodines y parámetros sin inyección SQL');
 r=await inbox('q='+marker+'&plazo=hoy');assert.ok(r.data.some(i=>i.id===scheduled));assert.ok(r.data.every(i=>i.plazo==='hoy'));assert.equal(r.resumen.hoy,r.total);r=await inbox('q='+marker+'&plazo=vencidas');assert.ok(r.data.some(i=>i.id===own));assert.equal(r.resumen.vencidas,r.total);r=await inbox('q='+marker+'&plazo=sin-fecha');assert.ok(r.data.every(i=>i.tipo==='oportunidad'));checked('Plazos excluyentes de Tampico, sin fecha y resumen consistentes con filtros');
 for(const id of web){r=await inbox('tipo=web&q='+id);assert.equal(r.total,id===web[0]?1:0);assert.ok(!JSON.stringify(r).includes('NO DEBE SALIR'));assert.ok(!JSON.stringify(r).includes('PRIVADO'));assert.ok(!JSON.stringify(r).includes('privado@example'));}
 checked('Solicitudes vigentes sin conversión: descarta vencidas/purgadas/descartadas/vinculadas y no devuelve contactos o piezas');
 const quote=(await writer.query(`INSERT INTO cotizacion(id_cotizacion,id_cliente,folio,nombre_receptor,estatus,fecha_vencimiento) SELECT coalesce(max(id_cotizacion),0)+1,$1,987650,$2,'Pendiente',now()-interval '1 day' FROM cotizacion RETURNING id_cotizacion::text id`,[client,marker+' Cotización'])).rows[0].id;
 r=await inbox('tipo=cotizacion&q='+marker);assert.equal(r.total,1);assert.equal(r.data[0].id,quote);assert.equal(r.data[0].plazo,'vencidas');
 await writer.query("UPDATE cotizacion SET estatus='Vigente' WHERE id_cotizacion=$1",[quote]);assert.equal((await inbox('tipo=cotizacion&q='+marker)).total,1);
 await writer.query("UPDATE cotizacion SET estatus='Cancelada' WHERE id_cotizacion=$1",[quote]);assert.equal((await inbox('tipo=cotizacion&q='+marker)).total,0);await writer.query("UPDATE cotizacion SET estatus='Pendiente' WHERE id_cotizacion=$1",[quote]);checked('Cotización pendiente/vigente real: identidad/fecha correctas y deja de aparecer al cancelarse');
 for(let n=0;n<24;n++)await task('Paginada '+n,users[1],users[0],"now()+interval '4 days'");
 const first=await inbox('q='+marker+'&tipo=tarea'),second=await inbox('q='+marker+'&tipo=tarea&page=2'),empty=await inbox('q='+marker+'&tipo=tarea&page=100000');assert.equal(first.data.length,20);assert.ok(second.data.length>0);assert.equal(first.total,second.total);assert.deepEqual(first.resumen,second.resumen);assert.equal(new Set([...first.data,...second.data].map(i=>i.id)).size,first.total);assert.equal(empty.data.length,0);assert.equal(empty.total,first.total);assert.deepEqual((await inbox('q=NONEXISTENT-'+randomUUID())).resumen,{vencidas:0,hoy:0,proximas:0,sinFecha:0});checked('Paginación estable sin duplicados, totales completos y página vacía conservando resumen');
 const model=await service.createModel({requestId:randomUUID(),nombre:marker+' Modelo',pasos:[{titulo:marker+' Pausada',descripcion:'Prueba',prioridad:'Alta',horas:0}]},actor);
 const run=await service.start({requestId:randomUUID(),idModelo:model.id,idCliente:client,idResponsable:users[0],motivo:'Prueba C03',confirmacion:true},actor);
 assert.equal((await inbox('q='+encodeURIComponent(marker+' Pausada'))).total,1);
 await service.control(run.id,{requestId:randomUUID(),accion:'Pausar',expectedVersion:1,motivo:'Prueba',confirmacion:true},actor);
 assert.equal((await inbox('q='+encodeURIComponent(marker+' Pausada'))).total,0);checked('Secuencia activa aparece; pausarla retira su tarea de la bandeja sin reactivar ni duplicar');
 for(const query of['page=0','page=1.5','page=100001','tipo=invalido','plazo=ayer','q='+encodeURIComponent('x'.repeat(101)),'sql=SELECT1'])await call('crm/bandeja?'+query,400);
 await call('crm/bandeja',401,'GET',undefined,'');const cached=await call('crm/bandeja?q='+marker);assert.equal(cached.cache,'private, no-store');
 await call('crm/tareas?idTarea=9223372036854775808',400);await call('crm/tareas?idTarea=1%20OR%201=1',400);const taskResult=(await call('crm/tareas?idTarea='+own,200,'GET',undefined,tokens[1])).data;assert.equal(taskResult.length,1);assert.equal(String(taskResult[0].idTarea),own);assert.equal((await call('crm/tareas?idTarea='+foreign,200,'GET',undefined,tokens[1])).data.length,0);checked('HTTP real: sin sesión401, DTO cerrado400, caché privada y acceso directo a tarea conserva ACL/bigint');
 await assert.rejects(inboxService.list({page:1,q:'',tipo:'todos',plazo:'todos'},{...actor,version:actor.version+1}),e=>e.getStatus?.()===403);
 const before=(await writer.query(`SELECT (SELECT count(*) FROM crm_tarea)::text tareas,(SELECT count(*) FROM crm_oportunidad)::text oportunidades,(SELECT count(*) FROM crm_solicitud_web)::text web,(SELECT count(*) FROM app_notification)::text avisos,(SELECT count(*) FROM auditoria_jsonb)::text auditoria`)).rows[0];
 await Promise.all([inbox('q='+marker),inbox('q='+marker),inbox('q='+marker,tokens[1])]);
 const after=(await writer.query(`SELECT (SELECT count(*) FROM crm_tarea)::text tareas,(SELECT count(*) FROM crm_oportunidad)::text oportunidades,(SELECT count(*) FROM crm_solicitud_web)::text web,(SELECT count(*) FROM app_notification)::text avisos,(SELECT count(*) FROM auditoria_jsonb)::text auditoria`)).rows[0];assert.deepEqual(after,before);
 checked('Revalidación de cuenta/version y lecturas concurrentes sin crear tareas/avisos/auditoría ni modificar fuentes');
 return {marker,own,foreign,client,opportunity:opportunities[0],web:web[0]};
};
