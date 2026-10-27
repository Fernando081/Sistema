import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { RolUsuario } from '../common/enums/app.enums';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { runScheduledJob } from '../common/scheduled-job';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { CrmBandejaService } from './crm-bandeja.service';
import { CrmReporteControlDto, CrmReporteCrearDto } from './crm-reportes.dto';
import { CrmReportesColaService } from './crm-reportes-cola.service';
export interface Programa {
 id:string; nombre:string; idPropietario:number; frecuencia:'Diaria'|'Semanal'; hora:number; minuto:number;
 dia:number|null; tipo:string; plazo:string; activa:boolean; version:number; zona:string; creadaEn:Date; vigenteDesde:Date;
}
export interface ReporteSnapshot {
 version:1; consultadoEn:string; zonaHoraria:string; tipo:string; plazo:string; total:number;
 resumen:{vencidas:number;hoy:number;proximas:number;sinFecha:number};
}
export interface Resultado { id:string; programadaEn:Date; generadaEn:Date; estado:'Generado'|'Error'; snapshot:ReporteSnapshot|null; codigo:string|null;
 reintento:{estado:string;intentos:number;version:number;disponibleEn:string;eventos:{intento:number;fase:string;codigo:string|null;creadaEn:string}[]}|null;
 recuperacion:{generadaEn:string;snapshot:ReporteSnapshot}|null;
}
const fields=`p.id_programa AS id,p.nombre,p.id_propietario AS "idPropietario",p.frecuencia,p.hora,p.minuto,p.dia,p.tipo,p.plazo,p.activa,p.version,p.zona,p.creada_en AS "creadaEn",p.vigente_desde AS "vigenteDesde"`;
const slot=`((($1::timestamptz AT TIME ZONE p.zona)::date)::timestamp+make_interval(hours=>p.hora,mins=>p.minuto)) AT TIME ZONE p.zona`;
const due=`p.activa AND s.at>=p.vigente_desde AND s.at<=$1::timestamptz AND
 (p.frecuencia='Diaria' OR p.dia=extract(isodow FROM $1::timestamptz AT TIME ZONE p.zona))`;
