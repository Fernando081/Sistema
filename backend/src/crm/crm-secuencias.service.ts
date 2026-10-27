import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { DataSource,EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { RolUsuario } from '../common/enums/app.enums';
import { QueryExecutor,queryRows,readSnapshot } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { CrmActividadService } from './crm-actividad.service';
import { SecuenciaControlDto,SecuenciaInicioDto,SecuenciaModeloDto,SecuenciaPasoDto,SecuenciaQuery,SecuenciaTransicionDto } from './crm-secuencias.dto';
export interface Model {id:string;nombre:string;pasos:SecuenciaPasoDto[];huella:string;id_creador:number;}
export interface Run {id:string;idModelo:string;nombre:string;cliente:string;idCliente:number;idResponsable:number;responsable:string;idCreador:number;estado:string;pasoActual:number;totalPasos:number;creadaEn:Date;cerradaEn:Date|null;motivo:string;version:number;pausadaEn:Date|null;}
const fields=`s.id_secuencia AS id,s.id_modelo AS "idModelo",m.nombre,c."RazonSocial" AS cliente,s.id_cliente AS "idCliente",s.id_responsable AS "idResponsable",u.username AS responsable,s.id_creador AS "idCreador",s.estado,s.paso_actual AS "pasoActual",jsonb_array_length(m.pasos) AS "totalPasos",s.creada_en AS "creadaEn",s.cerrada_en AS "cerradaEn",s.motivo,s.version,s.pausada_en AS "pausadaEn"`;
const joins='FROM crm_secuencia s JOIN crm_secuencia_modelo m USING(id_modelo) JOIN cliente c ON c."IdCliente"=s.id_cliente JOIN auth_user u ON u.id_user=s.id_responsable';
@Injectable()
export class CrmSecuenciasService {
 constructor(private readonly source:DataSource,private readonly activity:CrmActividadService){}
 private async staff(db:QueryExecutor,actor:JwtPayload,write=false){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3 AND fn_effective_permission(id_user,role,'crm.secuencias.gestionar') ${write?'FOR SHARE':''}`,[actor.idUser??null,actor.role,actor.version]);
  if(!u)throw new ForbiddenException('Tu cuenta o permiso de secuencias cambió.');if(write)await setAuditActor(db,actor.idUser);
 }
 private read<T>(actor:JwtPayload,work:(db:QueryExecutor)=>Promise<T>){return readSnapshot(this.source,async db=>{await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);return work(db);});}
 private write<T>(actor:JwtPayload,work:(db:EntityManager)=>Promise<T>){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-secuencias:v1',0))");await this.staff(db,actor,true);return work(db);
 });}
 private pattern(q:string){return q?'%'+q.replace(/[\\%_]/g,'\\$&')+'%':'';}
 models(query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const q=this.pattern(query.q),[count]=await queryRows<{total:number}>(db,"SELECT count(*)::int total FROM crm_secuencia_modelo WHERE ($1='' OR nombre ILIKE $1)",[q]);
  const data=await queryRows<Model>(db,"SELECT id_modelo AS id,nombre,pasos FROM crm_secuencia_modelo WHERE ($1='' OR nombre ILIKE $1) ORDER BY creada_en DESC,id_modelo LIMIT 20 OFFSET $2",[q,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 createModel(dto:SecuenciaModeloDto,actor:JwtPayload){const id=dto.requestId.toLowerCase(),hash=quoteHash({actor:actor.idUser,nombre:dto.nombre,pasos:dto.pasos});return this.write(actor,async db=>{
  const [old]=await queryRows<Model>(db,'SELECT id_modelo AS id,huella,id_creador FROM crm_secuencia_modelo WHERE id_modelo=$1',[id]);
  if(old){if(old.huella!==hash||old.id_creador!==actor.idUser)throw new ConflictException('El UUID identifica otro modelo.');return{id};}
  await db.query('INSERT INTO crm_secuencia_modelo(id_modelo,nombre,pasos,id_creador,huella) VALUES($1,$2,$3::jsonb,$4,$5)',[id,dto.nombre,JSON.stringify(dto.pasos),actor.idUser,hash]);return{id};
 });}
 clients(query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const q=this.pattern(query.q),[count]=await queryRows<{total:number}>(db,`SELECT count(*)::int total FROM cliente WHERE ($1='' OR concat_ws(' ',"RazonSocial","RFC") ILIKE $1)`,[q]);
  const data=await queryRows(db,`SELECT "IdCliente" AS id,"RazonSocial" AS nombre,"RFC" AS rfc FROM cliente WHERE ($1='' OR concat_ws(' ',"RazonSocial","RFC") ILIKE $1) ORDER BY "IdCliente" DESC LIMIT 20 OFFSET $2`,[q,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 runs(query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const args=[actor.role===RolUsuario.ADMIN,actor.idUser,this.pattern(query.q)],where=`WHERE ($1 OR s.id_responsable=$2 OR s.id_creador=$2) AND ($3='' OR concat_ws(' ',m.nombre,c."RazonSocial",s.estado) ILIKE $3)`;
  const [count]=await queryRows<{total:number}>(db,`SELECT count(*)::int total ${joins} ${where}`,args);
  const data=await queryRows<Run>(db,`SELECT ${fields} ${joins} ${where} ORDER BY s.creada_en DESC,s.id_secuencia LIMIT 20 OFFSET $4`,[...args,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 private async run(db:QueryExecutor,id:string,actor:JwtPayload){const [row]=await queryRows<Run>(db,`SELECT ${fields} ${joins} WHERE s.id_secuencia=$1 AND ($2 OR s.id_responsable=$3 OR s.id_creador=$3)`,[id,actor.role===RolUsuario.ADMIN,actor.idUser]);if(!row)throw new NotFoundException('Secuencia no encontrada');return row;}
 detail(id:string,actor:JwtPayload){return this.read(actor,async db=>{
  const run=await this.run(db,id,actor);
  const [{pasos}]=await queryRows<Model>(db,'SELECT pasos FROM crm_secuencia_modelo WHERE id_modelo=$1',[run.idModelo]);
  const tasks=await queryRows<{id:string;paso:number;estado:string;version:number;venceEn:Date}>(db,'SELECT id_tarea::text AS id,paso_secuencia AS paso,estado,version,fecha_vencimiento AS "venceEn" FROM crm_tarea WHERE id_secuencia=$1 ORDER BY paso_secuencia',[id]);
  const events=await queryRows(db,`SELECT e.id_evento::text AS id,e.evento,e.paso,e.creada_en AS fecha,u.username AS actor FROM crm_secuencia_evento e JOIN auth_user u ON u.id_user=e.id_actor WHERE id_secuencia=$1 ORDER BY id_evento`,[id]);
  const [origin]=await queryRows<{idRegla:string;regla:string;empresa:string;etapa:string}>(db,`SELECT r.id_regla AS "idRegla",r.nombre AS regla,o.empresa,e.etapa FROM crm_secuencia_aplicacion a JOIN crm_secuencia_regla r USING(id_regla) JOIN crm_etapa_evento e ON e.id_evento=a.id_evento JOIN crm_oportunidad o ON o.id_oportunidad=e.id_oportunidad WHERE a.id_secuencia=$1`,[id]);
  return{...run,pasos:pasos.map((p,i)=>({...p,numero:i+1,tarea:tasks.find(t=>t.paso===i+1)??null})),eventos:events,origen:origin??null};
 });}
 start(dto:SecuenciaInicioDto,actor:JwtPayload){return this.write(actor,db=>this.startInTransaction(db,dto,actor));}
 async startInTransaction(db:EntityManager,dto:SecuenciaInicioDto,actor:JwtPayload){
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-secuencias:v1',0))");await this.staff(db,actor,true);
  const id=dto.requestId.toLowerCase(),hash=quoteHash({actor:actor.idUser,...dto,requestId:id});
  const [old]=await queryRows<{huella:string;id_creador:number}>(db,'SELECT huella,id_creador FROM crm_secuencia WHERE id_secuencia=$1',[id]);
  if(old){if(old.huella!==hash||old.id_creador!==actor.idUser)throw new ConflictException('El UUID identifica otra ejecución.');return{id};}
  if(actor.role!==RolUsuario.ADMIN&&dto.idResponsable!==actor.idUser)throw new ForbiddenException('Sólo un administrador puede asignar a otra persona.');
  const [model]=await queryRows<Model>(db,'SELECT pasos FROM crm_secuencia_modelo WHERE id_modelo=$1',[dto.idModelo]);if(!model)throw new NotFoundException('Modelo no encontrado');
  const [client]=await queryRows(db,'SELECT "IdCliente" FROM cliente WHERE "IdCliente"=$1 FOR KEY SHARE',[dto.idCliente]);if(!client)throw new NotFoundException('Cliente no encontrado');
  const [owner]=await queryRows(db,'SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active FOR SHARE',[dto.idResponsable]);if(!owner)throw new ConflictException('Selecciona un responsable activo.');
  const [active]=await queryRows(db,"SELECT id_secuencia FROM crm_secuencia WHERE id_modelo=$1 AND id_cliente=$2 AND estado IN('Activa','Pausada')",[dto.idModelo,dto.idCliente]);if(active)throw new ConflictException('Este cliente ya tiene una ejecución activa o pausada de ese modelo.');
  await db.query('INSERT INTO crm_secuencia(id_secuencia,id_modelo,id_cliente,id_responsable,id_creador,motivo,huella) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,dto.idModelo,dto.idCliente,dto.idResponsable,actor.idUser,dto.motivo,hash]);
  const p=model.pasos[0],[task]=await queryRows<{id:string}>(db,`INSERT INTO crm_tarea(titulo,descripcion,prioridad,fecha_vencimiento,id_responsable,id_cliente,id_creador,id_secuencia,paso_secuencia) VALUES($1,$2,$3,clock_timestamp()+make_interval(hours=>$4),$5,$6,$7,$8,1) RETURNING id_tarea::text AS id`,[p.titulo,p.descripcion,p.prioridad,p.horas,dto.idResponsable,dto.idCliente,actor.idUser,id]);
  await db.query("INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES($1,$2,'Creada',1,$3)",[id,task.id,actor.idUser]);return{id};
 }
 async transition(id:string,dto:SecuenciaTransicionDto,actor:JwtPayload){
  await this.read(actor,async db=>{await this.run(db,id,actor);const [t]=await queryRows(db,'SELECT id_tarea FROM crm_tarea WHERE id_secuencia=$1 AND id_tarea::text=$2',[id,dto.idTarea]);if(!t)throw new NotFoundException('Tarea no encontrada en la secuencia');});
  return this.activity.updateTarea(dto.idTarea,{estado:dto.estado,expectedVersion:dto.expectedVersion},actor.idUser!,actor.role,actor);
 }
 owners(query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  if(actor.role!==RolUsuario.ADMIN)throw new ForbiddenException('La reasignación requiere administrador.');
  const q=this.pattern(query.q),[count]=await queryRows<{total:number}>(db,"SELECT count(*)::int total FROM auth_user WHERE is_active AND ($1='' OR username ILIKE $1)",[q]);
  const data=await queryRows<{id:number;nombre:string}>(db,"SELECT id_user AS id,username AS nombre FROM auth_user WHERE is_active AND ($1='' OR username ILIKE $1) ORDER BY username,id_user LIMIT 20 OFFSET $2",[q,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 controls(id:string,query:SecuenciaQuery,actor:JwtPayload){return this.read(actor,async db=>{
  await this.run(db,id,actor);const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM crm_secuencia_control WHERE id_secuencia=$1',[id]);
  const data=await queryRows(db,`SELECT e.request_id AS id,e.accion,e.motivo,e.version_resultante AS version,e.creada_en AS fecha,u.username AS actor,a.username AS anterior,n.username AS nuevo,e.vence_antes AS "venceAntes",e.vence_despues AS "venceDespues" FROM crm_secuencia_control e JOIN auth_user u ON u.id_user=e.id_actor JOIN auth_user a ON a.id_user=e.id_anterior JOIN auth_user n ON n.id_user=e.id_nuevo WHERE e.id_secuencia=$1 ORDER BY e.version_resultante DESC LIMIT 20 OFFSET $2`,[id,(query.page-1)*20]);return{data,total:count.total,page:query.page};
 });}
 control(id:string,dto:SecuenciaControlDto,actor:JwtPayload){
  const request=dto.requestId.toLowerCase(),hash=quoteHash({id,actor:actor.idUser,...dto,requestId:request});
  return this.source.transaction(async db=>{
   await db.query("SET LOCAL statement_timeout='10s'");await db.query("SELECT pg_advisory_xact_lock(hashtextextended('crm-secuencias:v1',0))");await this.staff(db,actor);
   await this.run(db,id,actor);
   const [old]=await queryRows<{huella:string;id_actor:number;version:number}>(db,'SELECT huella,id_actor,version_resultante AS version FROM crm_secuencia_control WHERE request_id=$1',[request]);
   if(old){if(old.huella!==hash||old.id_actor!==actor.idUser)throw new ConflictException('El UUID identifica otro control.');return{id,version:old.version};}
   // Mismo orden que la ruta existente: tarea -> ejecución -> autorización vigente.
   const [task]=await queryRows<{id:string;paso:number;estado:string;vence:string}>(db,`SELECT t.id_tarea::text AS id,t.paso_secuencia AS paso,t.estado,t.fecha_vencimiento::text AS vence FROM crm_tarea t JOIN crm_secuencia s ON s.id_secuencia=t.id_secuencia AND s.paso_actual=t.paso_secuencia WHERE s.id_secuencia=$1 FOR UPDATE OF t`,[id]);
   if(!task)throw new ConflictException('Actualiza el seguimiento antes de controlarlo.');
   await db.query('SELECT id_secuencia FROM crm_secuencia WHERE id_secuencia=$1 FOR UPDATE',[id]);await this.staff(db,actor,true);
   const s=await this.run(db,id,actor);
   if(s.version!==dto.expectedVersion||s.pasoActual!==task.paso||!['Activa','Pausada'].includes(s.estado)||!['Pendiente','En progreso'].includes(task.estado))throw new ConflictException('La secuencia cambió o está cerrada; actualiza antes de continuar.');
   if(dto.accion==='Reasignar'){
    if(actor.role!==RolUsuario.ADMIN)throw new ForbiddenException('La reasignación requiere administrador.');
    if(!dto.idResponsable||dto.idResponsable===s.idResponsable)throw new BadRequestException('Selecciona otro responsable activo.');
   }else if(dto.idResponsable!==undefined)throw new BadRequestException('El responsable sólo se recibe al reasignar.');
   if(dto.accion==='Pausar'&&s.estado!=='Activa'||dto.accion==='Reanudar'&&s.estado!=='Pausada')throw new ConflictException('La acción no corresponde al estado actual.');
   const owner=dto.accion==='Reasignar'?dto.idResponsable!:s.idResponsable;
   if(dto.accion!=='Pausar'){
    const [active]=await queryRows(db,'SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active FOR SHARE',[owner]);if(!active)throw new ConflictException('Selecciona un responsable activo antes de reanudar o reasignar.');
   }
   await db.query("SELECT set_config('app.crm_sequence_control',$1,true)",[id]);
   if(dto.accion==='Pausar')await db.query("UPDATE crm_secuencia SET estado='Pausada',pausada_en=clock_timestamp(),plazo_restante=$2::timestamptz-clock_timestamp(),version=version+1 WHERE id_secuencia=$1",[id,task.vence]);
   if(dto.accion==='Reasignar')await db.query('UPDATE crm_secuencia SET id_responsable=$2,version=version+1 WHERE id_secuencia=$1',[id,owner]);
   // Reanudar conserva el saldo firmado de tiempo; una tarea ya vencida sigue vencida.
   await db.query(`UPDATE crm_tarea SET id_responsable=$2,fecha_vencimiento=CASE WHEN $3::boolean THEN clock_timestamp()+(SELECT plazo_restante FROM crm_secuencia WHERE id_secuencia=$4) ELSE fecha_vencimiento END,version=version+1,updated_at=clock_timestamp() WHERE id_tarea=$1`,[task.id,owner,dto.accion==='Reanudar',id]);
   if(dto.accion==='Reanudar'){
    await db.query("UPDATE crm_secuencia SET estado='Activa',pausada_en=NULL,plazo_restante=NULL,version=version+1 WHERE id_secuencia=$1",[id]);
    await db.query("UPDATE app_notification SET read_at=NULL,created_at=clock_timestamp() WHERE type='crm_task_overdue' AND source_id=$1 AND id_user=$2 AND EXISTS(SELECT 1 FROM crm_tarea WHERE id_tarea=$1 AND fecha_vencimiento<clock_timestamp())",[task.id,owner]);
   }
   await db.query(`INSERT INTO crm_secuencia_control(request_id,id_secuencia,id_tarea,accion,motivo,id_actor,id_anterior,id_nuevo,vence_antes,vence_despues,version_anterior,version_resultante,huella) SELECT $1,$2,id_tarea,$3,$4,$5,$6,$7,$8::timestamptz,fecha_vencimiento,$9,$10,$11 FROM crm_tarea WHERE id_tarea=$12`,[request,id,dto.accion,dto.motivo,actor.idUser,s.idResponsable,owner,task.vence,s.version,s.version+1,hash,task.id]);
   await db.query("SELECT set_config('app.crm_sequence_control','',true)");return{id,version:s.version+1};
  });
 }
}
