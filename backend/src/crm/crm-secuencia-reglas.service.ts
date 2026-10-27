import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor,queryRows,readSnapshot } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { CrmSecuenciasService } from './crm-secuencias.service';
import { SecuenciaPasoDto,SecuenciaQuery } from './crm-secuencias.dto';
import { SecuenciaAplicarDto,SecuenciaReglaDto } from './crm-secuencia-reglas.dto';
export interface SequenceRule {id:string;nombre:string;idModelo:string;modelo:string;etapa:string;eventoDesde:string;creadaEn:Date;pasos:SecuenciaPasoDto[];}
export interface RuleCandidate {id:string;idOportunidad:number;empresa:string;cliente:string|null;idCliente:number|null;idResponsable:number|null;responsable:string|null;version:number;fecha:Date;estado:string;tipoEvento:string;}
const fields=`r.id_regla AS id,r.nombre,r.id_modelo AS "idModelo",m.nombre AS modelo,m.pasos,r.etapa,r.evento_desde::text AS "eventoDesde",r.creada_en AS "creadaEn"`;
const candidates=`SELECT e.id_evento::text AS id,e.id_oportunidad AS "idOportunidad",o.empresa,c."RazonSocial" AS cliente,e.id_cliente AS "idCliente",e.id_responsable AS "idResponsable",u.username AS responsable,o.version,e.creada_en AS fecha,e.tipo AS "tipoEvento",
 CASE WHEN EXISTS(SELECT 1 FROM crm_secuencia_aplicacion a WHERE a.id_evento=e.id_evento AND a.id_modelo=r.id_modelo) THEN 'Ya procesado'
 WHEN e.id_cliente IS NULL THEN 'Sin cliente' WHEN e.id_responsable IS NULL THEN 'Sin responsable'
 WHEN NOT u.is_active THEN 'Responsable inactivo'
 WHEN o.etapa IS DISTINCT FROM e.etapa OR o.id_cliente IS DISTINCT FROM e.id_cliente OR o.id_responsable IS DISTINCT FROM e.id_responsable THEN 'Origen modificado'
 WHEN EXISTS(SELECT 1 FROM crm_etapa_evento newer WHERE newer.id_oportunidad=e.id_oportunidad AND newer.id_evento>e.id_evento) THEN 'Evento sustituido'
 WHEN EXISTS(SELECT 1 FROM crm_secuencia s WHERE s.id_modelo=r.id_modelo AND s.id_cliente=e.id_cliente AND s.estado IN('Activa','Pausada')) THEN 'Seguimiento abierto'
 ELSE 'Elegible' END AS estado
 FROM crm_secuencia_regla r JOIN crm_etapa_evento e ON e.etapa=r.etapa AND e.id_evento>r.evento_desde AND e.creada_en>=r.creada_en
 JOIN crm_oportunidad o ON o.id_oportunidad=e.id_oportunidad LEFT JOIN cliente c ON c."IdCliente"=e.id_cliente LEFT JOIN auth_user u ON u.id_user=e.id_responsable WHERE r.id_regla=$1`;
