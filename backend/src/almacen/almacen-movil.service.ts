import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { RolUsuario } from '../common/enums/app.enums';
import { AnularPickingDto, MovilPageQuery, VerificarPickingDto } from './almacen-movil.dto';
export interface MobileOrder {id:number;folio:string;estado:string;version:number;}
export interface MobilePick {
 id:string;idProducto:number;idUbicacion:number;codigo:string;producto:string;almacen:string;ubicacion:string;
 cantidad:string;verificada:string;pendiente:string;estado:string;habilitada:boolean;revision:number;
 evaluacionSha256?:string;
}
export interface MobileEvent {id:string;idSurtido:string;codigo:string;ubicacion:string;accion:string;cantidad:string;idAnulada:string|null;metodo:string|null;motivo:string|null;actor:number;autor:string;creadaEn:Date;anulada:boolean;}
const activeStates=['Parcialmente surtido','Surtido'];
const pickSql=`SELECT ps.id_surtido::text AS id,ps.id_producto AS "idProducto",ps.id_ubicacion AS "idUbicacion",
 p."Codigo" AS codigo,p."Descripcion" AS producto,a.codigo AS almacen,u.codigo AS ubicacion,
 ps.cantidad::text AS cantidad,v.total::text AS verificada,(ps.cantidad-v.total)::text AS pendiente,
 ps.estado,(ps.estado='Reservada' AND a.activo AND u.activa AND o.estado IN('Parcialmente surtido','Surtido')) AS habilitada,v.revision
 FROM pedido_surtido_ubicacion ps JOIN pedido_venta o ON o.id_pedido=ps.id_pedido JOIN producto p ON p."IdProducto"=ps.id_producto
 JOIN almacen_ubicacion u ON u.id_ubicacion=ps.id_ubicacion JOIN almacen a ON a.id_almacen=u.id_almacen
 CROSS JOIN LATERAL(SELECT coalesce(sum(CASE accion WHEN 'Verificar' THEN cantidad ELSE -cantidad END),0) AS total,count(*)::int AS revision
   FROM almacen_picking_verificacion WHERE id_surtido=ps.id_surtido)v`;
