import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { DataSource,EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor,queryRows,readSnapshot } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { CommercialChannel,CommercialQuery,ConsentDto,ConsentQuery,PrepareCampaignDto } from './campana-consentimiento.dto';
import { commercialDestination,commercialSegmentPredicate,destinationHash,maskDestination } from './campana-consentimiento-policy';
export interface Contact {id:number;idCliente:number;nombre:string;cliente:string;telefono:string|null;email:string|null;}
export interface Consent {id_consentimiento:number;id_contacto:number;destino_hash:string;estado:string;version:number;vence_en:Date|null;ocurrida_en:Date;}
export interface CampaignSource {id:number;nombre:string;estado:string;fechaInicio:string|null;fechaFin:string|null;objetivo:string|null;idSegmento:number|null;segmento:string|null;segmentoActivo:boolean|null;tipoCliente:string|null;diasInactivo:number|null;idPlantilla:number|null;plantilla:string|null;canal:CommercialChannel|null;plantillaActiva:boolean|null;asunto:string|null;contenido:string|null;vencida:boolean;}
interface Candidate {idCliente:number;idContacto:number;cliente:string;contacto:string;destino:string;motivo:string;consentimiento:number|null;version:number;destinoHash:string|null;}
export interface CampaignPreparation {id:number;creadaEn:Date;motivo:string;autor:string;sha256:string;evaluacionSha256:string;}
interface StoredPreparation extends CampaignPreparation {snapshot:unknown;huella:string;id_campana:number;}
const eventPermission='crm.campanas.gestionar';
const consentLock='crm-campanas-consentimiento:v1';
const preparationFields=`p.id_preparacion AS id,p.creada_en AS "creadaEn",p.motivo,u.username AS autor,p.sha256,p.evaluacion_sha256 AS "evaluacionSha256"`;
@Injectable()
export class CampanaConsentimientoService {
 constructor(private readonly source:DataSource){}
 private async staff(db:QueryExecutor,actor:JwtPayload,write=false){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3
   AND fn_effective_permission(id_user,role,$4) ${write?'FOR SHARE':''}`,[actor.idUser??null,actor.role,actor.version,eventPermission]);
  if(!u)throw new ForbiddenException('Tu cuenta o permiso de campañas cambió.');if(write)await setAuditActor(db,actor.idUser);
 }
 read<T>(actor:JwtPayload,work:(db:QueryExecutor)=>Promise<T>){return readSnapshot(this.source,async db=>{await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);return work(db);});}
 write<T>(actor:JwtPayload,work:(db:EntityManager)=>Promise<T>){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");await this.staff(db,actor,true);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[consentLock]);return work(db);
 });}
 private async client(db:QueryExecutor,id:number){const [c]=await queryRows(db,'SELECT "IdCliente" FROM cliente WHERE "IdCliente"=$1',[id]);if(!c)throw new NotFoundException('Cliente no encontrado');}
 private async contactsRows(db:QueryExecutor,client:number,query:ConsentQuery){const q=query.q?'%'+query.q.replace(/[\\%_]/g,'\\$&')+'%':'';
  const where=`id_cliente=$1 AND ($2='' OR concat_ws(' ',nombre,cargo) ILIKE $2)`;
  const [count]=await queryRows<{total:number}>(db,`SELECT count(*)::int total FROM cliente_contacto WHERE ${where}`,[client,q]);
  const rows=await queryRows<Contact>(db,`SELECT id_contacto AS id,id_cliente AS "idCliente",nombre,telefono,email FROM cliente_contacto WHERE ${where} ORDER BY id_contacto LIMIT 20 OFFSET $3`,[client,q,(query.page-1)*20]);
  return{rows,total:count.total};
 }
 async latest(db:QueryExecutor,contacts:number[],canal:CommercialChannel){return queryRows<Consent>(db,`SELECT DISTINCT ON(id_contacto) id_consentimiento,id_contacto,destino_hash,estado,version,vence_en,ocurrida_en FROM crm_consentimiento_comercial
  WHERE id_contacto=ANY($1::int[]) AND canal=$2 ORDER BY id_contacto,version DESC`,[contacts,canal]);}
 async blocked(db:QueryExecutor,hashes:string[],canal:CommercialChannel){
  const rows=await queryRows<{destino_hash:string}>(db,`SELECT DISTINCT destino_hash FROM(SELECT DISTINCT ON(id_contacto,destino_hash) destino_hash,estado FROM crm_consentimiento_comercial
   WHERE canal=$1 AND destino_hash=ANY($2::text[]) ORDER BY id_contacto,destino_hash,version DESC) current_binding WHERE estado='Baja'`,[canal,hashes]);return new Set(rows.map(r=>r.destino_hash));
 }
 destination(c:Contact,canal:CommercialChannel){return commercialDestination(canal,canal==='Correo'?c.email:c.telefono);}
 contacts(client:number,query:ConsentQuery,actor:JwtPayload){return this.read(actor,async db=>{
  await this.client(db,client);const {rows,total}=await this.contactsRows(db,client,query),events=await this.latest(db,rows.map(c=>c.id),query.canal);
  const hashes=rows.map(c=>this.destination(c,query.canal)).filter((d):d is string=>d!==null).map(d=>destinationHash(query.canal,d)),blocked=await this.blocked(db,hashes,query.canal);
  const [{now}]=await queryRows<{now:Date}>(db,'SELECT clock_timestamp() AS now');
  return{data:rows.map(c=>{const destino=this.destination(c,query.canal),hash=destino?destinationHash(query.canal,destino):null,event=events.find(e=>e.id_contacto===c.id),same=event?.destino_hash===hash;
   const estado=!destino?'Destino inválido':blocked.has(hash!)?'Baja':!event||!same||event.ocurrida_en>now?'Sin autorización':event.vence_en&&event.vence_en<=now?'Vencido':event.estado==='Autorizado'?'Autorizado':'Sin autorización';
   return{id:c.id,nombre:c.nombre,canal:query.canal,destino:destino??'',destinoHuella:hash,version:event?.version??0,estado,venceEn:same?event?.vence_en??null:null};
  }),total,page:query.page,limit:20};
 });}
 history(client:number,query:CommercialQuery,actor:JwtPayload){return this.read(actor,async db=>{
  await this.client(db,client);const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM crm_consentimiento_comercial WHERE id_cliente=$1',[client]);
  const data=await queryRows(db,`SELECT e.id_consentimiento AS id,e.id_contacto AS "idContacto",COALESCE(c.nombre,'Contacto retirado') AS contacto,e.canal,e.estado,e.version,e.ocurrida_en AS "ocurridaEn",e.vence_en AS "venceEn",e.fuente,e.referencia,e.motivo,e.creada_en AS "creadaEn",u.username AS autor
   FROM crm_consentimiento_comercial e LEFT JOIN cliente_contacto c ON c.id_contacto=e.id_contacto AND c.id_cliente=e.id_cliente JOIN auth_user u ON u.id_user=e.id_user WHERE e.id_cliente=$1 ORDER BY e.id_consentimiento DESC LIMIT 20 OFFSET $2`,[client,(query.page-1)*20]);return{data,total:count.total,page:query.page,limit:20};
 });}
 consent(client:number,contact:number,dto:ConsentDto,actor:JwtPayload){const request=dto.requestId.toLowerCase(),hash=quoteHash({client,contact,...dto,requestId:request});return this.write(actor,async db=>{
  const [old]=await queryRows<{id:number;huella:string}>(db,'SELECT id_consentimiento AS id,huella FROM crm_consentimiento_comercial WHERE request_id=$1',[request]);
  const [other]=await queryRows(db,'SELECT id_preparacion FROM crm_campana_preparacion WHERE request_id=$1',[request]);
  if(other||old&&old.huella!==hash)throw new ConflictException('El UUID identifica otra operación.');if(old)return{id:old.id};
  const [c]=await queryRows<Contact>(db,'SELECT id_contacto AS id,id_cliente AS "idCliente",nombre,telefono,email FROM cliente_contacto WHERE id_cliente=$1 AND id_contacto=$2 FOR UPDATE',[client,contact]);
  if(!c)throw new NotFoundException('Contacto no encontrado en este cliente');
  const destino=this.destination(c,dto.canal);if(!destino)throw new BadRequestException('Corrige el correo o teléfono del contacto antes de registrar su preferencia.');
  if(destinationHash(dto.canal,destino)!==dto.destinoHuella)throw new ConflictException('El destino cambió; vuelve a consultar el contacto.');
  const [previous]=await this.latest(db,[contact],dto.canal);if((previous?.version??0)!==dto.versionAnterior)throw new ConflictException('La preferencia cambió. Actualiza antes de registrar otra decisión.');
  const [{now}]=await queryRows<{now:Date}>(db,'SELECT clock_timestamp() AS now');const occurred=new Date(dto.ocurridaEn),expires=dto.venceEn?new Date(dto.venceEn):null;
  if(!Number.isFinite(occurred.getTime())||occurred>now)throw new BadRequestException('La fecha declarada debe ser válida y no futura.');
  if(expires&&(!Number.isFinite(expires.getTime())||dto.estado==='Baja'||expires<=occurred||expires<=now))throw new BadRequestException('La vigencia debe ser futura y sólo aplica a autorizaciones.');
  const [binding]=await queryRows<Consent>(db,'SELECT estado,ocurrida_en FROM crm_consentimiento_comercial WHERE id_contacto=$1 AND canal=$2 AND destino_hash=$3 ORDER BY version DESC LIMIT 1',[contact,dto.canal,dto.destinoHuella]);
  if(dto.estado==='Autorizado'&&binding?.estado==='Baja'&&occurred<=binding.ocurrida_en)throw new ConflictException('La nueva autorización debe ser posterior a la baja registrada.');
  const [saved]=await queryRows<{id:number}>(db,`INSERT INTO crm_consentimiento_comercial(id_cliente,id_contacto,canal,destino_hash,estado,version,ocurrida_en,vence_en,fuente,referencia,motivo,id_user,request_id,huella)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id_consentimiento AS id`,[client,contact,dto.canal,dto.destinoHuella,dto.estado,(previous?.version??0)+1,occurred,expires,dto.fuente,dto.referencia,dto.motivo,actor.idUser,request,hash]);return saved;
 });}
 campaigns(query:CommercialQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const q=query.q?'%'+query.q.replace(/[\\%_]/g,'\\$&')+'%':'';
  const [count]=await queryRows<{total:number}>(db,"SELECT count(*)::int total FROM crm_campana WHERE ($1='' OR nombre ILIKE $1)",[q]);
  const data=await queryRows(db,`SELECT c.id_campana AS id,c.nombre,c.estado,p.canal,s.nombre AS segmento FROM crm_campana c LEFT JOIN crm_plantilla p USING(id_plantilla) LEFT JOIN crm_segmento s USING(id_segmento)
   WHERE ($1='' OR c.nombre ILIKE $1) ORDER BY c.id_campana DESC LIMIT 20 OFFSET $2`,[q,(query.page-1)*20]);return{data,total:count.total,page:query.page,limit:20};
 });}
 async evaluate(db:QueryExecutor,id:number){
  const [campaign]=await queryRows<CampaignSource>(db,`SELECT c.id_campana AS id,c.nombre,c.estado,c.fecha_inicio::text AS "fechaInicio",c.fecha_fin::text AS "fechaFin",c.objetivo,
   c.id_segmento AS "idSegmento",s.nombre AS segmento,s.activo AS "segmentoActivo",s.tipo_cliente AS "tipoCliente",s.dias_inactivo AS "diasInactivo",
   c.id_plantilla AS "idPlantilla",p.nombre AS plantilla,p.canal,p.activa AS "plantillaActiva",p.asunto,p.contenido,
   COALESCE(c.fecha_fin<(transaction_timestamp() AT TIME ZONE 'America/Mexico_City')::date,false) AS vencida
   FROM crm_campana c LEFT JOIN crm_segmento s USING(id_segmento) LEFT JOIN crm_plantilla p USING(id_plantilla) WHERE c.id_campana=$1`,[id]);
  if(!campaign)throw new NotFoundException('Campaña no encontrada');
  const blockers=[] as string[];if(campaign.estado!=='Borrador')blockers.push('La preparación local requiere campaña en Borrador.');
  if(!campaign.idSegmento||!campaign.segmentoActivo)blockers.push('Selecciona un segmento activo al crear el borrador.');
  if(!campaign.idPlantilla||!campaign.plantillaActiva||!campaign.canal)blockers.push('Selecciona una plantilla activa y con canal.');if(campaign.vencida)blockers.push('La campaña ya terminó según su fecha de fin.');
  const [{now}]=await queryRows<{now:Date}>(db,'SELECT clock_timestamp() AS now');
  const scope=`FROM cliente c JOIN crm_segmento s ON s.id_segmento=$1 WHERE ${commercialSegmentPredicate}`;
  const [stats]=await queryRows<{clientesSegmento:number;clientesSinContacto:number}>(db,`SELECT count(*)::int AS "clientesSegmento",count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM cliente_contacto a WHERE a.id_cliente=c."IdCliente"))::int AS "clientesSinContacto" ${scope}`,[campaign.idSegmento]);
  const contacts=blockers.length?[]:await queryRows<Contact>(db,`WITH clients AS (SELECT c."IdCliente",c."RazonSocial" ${scope})
   SELECT a.id_contacto AS id,a.id_cliente AS "idCliente",a.nombre,a.telefono,a.email,c."RazonSocial" AS cliente FROM clients c JOIN cliente_contacto a ON a.id_cliente=c."IdCliente" ORDER BY a.id_cliente,a.id_contacto LIMIT 1001`,[campaign.idSegmento]);
  if(contacts.length>1000)blockers.push('El segmento supera1000 contactos. Prepara un segmento más específico; no se generó una lista parcial.');
  const candidates:Candidate[]=[],seen=new Set<string>();
  if(!blockers.length&&campaign.canal){const canal=campaign.canal,events=await this.latest(db,contacts.map(c=>c.id),canal),destinations=contacts.map(c=>this.destination(c,canal)),hashes=destinations.filter((d):d is string=>d!==null).map(d=>destinationHash(canal,d)),blocked=await this.blocked(db,hashes,canal);
   for(const c of contacts){const destino=this.destination(c,canal),hash=destino?destinationHash(canal,destino):null,event=events.find(e=>e.id_contacto===c.id);
    let motivo=!hash?'Destino inválido':blocked.has(hash)?'Baja':!event||event.destino_hash!==hash||event.estado!=='Autorizado'||event.ocurrida_en>now?'Sin autorización':event.vence_en&&event.vence_en<=now?'Vencido':'Elegible';
    if(motivo==='Elegible'&&seen.has(hash!))motivo='Duplicado';if(motivo==='Elegible')seen.add(hash!);
    candidates.push({idCliente:c.idCliente,idContacto:c.id,cliente:c.cliente,contacto:c.nombre,destino:maskDestination(destino),destinoHash:hash,motivo,consentimiento:event?.id_consentimiento??null,version:event?.version??0});
   }
  }
  const motivos:Record<string,number>={};for(const r of candidates)motivos[r.motivo]=(motivos[r.motivo]??0)+1;
  const metrics={...stats,contactosEvaluados:candidates.length,elegibles:motivos.Elegible??0,excluidos:candidates.filter(c=>c.motivo!=='Elegible').length,motivos};
  // Guardar sólo referencias técnicas y huellas; los nombres/destinos no se duplican en la preparación.
  const configHash=quoteHash(campaign),decisions=candidates.map(({cliente:_,contacto:__,destino:___,...decision})=>{void _;void __;void ___;return decision;});
  const snapshot={version:1,idCampana:id,configHash,canal:campaign.canal,metricas:metrics,bloqueos:blockers,destinatarios:decisions};
  return{campaign,blockers,metrics,candidates,snapshot,evaluacionSha256:quoteHash(snapshot),evaluadaEn:now};
 }
 private async last(db:QueryExecutor,id:number){const [p]=await queryRows<StoredPreparation>(db,`SELECT ${preparationFields},p.snapshot,p.huella,p.id_campana FROM crm_campana_preparacion p JOIN auth_user u ON u.id_user=p.id_user WHERE p.id_campana=$1 ORDER BY p.id_preparacion DESC LIMIT 1`,[id]);
  if(!p)return null;if(quoteHash(p.snapshot)!==p.sha256)throw new ServiceUnavailableException('La preparación no coincide con su huella.');return p;
 }
 private project(p:StoredPreparation,current:string){return{id:p.id,creadaEn:p.creadaEn,motivo:p.motivo,autor:p.autor,sha256:p.sha256,evaluacionSha256:p.evaluacionSha256,actual:p.evaluacionSha256===current};}
 preview(id:number,query:CommercialQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const e=await this.evaluate(db,id),last=await this.last(db,id),q=query.q.toLocaleLowerCase('es-MX');
  const filtered=e.candidates.filter(c=>!q||[c.cliente,c.contacto,c.motivo].some(s=>s.toLocaleLowerCase('es-MX').includes(q)));
  const data=filtered.slice((query.page-1)*20,query.page*20).map(({destinoHash:_,...safe})=>{void _;return safe;});
  return{campana:e.campaign,bloqueos:e.blockers,metricas:e.metrics,evaluacionSha256:e.evaluacionSha256,evaluadaEn:e.evaluadaEn,ultima:last?this.project(last,e.evaluacionSha256):null,data,total:filtered.length,page:query.page,limit:20};
 });}
 prepare(id:number,dto:PrepareCampaignDto,actor:JwtPayload){const request=dto.requestId.toLowerCase(),hash=quoteHash({id,...dto,requestId:request});return this.write(actor,async db=>{
  const [other]=await queryRows(db,'SELECT id_consentimiento FROM crm_consentimiento_comercial WHERE request_id=$1',[request]);
  const [old]=await queryRows<StoredPreparation>(db,`SELECT ${preparationFields},p.snapshot,p.huella,p.id_campana FROM crm_campana_preparacion p JOIN auth_user u ON u.id_user=p.id_user WHERE p.request_id=$1`,[request]);
  if(other||old&&(old.huella!==hash||old.id_campana!==id))throw new ConflictException('El UUID identifica otra operación.');
  const e=await this.evaluate(db,id);if(old){if(quoteHash(old.snapshot)!==old.sha256)throw new ServiceUnavailableException('La preparación no coincide con su huella.');return this.project(old,e.evaluacionSha256);}
  if(e.blockers.length)throw new ConflictException(e.blockers.join(' '));if(e.evaluacionSha256!==dto.evaluacionSha256)throw new ConflictException('Cambiaron los contactos, autorizaciones o campaña. Revisa nuevamente los destinatarios.');
  if(!e.metrics.elegibles)throw new ConflictException('No hay destinatarios elegibles. No se generó una preparación vacía.');
  const [saved]=await queryRows<{id:number}>(db,`INSERT INTO crm_campana_preparacion(id_campana,request_id,huella,evaluacion_sha256,snapshot,sha256,motivo,id_user)VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)RETURNING id_preparacion AS id`,[id,request,hash,e.evaluacionSha256,JSON.stringify(e.snapshot),quoteHash(e.snapshot),dto.motivo,actor.idUser]);
  const p=await this.last(db,id);if(!p||p.id!==saved.id)throw new ConflictException('No se pudo confirmar la preparación.');return this.project(p,e.evaluacionSha256);
 });}
}
