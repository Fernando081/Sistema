/* V03.2. Se invoca únicamente dentro de la copia propia del verificador V03.1. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
async function verifyApi(c){
 const {app,writer,clients,fixtures,call,portal,cookieA,cookieB,actor,tokens,checked,root,api}=c;
 const service=app.get(require('./dist/portal/portal-publications.service').PortalPublicationsService);
 const fiscal=app.get(require('./dist/fiscal/fiscal.service').FiscalService);
 const url=id=>'clientes/'+id+'/portal-publicaciones';
 await call(url(clients[0]),null,401);await call(url(clients[0]),tokens[1],403);
 assert.equal((await call(url(clients[0]))).body.total,0);assert.equal((await portal('archivos',cookieA)).data.total,0);
 await call(url(clients[0])+'/candidatos/firma',tokens[0],404);await call(url(clients[0])+'/candidatos/xml?idCliente='+clients[1],tokens[0],400);
 for(const f of fixtures)await fiscal.stamp('FACTURA',f.facturas,actor.idUser); // PAC mock real, jamás proveedor externo.
 // Entrega V02 real sobre estado de picking sintético dentro de la copia; no se presume GPS/firma física.
 const delivery=app.get(require('./dist/pedido/entrega-evidencia.service').EntregaEvidenciaService);
 for(const f of fixtures){const row=(await writer.query("UPDATE pedido_venta SET estado='Surtido',version=version+1 WHERE id_pedido=$1 RETURNING version",[f.pedidos])).rows[0];
  await delivery.register(f.pedidos,{requestId:randomUUID(),version:row.version,recibidoPor:'NO_PUBLICAR_RECEPTOR',notas:'NO_PUBLICAR_NOTA',motivoSinEvidencia:'Prueba aislada sin captura física'}, {},actor);
 }
 const own={};for(const type of['xml','cotizacion','entrega']){
  const list=(await call(url(clients[0])+'/candidatos/'+type)).body;assert.equal(list.total,1);own[type]=list.data[0];
  const foreign=(await call(url(clients[1])+'/candidatos/'+type)).body.data[0];
  await assert.rejects(service.preview(clients[0],{tipo:type,origen:foreign.origen},actor),e=>e.getStatus?.()===404);
 }
 assert.equal(own.xml.clase,'mock');assert.equal(own.cotizacion.clase,'copia');assert.equal(own.entrega.clase,'copia');
 checked('105 en copia sin backfill; permiso independiente401/403, tipos cerrados/DTO sin idCliente, candidatos y vistas previas ligados al cliente; V01/V02/PAC mock existentes reutilizados');
 const publish=candidate=>({...candidate,requestId:randomUUID(),motivo:'Publicación aislada autorizada'});
 const body=publish(own.xml);delete body.titulo;delete body.clase;delete body.mime;
 const published=(await call(url(clients[0]),tokens[0],201,'POST',body)).body;
 assert.equal((await call(url(clients[0]),tokens[0],201,'POST',body)).body.id,published.id);
 await call(url(clients[0]),tokens[0],409,'POST',{...body,motivo:'Contenido distinto'});
 await call(url(clients[1]),tokens[0],409,'POST',body);
 await call(url(clients[0]),tokens[0],400,'POST',{...body,requestId:randomUUID(),clase:'production'});
 const raw=await fetch(api+'/api/v1/portal/archivos/'+published.id+'/descarga',{headers:{Origin:'http://127.0.0.1:4300','X-Portal-Browser':'1',Cookie:cookieA}});
 assert.equal(raw.status,200);assert.equal(raw.headers.get('cache-control'),'private, no-store');assert.equal(raw.headers.get('x-content-type-options'),'nosniff');assert.match(raw.headers.get('content-disposition'),/attachment;.*mock\.xml/);
 const xml=Buffer.from(await raw.arrayBuffer());assert.match(xml.toString(),/MOCK.*SIN VALIDEZ FISCAL/);assert.equal(xml.toString(),(await writer.query('SELECT xml_timbrado FROM fiscal_documento WHERE id_factura=$1',[fixtures[0].facturas])).rows[0].xml_timbrado);
 assert.equal(createHash('sha256').update(xml).digest('hex'),published.sha256);
 await portal('archivos/'+published.id+'/descarga',cookieB,404);await portal('archivos/'+published.id+'/descarga','',401);
 await portal('archivos/'+published.id+'/descarga','erp_session='+tokens[0],401);
 await portal('archivos',cookieA,403,'GET',undefined,{'X-Portal-Browser':''});
 assert.equal((await portal('archivos',cookieB)).data.total,0);const projection=JSON.stringify((await portal('archivos',cookieA)).data);for(const key of['id_cliente','id_user','motivo','origenSha256','NO_PUBLICAR','xml_timbrado','contenido'])assert.ok(!projection.includes(key));
 checked('Publicación deliberada/idempotente y revisión por huella; XML descargado idéntico al fiscal mock, SHA-256/attachment/nosniff/no-store; otro cliente404 y cookie ERP insuficiente');
 const quoteBody=publish(own.cotizacion),outcomes=await Promise.all([service.publish(clients[0],quoteBody,actor),service.publish(clients[0],quoteBody,actor)]);
 assert.equal(outcomes[0].id,outcomes[1].id);const quoteId=outcomes[0].id;
 const receipt=await service.publish(clients[0],publish(own.entrega),actor);
 for(const[id,name]of[[quoteId,'cotizacion'],[receipt.id,'entrega']]){const file=await service.download(cookieA.split('=')[1],id);assert.equal(file.contenido.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(path.join(root,'.artifacts/v032-'+name+'.pdf'),file.contenido);}
 // Alteración de XML fuente no reescribe el publicado ni vuelve descargables los bytes obsoletos.
 const oldXml=xml.toString();await writer.query('UPDATE fiscal_documento SET xml_timbrado=$2 WHERE id_factura=$1',[fixtures[0].facturas,oldXml+'\n<!-- cambio -->']);
 await portal('archivos/'+published.id+'/descarga',cookieA,404);await assert.rejects(service.publish(clients[0],{...body,requestId:randomUUID()},actor),e=>e.getStatus?.()===409);
 await writer.query('UPDATE fiscal_documento SET xml_timbrado=$2 WHERE id_factura=$1',[fixtures[0].facturas,oldXml]);
 // Reasignación administrativa del origen tampoco permite cruces en una descarga existente.
 await writer.query('UPDATE factura SET id_cliente=$2 WHERE id_factura=$1',[fixtures[0].facturas,clients[1]]);await portal('archivos/'+published.id+'/descarga',cookieA,404);
 await portal('archivos/'+published.id+'/descarga',cookieB,404);await writer.query('UPDATE factura SET id_cliente=$2 WHERE id_factura=$1',[fixtures[0].facturas,clients[0]]);
 checked('Publicación concurrente única; PDF V01/V02 conservados y separados de originales; cambios de fuente o reasignación bloquean la descarga sin transferir permisos');
 const retirement={requestId:randomUUID(),motivo:'Retiro aislado'};
 await call(url(clients[0])+'/'+quoteId+'/retirar',tokens[0],201,'POST',retirement);await call(url(clients[0])+'/'+quoteId+'/retirar',tokens[0],201,'POST',retirement);
 await portal('archivos/'+quoteId+'/descarga',cookieA,404);assert.ok(!(await portal('archivos',cookieA)).data.data.some(p=>p.id===quoteId));
 await call(url(clients[1])+'/'+receipt.id+'/retirar',tokens[0],404,'POST',{requestId:randomUUID(),motivo:'No autorizado'});
 const retiredRetry=await service.publish(clients[0],quoteBody,actor);assert.ok(retiredRetry.retirada,'El reintento no resucita una publicación retirada');
 checked('Retiro transaccional/idempotente, historial conservado y archivo desaparece del portal; reintentar la publicación original no resucita acceso; retiro cruzado404');
 const fiscalRow=(await writer.query('SELECT * FROM fiscal_documento WHERE id_factura=$1',[fixtures[0].facturas])).rows[0];
 await writer.query("UPDATE fiscal_documento SET ambiente='production',proveedor='sw' WHERE id_factura=$1",[fixtures[0].facturas]);
 await assert.rejects(service.preview(clients[0],{tipo:'xml',origen:fixtures[0].facturas},actor),e=>e.getStatus?.()===503);
 await writer.query('UPDATE fiscal_documento SET ambiente=$2,proveedor=$3,xml_timbrado=$4 WHERE id_factura=$1',[fixtures[0].facturas,fiscalRow.ambiente,fiscalRow.proveedor,'<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///nonexistent">]><foo/>']);
 await assert.rejects(service.preview(clients[0],{tipo:'xml',origen:fixtures[0].facturas},actor),e=>e.getStatus?.()===503);
 await writer.query('UPDATE fiscal_documento SET xml_timbrado=$2 WHERE id_factura=$1',[fixtures[0].facturas,'x'.repeat(2097153)]);
 await assert.rejects(service.preview(clients[0],{tipo:'xml',origen:fixtures[0].facturas},actor),e=>e.getStatus?.()===404);
 await writer.query('UPDATE fiscal_documento SET xml_timbrado=$2 WHERE id_factura=$1',[fixtures[0].facturas,fiscalRow.xml_timbrado]);
 // Acuse original simulado conservado; no llamar cancelación de negocio ni revertir existencias aquí.
 await writer.query('UPDATE fiscal_documento SET acuse_cancelacion=$2 WHERE id_factura=$1',[fixtures[0].facturas,'<MockCancellation UUID="'+fiscalRow.uuid+'" />']);
 const acknowledgement=(await call(url(clients[0])+'/candidatos/acuse')).body.data[0];await service.publish(clients[0],publish(acknowledgement),actor);
 checked('Proveniencia del servidor: mock no se publica como producción; XML con DTD/ENTITY y mayores2MiB rechazados; acuse mock conservado admite publicación separada');
 for(const table of['portal_publicacion','portal_publicacion_archivo','portal_publicacion_retiro'])await assert.rejects(writer.query('TRUNCATE '+table+' CASCADE'),e=>e.code==='P0001');
 await assert.rejects(writer.query("UPDATE portal_publicacion SET titulo='alterado' WHERE id_publicacion=$1",[published.id]),e=>e.code==='P0001');
 await assert.rejects(writer.query('DELETE FROM portal_publicacion_archivo WHERE id_publicacion=$1',[published.id]),e=>e.code==='P0001');
 await assert.rejects(writer.query("INSERT INTO auditoria_jsonb(table_name,action,new_record)VALUES('portal_publicacion_archivo','INSERT','{}')"),e=>e.code==='P0001');
 const audits=(await writer.query("SELECT app_user_id,new_record::text data FROM auditoria_jsonb WHERE table_name IN('portal_publicacion','portal_publicacion_retiro')")).rows;
 assert.ok(audits.length>=5);assert.ok(audits.every(a=>a.app_user_id===actor.idUser));assert.ok(audits.every(a=>!a.data.includes('xml_timbrado')&&!a.data.includes('contenido')));
 const rollbackBody=publish(own.cotizacion);await writer.query("ALTER TABLE auditoria_jsonb ADD CONSTRAINT verify_v032_failure CHECK(table_name<>'portal_publicacion') NOT VALID");
 try{await assert.rejects(service.publish(clients[0],rollbackBody,actor),e=>e.code==='23514');}finally{await writer.query('ALTER TABLE auditoria_jsonb DROP CONSTRAINT verify_v032_failure');}
 assert.equal((await writer.query('SELECT count(*)::int n FROM portal_publicacion WHERE request_id=$1',[rollbackBody.requestId])).rows[0].n,0);
 assert.equal((await writer.query('SELECT count(*)::int n FROM portal_publicacion_archivo a LEFT JOIN portal_publicacion p USING(id_publicacion) WHERE p.id_publicacion IS NULL')).rows[0].n,0);
 checked('Guardas ALWAYS de metadata/bytes/retiros y protección de auditoría sin archivos; actor nominal, fallo de auditoría revierte publicación/archivo juntos');
 // Permiso revocado mientras el escritor espera el bloqueo de auth_user.
 const newUser=(await writer.query(`INSERT INTO auth_user(username,password_hash,role,is_active,token_version)SELECT $1,password_hash,'admin',true,0 FROM auth_user WHERE id_user=$2 RETURNING id_user`,['pub_'+randomUUID().slice(0,8),actor.idUser])).rows[0].id_user;
 const revokedActor={...actor,idUser:newUser};
 await writer.query('BEGIN');await writer.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[newUser]);
 const waiting=service.publish(clients[0],publish(own.cotizacion),revokedActor).then(()=>({allowed:true}),e=>({status:e.getStatus?.()}));
 let blocked=false;for(let i=0;i<100;i++){if((await app.get(require('typeorm').DataSource).query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).length){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
 await writer.query('COMMIT');assert.ok(blocked);assert.equal((await waiting).status,403);
 checked('Revocación efectiva de personal mientras espera bloqueo rechaza403 sin crear publicación; base de origen intacta');
}
async function verifyUi(c){
 const {page,guest,row,client,theme,root}=c;
 await page.getByRole('dialog').last().getByRole('button',{name:'Cerrar',exact:true}).click();await row.getByRole('button',{name:'Documentos del portal',exact:true}).click();
 const dialog=page.getByRole('dialog').last();await expect(dialog.getByRole('heading',{name:/Documentos del portal/})).toBeVisible();await expect(dialog.getByText('Consultando o guardando…',{exact:true})).toBeHidden();
 await dialog.getByLabel('Tipo de archivo',{exact:true}).selectOption('cotizacion');await expect(dialog.getByRole('heading',{name:/Cotización \d+ · revisión/})).toBeVisible();
 await dialog.getByLabel('Motivo de publicación o retiro',{exact:true}).fill('Publicación revisada para '+client);
 const reviewing=page.waitForEvent('download');await dialog.getByRole('button',{name:'Descargar para revisar',exact:true}).click();assert.match((await reviewing).suggestedFilename(),/copia\.pdf$/);
 await expect(dialog.getByRole('button',{name:'Publicar archivo',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Publicar archivo',exact:true}).click();
 const confirmation=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Publicar archivo para el cliente',exact:true})});await confirmation.getByRole('button',{name:'Publicar archivo',exact:true}).click();
 await expect(dialog.getByText('Archivo publicado para este cliente.',{exact:true})).toBeVisible();await expect(dialog.getByText('Consultando o guardando…',{exact:true})).toBeHidden();
 await guest.getByRole('button',{name:'Archivos compartidos',exact:true}).click();const card=guest.locator('.cards article').filter({hasText:/Cotización \d+ · revisión/});await expect(card).toBeVisible();
 await expect(card.getByText('Copia documental · No es CFDI',{exact:true})).toBeVisible();const downloading=guest.waitForEvent('download');await card.getByRole('button',{name:'Descargar archivo',exact:true}).click();assert.match((await downloading).suggestedFilename(),/copia\.pdf$/);
 assert.deepEqual((await new AxeBuilder({page}).include('app-portal-publications-dialog').analyze()).violations,[]);assert.deepEqual((await new AxeBuilder({page:guest}).include('main').analyze()).violations,[]);
 assert.ok(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await dialog.screenshot({path:path.join(root,'.artifacts/v032-publicaciones-'+theme+'.png')});await guest.locator('main').screenshot({path:path.join(root,'.artifacts/v032-archivos-'+theme+'.png')});
 const published=dialog.locator('article').filter({hasText:/Cotización \d+ · revisión/}).filter({hasText:'Publicado'});await published.getByRole('button',{name:'Retirar archivo',exact:true}).click();
 const removal=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Retirar archivo del portal',exact:true})});await removal.getByRole('button',{name:'Retirar archivo',exact:true}).click();
 await expect(dialog.getByText('Archivo retirado; ya no admite nuevas descargas.',{exact:true})).toBeVisible();await guest.getByRole('button',{name:'Buscar',exact:true}).click();await expect(card).toHaveCount(0);
 await guest.getByRole('button',{name:'Pedidos',exact:true}).click();
}
module.exports={verifyApi,verifyUi};