@Injectable()
export class AlmacenMovilService {
 constructor(private readonly source:DataSource){}
 private id(id:number){if(!Number.isInteger(id)||id<1||id>2147483647)throw new BadRequestException('Identificador fuera de rango.');}
 private async staff(db:QueryExecutor,actor:JwtPayload,lock=false){
  const [u]=await queryRows(db,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3 AND role IN('admin','user') AND fn_effective_permission(id_user,role,'inventario.escanear') ${lock?'FOR SHARE':''}`,[actor.idUser,actor.role,actor.version]);
  if(!u)throw new ForbiddenException('Tu cuenta o permiso de escaneo cambió.');
 }
 private read<T>(actor:JwtPayload,work:(db:QueryExecutor)=>Promise<T>){return readSnapshot(this.source,async db=>{await db.query("SET LOCAL statement_timeout='8s'");await this.staff(db,actor);return work(db);});}
 list(q:MovilPageQuery,actor:JwtPayload){return this.read(actor,async db=>{
  const where=`WHERE EXISTS(SELECT 1 FROM pedido_surtido_ubicacion s WHERE s.id_pedido=p.id_pedido)
    AND ($1::text='todos' OR p.estado IN('Parcialmente surtido','Surtido')) AND p.folio::text ILIKE $2 ESCAPE '\\'`;
  const params=[q.estado,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'];
  const [c]=await queryRows<{total:number}>(db,`SELECT count(*)::int total FROM pedido_venta p ${where}`,params);
  const data=await queryRows<MobileOrder>(db,`SELECT p.id_pedido AS id,p.folio::text,p.estado,p.version FROM pedido_venta p ${where} ORDER BY p.updated_at DESC,p.id_pedido DESC LIMIT 20 OFFSET $3`,[...params,(q.page-1)*20]);return{data,total:c.total,page:q.page};
 });}
 private async order(db:QueryExecutor,id:number,lock=false){this.id(id);const [o]=await queryRows<MobileOrder>(db,`SELECT id_pedido AS id,folio::text,estado,version FROM pedido_venta WHERE id_pedido=$1 ${lock?'FOR UPDATE':''}`,[id]);if(!o)throw new NotFoundException('Pedido no encontrado.');return o;}
 private hash(o:MobileOrder,p:MobilePick){return quoteHash({pedido:o,partida:p});}
 detail(id:number,page:number,actor:JwtPayload){return this.read(actor,async db=>{
  const pedido=await this.order(db,id),[c]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM pedido_surtido_ubicacion WHERE id_pedido=$1',[id]);
  const rows=await queryRows<MobilePick>(db,`${pickSql} WHERE ps.id_pedido=$1 ORDER BY ps.id_surtido LIMIT 20 OFFSET $2`,[id,(page-1)*20]);
  return{pedido,data:rows.map(p=>({...p,evaluacionSha256:this.hash(pedido,p)})),total:c.total,page,idUsuario:actor.idUser,administrador:actor.role===RolUsuario.ADMIN};
 });}
 history(id:number,page:number,actor:JwtPayload){return this.read(actor,async db=>{
  await this.order(db,id);const [c]=await queryRows<{total:number}>(db,'SELECT count(*)::int total FROM almacen_picking_verificacion WHERE id_pedido=$1',[id]);
  const data=await queryRows<MobileEvent>(db,`SELECT v.id,v.id_surtido::text AS "idSurtido",v.accion,v.cantidad::text,v.id_anulada AS "idAnulada",v.metodo,v.motivo,v.id_actor AS actor,u.username AS autor,v.creada_en AS "creadaEn",
    coalesce(v.snapshot->'partida',original.snapshot->'partida')->>'codigo' AS codigo,
    concat_ws('/',coalesce(v.snapshot->'partida',original.snapshot->'partida')->>'almacen',coalesce(v.snapshot->'partida',original.snapshot->'partida')->>'ubicacion') AS ubicacion,
    EXISTS(SELECT 1 FROM almacen_picking_verificacion a WHERE a.id_anulada=v.id) AS anulada FROM almacen_picking_verificacion v JOIN auth_user u ON u.id_user=v.id_actor LEFT JOIN almacen_picking_verificacion original ON original.id=v.id_anulada WHERE v.id_pedido=$1 ORDER BY v.creada_en DESC,v.id LIMIT 20 OFFSET $2`,[id,(page-1)*20]);return{data,total:c.total,page};
 });}
 private async write<T>(id:number,actor:JwtPayload,work:(db:EntityManager,o:MobileOrder)=>Promise<T>){return this.source.transaction(async db=>{
  await db.query("SET LOCAL statement_timeout='10s'");const o=await this.order(db,id,true);await this.staff(db,actor,true);await setAuditActor(db,actor.idUser);return work(db,o);
 });}
 private async previous(db:QueryExecutor,id:string,hash:string){const [r]=await queryRows<{id:string;huella:string}>(db,'SELECT id,huella FROM almacen_picking_verificacion WHERE id=$1',[id]);if(r&&r.huella!==hash)throw new ConflictException('El identificador corresponde a otra operación.');return r?{id:r.id}:null;}
 verify(id:number,d:VerificarPickingDto,actor:JwtPayload){
  if(BigInt(d.idSurtido)>9223372036854775807n)throw new BadRequestException('Referencia de picking fuera de rango.');
  const request=d.requestId.toLowerCase(),hash=quoteHash({pedido:id,actor:actor.idUser,accion:'Verificar',...d,requestId:request});
  return this.write(id,actor,async(db,o)=>{
   const old=await this.previous(db,request,hash);if(old)return old;
   const [p]=await queryRows<MobilePick>(db,`${pickSql} WHERE ps.id_pedido=$1 AND ps.id_surtido=$2`,[id,d.idSurtido]);
   if(!p)throw new NotFoundException('Partida de picking no encontrada.');
   if(!p.habilitada||!activeStates.includes(o.estado))throw new ConflictException('El pedido o la ubicación ya no permite verificar.');
   if(this.hash(o,p)!==d.evaluacionSha256)throw new ConflictException('El picking cambió. Actualiza y vuelve a revisar los códigos.');
   if(![p.codigo,`RTT1:P:${p.idProducto}`].includes(d.producto))throw new BadRequestException('El producto leído no coincide con la partida.');
   if(![`${p.almacen}/${p.ubicacion}`,`RTT1:U:${p.idUbicacion}`].includes(d.ubicacion))throw new BadRequestException('La ubicación leída no coincide. Incluye almacén/ubicación o usa su QR.');
   const [valid]=await queryRows<{ok:boolean}>(db,'SELECT $1::numeric>0 AND $1::numeric<=$2::numeric AS ok',[d.cantidad,p.pendiente]);if(!valid.ok)throw new ConflictException('La cantidad debe ser positiva y no superar el pendiente.');
   await db.query(`INSERT INTO almacen_picking_verificacion(id,id_pedido,id_surtido,accion,cantidad,metodo,id_actor,huella,snapshot) VALUES($1,$2,$3,'Verificar',$4,$5,$6,$7,$8::jsonb)`,[request,id,p.id,d.cantidad,d.metodo,actor.idUser,hash,JSON.stringify({version:1,pedido:o,partida:p,codigoProducto:`RTT1:P:${p.idProducto}`,codigoUbicacion:`RTT1:U:${p.idUbicacion}`})]);return{id:request};
  });
 }
 cancel(id:number,d:AnularPickingDto,actor:JwtPayload){const request=d.requestId.toLowerCase(),hash=quoteHash({pedido:id,actor:actor.idUser,accion:'Anular',...d,requestId:request});return this.write(id,actor,async(db,o)=>{
  const old=await this.previous(db,request,hash);if(old)return old;
  const [v]=await queryRows<{id:string;id_surtido:string;cantidad:string;id_actor:number}>(db,"SELECT id,id_surtido::text,cantidad::text,id_actor FROM almacen_picking_verificacion WHERE id=$1 AND id_pedido=$2 AND accion='Verificar'",[d.idVerificacion,id]);
  if(!v||(actor.role!==RolUsuario.ADMIN&&v.id_actor!==actor.idUser))throw new NotFoundException('Verificación no encontrada.');
  if(!activeStates.includes(o.estado))throw new ConflictException('El pedido ya no permite corregir verificaciones.');
  if((await queryRows(db,'SELECT 1 FROM almacen_picking_verificacion WHERE id_anulada=$1',[v.id])).length)throw new ConflictException('La verificación ya fue anulada.');
  await db.query(`INSERT INTO almacen_picking_verificacion(id,id_pedido,id_surtido,accion,cantidad,id_anulada,motivo,id_actor,huella,snapshot) VALUES($1,$2,$3,'Anular',$4,$5,$6,$7,$8,$9::jsonb)`,[request,id,v.id_surtido,v.cantidad,v.id,d.motivo,actor.idUser,hash,JSON.stringify({version:1,idVerificacion:v.id})]);return{id:request};
 });}
 async label(kind:string,id:number,actor:JwtPayload):Promise<Buffer>{this.id(id);if(!['producto','ubicacion'].includes(kind))throw new BadRequestException('Tipo de etiqueta inválido.');
  const row=await this.read(actor,async db=>{
   const [r]=await queryRows<{codigo:string;descripcion:string}>(db,kind==='producto'?`SELECT "Codigo" AS codigo,"Descripcion" AS descripcion FROM producto WHERE "IdProducto"=$1`:`SELECT a.codigo||'/'||u.codigo AS codigo,a.nombre AS descripcion FROM almacen_ubicacion u JOIN almacen a ON a.id_almacen=u.id_almacen WHERE u.id_ubicacion=$1 AND u.activa AND a.activo`,[id]);if(!r)throw new NotFoundException('Producto o ubicación no encontrado.');return r;
  });
  const code=`RTT1:${kind==='producto'?'P':'U'}:${id}`,printer=new PdfPrinter({Helvetica:{normal:'Helvetica',bold:'Helvetica-Bold',italics:'Helvetica-Oblique',bolditalics:'Helvetica-BoldOblique'}});
  const def:TDocumentDefinitions={pageSize:{width:285,height:340},pageMargins:20,defaultStyle:{font:'Helvetica',color:'#111111'},content:[
   {text:'Refacciones y Tractorepuestos\nTampico',fontSize:11,bold:true,alignment:'center',margin:[0,0,0,12]},
   {qr:code,fit:132,alignment:'center',eccLevel:'M',margin:[0,0,0,10]},
   {text:row.codigo.slice(0,160),fontSize:13,bold:true,alignment:'center',margin:[0,0,0,6]},
   {text:row.descripcion.slice(0,160),fontSize:9,alignment:'center',margin:[0,0,0,8]},
   {text:code,fontSize:8,alignment:'center'},
  ]};const doc=printer.createPdfKitDocument(def);return new Promise((resolve,reject)=>{const chunks:Buffer[]=[];doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});
 }
}
