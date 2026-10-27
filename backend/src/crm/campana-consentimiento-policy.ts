import { createHash } from 'node:crypto';
import { CommercialChannel } from './campana-consentimiento.dto';
// Límite deliberado: correo ASCII y teléfono internacional o diez dígitos mexicanos.
// No fusionar alias Gmail ni quitar '+': podrían pertenecer a destinatarios distintos.
export function commercialDestination(canal:CommercialChannel,value:string|null|undefined):string|null {
 const input=(value??'').trim();
 if(canal==='Correo'){
  if(input.length>150||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(input))return null;
  const local=input.slice(0,input.lastIndexOf('@'));if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return null;
  // Plegado conservador: una baja también bloquea variantes de mayúsculas.
  return input.toLowerCase();
 }
 const compact=input.replace(/[\s().-]/g,'');
 if(/^\d{10}$/.test(compact))return '+52'+compact;
 return /^\+[1-9]\d{7,14}$/.test(compact)?compact:null;
}
export const destinationHash=(canal:CommercialChannel,destino:string)=>createHash('sha256').update('crm-promociones:v1:'+canal+':'+destino).digest('hex');
export function maskDestination(destino:string|null){if(!destino)return 'Destino inválido';const at=destino.indexOf('@');return at>=0?destino.slice(0,1)+'***'+destino.slice(at):'***'+destino.slice(-4);}
// Alias c=cliente,s=segmento; también lo utiliza el conteo de segmentos ya existente.
export const commercialSegmentPredicate=`(s.tipo_cliente IS NULL OR EXISTS(SELECT 1 FROM crm_oportunidad o WHERE o.id_cliente=c."IdCliente" AND o.tipo_cliente=s.tipo_cliente))
 AND (s.dias_inactivo IS NULL OR NOT EXISTS(SELECT 1 FROM factura f WHERE f.id_cliente=c."IdCliente" AND f.tipo_comprobante='I' AND f.serie<>'G'
  AND f.estatus::text IN('Timbrada','Pagada') AND f.fecha_emision>=(((transaction_timestamp() AT TIME ZONE 'America/Mexico_City')::date-s.dias_inactivo)::timestamp AT TIME ZONE 'America/Mexico_City')))`;