const permission=`is_active AND role='admin' AND fn_effective_permission(id_user,role,'crm.reportes.programar')`;
@Injectable()
export class CrmReportesService {
 private readonly logger=new Logger(CrmReportesService.name);
 constructor(private readonly source:DataSource,private readonly inbox:CrmBandejaService,private readonly queue:CrmReportesColaService){}
 private async staff(db:QueryExecutor,actor:JwtPayload,lock=false){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND token_version=$2 AND $3::text='admin' AND ${permission} ${lock?'FOR SHARE':''}`,[actor.idUser,actor.version,actor.role]);
  if(!u)throw new ForbiddenException('Tu cuenta o permiso de reportes cambió.');
 }
 private read<T>(actor:JwtPayload,work:(db:QueryExecutor)=>Promise<T>){return readSnapshot(this.source,async db=>{
  await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);return work(db);
 });}
 list(page:number,actor:JwtPayload){return this.read(actor,async db=>{
  const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM crm_reporte_programa WHERE id_propietario=$1',[actor.idUser]);
  const data=await queryRows<Programa>(db,`SELECT ${fields} FROM crm_reporte_programa p WHERE p.id_propietario=$1 ORDER BY p.creada_en DESC,p.id_programa LIMIT 20 OFFSET $2`,[actor.idUser,(page-1)*20]);return{data,total:count.total,page};
 });}
 history(id:string,page:number,actor:JwtPayload){return this.read(actor,async db=>{
  const [programa]=await queryRows<Programa>(db,`SELECT ${fields} FROM crm_reporte_programa p WHERE p.id_programa=$1 AND p.id_propietario=$2`,[id,actor.idUser]);
  if(!programa)throw new NotFoundException('Programación no encontrada.');
  const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM crm_reporte_resultado WHERE id_programa=$1',[id]);
  const data=await queryRows<Resultado>(db,`SELECT r.id_resultado AS id,r.programada_en AS "programadaEn",r.generada_en AS "generadaEn",r.estado,r.snapshot,r.codigo,
   CASE WHEN q.id_resultado IS NOT NULL THEN jsonb_build_object('estado',q.estado,'intentos',q.intentos,'version',q.version,'disponibleEn',q.disponible_en,
     'eventos',(SELECT coalesce(jsonb_agg(jsonb_build_object('intento',e.intento,'fase',e.fase,'codigo',e.codigo,'creadaEn',e.creada_en) ORDER BY e.creada_en,e.id),'[]'::jsonb) FROM crm_reporte_intento_evento e WHERE e.id_resultado=r.id_resultado)) END AS reintento,
   CASE WHEN c.id_resultado IS NOT NULL THEN jsonb_build_object('generadaEn',c.generada_en,'snapshot',c.snapshot) END AS recuperacion
   FROM crm_reporte_resultado r LEFT JOIN crm_reporte_reintento q ON q.id_resultado=r.id_resultado
   LEFT JOIN crm_reporte_recuperacion c ON c.id_resultado=r.id_resultado
   WHERE r.id_programa=$1 ORDER BY r.programada_en DESC,r.id_resultado LIMIT 20 OFFSET $2`,[id,(page-1)*20]);return{programa,data,total:count.total,page};
 });}
 create(dto:CrmReporteCrearDto,actor:JwtPayload){
  if(dto.frecuencia==='Semanal'?!dto.dia:dto.dia!=null)throw new BadRequestException('Indica día sólo para frecuencia semanal.');
  const id=dto.requestId.toLowerCase(),huella=quoteHash({actor:actor.idUser,...dto,requestId:id,dia:dto.dia??null});
  return this.source.transaction(async db=>{
   await db.query("SET LOCAL statement_timeout='10s'");await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-reportes:'||$1::text,0))",[actor.idUser]);await this.staff(db,actor,true);
   const [old]=await queryRows<{huella:string}>(db,'SELECT huella FROM crm_reporte_programa WHERE id_programa=$1',[id]);
   if(old){if(old.huella!==huella)throw new ConflictException('El identificador corresponde a otra programación.');return{id};}
   const [count]=await queryRows<{n:number}>(db,'SELECT count(*)::int n FROM crm_reporte_programa WHERE id_propietario=$1',[actor.idUser]);
   if(count.n>=50)throw new ConflictException('Máximo50 programaciones conservadas por usuario.');
   await setAuditActor(db,actor.idUser);
   await db.query(`INSERT INTO crm_reporte_programa(id_programa,nombre,id_propietario,frecuencia,hora,minuto,dia,tipo,plazo,huella) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,dto.nombre,actor.idUser,dto.frecuencia,dto.hora,dto.minuto,dto.dia??null,dto.tipo,dto.plazo,huella]);return{id};
  });
 }
 control(id:string,dto:CrmReporteControlDto,actor:JwtPayload){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");
  const [p]=await queryRows<Programa>(db,`SELECT ${fields} FROM crm_reporte_programa p WHERE p.id_programa=$1 AND p.id_propietario=$2 FOR UPDATE`,[id,actor.idUser]);
  if(!p)throw new NotFoundException('Programación no encontrada.');await this.staff(db,actor,true);
  if(p.version!==dto.expectedVersion)throw new ConflictException('La programación cambió; actualiza antes de continuar.');
  if(p.activa===dto.activa)return{id,version:p.version};await setAuditActor(db,actor.idUser);
  await db.query('UPDATE crm_reporte_programa SET activa=$2,version=version+1 WHERE id_programa=$1',[id,dto.activa]);return{id,version:p.version+1};
 });}
 @Cron('0 */10 * * * *')
 async scheduled(){
  try{return await runScheduledJob(this.source,'crm_reports',async()=>{
   let failed=false;try{await this.generateDue();}catch{failed=true;}
   try{await this.queue.processDue();}catch{failed=true;}
   if(failed)throw new Error('No se completaron todos los reportes o reintentos.');
  },m=>this.logger.error(m));}
  catch{this.logger.error('Falló la generación programada de reportes comerciales');return'failed';}
 }
 // Reloj inyectable sólo desde verificadores internos; no hay ruta HTTP de ejecución.
 async generateDue(at=new Date()){
  const candidates=await queryRows<{id:string}>(this.source,`SELECT p.id_programa AS id FROM crm_reporte_programa p JOIN auth_user u ON u.id_user=p.id_propietario
   CROSS JOIN LATERAL(SELECT ${slot} AS at)s WHERE ${due} AND u.is_active AND u.role='admin' AND fn_effective_permission(u.id_user,u.role,'crm.reportes.programar')
   AND NOT EXISTS(SELECT 1 FROM crm_reporte_resultado r WHERE r.id_programa=p.id_programa AND r.programada_en=s.at) ORDER BY s.at,p.id_programa LIMIT 50`,[at]);
  let failed=false;
  for(const p of candidates){try{await this.generateOne(p.id,at);}catch{await this.recordFailure(p.id,at);failed=true;}}
  if(failed)throw new Error('No se pudieron generar todos los reportes.');
 }
 private async eligible(db:QueryExecutor,id:string,at:Date){
  const [p]=await queryRows<Programa>(db,`SELECT ${fields} FROM crm_reporte_programa p WHERE p.id_programa=$1 FOR UPDATE`,[id]);
  if(!p)return null;
  const [dueAt]=await queryRows<{at:Date}>(db,`SELECT s.at FROM crm_reporte_programa p CROSS JOIN LATERAL(SELECT ${slot} AS at)s WHERE p.id_programa=$2 AND ${due}`,[at,id]);
  if(!dueAt)return null;
  const [user]=await queryRows<{version:number}>(db,`SELECT token_version AS version FROM auth_user WHERE id_user=$1 AND ${permission} FOR SHARE`,[p.idPropietario]);
  if(!user)return null;
  return {p,at:dueAt.at,actor:{idUser:p.idPropietario,role:RolUsuario.ADMIN,version:user.version,sub:'scheduled-report',iat:0,exp:0,iss:'sistema-erp',aud:'sistema-web'} satisfies JwtPayload};
 }
 private async generateOne(id:string,at:Date){return this.source.transaction('REPEATABLE READ',async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");const e=await this.eligible(db,id,at);if(!e)return;
  if((await queryRows(db,'SELECT 1 FROM crm_reporte_resultado WHERE id_programa=$1 AND programada_en=$2',[id,e.at])).length)return;
  const r=await this.inbox.inSnapshot({page:1,q:'',tipo:e.p.tipo,plazo:e.p.plazo},e.actor,db);
  const snapshot:ReporteSnapshot={version:1,consultadoEn:r.consultadoEn,zonaHoraria:r.zonaHoraria,tipo:e.p.tipo,plazo:e.p.plazo,total:r.total,resumen:r.resumen};
  await db.query("INSERT INTO crm_reporte_resultado(id_programa,programada_en,estado,snapshot) VALUES($1,$2,'Generado',$3::jsonb)",[id,e.at,JSON.stringify(snapshot)]);
 });}
 private recordFailure(id:string,at:Date){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='8s'");const e=await this.eligible(db,id,at);if(!e)return;
  const [r]=await queryRows<{id:string}>(db,"INSERT INTO crm_reporte_resultado(id_programa,programada_en,estado,codigo) VALUES($1,$2,'Error','GENERACION_FALLIDA') ON CONFLICT(id_programa,programada_en) DO NOTHING RETURNING id_resultado AS id",[id,e.at]);
  if(r)await this.queue.enqueue(db,r.id);
 });}
}
