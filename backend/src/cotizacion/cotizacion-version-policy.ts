import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { QueryExecutor, queryRows } from '../common/database/typed-query';
export function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const quoteHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface QuoteSnapshot { idCotizacion:number; idCliente:number; idUnidad:number|null; folio:number; nombre:string; rfc:string; fecha:string; vencimiento:string; subtotal:string; impuestos:string; retenciones:string; total:string; conceptos:{idConcepto:number;idProducto:number;descripcion:string;unidad:string;cantidad:string;precio:string;importe:string;iva:string;retencion:string}[] }
export interface Revision {id_revision:number;id_cotizacion:number;id_raiz:number;numero:number;snapshot:QuoteSnapshot;sha256:string;huella:string;request_id:string}
export async function quoteSnapshot(db:QueryExecutor,id:number){
 const [row]=await queryRows<{snapshot:QuoteSnapshot}>(db,`SELECT jsonb_build_object('idCotizacion',q.id_cotizacion,'idCliente',q.id_cliente,'idUnidad',q.id_unidad,
  'folio',q.folio,'nombre',q.nombre_receptor,'rfc',q.rfc_receptor,
  'fecha',to_char(q.fecha_emision AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'vencimiento',to_char(q.fecha_vencimiento AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'subtotal',q.subtotal::text,'impuestos',q.total_impuestos::text,'retenciones',q.total_retenciones::text,'total',q.total::text,
  'conceptos',COALESCE((SELECT jsonb_agg(jsonb_build_object('idConcepto',c.id_concepto,'idProducto',c.id_producto,'descripcion',c.descripcion,'unidad',c.unidad,
    'cantidad',c.cantidad::text,'precio',c.valor_unitario::text,'importe',c.importe::text,'iva',c.importe_iva::text,'retencion',c.importe_ret_isr::text) ORDER BY c.id_concepto)
    FROM conceptocotizacion c WHERE c.id_cotizacion=q.id_cotizacion),'[]'::jsonb)) AS snapshot FROM cotizacion q WHERE q.id_cotizacion=$1`,[id]);
 if(!row)throw new NotFoundException('Cotización no encontrada');return row.snapshot;
}
export function verifySnapshot(row:Revision){if(quoteHash(row.snapshot)!==row.sha256)throw new ServiceUnavailableException('La revisión no coincide con su huella; revisa el respaldo');}
// Always lock the family root before its current quote. A second lookup covers sealing races on legacy quotes.
export async function lockQuoteFamily(db:QueryExecutor,id:number){
 const [known]=await queryRows<{id_raiz:number}>(db,'SELECT id_raiz FROM cotizacion_revision WHERE id_cotizacion=$1',[id]);
 await db.query('SELECT id_cotizacion FROM cotizacion WHERE id_cotizacion=$1 FOR UPDATE',[known?.id_raiz??id]);
 const [row]=await queryRows<Revision>(db,'SELECT r.* FROM cotizacion_revision r WHERE id_cotizacion=$1',[id]);
 return row;
}
export async function currentRevision(db:QueryExecutor,row:Revision){
 verifySnapshot(row);
 const [latest]=await queryRows<{id_revision:number}>(db,'SELECT id_revision FROM cotizacion_revision WHERE id_raiz=$1 ORDER BY numero DESC LIMIT 1',[row.id_raiz]);
 if(latest.id_revision!==row.id_revision)throw new ConflictException('La revisión fue sustituida. Usa la última cotización del historial.');
 if(quoteHash(await quoteSnapshot(db,row.id_cotizacion))!==row.sha256)throw new ConflictException('La cotización cambió después de sellarse; prepara una nueva revisión.');
}
export async function requireAcceptedQuote(db:QueryExecutor,id:number){
 const row=await lockQuoteFamily(db,id);if(!row)return;
 const [valid]=await queryRows<{vigente:boolean}>(db,'SELECT fecha_vencimiento>clock_timestamp() AS vigente FROM cotizacion WHERE id_cotizacion=$1',[id]);
 if(!valid.vigente)throw new ConflictException('La revisión aceptada venció; prepara una nueva revisión.');
 await currentRevision(db,row);
 const [response]=await queryRows<{decision:string}>(db,'SELECT decision FROM cotizacion_respuesta WHERE id_revision=$1',[row.id_revision]);
 if(response?.decision!=='Aceptada')throw new ConflictException('La última revisión necesita aceptación antes de crear pedido o venta.');
 await db.query('SELECT "IdProducto" FROM producto WHERE "IdProducto" IN(SELECT id_producto FROM conceptocotizacion WHERE id_cotizacion=$1) ORDER BY "IdProducto" FOR UPDATE',[id]);
 const [fiscal]=await queryRows<{changed:boolean}>(db,`SELECT EXISTS(SELECT 1 FROM conceptocotizacion c JOIN producto p ON p."IdProducto"=c.id_producto WHERE c.id_cotizacion=$1
   AND c.importe_iva IS DISTINCT FROM CASE WHEN p."ObjetoImpuesto"='02' THEN round(c.cantidad*c.valor_unitario*p."TasaIVA",2) ELSE 0 END) AS changed`,[id]);
 if(fiscal.changed)throw new ConflictException('Los impuestos actuales difieren de la revisión aceptada; prepara otra revisión.');
 return row;
}