@Injectable()
export class CrmSecuenciaReglasService {
 constructor(private readonly source:DataSource,private readonly sequences:CrmSecuenciasService){}
 private async staff(db:QueryExecutor,actor:JwtPayload,write=false){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role='admin' AND role=$2 AND token_version=$3 AND fn_effective_permission(id_user,role,'crm.secuencias.gestionar') ${write?'FOR SHARE':''}`,[actor.idUser??null,actor.role,actor.version]);
  if(!u)throw new ForbiddenException('Las reglas requieren administrador activo con permiso de secuencias.');if(write)await setAuditActor(db,actor.idUser);
 }
 private read<T>(actor:JwtPayload,work:(db:QueryExecutor)=>Promise<T>){return readSnapshot(this.source,async db=>{await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);return work(db);});}
 private pattern(q:string){return q?'%'+q.replace(/[\\%_]/g,'\\$&')+'%':'';}
 private async rule(db:QueryExecutor,id:string){const [r]=await queryRows<SequenceRule>(db,`SELECT ${fields} FROM crm_secuencia_regla r JOIN crm_secuencia_modelo m USING(id_modelo) WHERE r.id_regla=$1`,[id]);if(!r)throw new NotFoundException('Regla no encontrada');return r;}
 list(query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const q=this.pattern(query.q),[count]=await queryRows<{total:number}>(db,"SELECT count(*)::int total FROM crm_secuencia_regla WHERE ($1='' OR nombre ILIKE $1)",[q]);
  const data=await queryRows<SequenceRule>(db,`SELECT ${fields} FROM crm_secuencia_regla r JOIN crm_secuencia_modelo m USING(id_modelo) WHERE ($1='' OR r.nombre ILIKE $1) ORDER BY r.creada_en DESC,r.id_regla LIMIT 20 OFFSET $2`,[q,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 create(dto:SecuenciaReglaDto,actor:JwtPayload){const id=dto.requestId.toLowerCase(),hash=quoteHash({actor:actor.idUser,nombre:dto.nombre,idModelo:dto.idModelo,etapa:dto.etapa});return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-secuencias:v1',0))");await this.staff(db,actor,true);
  const [old]=await queryRows<{huella:string;id_creador:number}>(db,'SELECT huella,id_creador FROM crm_secuencia_regla WHERE id_regla=$1',[id]);if(old){if(old.huella!==hash||old.id_creador!==actor.idUser)throw new ConflictException('El UUID identifica otra regla.');return{id};}
  const [model]=await queryRows(db,'SELECT id_modelo FROM crm_secuencia_modelo WHERE id_modelo=$1',[dto.idModelo]);if(!model)throw new NotFoundException('Modelo no encontrado');
  await db.query('INSERT INTO crm_secuencia_regla(id_regla,nombre,id_modelo,etapa,evento_desde,id_creador,huella) SELECT $1,$2,$3,$4,coalesce(max(id_evento),0),$5,$6 FROM crm_etapa_evento',[id,dto.nombre,dto.idModelo,dto.etapa,actor.idUser,hash]);return{id};
 });}
 private project(rule:SequenceRule,row:RuleCandidate){return{...row,evaluacionSha256:quoteHash({regla:rule.id,modelo:rule.idModelo,evento:row.id,cliente:row.idCliente,responsable:row.idResponsable,version:row.version,estado:row.estado})};}
 preview(id:string,query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const rule=await this.rule(db,id),q=this.pattern(query.q),base=`WITH candidates AS (${candidates})`;
  const metrics=await queryRows<{estado:string;total:number}>(db,`${base} SELECT estado,count(*)::int total FROM candidates GROUP BY estado ORDER BY estado`,[id]);
  const where="WHERE ($2='' OR concat_ws(' ',empresa,cliente,responsable,estado) ILIKE $2)",[count]=await queryRows<{total:number}>(db,`${base} SELECT count(*)::int total FROM candidates ${where}`,[id,q]);
  const rows=await queryRows<RuleCandidate>(db,`${base} SELECT * FROM candidates ${where} ORDER BY id::bigint DESC LIMIT 20 OFFSET $3`,[id,q,(query.page-1)*20]);
  return{regla:rule,metricas:metrics,data:rows.map(r=>this.project(rule,r)),total:count.total,page:query.page};
 });}
 history(id:string,query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  await this.rule(db,id);const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM crm_secuencia_aplicacion WHERE id_regla=$1',[id]);
  const data=await queryRows(db,`SELECT a.request_id AS id,a.id_evento::text AS "idEvento",a.id_secuencia AS "idSecuencia",a.motivo,a.creada_en AS fecha,u.username AS actor,s.estado,c."RazonSocial" AS cliente FROM crm_secuencia_aplicacion a JOIN auth_user u ON u.id_user=a.id_actor JOIN crm_secuencia s ON s.id_secuencia=a.id_secuencia JOIN cliente c ON c."IdCliente"=s.id_cliente WHERE a.id_regla=$1 ORDER BY a.creada_en DESC,a.request_id LIMIT 20 OFFSET $2`,[id,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 apply(id:string,dto:SecuenciaAplicarDto,actor:JwtPayload){
  if(BigInt(dto.idEvento)>9223372036854775807n)throw new BadRequestException('El evento está fuera del rango permitido.');
  const request=dto.requestId.toLowerCase(),hash=quoteHash({id,actor:actor.idUser,...dto,requestId:request});
  return this.source.transaction(async db=>{
   await db.query("SET LOCAL statement_timeout='10s'");await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-secuencias:v1',0))");await this.staff(db,actor);
   const rule=await this.rule(db,id),[old]=await queryRows<{huella:string;id_actor:number;id:string}>(db,'SELECT huella,id_actor,id_secuencia AS id FROM crm_secuencia_aplicacion WHERE request_id=$1',[request]);
   if(old){if(old.huella!==hash||old.id_actor!==actor.idUser)throw new ConflictException('El UUID identifica otra aplicación.');return{id:old.id};}
   const [source]=await queryRows<{id:number}>(db,`SELECT o.id_oportunidad AS id FROM crm_oportunidad o JOIN crm_etapa_evento e ON e.id_oportunidad=o.id_oportunidad WHERE e.id_evento=$1::bigint FOR UPDATE OF o`,[dto.idEvento]);if(!source)throw new NotFoundException('Evento no encontrado');
   await this.staff(db,actor,true);
   let [candidate]=await queryRows<RuleCandidate>(db,`${candidates} AND e.id_evento=$2::bigint`,[id,dto.idEvento]);if(!candidate)throw new NotFoundException('Evento fuera del alcance de esta regla');
   if(candidate.idResponsable)await db.query('SELECT id_user FROM auth_user WHERE id_user=$1 FOR SHARE',[candidate.idResponsable]);
   [candidate]=await queryRows<RuleCandidate>(db,`${candidates} AND e.id_evento=$2::bigint`,[id,dto.idEvento]);
   if(candidate.estado!=='Elegible')throw new ConflictException('No se puede iniciar: '+candidate.estado+'.');
   if(this.project(rule,candidate).evaluacionSha256!==dto.evaluacionSha256)throw new ConflictException('La evaluación cambió; actualiza y revisa el evento otra vez.');
   const saved=await this.sequences.startInTransaction(db,{requestId:request,idModelo:rule.idModelo,idCliente:candidate.idCliente!,idResponsable:candidate.idResponsable!,motivo:dto.motivo,confirmacion:true},actor);
   await db.query('INSERT INTO crm_secuencia_aplicacion(request_id,id_regla,id_evento,id_modelo,id_secuencia,id_actor,motivo,evaluacion_sha256,huella) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[request,id,dto.idEvento,rule.idModelo,saved.id,actor.idUser,dto.motivo,dto.evaluacionSha256,hash]);return saved;
  });
 }
}
