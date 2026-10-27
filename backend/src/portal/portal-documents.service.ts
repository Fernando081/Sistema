import { Injectable,NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { queryRows,readSnapshot } from '../common/database/typed-query';
import { QuoteSnapshot,Revision,verifySnapshot } from '../cotizacion/cotizacion-version-policy';
import { PortalIdentityService } from './portal-identity.service';
import { PortalQuery } from './portal.dto';
interface Line {descripcion:string;cantidad:string;precio?:string;importe?:string;}
export interface PortalDocument {id:number;titulo:string;estado:string;fecha:string;total:string|null;moneda:string|null;detalle:{etiqueta:string;valor:string}[];partidas:Line[];}
interface DocumentRow extends PortalDocument {snapshot?:QuoteSnapshot;sha256?:string;}
// Cada origen filtra cliente ANTES de paginar/contar. Nunca reutiliza listados internos SELECT *.
const scopes:Record<string,string>={
 cotizaciones:`SELECT r.id_cotizacion AS id,'Cotización '||(r.snapshot->>'folio')||' · revisión '||r.numero AS titulo,
   COALESCE(s.decision,'Sin respuesta') AS estado,(r.snapshot->>'fecha')::timestamptz AS fecha,
   r.snapshot->>'total' AS total,'MXN'::text AS moneda,r.snapshot,r.sha256,
   jsonb_build_array(jsonb_build_object('etiqueta','Vencimiento','valor',r.snapshot->>'vencimiento')) AS detalle,'[]'::jsonb AS partidas
   FROM cotizacion_revision r JOIN cotizacion q ON q.id_cotizacion=r.id_cotizacion LEFT JOIN cotizacion_respuesta s USING(id_revision)
   WHERE q.id_cliente=$1 AND (r.snapshot->>'idCliente')::int=$1
    AND NOT EXISTS(SELECT 1 FROM cotizacion_revision n WHERE n.id_raiz=r.id_raiz AND n.numero>r.numero)`,
 pedidos:`SELECT p.id_pedido AS id,'Pedido '||p.folio AS titulo,p.estado,p.created_at AS fecha,p.total::text,'MXN'::text AS moneda,
   '[]'::jsonb AS detalle,COALESCE((SELECT jsonb_agg(jsonb_build_object('descripcion',d.descripcion,'cantidad',d.cantidad::text,'precio',d.valor_unitario::text,'importe',d.importe::text)ORDER BY d.id_detalle)
    FROM pedido_venta_detalle d WHERE d.id_pedido=p.id_pedido),'[]'::jsonb)AS partidas FROM pedido_venta p WHERE p.id_cliente=$1 AND p.estado<>'Borrador'`,
 facturas:`SELECT f.id_factura AS id,'Documento '||f.serie||'-'||f.folio AS titulo,f.estatus::text AS estado,f.fecha_emision AS fecha,f.total::text,f.moneda,
   jsonb_build_array(jsonb_build_object('etiqueta','Tipo de comprobante','valor',f.tipo_comprobante),
    jsonb_build_object('etiqueta','Estado fiscal registrado','valor',COALESCE(fd.estado,'Sin registro fiscal')))AS detalle,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('descripcion',c.descripcion,'cantidad',c.cantidad::text,'precio',c.valor_unitario::text,'importe',c.importe::text)ORDER BY c.id_concepto)
    FROM conceptofactura c WHERE c.id_factura=f.id_factura),'[]'::jsonb)AS partidas
   FROM factura f LEFT JOIN fiscal_documento fd ON fd.id_factura=f.id_factura WHERE f.id_cliente=$1 AND f.serie<>'G' AND f.tipo_comprobante IN('I','E') AND f.estatus::text IN('Timbrada','Pagada','Cancelada')`,
 unidades:`SELECT u.id_unidad AS id,COALESCE(NULLIF(u.numero_economico,''),NULLIF(u.vin,''),u.esn) AS titulo,'Registrada'::text AS estado,u.created_at AS fecha,NULL::text AS total,NULL::text AS moneda,
   jsonb_build_array(jsonb_build_object('etiqueta','VIN','valor',COALESCE(u.vin,'Sin VIN')),
    jsonb_build_object('etiqueta','ESN','valor',COALESCE(u.esn,'Sin ESN')),jsonb_build_object('etiqueta','Marca / modelo','valor',concat_ws(' ',u.marca,u.modelo,u.anio)),
    jsonb_build_object('etiqueta','Motor','valor',COALESCE(u.motor,'Sin especificar')))AS detalle,'[]'::jsonb AS partidas
   FROM crm_unidad_cliente u WHERE u.id_cliente=$1`,
 garantias:`SELECT g.id_garantia AS id,'Garantía '||g.id_garantia||' · '||f.serie||'-'||f.folio AS titulo,g.estado,g.created_at AS fecha,NULL::text AS total,NULL::text AS moneda,
   jsonb_build_array(jsonb_build_object('etiqueta','Producto','valor',c.descripcion),jsonb_build_object('etiqueta','Cantidad','valor',g.cantidad::text),
    jsonb_build_object('etiqueta','Fecha compromiso registrada','valor',COALESCE(g.fecha_compromiso::text,'Por confirmar')))AS detalle,'[]'::jsonb AS partidas
   FROM garantia g JOIN factura f ON f.id_factura=g.id_factura JOIN conceptofactura c ON c.id_concepto=g.id_concepto AND c.id_factura=f.id_factura WHERE f.id_cliente=$1`,
};
@Injectable()
export class PortalDocumentsService {
 constructor(private readonly source:DataSource,private readonly identity:PortalIdentityService){}
 private scope(kind:string){if(!Object.hasOwn(scopes,kind))throw new NotFoundException('Sección no disponible');return scopes[kind];}
 private project(row:DocumentRow):PortalDocument {
  let partidas=row.partidas;
  if(row.snapshot){verifySnapshot({snapshot:row.snapshot,sha256:row.sha256}as Revision);partidas=row.snapshot.conceptos.map(c=>({descripcion:c.descripcion,cantidad:c.cantidad,precio:c.precio,importe:c.importe}));}
  return{id:row.id,titulo:row.titulo,estado:row.estado,fecha:row.fecha,total:row.total,moneda:row.moneda,detalle:row.detalle,partidas};
 }
 list(token:string,kind:string,query:PortalQuery){const scope=this.scope(kind);return readSnapshot(this.source,async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");const a=await this.identity.identity(db,token),q=query.q?'%'+query.q.replace(/[\\%_]/g,'\\$&')+'%':'';
  const [count]=await queryRows<{total:number}>(db,`WITH scope AS (${scope})SELECT count(*)::int AS total FROM scope WHERE ($2='' OR concat_ws(' ',titulo,detalle::text) ILIKE $2)`,[a.idCliente,q]);
  const rows=await queryRows<DocumentRow>(db,`WITH scope AS (${scope})SELECT * FROM scope WHERE ($2='' OR concat_ws(' ',titulo,detalle::text) ILIKE $2) ORDER BY fecha DESC,id DESC LIMIT 20 OFFSET $3`,[a.idCliente,q,(query.page-1)*20]);
  return{data:rows.map(row=>{const {partidas:_,detalle:__,...summary}=this.project(row);void _;void __;return summary;}),total:count.total,page:query.page,limit:20};
 });}
 one(token:string,kind:string,id:number){const scope=this.scope(kind);return readSnapshot(this.source,async db=>{
  await db.query("SET LOCAL statement_timeout='5s'");const a=await this.identity.identity(db,token);
  const [row]=await queryRows<DocumentRow>(db,`WITH scope AS (${scope})SELECT * FROM scope WHERE id=$2`,[a.idCliente,id]);
  if(!row)throw new NotFoundException('Documento no disponible');return this.project(row);
 });}
 async pdf(token:string,kind:string,id:number){const doc=await this.one(token,kind,id);
  const definition:TDocumentDefinitions={pageSize:'LETTER',pageMargins:40,defaultStyle:{font:'Helvetica',fontSize:10},content:[
   {text:'Refacciones y Tractorepuestos Tampico',fontSize:17,bold:true},{text:doc.titulo,fontSize:14,margin:[0,14,0,8]},
   {text:'RESUMEN INFORMATIVO DEL PORTAL - NO ES CFDI',bold:true},{text:'Estado registrado: '+doc.estado},
   {text:'Fecha: '+new Date(doc.fecha).toISOString()},...(doc.total===null?[]:[{text:'Total del documento: '+doc.total+' '+(doc.moneda??'Sin moneda')}]),
   ...doc.detalle.map(v=>({text:v.etiqueta+': '+v.valor,margin:[0,4,0,4]as[number,number,number,number]})),
   ...(doc.partidas.length?[{table:{headerRows:1,widths:['*','auto','auto','auto'],body:[['Descripción','Cantidad','Precio','Importe'],...doc.partidas.map(p=>[p.descripcion,p.cantidad,p.precio??'—',p.importe??'—'])]},margin:[0,12,0,12]as[number,number,number,number]}]:[]),
   {text:'Consulta de datos registrados. No acredita pago, saldo conciliado, compatibilidad, aceptación de cotización ni cobertura de garantía. Los datos fiscales pueden ser simulados durante el desarrollo. Confirma las condiciones con tu asesor.',fontSize:9,margin:[0,14,0,0]},
  ]};
  const printer=new PdfPrinter({Helvetica:{normal:'Helvetica',bold:'Helvetica-Bold',italics:'Helvetica-Oblique',bolditalics:'Helvetica-BoldOblique'}});
  return new Promise<Buffer>((resolve,reject)=>{const pdf=printer.createPdfKitDocument(definition),chunks:Buffer[]=[];pdf.on('data',(chunk:Buffer)=>chunks.push(chunk));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);pdf.end();});
 }
}
