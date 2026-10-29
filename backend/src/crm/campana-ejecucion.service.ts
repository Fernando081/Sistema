import { ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource,EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { queryRows } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { CommercialChannel } from './campana-consentimiento.dto';
import { commercialDestination,destinationHash } from './campana-consentimiento-policy';
import { CampanaConsentimientoService,Consent } from './campana-consentimiento.service';
import { CancelCampaignSimulationDto,StartCampaignSimulationDto } from './campana-ejecucion.dto';

const consentLock='crm-campanas-consentimiento:v1';
const LOTE=200;

export type MotivoOmision='Contacto retirado'|'Destino cambiado'|'Destino inválido'|'Baja'|'Sin autorización'|'Vencido';

/**
 * Revalida un destinatario al momento de procesarlo (no al preparar): el contacto debe existir en el mismo
 * cliente, conservar el destino preparado, no tener baja en ese destino y seguir autorizado y vigente.
 */
export function decidirDestinatario(input:{contacto:{idCliente:number;email:string|null;telefono:string|null}|null;idCliente:number;canal:CommercialChannel;
 destinoHash:string;bajas:Set<string>;ultimo:Consent|undefined;ahora:Date}):'Simulado'|MotivoOmision{
 const {contacto,canal,ultimo,ahora}=input;
 if(!contacto||contacto.idCliente!==input.idCliente)return 'Contacto retirado';
 const destino=commercialDestination(canal,canal==='Correo'?contacto.email:contacto.telefono);
 if(!destino)return 'Destino inválido';
 if(destinationHash(canal,destino)!==input.destinoHash)return 'Destino cambiado';
 if(input.bajas.has(input.destinoHash))return 'Baja';
 if(!ultimo||ultimo.destino_hash!==input.destinoHash||ultimo.estado!=='Autorizado'||new Date(ultimo.ocurrida_en)>ahora)return 'Sin autorización';
 if(ultimo.vence_en&&new Date(ultimo.vence_en)<=ahora)return 'Vencido';
 return 'Simulado';
}

/** Personaliza {{nombre}} y {{cliente}}; sólo se conserva la huella del resultado. */
export function mensajeCampana(asunto:string|null,contenido:string|null,datos:{nombre:string;cliente:string}){
 const poner=(t:string)=>t.replace(/\{\{\s*nombre\s*\}\}/gi,datos.nombre).replace(/\{\{\s*cliente\s*\}\}/gi,datos.cliente);
 return{asunto:poner(asunto??''),contenido:poner(contenido??'')};
}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const plantillaHash=(asunto:string|null,contenido:string|null)=>sha(JSON.stringify([asunto??'',contenido??'']));

interface Ejecucion {id:number;idCampana:number;canal:CommercialChannel;plantillaSha256:string}

/**
 * O01.2c · Consumidor de campañas en modo simulación. Toma la preparación C01 vigente, crea una ejecución con
 * sus destinatarios elegibles y el proceso automático los revalida uno por uno. No existe envío real: el canal
 * exige C01.2 (baja accesible al destinatario y autorización del propietario).
 */
@Injectable()
export class CampanaEjecucionService {
 constructor(private readonly source:DataSource,private readonly consent:CampanaConsentimientoService){}

 list(idCampana:number,actor:JwtPayload){return this.consent.read(actor,async db=>{
  const [c]=await queryRows(db,'SELECT id_campana FROM crm_campana WHERE id_campana=$1',[idCampana]);if(!c)throw new NotFoundException('Campaña no encontrada');
  return queryRows(db,`SELECT e.id_ejecucion AS id,e.id_preparacion AS "idPreparacion",e.modo,e.canal,e.estado,e.motivo,e.creada_en AS "creadaEn",e.terminada_en AS "terminadaEn",
    e.motivo_cierre AS "motivoCierre",u.username AS autor,
    count(d.*)::int AS total,count(d.*) FILTER(WHERE d.estado='Pendiente')::int AS pendientes,count(d.*) FILTER(WHERE d.estado='Simulado')::int AS simulados,
    count(d.*) FILTER(WHERE d.estado='Omitido')::int AS omitidos,count(d.*) FILTER(WHERE d.estado='Cancelado')::int AS cancelados,
    coalesce((SELECT jsonb_object_agg(motivo,n) FROM (SELECT motivo,count(*)::int n FROM crm_campana_ejecucion_destino WHERE id_ejecucion=e.id_ejecucion AND estado='Omitido' GROUP BY motivo) m),'{}'::jsonb) AS motivos
   FROM crm_campana_ejecucion e JOIN auth_user u ON u.id_user=e.id_user LEFT JOIN crm_campana_ejecucion_destino d ON d.id_ejecucion=e.id_ejecucion
   WHERE e.id_campana=$1 GROUP BY e.id_ejecucion,u.username ORDER BY e.id_ejecucion DESC LIMIT 20`,[idCampana]);
 });}

 start(idCampana:number,dto:StartCampaignSimulationDto,actor:JwtPayload){const request=dto.requestId.toLowerCase(),huella=quoteHash({idCampana,...dto,requestId:request});
  return this.consent.write(actor,async db=>{
   const [old]=await queryRows<{id:number;huella:string}>(db,'SELECT id_ejecucion AS id,huella FROM crm_campana_ejecucion WHERE request_id=$1',[request]);
   if(old){if(old.huella!==huella)throw new ConflictException('El UUID identifica otra operación.');return{id:old.id,repetida:true};}
   const [p]=await queryRows<{id:number;evaluacionSha256:string;snapshot:{destinatarios:Array<{idCliente:number;idContacto:number;destinoHash:string|null;motivo:string;consentimiento:number|null}>}}>(db,
    `SELECT id_preparacion AS id,evaluacion_sha256 AS "evaluacionSha256",snapshot FROM crm_campana_preparacion WHERE id_campana=$1 ORDER BY id_preparacion DESC LIMIT 1`,[idCampana]);
   if(!p||p.id!==dto.idPreparacion)throw new ConflictException('Usa la preparación más reciente de la campaña.');
   const e=await this.consent.evaluate(db,idCampana);
   if(e.blockers.length)throw new ConflictException(e.blockers.join(' '));
   if(e.evaluacionSha256!==p.evaluacionSha256)throw new ConflictException('La preparación ya no coincide con los destinatarios actuales. Revisa y conserva una nueva.');
   const [enCurso]=await queryRows(db,"SELECT 1 FROM crm_campana_ejecucion WHERE id_campana=$1 AND estado='En curso'",[idCampana]);
   if(enCurso)throw new ConflictException('La campaña ya tiene una simulación en curso.');
   const elegibles=p.snapshot.destinatarios.filter(d=>d.motivo==='Elegible'&&d.destinoHash&&d.consentimiento);
   if(!elegibles.length)throw new ConflictException('La preparación no tiene destinatarios elegibles.');
   const [saved]=await queryRows<{id:number}>(db,`INSERT INTO crm_campana_ejecucion(id_campana,id_preparacion,request_id,huella,canal,plantilla_sha256,motivo,id_user)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_ejecucion AS id`,[idCampana,p.id,request,huella,e.campaign.canal,plantillaHash(e.campaign.asunto,e.campaign.contenido),dto.motivo,actor.idUser]);
   await db.query(`INSERT INTO crm_campana_ejecucion_destino(id_ejecucion,id_contacto,id_cliente,destino_hash,id_consentimiento)
    SELECT $1,x.c,x.cl,x.h,x.k FROM unnest($2::int[],$3::int[],$4::text[],$5::int[]) AS x(c,cl,h,k)`,
   [saved.id,elegibles.map(d=>d.idContacto),elegibles.map(d=>d.idCliente),elegibles.map(d=>d.destinoHash),elegibles.map(d=>d.consentimiento)]);
   return{id:saved.id,repetida:false,destinatarios:elegibles.length};
  });
 }

 cancel(idCampana:number,idEjecucion:number,dto:CancelCampaignSimulationDto,actor:JwtPayload){return this.consent.write(actor,async db=>{
  const [e]=await queryRows<{estado:string}>(db,'SELECT estado FROM crm_campana_ejecucion WHERE id_ejecucion=$1 AND id_campana=$2 FOR UPDATE',[idEjecucion,idCampana]);
  if(!e)throw new NotFoundException('Simulación no encontrada');
  if(e.estado!=='En curso')throw new ConflictException(`La simulación ya está ${e.estado.toLowerCase()}.`);
  const pendientes=await queryRows(db,`UPDATE crm_campana_ejecucion_destino SET estado='Cancelado',motivo='Cancelada por usuario',procesado_en=clock_timestamp()
   WHERE id_ejecucion=$1 AND estado='Pendiente' RETURNING id_contacto`,[idEjecucion]);
  await db.query(`UPDATE crm_campana_ejecucion SET estado='Cancelada',terminada_en=clock_timestamp(),motivo_cierre=$2,id_user_cierre=$3 WHERE id_ejecucion=$1`,[idEjecucion,dto.motivo,actor.idUser]);
  return{id:idEjecucion,cancelados:pendientes.length};
 });}

 /** ¿Hay simulaciones con destinatarios pendientes? */
 async hayPendientes(){const [r]=await queryRows<{hay:boolean}>(this.source,"SELECT EXISTS(SELECT 1 FROM crm_campana_ejecucion WHERE estado='En curso') AS hay");return Boolean(r?.hay);}

 /** Un ciclo del proceso automático: hasta LOTE destinatarios, serializado con las decisiones de consentimiento. */
 procesar(){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='30s'");
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[consentLock]);
  const ejecuciones=await queryRows<Ejecucion>(db,`SELECT id_ejecucion AS id,id_campana AS "idCampana",canal,plantilla_sha256 AS "plantillaSha256"
   FROM crm_campana_ejecucion WHERE estado='En curso' ORDER BY id_ejecucion FOR UPDATE SKIP LOCKED`);
  let simulados=0,omitidos=0,terminadas=0,restante=LOTE;
  for(const e of ejecuciones){
   const r=await this.procesarEjecucion(db,e,restante);simulados+=r.simulados;omitidos+=r.omitidos;restante-=r.simulados+r.omitidos;
   if(r.terminada)terminadas++;if(restante<=0)break;
  }
  return{simulados,omitidos,terminadas};
 });}

 private async procesarEjecucion(db:EntityManager,e:Ejecucion,limite:number){
  const [c]=await queryRows<{estado:string;asunto:string|null;contenido:string|null;activa:boolean|null;canal:string|null}>(db,
   `SELECT c.estado,p.asunto,p.contenido,p.activa,p.canal FROM crm_campana c LEFT JOIN crm_plantilla p USING(id_plantilla) WHERE c.id_campana=$1`,[e.idCampana]);
  // Cambios en la campaña invalidan lo que falta: no se simula con otra plantilla ni en una campaña cerrada.
  const bloqueo=!c||c.estado==='Cancelada'||c.estado==='Finalizada'?'Campaña cerrada'
   :!c.activa||c.canal!==e.canal||plantillaHash(c.asunto,c.contenido)!==e.plantillaSha256?'Plantilla cambiada':null;
  if(bloqueo){
   const rows=await queryRows(db,`UPDATE crm_campana_ejecucion_destino SET estado='Omitido',motivo=$2,procesado_en=clock_timestamp() WHERE id_ejecucion=$1 AND estado='Pendiente' RETURNING id_contacto`,[e.id,bloqueo]);
   await db.query(`UPDATE crm_campana_ejecucion SET estado='Terminada',terminada_en=clock_timestamp(),motivo_cierre=$2 WHERE id_ejecucion=$1`,[e.id,bloqueo]);
   return{simulados:0,omitidos:rows.length,terminada:true};
  }
  const items=await queryRows<{idContacto:number;idCliente:number;destinoHash:string}>(db,`SELECT id_contacto AS "idContacto",id_cliente AS "idCliente",destino_hash AS "destinoHash"
   FROM crm_campana_ejecucion_destino WHERE id_ejecucion=$1 AND estado='Pendiente' ORDER BY id_contacto LIMIT $2`,[e.id,limite]);
  const ids=items.map(i=>i.idContacto);
  const contactos=await queryRows<{id:number;idCliente:number;nombre:string;email:string|null;telefono:string|null;cliente:string}>(db,
   `SELECT a.id_contacto AS id,a.id_cliente AS "idCliente",a.nombre,a.email,a.telefono,c."RazonSocial" AS cliente FROM cliente_contacto a JOIN cliente c ON c."IdCliente"=a.id_cliente WHERE a.id_contacto=ANY($1::int[])`,[ids]);
  const ultimos=await this.consent.latest(db,ids,e.canal),bajas=await this.consent.blocked(db,items.map(i=>i.destinoHash),e.canal);
  const [{ahora}]=await queryRows<{ahora:Date}>(db,'SELECT clock_timestamp() AS ahora');
  let simulados=0,omitidos=0;
  for(const item of items){
   const contacto=contactos.find(x=>x.id===item.idContacto)??null;
   const decision=decidirDestinatario({contacto,idCliente:item.idCliente,canal:e.canal,destinoHash:item.destinoHash,bajas,ultimo:ultimos.find(u=>u.id_contacto===item.idContacto),ahora});
   if(decision==='Simulado'){
    const m=mensajeCampana(c.asunto,c.contenido,{nombre:contacto!.nombre,cliente:contacto!.cliente});
    await db.query(`UPDATE crm_campana_ejecucion_destino SET estado='Simulado',mensaje_sha256=$3,procesado_en=clock_timestamp() WHERE id_ejecucion=$1 AND id_contacto=$2`,[e.id,item.idContacto,sha(JSON.stringify([e.canal,item.destinoHash,m.asunto,m.contenido]))]);
    simulados++;
   }else{
    await db.query(`UPDATE crm_campana_ejecucion_destino SET estado='Omitido',motivo=$3,procesado_en=clock_timestamp() WHERE id_ejecucion=$1 AND id_contacto=$2`,[e.id,item.idContacto,decision]);
    omitidos++;
   }
  }
  const [{quedan}]=await queryRows<{quedan:boolean}>(db,"SELECT EXISTS(SELECT 1 FROM crm_campana_ejecucion_destino WHERE id_ejecucion=$1 AND estado='Pendiente') AS quedan",[e.id]);
  if(!quedan)await db.query(`UPDATE crm_campana_ejecucion SET estado='Terminada',terminada_en=clock_timestamp() WHERE id_ejecucion=$1`,[e.id]);
  return{simulados,omitidos,terminada:!quedan};
 }
}
