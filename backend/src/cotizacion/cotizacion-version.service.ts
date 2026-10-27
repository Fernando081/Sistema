import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, createHmac } from 'node:crypto';
import { JwtPayload } from '../auth/auth.types';
import { commercialActor } from '../comercial/commercial-actor';
import { queryRows, readSnapshot } from '../common/database/typed-query';
import { MotivoExpedienteDto } from '../crm/unidad-expediente.dto';
import { CotizacionService } from './cotizacion.service';
import { InvitarCotizacionDto, NuevaRevisionDto, ResponderCotizacionDto, SellarCotizacionDto, TokenCotizacionDto, VersionQuery } from './cotizacion-version.dto';
import { currentRevision, lockQuoteFamily, quoteHash, quoteSnapshot, Revision, verifySnapshot } from './cotizacion-version-policy';
const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
@Injectable()
export class CotizacionVersionService {
 constructor(private readonly source:DataSource,private readonly quotes:CotizacionService){}
 private async open(db:EntityManager,id:number,allowExpired=false){
  const [row]=await queryRows<{open:boolean}>(db,`SELECT estatus NOT IN ('Convertida','Rechazada') AND ($2::boolean OR fecha_vencimiento>clock_timestamp())
   AND NOT EXISTS(SELECT 1 FROM conceptocotizacion WHERE id_cotizacion=$1 AND estatus<>'Pendiente')
   AND NOT EXISTS(SELECT 1 FROM pedido_venta WHERE id_cotizacion=$1)
   AND NOT EXISTS(SELECT 1 FROM factura WHERE id_cotizacion=$1) AS open FROM cotizacion WHERE id_cotizacion=$1 FOR UPDATE`,[id,allowExpired]);
  if(!row)throw new NotFoundException('Cotización no encontrada');
  if(!row.open)throw new ConflictException('La cotización está vencida, cerrada o tiene documentos/renglones procesados.');
 }
 private write<T>(actor:JwtPayload,work:(db:EntityManager,name:string)=>Promise<T>){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");await commercialActor(db,actor,'cotizaciones.versionar');
  const [user]=await queryRows<{nombre:string}>(db,'SELECT username AS nombre FROM auth_user WHERE id_user=$1',[actor.idUser]);return work(db,user.nombre);
 });}
 async state(id:number,query:VersionQuery,actor:JwtPayload){return readSnapshot(this.source,async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");
  const [user]=await queryRows<{gestionar:boolean}>(db,`SELECT fn_effective_permission(id_user,role,'cotizaciones.versionar') AS gestionar FROM auth_user
    WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3`,[actor.idUser,actor.role,actor.version]);
  if(!user)throw new ForbiddenException('Tu cuenta cambió. Inicia sesión nuevamente.');
  const [row]=await queryRows<Revision>(db,'SELECT * FROM cotizacion_revision WHERE id_cotizacion=$1',[id]);
  const source=await quoteSnapshot(db,id);
  const products=await queryRows(db,`SELECT "IdProducto" AS "idProducto","ObjetoImpuesto" AS "objetoImpuesto","TasaIVA" AS "tasaIva","AplicaRetencionISR" AS "aplicaRetencionIsr" FROM producto WHERE "IdProducto"=ANY($1::int[])`,[source.conceptos.map(c=>c.idProducto)]);
  if(!row)return {gestion:user.gestionar,actual:null,seleccion:null,revisionTotal:0,revisiones:[],invitaciones:[],snapshot:source,productos:products};
  verifySnapshot(row);
  const [latest]=await queryRows<Revision>(db,'SELECT * FROM cotizacion_revision WHERE id_raiz=$1 ORDER BY numero DESC LIMIT 1',[row.id_raiz]);verifySnapshot(latest);
  const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM cotizacion_revision WHERE id_raiz=$1',[row.id_raiz]);
  const revisions=await queryRows(db,`SELECT r.id_revision AS "idRevision",r.id_cotizacion AS "idCotizacion",r.numero,r.motivo,r.autor_nombre AS autor,r.creada_en AS "creadaEn",
   s.decision,s.nombre AS "nombreDeclarado",s.comentario,s.creada_en AS "respondidaEn" FROM cotizacion_revision r LEFT JOIN cotizacion_respuesta s USING(id_revision)
   WHERE r.id_raiz=$1 ORDER BY numero DESC LIMIT 20 OFFSET $2`,[row.id_raiz,(query.page-1)*20]);
  const invitations=await queryRows(db,`SELECT id_invitacion AS "idInvitacion",creada_en AS "creadaEn",vence_en AS "venceEn",revocada,motivo_revocacion AS motivo,autor_nombre AS autor
   FROM cotizacion_invitacion WHERE id_revision=$1 ORDER BY id_invitacion DESC LIMIT 20`,[latest.id_revision]);
  const [response]=await queryRows(db,'SELECT decision,nombre,comentario,creada_en AS fecha FROM cotizacion_respuesta WHERE id_revision=$1',[latest.id_revision]);
  return {gestion:user.gestionar,actual:{idRevision:latest.id_revision,idCotizacion:latest.id_cotizacion,numero:latest.numero,respuesta:response??null},seleccion:row.id_revision,
   revisionTotal:count.total,revisiones:revisions,invitaciones:invitations,snapshot:row.snapshot,coincide:quoteHash(source)===row.sha256,productos:products};
 });}
 seal(id:number,dto:SellarCotizacionDto,actor:JwtPayload){return this.write(actor,async(db,name)=>{
  const existing=await lockQuoteFamily(db,id);
  if(existing){if(existing.request_id===dto.requestId&&existing.huella===quoteHash(dto))return{idRevision:existing.id_revision,idCotizacion:id};
   throw new ConflictException('La cotización ya está versionada; consulta su historial.');}
  await this.open(db,id);const snapshot=await quoteSnapshot(db,id);
  const [row]=await queryRows<{idRevision:number}>(db,`INSERT INTO cotizacion_revision(id_cotizacion,id_raiz,numero,request_id,huella,snapshot,sha256,motivo,autor_nombre)
   VALUES($1,$1,1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING id_revision AS "idRevision"`,[id,dto.requestId,quoteHash(dto),JSON.stringify(snapshot),quoteHash(snapshot),dto.motivo,name]);
  return{...row,idCotizacion:id};
 });}
 revise(id:number,dto:NuevaRevisionDto,actor:JwtPayload){return this.write(actor,async(db,name)=>{
  const row=await lockQuoteFamily(db,id);if(!row)throw new ConflictException('Activa primero las revisiones de esta cotización');
  const [previous]=await queryRows<{idRevision:number;idCotizacion:number;huella:string}>(db,'SELECT id_revision AS "idRevision",id_cotizacion AS "idCotizacion",huella FROM cotizacion_revision WHERE id_raiz=$1 AND request_id=$2',[row.id_raiz,dto.requestId]);
  if(previous){if(previous.huella!==quoteHash(dto))throw new ConflictException('La clave de revisión identifica otros datos');return previous;}
  const [latest]=await queryRows<Revision>(db,'SELECT * FROM cotizacion_revision WHERE id_raiz=$1 ORDER BY numero DESC LIMIT 1',[row.id_raiz]);verifySnapshot(latest);
  if(latest.id_revision!==dto.revisionAnterior||latest.id_cotizacion!==id)throw new ConflictException('Hay una revisión más reciente; recarga el historial.');
  await this.open(db,id,true);
  if(dto.idCliente!==latest.snapshot.idCliente)throw new ConflictException('Una revisión debe conservar el mismo cliente');
  const quote=await this.quotes.createWithManager(db,dto,actor);
  await db.query('UPDATE cotizacion SET id_unidad=$2 WHERE id_cotizacion=$1',[quote.id,latest.snapshot.idUnidad]);
  const snapshot=await quoteSnapshot(db,quote.id);
  const [created]=await queryRows<{idRevision:number}>(db,`INSERT INTO cotizacion_revision(id_cotizacion,id_raiz,numero,request_id,huella,snapshot,sha256,motivo,autor_nombre)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id_revision AS "idRevision"`,[quote.id,row.id_raiz,latest.numero+1,dto.requestId,quoteHash(dto),JSON.stringify(snapshot),quoteHash(snapshot),dto.motivo,name]);
  await db.query("UPDATE cotizacion_invitacion SET revocada=true,motivo_revocacion='Revisión sustituida' WHERE id_revision IN(SELECT id_revision FROM cotizacion_revision WHERE id_raiz=$1) AND NOT revocada",[row.id_raiz]);
  return{...created,idCotizacion:quote.id};
 });}
 invite(id:number,dto:InvitarCotizacionDto,actor:JwtPayload){return this.write(actor,async(db,name)=>{
  const row=await lockQuoteFamily(db,id);if(!row)throw new ConflictException('Activa primero las revisiones');
  await currentRevision(db,row);await this.open(db,id);
  const [response]=await queryRows(db,'SELECT id_respuesta FROM cotizacion_respuesta WHERE id_revision=$1',[row.id_revision]);if(response)throw new ConflictException('La revisión ya tiene respuesta; prepara otra revisión para cambiar la propuesta.');
  const key=process.env.JWT_SECRET;if(!key||key.length<32)throw new ServiceUnavailableException('Configura una clave de servidor robusta antes de emitir enlaces.');
  const token=createHmac('sha256',key).update('cotizacion-respuesta-v1:'+row.id_revision+':'+dto.requestId).digest('base64url');
  const digest=tokenHash(token),[previous]=await queryRows<{idInvitacion:number;venceEn:Date;token_hash:string;revocada:boolean}>(db,'SELECT id_invitacion AS "idInvitacion",vence_en AS "venceEn",token_hash,revocada FROM cotizacion_invitacion WHERE id_revision=$1 AND request_id=$2',[row.id_revision,dto.requestId]);
  if(previous){if(previous.token_hash!==digest)throw new ConflictException('Cambió la clave de emisión; prepara un enlace nuevo.');if(previous.revocada||previous.venceEn.getTime()<=Date.now())throw new ConflictException('El enlace ya venció o fue revocado; prepara otro.');return{idInvitacion:previous.idInvitacion,venceEn:previous.venceEn,token};}
  await db.query("UPDATE cotizacion_invitacion SET revocada=true,motivo_revocacion='Enlace reemplazado' WHERE id_revision=$1 AND NOT revocada",[row.id_revision]);
  const [created]=await queryRows<{idInvitacion:number;venceEn:Date}>(db,`INSERT INTO cotizacion_invitacion(id_revision,request_id,token_hash,autor_nombre,vence_en)
   SELECT $1,$2,$3,$4,LEAST(clock_timestamp()+interval '24 hours',fecha_vencimiento) FROM cotizacion WHERE id_cotizacion=$5 RETURNING id_invitacion AS "idInvitacion",vence_en AS "venceEn"`,[row.id_revision,dto.requestId,digest,name,id]);return{...created,token};
 });}
 revoke(id:number,invitation:number,dto:MotivoExpedienteDto,actor:JwtPayload){return this.write(actor,async db=>{
  const row=await lockQuoteFamily(db,id);if(!row)throw new NotFoundException('Revisión no encontrada');
  const [item]=await queryRows<{revocada:boolean;motivo_revocacion:string}>(db,'SELECT revocada,motivo_revocacion FROM cotizacion_invitacion WHERE id_revision=$1 AND id_invitacion=$2',[row.id_revision,invitation]);
  if(!item)throw new NotFoundException('Enlace no encontrado en esta revisión');
  if(item.revocada){if(item.motivo_revocacion!==dto.motivo)throw new ConflictException('El enlace ya fue revocado con otro motivo');return{message:'Enlace revocado'};}
  await db.query('UPDATE cotizacion_invitacion SET revocada=true,motivo_revocacion=$2 WHERE id_invitacion=$1',[invitation,dto.motivo]);return{message:'Enlace revocado'};
 });}
 async publicResolve(dto:TokenCotizacionDto,response?:ResponderCotizacionDto){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");await db.query("SELECT set_config('app.current_user_id','',true)");
  const [known]=await queryRows<Revision & {id_invitacion:number}>(db,`SELECT r.*,i.id_invitacion FROM cotizacion_invitacion i JOIN cotizacion_revision r USING(id_revision) WHERE i.token_hash=$1`,[tokenHash(dto.token)]);
  if(!known)throw new NotFoundException('El enlace no está disponible. Solicita uno vigente.');
  const row=await lockQuoteFamily(db,known.id_cotizacion);if(!row)throw new NotFoundException('El enlace no está disponible.');
  const [invite]=await queryRows<{valida:boolean}>(db,'SELECT NOT revocada AND vence_en>clock_timestamp() AS valida FROM cotizacion_invitacion WHERE id_invitacion=$1',[known.id_invitacion]);
  if(!invite?.valida)throw new NotFoundException('El enlace no está disponible. Solicita uno vigente.');
  await currentRevision(db,row);
  const [saved]=await queryRows<{id_respuesta:number;request_id:string;huella:string;decision:string;nombre:string;comentario:string;creada_en:Date}>(db,'SELECT * FROM cotizacion_respuesta WHERE id_revision=$1',[row.id_revision]);
  const receipt=(s:typeof saved)=>({decision:s.decision,nombre:s.nombre,comentario:s.comentario,fecha:s.creada_en});
  const responseHash=response?quoteHash({requestId:response.requestId,decision:response.decision,nombre:response.nombre,comentario:response.comentario,confirmacion:response.confirmacion}):'';
  if(response&&saved){if(saved.request_id!==response.requestId||saved.huella!==responseHash)throw new ConflictException('La revisión ya tiene una respuesta; solicita una nueva revisión para cambiarla.');return{respuesta:receipt(saved)};}
  if(!saved)await this.open(db,row.id_cotizacion);
  if(!response){const s=row.snapshot;
   return{numero:row.numero,snapshot:{idCotizacion:s.idCotizacion,folio:s.folio,nombre:s.nombre,fecha:s.fecha,vencimiento:s.vencimiento,subtotal:s.subtotal,impuestos:s.impuestos,retenciones:s.retenciones,total:s.total,
    conceptos:s.conceptos.map(c=>({idConcepto:c.idConcepto,descripcion:c.descripcion,unidad:c.unidad,cantidad:c.cantidad,precio:c.precio,importe:c.importe,iva:c.iva,retencion:c.retencion}))},respuesta:saved?receipt(saved):null};}
  const [created]=await queryRows<typeof saved>(db,`INSERT INTO cotizacion_respuesta(id_revision,id_invitacion,request_id,huella,decision,nombre,comentario,confirmacion)
   VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,[row.id_revision,known.id_invitacion,response.requestId,responseHash,response.decision,response.nombre,response.comentario]);
  return{respuesta:receipt(created)};
 });}
}
