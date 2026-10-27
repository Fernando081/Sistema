import { NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { QueryExecutor,queryRows } from '../common/database/typed-query';
import { quoteHash,Revision,verifySnapshot } from '../cotizacion/cotizacion-version-policy';
import { Snapshot } from '../pedido/entrega-evidencia.service';
import { PortalSourceDto } from './portal-publications.dto';
export const portalDigest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export const publicationLimit=2*1024*1024;
export interface PublicationSource {
 titulo:string;clase:'mock'|'sandbox'|'production'|'copia';mime:'application/xml'|'application/pdf';origenSha256:string;
 xml?:Buffer;definition?:TDocumentDefinitions;
}
const unavailable=()=>new NotFoundException('Origen no disponible para este cliente; revisa su estado y la última revisión.');
function definition(title:string,lines:TDocumentDefinitions['content']):TDocumentDefinitions {
 return{pageSize:'LETTER',pageMargins:40,defaultStyle:{font:'Helvetica',fontSize:10},content:[
  {text:'Refacciones y Tractorepuestos Tampico',fontSize:17,bold:true},{text:title,fontSize:14,margin:[0,12,0,10]},
  {text:'COPIA DOCUMENTAL PARA CLIENTE - NO ES CFDI',bold:true},...(Array.isArray(lines)?lines:[lines]),
  {text:'Copia de datos conservados en el ERP. No acredita pago, identidad, firma avanzada ni aceptación comercial. No incluye anexos privados del expediente.',margin:[0,14,0,0],fontSize:9},
 ]};
}
// Sólo orígenes enumerados. No rutas del disco, URLs, payloads del PAC ni archivos subidos.
export async function publicationSource(db:QueryExecutor,client:number,input:PortalSourceDto):Promise<PublicationSource>{
 const {tipo,origen}=input;
 if(tipo==='xml'||tipo==='acuse'){
  const [row]=await queryRows<{titulo:string;ambiente:PublicationSource['clase'];proveedor:string;estado:string;xml:string;uuid:string}>(db,`SELECT 'Documento '||f.serie||'-'||f.folio AS titulo,d.ambiente,d.proveedor,d.estado,d.uuid,
   CASE WHEN $3='xml' THEN d.xml_timbrado ELSE d.acuse_cancelacion END AS xml
   FROM factura f JOIN fiscal_documento d ON d.id_factura=f.id_factura
   WHERE f.id_cliente=$1 AND f.id_factura=$2 AND f.serie<>'G' AND f.tipo_comprobante IN('I','E')
    AND f.estatus::text IN('Timbrada','Pagada','Cancelada') AND d.estado IN('Timbrado','Cancelacion solicitada','Cancelado')
    AND d.uuid IS NOT NULL AND octet_length(CASE WHEN $3='xml' THEN d.xml_timbrado ELSE d.acuse_cancelacion END) BETWEEN 1 AND 2097152`,[client,origen,tipo]);
  if(!row||!['mock','sandbox','production'].includes(row.ambiente)||!((row.ambiente==='mock'&&row.proveedor==='mock')||(row.ambiente!=='mock'&&row.proveedor==='sw')))throw unavailable();
  if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(row.xml)||(row.ambiente==='production'&&/MOCK|SIN VALIDEZ FISCAL|MockCancellation/i.test(row.xml)))throw new ServiceUnavailableException('XML no publicable; requiere revisión fiscal.');
  const xml=Buffer.from(row.xml,'utf8'),titulo=(tipo==='acuse'?'Acuse · ':'XML · ')+row.titulo;
  return{titulo,clase:row.ambiente,mime:'application/xml',xml,origenSha256:quoteHash({v:1,client,tipo,origen,titulo,ambiente:row.ambiente,proveedor:row.proveedor,estado:row.estado,uuid:row.uuid,sha:portalDigest(xml)})};
 }
 if(tipo==='cotizacion'){
  const [r]=await queryRows<Revision>(db,`SELECT r.* FROM cotizacion_revision r JOIN cotizacion q USING(id_cotizacion)
   WHERE q.id_cliente=$1 AND r.id_revision=$2 AND (r.snapshot->>'idCliente')::int=$1
    AND NOT EXISTS(SELECT 1 FROM cotizacion_revision n WHERE n.id_raiz=r.id_raiz AND n.numero>r.numero)`,[client,origen]);
  if(!r)throw unavailable();verifySnapshot(r);const s=r.snapshot,titulo=`Cotización ${s.folio} · revisión ${r.numero}`;
  return{titulo,clase:'copia',mime:'application/pdf',origenSha256:quoteHash({v:1,client,tipo,origen,sha:r.sha256}),definition:definition(titulo,[
   {text:'Cliente: '+s.nombre},{text:'Fecha: '+s.fecha},{text:'Vencimiento registrado: '+s.vencimiento},
   {table:{headerRows:1,widths:['*','auto','auto','auto'],body:[['Descripción','Cantidad','Precio MXN','Importe MXN'],...s.conceptos.map(c=>[c.descripcion,c.cantidad,c.precio,c.importe])]},margin:[0,10,0,10]},
   {text:`Subtotal: ${s.subtotal} · Impuestos: ${s.impuestos} · Retenciones: ${s.retenciones} · Total: ${s.total} MXN`},
   {text:'Propuesta versionada conservada. La consulta/descarga no acepta ni reserva mercancía. Huella del snapshot: '+r.sha256,fontSize:8},
  ])};
 }
 if(tipo==='entrega'){
  const [e]=await queryRows<{id_entrega:string;creada_en:Date;snapshot:Snapshot;sha256:string;calculada:string}>(db,`SELECT e.id_entrega,e.creada_en,e.snapshot,e.sha256,encode(sha256(convert_to(e.snapshot::text,'UTF8')),'hex') AS calculada
   FROM pedido_venta p JOIN entrega_pedido d ON d.id_pedido=p.id_pedido JOIN pedido_entrega_evidencia e USING(id_entrega)
   WHERE p.id_cliente=$1 AND p.id_pedido=$2 AND p.estado IN('Entregado','Facturado')`,[client,origen]);
  if(!e)throw unavailable();if(e.sha256!==e.calculada)throw new ServiceUnavailableException('La entrega no coincide con su huella.');
  const s=e.snapshot,titulo=`Entrega de pedido ${s.folio}`;
  return{titulo,clase:'copia',mime:'application/pdf',origenSha256:quoteHash({v:1,client,tipo,origen,sha:e.sha256}),definition:definition(titulo,[
   {text:'Cliente: '+s.cliente},{text:'Fecha de registro: '+new Date(e.creada_en).toISOString()},
   {table:{headerRows:1,widths:['auto','*','auto'],body:[['Parte','Descripción','Cantidad'],...s.partidas.map(p=>[p.codigo,p.descripcion,p.cantidad])]},margin:[0,10,0,10]},
   {text:'Copia de entrega V02; no incluye receptor, notas internas, ubicación, firma ni fotografías.'},
   {text:'Huella del snapshot conservado: '+e.sha256,fontSize:8},
  ])};
 }
 throw unavailable();
}
export async function publicationBytes(source:PublicationSource){
 if(source.xml)return source.xml;if(!source.definition)throw unavailable();
 const printer=new PdfPrinter({Helvetica:{normal:'Helvetica',bold:'Helvetica-Bold',italics:'Helvetica-Oblique',bolditalics:'Helvetica-BoldOblique'}});
 return new Promise<Buffer>((resolve,reject)=>{const pdf=printer.createPdfKitDocument(source.definition!),chunks:Buffer[]=[];let size=0,oversize=false;
  pdf.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>publicationLimit){oversize=true;return;}chunks.push(chunk);});
  pdf.on('end',()=>oversize?reject(new ServiceUnavailableException('El documento supera2MiB; requiere revisión.')):resolve(Buffer.concat(chunks)));pdf.on('error',reject);pdf.end();
 });
}
