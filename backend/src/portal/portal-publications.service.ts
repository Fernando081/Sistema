import { ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { DataSource,EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor,queryRows,readSnapshot } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { PortalIdentityService } from './portal-identity.service';
import { PortalQuery } from './portal.dto';
import { PortalPublishDto,PortalSourceDto,PortalWithdrawDto } from './portal-publications.dto';
import { portalDigest,publicationBytes,publicationLimit,publicationSource } from './portal-publication-source';
export interface Publication {
 id:number;tipo:PortalSourceDto['tipo'];origen:number;origenSha256:string;titulo:string;clase:string;mime:string;sha256:string;bytes:number;creadaEn:Date;retirada:boolean;
}
const fields=`p.id_publicacion AS id,p.tipo,p.origen,p.origen_sha256 AS "origenSha256",p.titulo,p.clase,p.mime,p.sha256,p.bytes,p.creada_en AS "creadaEn",(r.id_publicacion IS NOT NULL) AS retirada`;
const tables='portal_publicacion p LEFT JOIN portal_publicacion_retiro r USING(id_publicacion)';
@Injectable()
export class PortalPublicationsService {
 constructor(private readonly source:DataSource,private readonly identity:PortalIdentityService){}
 private async staff(db:QueryExecutor,actor:JwtPayload){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3 AND fn_effective_permission(id_user,role,'portal.publicar') FOR SHARE`,[actor.idUser??null,actor.role,actor.version]);
  if(!u)throw new ForbiddenException('Tu cuenta o permiso de publicación cambió.');await setAuditActor(db,actor.idUser);
 }
 private write<T>(client:number,actor:JwtPayload,work:(db:EntityManager)=>Promise<T>){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");await this.staff(db,actor);
  const [c]=await queryRows(db,'SELECT "IdCliente" FROM cliente WHERE "IdCliente"=$1 FOR UPDATE',[client]);if(!c)throw new NotFoundException('Cliente no encontrado');return work(db);
 });}
 private async lockRequest(db:QueryExecutor,request:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['portal-publicacion:'+request]);}
 private async oldRequest(db:QueryExecutor,request:string){const [r]=await queryRows<{id:number;huella:string;id_cliente:number;action:string}>(db,`SELECT id_publicacion AS id,huella,id_cliente,'publicar' AS action FROM portal_publicacion WHERE request_id=$1
  UNION ALL SELECT r.id_publicacion,r.huella,p.id_cliente,'retirar' FROM portal_publicacion_retiro r JOIN portal_publicacion p USING(id_publicacion) WHERE r.request_id=$1`,[request]);return r;}
 private async get(db:QueryExecutor,client:number,id:number){const [p]=await queryRows<Publication>(db,`SELECT ${fields} FROM ${tables} WHERE p.id_cliente=$1 AND p.id_publicacion=$2`,[client,id]);if(!p)throw new NotFoundException('Publicación no disponible');return p;}
 private async available(db:QueryExecutor,client:number,p:Publication){
  if(p.retirada)return false;
  try{return (await publicationSource(db,client,{tipo:p.tipo,origen:p.origen})).origenSha256===p.origenSha256;}
  catch(error){if(error instanceof NotFoundException||error instanceof ServiceUnavailableException)return false;throw error;}
 }
 adminList(client:number,query:PortalQuery,actor:JwtPayload){return this.write(client,actor,async db=>{
  const [count]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM portal_publicacion WHERE id_cliente=$1',[client]);
  const data=await queryRows<Publication>(db,`SELECT ${fields} FROM ${tables} WHERE p.id_cliente=$1 ORDER BY p.id_publicacion DESC LIMIT 20 OFFSET $2`,[client,(query.page-1)*20]);
  const visible=[];for(const p of data)visible.push({...p,disponible:await this.available(db,client,p)});
  return{data:visible,total:count.total,page:query.page,limit:20};
 });}
 candidates(client:number,tipo:PortalSourceDto['tipo'],query:PortalQuery,actor:JwtPayload){return this.write(client,actor,async db=>{
  // IDs por cliente antes de paginar; jamás SELECT * sobre documentos internos.
  let sql:string;
  if(tipo==='xml'||tipo==='acuse')sql=`SELECT f.id_factura AS origen,'Documento '||f.serie||'-'||f.folio AS titulo FROM factura f JOIN fiscal_documento d ON d.id_factura=f.id_factura
   WHERE f.id_cliente=$1 AND f.serie<>'G' AND f.tipo_comprobante IN('I','E') AND f.estatus::text IN('Timbrada','Pagada','Cancelada') AND d.estado IN('Timbrado','Cancelacion solicitada','Cancelado') AND d.uuid IS NOT NULL
    AND octet_length(${tipo==='xml'?'d.xml_timbrado':'d.acuse_cancelacion'}) BETWEEN 1 AND 2097152`;
  else if(tipo==='cotizacion')sql=`SELECT r.id_revision AS origen,'Cotización '||(r.snapshot->>'folio')||' · revisión '||r.numero AS titulo FROM cotizacion_revision r JOIN cotizacion q USING(id_cotizacion)
   WHERE q.id_cliente=$1 AND (r.snapshot->>'idCliente')::int=$1 AND NOT EXISTS(SELECT 1 FROM cotizacion_revision n WHERE n.id_raiz=r.id_raiz AND n.numero>r.numero)`;
  else if(tipo==='entrega')sql=`SELECT p.id_pedido AS origen,'Entrega de pedido '||p.folio AS titulo FROM pedido_venta p JOIN entrega_pedido d USING(id_pedido) JOIN pedido_entrega_evidencia e USING(id_entrega) WHERE p.id_cliente=$1 AND p.estado IN('Entregado','Facturado')`;
  else throw new NotFoundException('Tipo no disponible');
  const q=query.q?'%'+query.q.replace(/[\\%_]/g,'\\$&')+'%':'';
  const [count]=await queryRows<{total:number}>(db,`WITH scope AS (${sql})SELECT count(*)::int total FROM scope WHERE ($2='' OR titulo ILIKE $2)`,[client,q]);
  const rows=await queryRows<{origen:number;titulo:string}>(db,`WITH scope AS (${sql})SELECT * FROM scope WHERE ($2='' OR titulo ILIKE $2) ORDER BY origen DESC LIMIT 20 OFFSET $3`,[client,q,(query.page-1)*20]);
  const data=[];for(const row of rows){const s=await publicationSource(db,client,{tipo,origen:row.origen});data.push({tipo,origen:row.origen,titulo:s.titulo,clase:s.clase,mime:s.mime,origenSha256:s.origenSha256});}
  return{data,total:count.total,page:query.page,limit:20};
 });}
 preview(client:number,input:PortalSourceDto,actor:JwtPayload){return this.write(client,actor,async db=>{const source=await publicationSource(db,client,input);return{mime:source.mime,clase:source.clase,contenido:await publicationBytes(source)};});}
 publish(client:number,dto:PortalPublishDto,actor:JwtPayload){const request=dto.requestId.toLowerCase(),hash=quoteHash({client,...dto,requestId:request});return this.write(client,actor,async db=>{
  await this.lockRequest(db,request);const old=await this.oldRequest(db,request);
  if(old){if(old.id_cliente!==client||old.huella!==hash||old.action!=='publicar')throw new ConflictException('La clave identifica otra operación.');return this.get(db,client,old.id);}
  const source=await publicationSource(db,client,dto);if(source.origenSha256!==dto.origenSha256)throw new ConflictException('El origen cambió; revisa la vista previa antes de publicar.');
  const [active]=await queryRows(db,`SELECT p.id_publicacion FROM ${tables} WHERE p.id_cliente=$1 AND p.tipo=$2 AND p.origen=$3 AND r.id_publicacion IS NULL`,[client,dto.tipo,dto.origen]);
  if(active)throw new ConflictException('Ya hay una publicación para este origen. Retírala antes de reemplazarla.');
  const [quota]=await queryRows<{n:number}>(db,`SELECT count(*)::int n FROM ${tables} WHERE p.id_cliente=$1 AND r.id_publicacion IS NULL`,[client]);if(quota.n>=500)throw new ConflictException('Máximo500 archivos activos por cliente.');
  const bytes=await publicationBytes(source);if(!bytes.length||bytes.length>publicationLimit)throw new ConflictException('Archivo fuera del límite de2MiB.');
  const [created]=await queryRows<{id:number}>(db,`INSERT INTO portal_publicacion(id_cliente,tipo,origen,origen_sha256,titulo,clase,mime,sha256,bytes,request_id,huella,motivo,id_user)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)RETURNING id_publicacion AS id`,[client,dto.tipo,dto.origen,source.origenSha256,source.titulo,source.clase,source.mime,portalDigest(bytes),bytes.length,request,hash,dto.motivo,actor.idUser]);
  await db.query('INSERT INTO portal_publicacion_archivo(id_publicacion,contenido)VALUES($1,$2)',[created.id,bytes]);return this.get(db,client,created.id);
 });}
 withdraw(client:number,id:number,dto:PortalWithdrawDto,actor:JwtPayload){const request=dto.requestId.toLowerCase(),hash=quoteHash({client,id,...dto,requestId:request});return this.write(client,actor,async db=>{
  await this.lockRequest(db,request);const old=await this.oldRequest(db,request);
  if(old){if(old.id_cliente!==client||old.id!==id||old.huella!==hash||old.action!=='retirar')throw new ConflictException('La clave identifica otra operación.');return this.get(db,client,id);}
  const p=await this.get(db,client,id);if(p.retirada)throw new ConflictException('La publicación ya fue retirada.');
  await db.query('INSERT INTO portal_publicacion_retiro(id_publicacion,request_id,huella,motivo,id_user)VALUES($1,$2,$3,$4,$5)',[id,request,hash,dto.motivo,actor.idUser]);return this.get(db,client,id);
 });}
 list(token:string,query:PortalQuery){return readSnapshot(this.source,async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");const a=await this.identity.identity(db,token),q=query.q?'%'+query.q.replace(/[\\%_]/g,'\\$&')+'%':'';
  const where="p.id_cliente=$1 AND r.id_publicacion IS NULL AND ($2='' OR p.titulo ILIKE $2)";
  const [count]=await queryRows<{total:number}>(db,`SELECT count(*)::int total FROM ${tables} WHERE ${where}`,[a.idCliente,q]);
  const data=await queryRows<Publication>(db,`SELECT ${fields} FROM ${tables} WHERE ${where} ORDER BY p.id_publicacion DESC LIMIT 20 OFFSET $3`,[a.idCliente,q,(query.page-1)*20]);
  const visible=[];for(const p of data){const {origen:_,origenSha256:__,...safe}=p;void _;void __;visible.push({...safe,disponible:await this.available(db,a.idCliente,p)});}
  return{data:visible,total:count.total,page:query.page,limit:20};
 });}
 download(token:string,id:number){return readSnapshot(this.source,async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");const a=await this.identity.identity(db,token),p=await this.get(db,a.idCliente,id);if(p.retirada)throw new NotFoundException('Publicación no disponible');
  const current=await publicationSource(db,a.idCliente,{tipo:p.tipo,origen:p.origen});if(current.origenSha256!==p.origenSha256)throw new NotFoundException('El documento cambió. Solicita una publicación actualizada a tu asesor.');
  const [file]=await queryRows<{contenido:Buffer}>(db,'SELECT contenido FROM portal_publicacion_archivo WHERE id_publicacion=$1',[p.id]);
  if(!file||file.contenido.length!==p.bytes||portalDigest(file.contenido)!==p.sha256)throw new ServiceUnavailableException('El archivo no coincide con su huella.');
  return{mime:p.mime,clase:p.clase,contenido:file.contenido};
 });}
}
