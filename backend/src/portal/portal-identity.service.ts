import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException,UnauthorizedException } from '@nestjs/common';
import { DataSource,EntityManager } from 'typeorm';
import { createHash,createHmac,randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { validatePasswordPolicy } from '../auth/password-policy';
import { QueryExecutor,queryRows,readSnapshot } from '../common/database/typed-query';
import { PortalActivarDto,PortalCambiarAccesoDto,PortalInvitarDto,PortalLoginDto,PortalPasswordDto,PortalQuery } from './portal.dto';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const fingerprint=(value:unknown)=>digest(JSON.stringify(value));
interface Account {id:number;idCliente:number;alias:string;nombre:string;estado:string;version:number;}
interface Invitation {id_invitacion:number;id_acceso:number;request_id:string;huella:string;token_hash:string;version:number;vence_en:Date;usada_en:Date|null;revocada:boolean;}
export interface PortalIdentity {idAcceso:number;idCliente:number;nombre:string;alias:string;cliente:string;venceEn:Date;}
@Injectable()
export class PortalIdentityService {
 private readonly dummy=bcrypt.hash(randomBytes(32).toString('hex'),12);
 constructor(private readonly source:DataSource){}
 private async staff(db:QueryExecutor,actor:JwtPayload){
  const [user]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3
   AND fn_effective_permission(id_user,role,'portal.gestionar') FOR SHARE`,[actor.idUser??null,actor.role,actor.version]);
  if(!user)throw new ForbiddenException('Tu cuenta o permiso del portal cambió.');await setAuditActor(db,actor.idUser);
 }
 private async account(db:QueryExecutor,idCliente:number,id:number){
  const [a]=await queryRows<Account>(db,`SELECT id_acceso AS id,id_cliente AS "idCliente",alias,nombre,estado,version FROM portal_acceso WHERE id_cliente=$1 AND id_acceso=$2 FOR UPDATE`,[idCliente,id]);
  if(!a)throw new NotFoundException('Acceso no encontrado en este cliente');return a;
 }
 private async event(db:QueryExecutor,id:number,tipo:string,motivo='',requestId?:string,huella?:string){
  await db.query('INSERT INTO portal_evento(id_acceso,tipo,motivo,request_id,huella)VALUES($1,$2,$3,$4,$5)',[id,tipo,motivo,requestId??null,huella??null]);
 }
 private write<T>(actor:JwtPayload,work:(db:EntityManager)=>Promise<T>){return this.source.transaction(async db=>{await db.query("SET LOCAL statement_timeout='10s'");await this.staff(db,actor);return work(db);});}
 list(idCliente:number,query:PortalQuery,actor:JwtPayload){return this.write(actor,async db=>{
  const [client]=await queryRows<{nombre:string}>(db,'SELECT "RazonSocial" AS nombre FROM cliente WHERE "IdCliente"=$1',[idCliente]);if(!client)throw new NotFoundException('Cliente no encontrado');
  const data=await queryRows(db,`SELECT a.id_acceso AS id,a.alias,a.nombre,a.estado,a.version,a.creada_en AS "creadaEn",
    (SELECT max(i.vence_en) FROM portal_invitacion i WHERE i.id_acceso=a.id_acceso AND i.version=a.version AND NOT i.revocada AND i.usada_en IS NULL) AS "invitacionVenceEn"
    FROM portal_acceso a WHERE a.id_cliente=$1 ORDER BY a.id_acceso DESC LIMIT 20 OFFSET $2`,[idCliente,(query.page-1)*20]);
  const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM portal_acceso WHERE id_cliente=$1',[idCliente]);
  return{cliente:client.nombre,data,total:count.total,page:query.page,limit:20};
 });}
 private token(id:number,requestId:string){const key=process.env.JWT_SECRET;if(!key||key.length<32)throw new ServiceUnavailableException('La emisión requiere una clave robusta del servidor');return createHmac('sha256',key).update('portal-invitacion:v1:'+id+':'+requestId).digest('base64url');}
 private result(inv:Invitation){const usable=!inv.revocada&&!inv.usada_en&&new Date(inv.vence_en).getTime()>Date.now();const token=usable?this.token(inv.id_acceso,inv.request_id):null;
  if(token&&digest(token)!==inv.token_hash)throw new ConflictException('La clave del servidor cambió; emite otra invitación.');return{idAcceso:inv.id_acceso,venceEn:inv.vence_en,token};}
 private async invite(db:QueryExecutor,a:Account,requestId:string,hash:string,motivo:string){
  const token=this.token(a.id,requestId);
  await db.query('UPDATE portal_invitacion SET revocada=true WHERE id_acceso=$1 AND NOT revocada',[a.id]);
  await db.query('UPDATE portal_sesion SET revocada_en=clock_timestamp() WHERE id_acceso=$1 AND revocada_en IS NULL',[a.id]);
  const [inv]=await queryRows<Invitation>(db,`INSERT INTO portal_invitacion(id_acceso,request_id,huella,token_hash,version,vence_en)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '24 hours') RETURNING *`,[a.id,requestId,hash,digest(token),a.version]);
  await this.event(db,a.id,'Invitación',motivo,requestId,hash);return this.result(inv);
 }
 create(idCliente:number,dto:PortalInvitarDto,actor:JwtPayload){const requestId=dto.requestId.toLowerCase(),hash=fingerprint({idCliente,alias:dto.alias,nombre:dto.nombre,motivo:dto.motivo});return this.write(actor,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['portal:'+requestId]);
  const [old]=await queryRows<Invitation>(db,'SELECT * FROM portal_invitacion WHERE request_id=$1',[requestId]);
  if(old){const a=await this.account(db,idCliente,old.id_acceso);if(old.huella!==hash)throw new ConflictException('La clave de invitación identifica otros datos');return this.result({...old,revocada:old.revocada||a.version!==old.version||a.estado!=='Pendiente'});}
  const [client]=await queryRows(db,'SELECT "IdCliente" FROM cliente WHERE "IdCliente"=$1 FOR UPDATE',[idCliente]);if(!client)throw new NotFoundException('Cliente no encontrado');
  const [quota]=await queryRows<{n:number}>(db,'SELECT count(*)::int n FROM portal_acceso WHERE id_cliente=$1',[idCliente]);if(quota.n>=10)throw new ConflictException('Máximo10 accesos por cliente; revisa los existentes.');
  const [a]=await queryRows<Account>(db,`INSERT INTO portal_acceso(id_cliente,alias,nombre)VALUES($1,$2,$3)RETURNING id_acceso AS id,version`,[idCliente,dto.alias,dto.nombre]);
  await db.query('INSERT INTO portal_credencial(id_acceso)VALUES($1)',[a.id]);return this.invite(db,a,requestId,hash,dto.motivo);
 });}
 changeAccess(idCliente:number,id:number,dto:PortalCambiarAccesoDto,actor:JwtPayload,action:'Restablecer'|'Suspender'){
  const requestId=dto.requestId.toLowerCase(),hash=fingerprint({idCliente,id,version:dto.version,motivo:dto.motivo,action});
  return this.write(actor,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['portal:'+requestId]);const a=await this.account(db,idCliente,id);
   const [old]=await queryRows<{huella:string;tipo:string}>(db,'SELECT huella,tipo FROM portal_evento WHERE id_acceso=$1 AND request_id=$2',[id,requestId]);
   if(old){if(old.huella!==hash)throw new ConflictException('La clave de cambio identifica otros datos');if(action==='Suspender')return{message:'Acceso suspendido'};const [inv]=await queryRows<Invitation>(db,'SELECT * FROM portal_invitacion WHERE request_id=$1 AND id_acceso=$2',[requestId,id]);return this.result({...inv,revocada:inv.revocada||a.version!==inv.version||a.estado!=='Pendiente'});}
   if(a.version!==dto.version)throw new ConflictException('El acceso cambió. Actualiza la lista.');
   await db.query('UPDATE portal_acceso SET estado=$2,version=version+1 WHERE id_acceso=$1',[id,action==='Suspender'?'Suspendido':'Pendiente']);a.version++;
   await db.query('UPDATE portal_credencial SET password_hash=NULL,fallos=0,bloqueado_hasta=NULL WHERE id_acceso=$1',[id]);
   if(action==='Restablecer')return this.invite(db,a,requestId,hash,dto.motivo);
   await db.query('UPDATE portal_invitacion SET revocada=true WHERE id_acceso=$1',[id]);await db.query('UPDATE portal_sesion SET revocada_en=clock_timestamp() WHERE id_acceso=$1 AND revocada_en IS NULL',[id]);
   await this.event(db,id,'Suspensión',dto.motivo,requestId,hash);return{message:'Acceso suspendido'};
  });
 }
 private external<T>(work:(db:EntityManager)=>Promise<T>){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");await db.query("SELECT set_config('app.current_user_id','',true)");return work(db);
 });}
 private wrongPassword(db:QueryExecutor,id:number){return db.query(`UPDATE portal_credencial SET fallos=CASE WHEN bloqueado_hasta<=clock_timestamp() THEN 1 ELSE least(fallos+1,5) END,
   bloqueado_hasta=CASE WHEN bloqueado_hasta>clock_timestamp() THEN bloqueado_hasta WHEN (CASE WHEN bloqueado_hasta<=clock_timestamp() THEN 1 ELSE fallos+1 END)>=5 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END WHERE id_acceso=$1`,[id]);}
 async activate(dto:PortalActivarDto){validatePasswordPolicy(dto.password);const password=await bcrypt.hash(dto.password,12);
  await this.external(async db=>{
   const [known]=await queryRows<Invitation>(db,'SELECT * FROM portal_invitacion WHERE token_hash=$1',[digest(dto.token)]);if(!known)throw new UnauthorizedException('Invitación inválida o no disponible');
   const [a]=await queryRows<Account>(db,'SELECT id_acceso AS id,version,estado FROM portal_acceso WHERE id_acceso=$1 FOR UPDATE',[known.id_acceso]);
   const [inv]=await queryRows<Invitation>(db,'SELECT * FROM portal_invitacion WHERE id_invitacion=$1 FOR UPDATE',[known.id_invitacion]);
   if(!inv||inv.revocada||inv.usada_en||new Date(inv.vence_en).getTime()<=Date.now()||inv.version!==a.version||a.estado!=='Pendiente')throw new UnauthorizedException('Invitación inválida o no disponible');
   await db.query('UPDATE portal_credencial SET password_hash=$2,fallos=0,bloqueado_hasta=NULL WHERE id_acceso=$1',[a.id,password]);
   await db.query("UPDATE portal_acceso SET estado='Activo',version=version+1 WHERE id_acceso=$1",[a.id]);await db.query('UPDATE portal_invitacion SET usada_en=clock_timestamp() WHERE id_invitacion=$1',[inv.id_invitacion]);
   await this.event(db,a.id,'Activación');
  });return{message:'Acceso activado. Inicia sesión.'};
 }
 async login(dto:PortalLoginDto){
  const result=await this.external(async db=>{
   const [a]=await queryRows<Account>(db,'SELECT id_acceso AS id,alias,nombre,id_cliente AS "idCliente",estado,version FROM portal_acceso WHERE alias=$1 FOR UPDATE',[dto.alias]);
   const [credential]=a?await queryRows<{password_hash:string|null;fallos:number;bloqueado_hasta:Date|null}>(db,'SELECT * FROM portal_credencial WHERE id_acceso=$1',[a.id]):[];
   const candidate=Buffer.byteLength(dto.password,'utf8')<=72?dto.password:'';
   const valid=await bcrypt.compare(candidate,credential?.password_hash??await this.dummy);
   if(!a||!credential||a.estado!=='Activo'||!valid||(credential.bloqueado_hasta&&new Date(credential.bloqueado_hasta).getTime()>Date.now())){
    if(a&&credential&&a.estado==='Activo')await this.wrongPassword(db,a.id);
    return null;
   }
   await db.query('UPDATE portal_credencial SET fallos=0,bloqueado_hasta=NULL WHERE id_acceso=$1',[a.id]);
   await db.query(`UPDATE portal_sesion SET revocada_en=clock_timestamp() WHERE token_hash IN(SELECT token_hash FROM portal_sesion WHERE id_acceso=$1 AND revocada_en IS NULL AND vence_en>clock_timestamp() ORDER BY creada_en DESC OFFSET 4)`,[a.id]);
   const token=randomBytes(32).toString('base64url');const [s]=await queryRows<{vence_en:Date}>(db,`INSERT INTO portal_sesion(token_hash,id_acceso,version,vence_en)VALUES($1,$2,$3,clock_timestamp()+interval '8 hours')RETURNING vence_en`,[digest(token),a.id,a.version]);
   await this.event(db,a.id,'Ingreso');return{token,venceEn:s.vence_en};
  });if(!result)throw new UnauthorizedException('Acceso inválido o no disponible');return result;
 }
 async identity(db:QueryExecutor,token:string):Promise<PortalIdentity>{
  const [a]=await queryRows<PortalIdentity>(db,`SELECT a.id_acceso AS "idAcceso",a.id_cliente AS "idCliente",a.nombre,a.alias,c."RazonSocial" AS cliente,s.vence_en AS "venceEn"
   FROM portal_sesion s JOIN portal_acceso a USING(id_acceso) JOIN cliente c ON c."IdCliente"=a.id_cliente
   WHERE s.token_hash=$1 AND s.revocada_en IS NULL AND s.vence_en>clock_timestamp() AND s.version=a.version AND a.estado='Activo'`,[digest(token)]);
  if(!a)throw new UnauthorizedException('Sesión del portal requerida');return a;
 }
 state(token:string){return readSnapshot(this.source,async db=>{const a=await this.identity(db,token);return{nombre:a.nombre,alias:a.alias,cliente:a.cliente,venceEn:a.venceEn};});}
 logout(token:string){return this.external(async db=>{
  const a=await this.identity(db,token);await db.query('SELECT id_acceso FROM portal_acceso WHERE id_acceso=$1 FOR UPDATE',[a.idAcceso]);await db.query('UPDATE portal_sesion SET revocada_en=clock_timestamp() WHERE token_hash=$1',[digest(token)]);await this.event(db,a.idAcceso,'Salida');return{message:'Sesión cerrada'};
 });}
 async password(token:string,dto:PortalPasswordDto){validatePasswordPolicy(dto.nueva);const next=await bcrypt.hash(dto.nueva,12);
  const ok=await this.external(async db=>{
   const initial=await this.identity(db,token);await db.query('SELECT id_acceso FROM portal_acceso WHERE id_acceso=$1 FOR UPDATE',[initial.idAcceso]);const a=await this.identity(db,token);
   const [credential]=await queryRows<{password_hash:string;bloqueado_hasta:Date|null}>(db,'SELECT password_hash,bloqueado_hasta FROM portal_credencial WHERE id_acceso=$1',[a.idAcceso]);
   const candidate=Buffer.byteLength(dto.actual,'utf8')<=72?dto.actual:'';
   if(!await bcrypt.compare(candidate,credential?.password_hash??await this.dummy)||(credential?.bloqueado_hasta&&new Date(credential.bloqueado_hasta).getTime()>Date.now())){await this.wrongPassword(db,a.idAcceso);return false;}
   if(dto.actual===dto.nueva)throw new BadRequestException('Elige una contraseña diferente');
   await db.query('UPDATE portal_credencial SET password_hash=$2,fallos=0,bloqueado_hasta=NULL WHERE id_acceso=$1',[a.idAcceso,next]);await db.query('UPDATE portal_acceso SET version=version+1 WHERE id_acceso=$1',[a.idAcceso]);
   await db.query('UPDATE portal_sesion SET revocada_en=clock_timestamp() WHERE id_acceso=$1 AND revocada_en IS NULL',[a.idAcceso]);await this.event(db,a.idAcceso,'Contraseña');return true;
  });if(!ok)throw new BadRequestException('No se pudo cambiar la contraseña');return{message:'Contraseña actualizada. Inicia sesión nuevamente.'};
 }
}
