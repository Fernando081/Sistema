import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isEmail } from 'class-validator';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { RolUsuario } from '../common/enums/app.enums';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { DocumentosVentaService } from './documentos-venta.service';
import { EmailFacturaRow } from './venta.types';
import { SalidaCancelarDto, SalidaCerrarDto, SalidaPrepararDto } from './salida-documentos.dto';

interface Origin { id_factura:number; id_cliente:number; estatus:string; id_factura_global:number|null; }
interface Intent { id:string; id_actor:number; huella:string; origen_sha256:string; contenido_sha256:string; pdf_sha256:string; bytes:number; }
interface Payload { destinatario:string; asunto:string; cuerpo:string; contenido:Buffer; }
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');

@Injectable()
export class SalidaDocumentosService {
 constructor(private readonly db:DataSource,private readonly documents:DocumentosVentaService){}
 private id(id:number){if(!Number.isInteger(id)||id<1||id>2147483647)throw new BadRequestException('Factura fuera de rango.');}
 private async staff(db:QueryExecutor,actor:JwtPayload,lock=false){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND role=$2 AND token_version=$3
   AND is_active AND role IN('admin','user') AND fn_effective_permission(id_user,role,'ventas.correo.gestionar') ${lock?'FOR SHARE':''}`,[actor.idUser,actor.role,actor.version]);
  if(!u)throw new ForbiddenException('Tu cuenta o permiso de documentos cambió.');
 }
 private async origin(db:QueryExecutor,id:number,lock=false){
  this.id(id);const [o]=await queryRows<Origin>(db,`SELECT id_factura,id_cliente,estatus,id_factura_global FROM factura WHERE id_factura=$1 ${lock?'FOR UPDATE':''}`,[id]);
  if(!o)throw new NotFoundException('Factura no encontrada.');return o;
 }
 private async source(db:QueryExecutor,o:Origin,lock=false){
  if(o.estatus==='Cancelada'||o.id_factura_global!=null)throw new ConflictException('La factura cancelada o incluida en una global no admite preparar correo.');
  if(lock)await db.query('SELECT 1 FROM cliente WHERE "IdCliente"=$1 FOR SHARE',[o.id_cliente]);
  // La función histórica inserta historial antes de enviar. La revisión debe
  // ser pura y no registrar un correo ficticiamente enviado o intentado.
  const [mail]=await queryRows<EmailFacturaRow>(db,`SELECT c.email AS destinatario,
   concat('Documento ',f.serie,f.folio,' - Refacciones y Tractorepuestos Tampico') AS asunto,
   concat('Estimado(a) ',c."RazonSocial",E',\n\nDocumento ',f.serie,f.folio,E'.\nGracias por su preferencia.\nRefacciones y Tractorepuestos Tampico') AS cuerpo_mensaje,
   'documento.pdf' AS nombre_archivo FROM factura f JOIN cliente c ON c."IdCliente"=f.id_cliente WHERE f.id_factura=$1`,[o.id_factura]);
  if(!mail)throw new BadRequestException('No hay datos de correo para esta factura.');
  const destination=mail.destinatario?.trim()||'';
  if(destination.length>254||!isEmail(destination,{allow_utf8_local_part:false})||/[\r\n,;<>]/.test(destination))throw new BadRequestException('Revisa el correo registrado del cliente; se requiere una sola dirección válida.');
  if(!mail.asunto||mail.asunto.length>300||/[\r\n]/.test(mail.asunto)||!mail.cuerpo_mensaje||mail.cuerpo_mensaje.length>4000)throw new BadRequestException('El contenido de correo no cumple los límites.');
  const ticket=await this.documents.datosPdf(o.id_factura,db),ambiente=ticket.fiscal?.environment||'mock';
  if(!['mock','sandbox','production'].includes(ambiente))throw new ConflictException('Ambiente fiscal no reconocido.');
  const content={destinatario:destination,asunto:mail.asunto,cuerpo:mail.cuerpo_mensaje};
  return{content,ticket,ambiente,hash:quoteHash({origen:o,content,ticket})};
 }
 preview(id:number,actor:JwtPayload){return readSnapshot(this.db,async db=>{
  await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);const o=await this.origin(db,id),s=await this.source(db,o);
  return{idFactura:id,folio:s.ticket.folio,destinatario:s.content.destinatario,asunto:s.content.asunto,ambiente:s.ambiente,evaluacionSha256:s.hash,modo:'Local' as const};
 });}
 prepare(id:number,d:SalidaPrepararDto,actor:JwtPayload){const request=d.requestId.toLowerCase(),hash=quoteHash({factura:id,actor:actor.idUser,requestId:request,evaluacion:d.evaluacionSha256});
  return this.db.transaction(async db=>{
   await db.query("SET LOCAL statement_timeout='10s'");const o=await this.origin(db,id,true);await this.staff(db,actor,true);
   const [old]=await queryRows<Intent>(db,'SELECT id,huella FROM documento_salida WHERE id=$1',[request]);
   if(old){if(old.huella!==hash)throw new ConflictException('El identificador corresponde a otra solicitud.');return{id:old.id};}
   const s=await this.source(db,o,true);if(s.hash!==d.evaluacionSha256)throw new ConflictException('Cambió el destinatario o documento. Actualiza y vuelve a revisar.');
   const [count]=await queryRows<{n:number}>(db,'SELECT count(*)::int n FROM documento_salida WHERE id_factura=$1',[id]);if(count.n>=20)throw new ConflictException('Máximo20 preparaciones conservadas por factura en esta fase local.');
   const pdf=await this.documents.renderPdf(s.ticket);if(pdf.length>2097152||pdf.length<1)throw new ConflictException('El PDF supera el límite de2MiB.');
   const pdfHash=sha(pdf),payloadHash=quoteHash({...s.content,pdfSha256:pdfHash});await setAuditActor(db,actor.idUser);
   await db.query(`INSERT INTO documento_salida(id,id_factura,id_cliente,id_actor,origen_sha256,contenido_sha256,pdf_sha256,huella,ambiente,bytes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[request,id,o.id_cliente,actor.idUser,s.hash,payloadHash,pdfHash,hash,s.ambiente,pdf.length]);
   await db.query('INSERT INTO documento_salida_archivo(id,destinatario,asunto,cuerpo,contenido)VALUES($1,$2,$3,$4,$5)',[request,s.content.destinatario,s.content.asunto,s.content.cuerpo,pdf]);return{id:request};
  });
 }
 private async intent(db:QueryExecutor,id:number,request:string,actor:JwtPayload,lock=false){
  const [r]=await queryRows<Intent>(db,`SELECT * FROM documento_salida WHERE id=$1 AND id_factura=$2 AND ($3::boolean OR id_actor=$4) ${lock?'FOR UPDATE':''}`,[request,id,actor.role===RolUsuario.ADMIN,actor.idUser]);
  if(!r)throw new NotFoundException('Solicitud no encontrada.');return r;
 }
 list(id:number,page:number,actor:JwtPayload){return readSnapshot(this.db,async db=>{
  await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);await this.origin(db,id);
  const params=[id,actor.role===RolUsuario.ADMIN,actor.idUser],where='s.id_factura=$1 AND ($2::boolean OR s.id_actor=$3)';
  const [c]=await queryRows<{n:number}>(db,`SELECT count(*)::int n FROM documento_salida s WHERE ${where}`,params);
  const data=await queryRows<{id:string}>(db,`SELECT s.id,s.creada_en AS "creadaEn",s.ambiente,s.bytes,s.pdf_sha256 AS "pdfSha256",u.username AS autor,
    coalesce(c.accion,'Preparado') AS estado,c.creada_en AS "cerradaEn",c.motivo,a.destinatario,a.asunto
    FROM documento_salida s JOIN documento_salida_archivo a ON a.id=s.id JOIN auth_user u ON u.id_user=s.id_actor
    LEFT JOIN documento_salida_cierre c ON c.id=s.id WHERE ${where} ORDER BY s.creada_en DESC,s.id LIMIT 20 OFFSET $4`,[...params,(page-1)*20]);
  return{data,total:c.n,page,modo:'Local' as const};
 });}
 close(id:number,request:string,d:SalidaCerrarDto|SalidaCancelarDto,actor:JwtPayload,cancel=false){
  request=request.toLowerCase();
  const key=d.requestId.toLowerCase(),motivo='motivo'in d?d.motivo:null,hash=quoteHash({factura:id,id:request,requestId:key,actor:actor.idUser,accion:cancel?'Cancelar':'Simular',motivo});
  return this.db.transaction(async db=>{
   await db.query("SET LOCAL statement_timeout='10s'");const o=await this.origin(db,id,true),r=await this.intent(db,id,request,actor,true);await this.staff(db,actor,true);
   const [old]=await queryRows<{id:string;huella:string;accion:string}>(db,'SELECT id,huella,accion FROM documento_salida_cierre WHERE request_id=$1 OR id=$2',[key,request]);
   if(old){if(old.huella!==hash)throw new ConflictException('La solicitud ya tiene un cierre o el identificador fue usado.');return{id:old.id,estado:old.accion,envioExterno:false};}
   let action='Cancelado';
   if(!cancel){
    const [payload]=await queryRows<Payload>(db,'SELECT * FROM documento_salida_archivo WHERE id=$1',[request]);
    if(!payload||payload.contenido.length!==r.bytes||sha(payload.contenido)!==r.pdf_sha256||quoteHash({destinatario:payload.destinatario,asunto:payload.asunto,cuerpo:payload.cuerpo,pdfSha256:r.pdf_sha256})!==r.contenido_sha256)throw new ConflictException('El documento conservado no coincide con su huella.');
    try{const current=await this.source(db,o,true);action=current.hash===r.origen_sha256?'Simulado':'Obsoleto';}
    catch(e){if(e instanceof BadRequestException||e instanceof ConflictException)action='Obsoleto';else throw e;}
   }
   await setAuditActor(db,actor.idUser);await db.query('INSERT INTO documento_salida_cierre(id,request_id,huella,accion,motivo,id_actor)VALUES($1,$2,$3,$4,$5,$6)',[request,key,hash,action,cancel?motivo:null,actor.idUser]);
   return{id:request,estado:action,envioExterno:false};
  });
 }
 file(id:number,request:string,actor:JwtPayload){return readSnapshot(this.db,async db=>{
  await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);this.id(id);const r=await this.intent(db,id,request,actor);
  const [file]=await queryRows<{contenido:Buffer}>(db,'SELECT contenido FROM documento_salida_archivo WHERE id=$1',[request]);
  if(!file||file.contenido.length!==r.bytes||sha(file.contenido)!==r.pdf_sha256)throw new ConflictException('El archivo conservado no coincide con su huella.');return file.contenido;
 });}
}
