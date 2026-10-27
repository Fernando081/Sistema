import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource,EntityManager } from 'typeorm';
import { queryRows,readSnapshot } from '../common/database/typed-query';
import { ConfigClienteDto,CreateListaDto,ResolverAutorizacionDto,SetPrecioEspecialDto,SetPrecioListaDto,SimularPrecioDto,SolicitarAutorizacionDto,ReglaAprobacionDto,LimiteAprobadorDto } from './comercial.dto';
import { JwtPayload } from '../auth/auth.types';
import { commercialActor } from './commercial-actor';
import { RolUsuario } from '../common/enums/app.enums';
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
  COALESCE(cc.limite_credito,0) AS "limiteCredito",COALESCE(cc.dias_credito,0) AS "diasCredito",COALESCE(cc.bloqueado,false) AS bloqueado,cc.motivo_bloqueo AS "motivoBloqueo",
  COALESCE(sum(f.saldo_pendiente) FILTER(WHERE f.estatus::text<>'Cancelada'),0) AS deuda FROM cliente c LEFT JOIN cliente_comercial cc ON cc.id_cliente=c."IdCliente"
  LEFT JOIN lista_precio lp ON lp.id_lista=cc.id_lista LEFT JOIN factura f ON f.id_cliente=c."IdCliente" GROUP BY c."IdCliente",lp.nombre,cc.limite_credito,cc.dias_credito,cc.bloqueado,cc.motivo_bloqueo ORDER BY c."RazonSocial"`);}

 private mutation<T>(actor:JwtPayload,work:(manager:EntityManager,id:number)=>Promise<T>,admin=true,permission?:string,exclusive=false){
  if(admin&&actor?.role!==RolUsuario.ADMIN)throw new ForbiddenException('Se requiere administrador');
  return this.dataSource.transaction(async manager=>{
    const id=await commercialActor(manager,actor,permission,exclusive);return work(manager,id);
  });
 }
 configureClient(id:number,dto:ConfigClienteDto,actor:JwtPayload){return this.mutation(actor,async manager=>{
  await manager.query(`INSERT INTO cliente_comercial(id_cliente,id_lista,limite_credito,dias_credito,bloqueado,motivo_bloqueo)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id_cliente) DO UPDATE SET id_lista=excluded.id_lista,limite_credito=excluded.limite_credito,dias_credito=excluded.dias_credito,bloqueado=excluded.bloqueado,motivo_bloqueo=excluded.motivo_bloqueo,updated_at=now()`,
    [id,dto.idLista??null,dto.limiteCredito,dto.diasCredito,dto.bloqueado,dto.motivoBloqueo||null]);return{message:'Política comercial actualizada'};
 });}
 lists(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT lp.id_lista AS "idLista",lp.nombre,lp.moneda,lp.activa,lp.valid_from AS "validFrom",lp.valid_to AS "validTo",count(ld.id_detalle)::int AS productos FROM lista_precio lp LEFT JOIN lista_precio_detalle ld ON ld.id_lista=lp.id_lista GROUP BY lp.id_lista ORDER BY lp.nombre`);}
 createList(dto:CreateListaDto,actor:JwtPayload){return this.mutation(actor,async manager=>{
  const r=await queryRows<{idLista:number}>(manager,`INSERT INTO lista_precio(nombre,valid_from,valid_to)VALUES($1,$2,$3)RETURNING id_lista AS "idLista"`,[dto.nombre,dto.validFrom||null,dto.validTo||null]);return r[0];
 });}
 setListPrice(id:number,dto:SetPrecioListaDto,actor:JwtPayload){return this.mutation(actor,async manager=>{
  const lists=await queryRows(manager,'SELECT id_lista FROM lista_precio WHERE id_lista=$1',[id]);if(!lists.length)throw new NotFoundException('Lista no encontrada');
  await manager.query(`INSERT INTO lista_precio_detalle(id_lista,id_producto,cantidad_minima,precio)VALUES($1,$2,$3,$4)ON CONFLICT(id_lista,id_producto,cantidad_minima)DO UPDATE SET precio=excluded.precio`,[id,dto.idProducto,dto.cantidadMinima,dto.precio]);return{message:'Precio de lista guardado'};
 });}
 setSpecial(dto:SetPrecioEspecialDto,actor:JwtPayload){return this.mutation(actor,async manager=>{
  await manager.query(`INSERT INTO precio_especial_cliente(id_cliente,id_producto,precio,valid_from,valid_to)VALUES($1,$2,$3,$4,$5)ON CONFLICT(id_cliente,id_producto)DO UPDATE SET precio=excluded.precio,valid_from=excluded.valid_from,valid_to=excluded.valid_to`,[dto.idCliente,dto.idProducto,dto.precio,dto.validFrom||null,dto.validTo||null]);return{message:'Precio especial guardado'};
 });}
 authorizations(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT a.id_autorizacion AS "idAutorizacion",a.tipo,a.estado,a.valor_solicitado AS "valorSolicitado",a.valor_referencia AS "valorReferencia",a.motivo,a.resolucion,a.created_at AS "createdAt",a.expires_at AS "expiresAt",a.operacion_tipo AS "operacionTipo",a.operacion_id AS "operacionId",a.used_at AS "usedAt",a.operacion_destino AS "operacionDestino",a.monto_operacion AS "montoOperacion",a.regla_version AS "reglaVersion",a.politica_decision AS "politicaDecision",c."RazonSocial" AS cliente,p."Codigo" AS producto,u.username AS solicitante,v.username AS aprobador
  FROM solicitud_autorizacion_comercial a JOIN cliente c ON c."IdCliente"=a.id_cliente LEFT JOIN producto p ON p."IdProducto"=a.id_producto LEFT JOIN auth_user u ON u.id_user=a.id_solicitante LEFT JOIN auth_user v ON v.id_user=a.id_autorizador ORDER BY(a.estado='Pendiente')DESC,a.created_at DESC,a.id_autorizacion DESC LIMIT 200`);}
 requestAuthorization(dto:SolicitarAutorizacionDto,actor:JwtPayload){return this.mutation(actor,async(manager,id)=>{
  if(!dto.motivo.trim())throw new BadRequestException('Indica el motivo');
  if(dto.tipo==='Exceso credito'?!!dto.idProducto:!dto.idProducto)throw new BadRequestException('Descuento/margen requieren producto; exceso de crédito corresponde al documento');
  if(dto.valorSolicitado<0||dto.valorReferencia<0)throw new BadRequestException('Los valores no pueden ser negativos');
  const [r]=await queryRows<{idAutorizacion:number}>(manager,`INSERT INTO solicitud_autorizacion_comercial(tipo,id_cliente,id_producto,valor_solicitado,valor_referencia,motivo,id_solicitante,operacion_destino,monto_operacion)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id_autorizacion AS "idAutorizacion"`,[dto.tipo,dto.idCliente,dto.idProducto||null,dto.valorSolicitado,dto.valorReferencia,dto.motivo,id,dto.operacionDestino,dto.montoOperacion]);return r;
 },false);}
 resolve(id:number,dto:ResolverAutorizacionDto,actor:JwtPayload){return this.mutation(actor,async(manager,idUser)=>{
  const [a]=await queryRows<{estado:string;tipo:string;id_solicitante:number|null;operacion_destino:string|null;monto_operacion:string|null}>(manager,'SELECT estado,tipo,id_solicitante,operacion_destino,monto_operacion FROM solicitud_autorizacion_comercial WHERE id_autorizacion=$1 FOR UPDATE',[id]);
  if(!a||a.estado!=='Pendiente')throw new ConflictException('La solicitud ya fue resuelta o no existe');
  if(dto.estado==='Rechazada'){
   await manager.query("UPDATE solicitud_autorizacion_comercial SET estado='Rechazada',resolucion=$2,id_autorizador=$3,resolved_at=now() WHERE id_autorizacion=$1",[id,dto.resolucion,idUser]);
  }else{
   if(!a.operacion_destino)throw new ConflictException('Solicitud histórica sin alcance: crea una nueva indicando operación y monto máximo');
   const [rule]=await queryRows<{version:number;requiresDifferent:boolean;maximum:string|null;hours:number;authority:string|null}>(manager,`SELECT r.version,r.requiere_distinto AS "requiresDifferent",r.monto_maximo AS maximum,r.vigencia_maxima_horas AS hours,l.monto_maximo AS authority FROM comercial_regla_aprobacion r LEFT JOIN comercial_limite_aprobador l ON l.operacion=r.operacion AND l.id_usuario=$3 WHERE r.operacion=$1 AND r.tipo=$2`,[a.operacion_destino,a.tipo,idUser]);
   if(!rule)throw new ConflictException('No existe regla para esta operación');
   if(rule.requiresDifferent&&(!a.id_solicitante||a.id_solicitante===idUser))throw new ForbiddenException('La regla requiere un aprobador distinto al solicitante identificado');
   if(dto.vigenciaHoras>rule.hours)throw new BadRequestException(`La vigencia máxima de esta regla es ${rule.hours} horas`);
   if([rule.maximum,rule.authority].some(value=>value!==null&&Number(a.monto_operacion)>Number(value)))throw new ForbiddenException('El monto supera el límite de la regla o del aprobador');
   await manager.query(`UPDATE solicitud_autorizacion_comercial SET estado='Aprobada',resolucion=$2,id_autorizador=$3,resolved_at=now(),expires_at=now()+make_interval(hours=>$4),regla_version=$5,politica_decision=$6::jsonb WHERE id_autorizacion=$1`,[id,dto.resolucion,idUser,dto.vigenciaHoras,rule.version,JSON.stringify({version:rule.version,operacion:a.operacion_destino,tipo:a.tipo,montoMaximo:rule.maximum,limiteAprobador:rule.authority,requiereDistinto:rule.requiresDifferent,vigenciaHoras:dto.vigenciaHoras})]);
  }
  return{message:`Solicitud ${dto.estado.toLowerCase()}`};
 },true,'credito.autorizar');}
 approvalPolicy(){return readSnapshot(this.dataSource,async manager=>({
  reglas:await queryRows(manager,`SELECT operacion,tipo,monto_maximo AS "montoMaximo",requiere_distinto AS "requiereDistinto",vigencia_maxima_horas AS "vigenciaMaximaHoras",version,motivo FROM comercial_regla_aprobacion ORDER BY operacion,tipo`),
  limites:await queryRows(manager,`SELECT l.id_usuario AS "idUsuario",u.username AS usuario,l.operacion,l.monto_maximo AS "montoMaximo",l.version,l.motivo FROM comercial_limite_aprobador l JOIN auth_user u ON u.id_user=l.id_usuario ORDER BY u.username,l.operacion`),
  aprobadores:await queryRows(manager,`SELECT id_user AS "idUsuario",username AS usuario,is_active AS activo,fn_effective_permission(id_user,role,'credito.autorizar') AS habilitado FROM auth_user WHERE role='admin' ORDER BY username`)
 }));}
 setApprovalRule(dto:ReglaAprobacionDto,actor:JwtPayload){return this.mutation(actor,async manager=>{
  const rows=await queryRows(manager,`WITH changed AS (UPDATE comercial_regla_aprobacion SET monto_maximo=$3,requiere_distinto=$4,vigencia_maxima_horas=$5,version=version+1,motivo=$6 WHERE operacion=$1 AND tipo=$2 AND version=$7 RETURNING version) SELECT version FROM changed`,[dto.operacion,dto.tipo,dto.montoMaximo??null,dto.requiereDistinto,dto.vigenciaMaximaHoras,dto.motivo,dto.version]);
  if(!rows.length)throw new ConflictException('La regla cambió; recarga antes de guardar');return rows[0];
 },true,'comercial.configurar_aprobaciones',true);}
 setApproverLimit(id:number,dto:LimiteAprobadorDto,actor:JwtPayload){return this.mutation(actor,async manager=>{
  if(!(await queryRows(manager,"SELECT id_user FROM auth_user WHERE id_user=$1 AND role='admin'",[id])).length)throw new BadRequestException('Selecciona una cuenta administradora');
  const [existing]=await queryRows<{version:number}>(manager,'SELECT version FROM comercial_limite_aprobador WHERE id_usuario=$1 AND operacion=$2',[id,dto.operacion]);
  if((existing?.version??0)!==dto.version)throw new ConflictException('El límite cambió; recarga antes de guardar');
  await manager.query(`INSERT INTO comercial_limite_aprobador(id_usuario,operacion,monto_maximo,motivo) VALUES($1,$2,$3,$4) ON CONFLICT(id_usuario,operacion)DO UPDATE SET monto_maximo=excluded.monto_maximo,motivo=excluded.motivo,version=comercial_limite_aprobador.version+1`,[id,dto.operacion,dto.montoMaximo??null,dto.motivo]);return{version:dto.version+1};
 },true,'comercial.configurar_aprobaciones',true);}
}
