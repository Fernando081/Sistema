import { BadRequestException,ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { ConfigClienteDto,CreateAutorizacionDto,CreateListaDto,ResolverAutorizacionDto,SetPrecioEspecialDto,SetPrecioListaDto,SimularPrecioDto } from './comercial.dto';
interface PriceRow{base:string|number;cost:string|number;minMargin:string|number;special:string|number|null;listPrice:string|number|null;listName:string|null;blocked:boolean;creditLimit:string|number;creditDays:number;debt:string|number;commitments:string|number;}
@Injectable()
export class ComercialService{
 constructor(@InjectDataSource()private readonly dataSource:DataSource){}
 async simulate(dto:SimularPrecioDto){
  const rows=await queryRows<PriceRow>(this.dataSource,`SELECT p."PrecioUnitario" AS base,
    COALESCE(p.costo_reposicion,(SELECT avg(rd.costo_unitario) FROM recepcion_compra_detalle rd WHERE rd.id_producto=p."IdProducto"),(SELECT avg(k.precio_unitario) FROM kardex k WHERE k.id_producto=p."IdProducto" AND k.tipo_movimiento::text='COMPRA'),p."PrecioUnitario"*.6) AS cost,
    p.margen_minimo AS "minMargin",pe.precio AS special,ld.precio AS "listPrice",lp.nombre AS "listName",
    COALESCE(cc.bloqueado,false) AS blocked,COALESCE(cc.limite_credito,0) AS "creditLimit",COALESCE(cc.dias_credito,0) AS "creditDays",
    COALESCE((SELECT sum(f.saldo_pendiente) FROM factura f WHERE f.id_cliente=$1 AND f.estatus::text<>'Cancelada'),0) AS debt,
    COALESCE((SELECT sum(pv.total) FROM pedido_venta pv WHERE pv.id_cliente=$1 AND pv.estado IN ('Borrador','Confirmado','En espera','Parcialmente surtido','Surtido','Entregado')),0) AS commitments
    FROM producto p LEFT JOIN cliente_comercial cc ON cc.id_cliente=$1
    LEFT JOIN lista_precio lp ON lp.id_lista=cc.id_lista AND lp.activa AND (lp.valid_from IS NULL OR lp.valid_from<=current_date) AND (lp.valid_to IS NULL OR lp.valid_to>=current_date)
    LEFT JOIN LATERAL(SELECT precio FROM lista_precio_detalle WHERE id_lista=lp.id_lista AND id_producto=p."IdProducto" AND cantidad_minima<=$3 ORDER BY cantidad_minima DESC LIMIT 1)ld ON true
    LEFT JOIN precio_especial_cliente pe ON pe.id_cliente=$1 AND pe.id_producto=p."IdProducto" AND (pe.valid_from IS NULL OR pe.valid_from<=current_date) AND (pe.valid_to IS NULL OR pe.valid_to>=current_date)
    WHERE p."IdProducto"=$2 AND EXISTS(SELECT 1 FROM cliente WHERE "IdCliente"=$1)`,[dto.idCliente,dto.idProducto,dto.cantidad]);
  if(!rows.length)throw new NotFoundException('Cliente o producto no encontrado');const r=rows[0];
  const suggested=Number(r.special??r.listPrice??r.base),source=r.special!==null?'Precio especial':r.listPrice!==null?`Lista ${r.listName}`:'Precio público';
  const cost=Number(r.cost),minMargin=Number(r.minMargin),minimum=cost/(1-minMargin);const proposed=dto.precioPropuesto??suggested;
  const margin=proposed>0?(proposed-cost)/proposed:0,debt=Number(r.debt),commitments=Number(r.commitments),limit=Number(r.creditLimit);
  return {precioSugerido:suggested,precioPropuesto:proposed,origen:source,costoReposicion:cost,margen:margin,margenMinimo:minMargin,precioMinimo:minimum,
    requiereAutorizacionMargen:proposed+0.000001<minimum,credito:{limite:limit,deuda:debt,comprometido:commitments,disponible:Math.max(0,limit-debt-commitments),dias:r.creditDays,bloqueado:r.blocked}};
 }
 clients(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT c."IdCliente" AS "idCliente",c."RazonSocial" AS cliente,c."RFC" AS rfc,lp.nombre AS lista,
  COALESCE(cc.limite_credito,0) AS "limiteCredito",COALESCE(cc.dias_credito,0) AS "diasCredito",COALESCE(cc.bloqueado,false) AS bloqueado,
  COALESCE(sum(f.saldo_pendiente) FILTER(WHERE f.estatus::text<>'Cancelada'),0) AS deuda FROM cliente c LEFT JOIN cliente_comercial cc ON cc.id_cliente=c."IdCliente"
  LEFT JOIN lista_precio lp ON lp.id_lista=cc.id_lista LEFT JOIN factura f ON f.id_cliente=c."IdCliente" GROUP BY c."IdCliente",lp.nombre,cc.limite_credito,cc.dias_credito,cc.bloqueado ORDER BY c."RazonSocial"`);}
 configureClient(id:number,dto:ConfigClienteDto){return this.dataSource.query(`INSERT INTO cliente_comercial(id_cliente,id_lista,limite_credito,dias_credito,bloqueado,motivo_bloqueo)
  VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id_cliente) DO UPDATE SET id_lista=excluded.id_lista,limite_credito=excluded.limite_credito,dias_credito=excluded.dias_credito,bloqueado=excluded.bloqueado,motivo_bloqueo=excluded.motivo_bloqueo,updated_at=now()`,[id,dto.idLista??null,dto.limiteCredito,dto.diasCredito,dto.bloqueado,dto.motivoBloqueo||null]).then(()=>({message:'Política comercial actualizada'}));}
 lists(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT lp.id_lista AS "idLista",lp.nombre,lp.moneda,lp.activa,lp.valid_from AS "validFrom",lp.valid_to AS "validTo",count(ld.id_detalle)::int AS productos FROM lista_precio lp LEFT JOIN lista_precio_detalle ld ON ld.id_lista=lp.id_lista GROUP BY lp.id_lista ORDER BY lp.nombre`);}
 async createList(dto:CreateListaDto){const r=await queryRows<{idLista:number}>(this.dataSource,`INSERT INTO lista_precio(nombre,valid_from,valid_to)VALUES($1,$2,$3)RETURNING id_lista AS "idLista"`,[dto.nombre,dto.validFrom||null,dto.validTo||null]);return r[0];}
 async setListPrice(id:number,dto:SetPrecioListaDto){const lists=await queryRows<{id:number}>(this.dataSource,'SELECT id_lista AS id FROM lista_precio WHERE id_lista=$1',[id]);if(!lists.length)throw new NotFoundException('Lista no encontrada');await this.dataSource.query(`INSERT INTO lista_precio_detalle(id_lista,id_producto,cantidad_minima,precio)VALUES($1,$2,$3,$4)ON CONFLICT(id_lista,id_producto,cantidad_minima)DO UPDATE SET precio=excluded.precio`,[id,dto.idProducto,dto.cantidadMinima,dto.precio]);return{message:'Precio de lista guardado'};}
 async setSpecial(dto:SetPrecioEspecialDto){await this.dataSource.query(`INSERT INTO precio_especial_cliente(id_cliente,id_producto,precio,valid_from,valid_to)VALUES($1,$2,$3,$4,$5)ON CONFLICT(id_cliente,id_producto)DO UPDATE SET precio=excluded.precio,valid_from=excluded.valid_from,valid_to=excluded.valid_to`,[dto.idCliente,dto.idProducto,dto.precio,dto.validFrom||null,dto.validTo||null]);return{message:'Precio especial guardado'};}
 authorizations(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT a.id_autorizacion AS "idAutorizacion",a.tipo,a.estado,a.valor_solicitado AS "valorSolicitado",a.valor_referencia AS "valorReferencia",a.motivo,a.resolucion,a.created_at AS "createdAt",a.expires_at AS "expiresAt",a.operacion_tipo AS "operacionTipo",a.operacion_id AS "operacionId",a.used_at AS "usedAt",c."RazonSocial" AS cliente,p."Codigo" AS producto,u.username AS solicitante FROM solicitud_autorizacion_comercial a JOIN cliente c ON c."IdCliente"=a.id_cliente LEFT JOIN producto p ON p."IdProducto"=a.id_producto LEFT JOIN auth_user u ON u.id_user=a.id_solicitante ORDER BY(a.estado='Pendiente')DESC,a.created_at DESC LIMIT 200`);}
 async requestAuthorization(dto:CreateAutorizacionDto,idUser?:number){if(!dto.motivo.trim())throw new BadRequestException('Indica el motivo');const r=await queryRows<{idAutorizacion:number}>(this.dataSource,`INSERT INTO solicitud_autorizacion_comercial(tipo,id_cliente,id_producto,valor_solicitado,valor_referencia,motivo,id_solicitante)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING id_autorizacion AS "idAutorizacion"`,[dto.tipo,dto.idCliente,dto.idProducto||null,dto.valorSolicitado,dto.valorReferencia,dto.motivo,idUser??null]);return r[0];}
 async resolve(id:number,dto:ResolverAutorizacionDto,idUser?:number){const result=await queryRows<{id_autorizacion:number}>(this.dataSource,`UPDATE solicitud_autorizacion_comercial SET estado=$2,resolucion=$3,id_autorizador=$4,resolved_at=now(),expires_at=CASE WHEN $2='Aprobada' THEN now()+($5||' hours')::interval ELSE NULL END WHERE id_autorizacion=$1 AND estado='Pendiente' RETURNING id_autorizacion`,[id,dto.estado,dto.resolucion,idUser??null,dto.vigenciaHoras]);if(!result.length)throw new ConflictException('La solicitud ya fue resuelta o no existe');return{message:`Solicitud ${dto.estado.toLowerCase()}`};}
}
