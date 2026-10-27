import { updateManagedStock } from '../common/database/managed-stock';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { CreateCostoAdicionalDto, CreateDevolucionProveedorDto, CreateEvaluacionProveedorDto, CreateOrdenDto, CreateRecepcionDto, CreateSolicitudDto } from './abastecimiento.dto';

const requestTables = {"solicitud":"solicitud_compra","orden":"orden_compra","recepcion":"recepcion_compra","costo":"recepcion_costo_adicional","devolucion":"devolucion_proveedor"} as const;
function canonicalPayload(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonicalPayload);
  if(value!==null&&typeof value==='object'){
    const record=value as Record<string,unknown>;
    return Object.fromEntries(Object.keys(record).sort().filter(key=>record[key]!==undefined).map(key=>[key,canonicalPayload(record[key])]));
  }
  return value;
}

interface ProductRow { id:number; descripcion:string; existencia:string|number; }
interface OrderLine { idDetalle:number; idProducto:number; cantidad:string|number; recibida:string|number; costo:string|number; }
interface BackorderRow { idBackorder:number; idPedido:number; idDetalle:number; pendiente:string|number; }

@Injectable()
export class AbastecimientoService {
  constructor(@InjectDataSource() private readonly dataSource:DataSource) {}

  private async lockRequest(manager:EntityManager,scope:string,requestId:string):Promise<void>{
    // Serializa reintentos antes de consultar existencia; PostgreSQL libera el lock con commit/rollback.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[
      'abastecimiento:'+scope+':'+requestId.toLowerCase(),
    ]);
  }

  private async updateStock(manager:EntityManager,idProducto:number,existencia:number):Promise<void>{
    await updateManagedStock(manager,idProducto,existencia);
  }

  private transactionRequest<T>(scope:keyof typeof requestTables,requestId:string,payload:unknown,idUser:number|undefined,work:(manager:EntityManager)=>Promise<T>):Promise<T>{
    return this.dataSource.transaction(async manager=>{
      await this.lockRequest(manager,scope,requestId);
      const hash=createHash('sha256').update(JSON.stringify(canonicalPayload(payload))).digest('hex');
      const operation='abastecimiento:'+scope;
      const previous=await queryRows<{operation_type:string;payload_hash:string;response:T}>(manager,
        'SELECT operation_type,payload_hash,response FROM operation_idempotency WHERE request_id=$1',[requestId]);
      if(previous.length){
        if(previous[0].operation_type!==operation||previous[0].payload_hash!==hash)
          throw new ConflictException('El identificador de reintento ya fue usado con datos diferentes');
        return previous[0].response;
      }
      const legacy=await queryRows<{exists:number}>(manager,'SELECT 1 AS exists FROM '+requestTables[scope]+' WHERE request_id=$1',[requestId]);
      if(legacy.length)throw new ConflictException('La operación original no tiene huella de reintento; consulte su registro antes de continuar');
      const response=await work(manager);
      await manager.query('INSERT INTO operation_idempotency(request_id,operation_type,id_user,payload_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)',[requestId,operation,idUser??null,hash,JSON.stringify(response)]);
      return response;
    });
  }

  async createRequest(dto:CreateSolicitudDto,idUser?:number){
    return this.transactionRequest('solicitud',dto.requestId,{motivo:dto.motivo||null,partidas:dto.partidas.map(x=>({idProducto:x.idProducto,cantidad:x.cantidad,costoEstimado:x.costoEstimado??0,origen:x.origen??'Manual'})).sort((a,b)=>a.idProducto-b.idProducto)},idUser,async manager=>{
      const repeated=await queryRows<{idSolicitud:number}>(manager,'SELECT id_solicitud AS "idSolicitud" FROM solicitud_compra WHERE request_id=$1',[dto.requestId]);
      if(repeated.length)return repeated[0];
      const ids=[...new Set(dto.partidas.map(x=>x.idProducto))].sort((a,b)=>a-b);
      if(ids.length!==dto.partidas.length)throw new BadRequestException('Cada producto debe aparecer una sola vez');
      const products=await queryRows<{id:number}>(manager,'SELECT "IdProducto" AS id FROM producto WHERE "IdProducto"=ANY($1::int[]) ORDER BY "IdProducto"',[ids]);
      if(products.length!==ids.length)throw new BadRequestException('Uno o más productos no existen');
      const rows=await queryRows<{idSolicitud:number}>(manager,`INSERT INTO solicitud_compra(request_id,motivo,id_solicitante)
        VALUES($1,$2,$3) RETURNING id_solicitud AS "idSolicitud"`,[dto.requestId,dto.motivo||null,idUser??null]);
      for(const line of dto.partidas)await manager.query(`INSERT INTO solicitud_compra_detalle(id_solicitud,id_producto,cantidad,costo_estimado,origen)
        VALUES($1,$2,$3,$4,$5)`,[rows[0].idSolicitud,line.idProducto,line.cantidad,line.costoEstimado,line.origen]);
      return rows[0];
    });
  }

  async authorizeRequest(id:number,idUser?:number){
    return this.dataSource.transaction(async manager=>{
      const rows=await queryRows<{estado:string}>(manager,'SELECT estado FROM solicitud_compra WHERE id_solicitud=$1 FOR UPDATE',[id]);
      if(!rows.length)throw new NotFoundException('Solicitud no encontrada');
      if(rows[0].estado!=='Borrador')throw new ConflictException('Solo se puede autorizar una solicitud en borrador');
      await manager.query(`UPDATE solicitud_compra SET estado='Autorizada',id_autorizador=$2,authorized_at=now(),updated_at=now() WHERE id_solicitud=$1`,[id,idUser??null]);
      return {message:'Solicitud autorizada'};
    });
  }

  async createOrder(dto:CreateOrdenDto,idUser?:number){
    return this.transactionRequest('orden',dto.requestId,{idSolicitud:dto.idSolicitud||null,idProveedor:dto.idProveedor,fechaPromesa:dto.fechaPromesa||null,notas:dto.notas||null,partidas:dto.partidas.map(x=>({idProducto:x.idProducto,cantidad:x.cantidad,costoUnitario:x.costoUnitario,tasaIva:x.tasaIva??0.16})).sort((a,b)=>a.idProducto-b.idProducto)},idUser,async manager=>{
      const repeated=await queryRows<{idOrden:number}>(manager,'SELECT id_orden AS "idOrden" FROM orden_compra WHERE request_id=$1',[dto.requestId]);
      if(repeated.length)return repeated[0];
      const providers=await queryRows<{id:number}>(manager,'SELECT "IdProveedor" AS id FROM proveedor WHERE "IdProveedor"=$1',[dto.idProveedor]);
      if(!providers.length)throw new NotFoundException('Proveedor no encontrado');
      const ids=[...new Set(dto.partidas.map(x=>x.idProducto))].sort((a,b)=>a-b);
      if(ids.length!==dto.partidas.length)throw new BadRequestException('Cada producto debe aparecer una sola vez');
      const products=await queryRows<ProductRow>(manager,`SELECT "IdProducto" AS id,"Descripcion" AS descripcion,"Existencia" AS existencia
        FROM producto WHERE "IdProducto"=ANY($1::int[]) ORDER BY "IdProducto"`,[ids]);
      if(products.length!==ids.length)throw new BadRequestException('Uno o más productos no existen');
      if(dto.idSolicitud){
        const requests=await queryRows<{estado:string}>(manager,'SELECT estado FROM solicitud_compra WHERE id_solicitud=$1 FOR UPDATE',[dto.idSolicitud]);
        if(!requests.length)throw new NotFoundException('Solicitud no encontrada');
        if(requests[0].estado!=='Autorizada')throw new ConflictException('La solicitud debe estar autorizada');
        const requested=await queryRows<{idProducto:number;cantidad:string|number}>(manager,'SELECT id_producto AS "idProducto",cantidad FROM solicitud_compra_detalle WHERE id_solicitud=$1 ORDER BY id_producto',[dto.idSolicitud]);
        const supplied=new Map(dto.partidas.map(x=>[x.idProducto,x.cantidad]));
        if(requested.length!==supplied.size||requested.some(x=>Math.abs(Number(x.cantidad)-(supplied.get(x.idProducto)||0))>0.000001))throw new BadRequestException('La orden no coincide con las partidas autorizadas');
      }
      const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
      const subtotal=money(dto.partidas.reduce((s,x)=>s+x.cantidad*x.costoUnitario,0));
      const taxes=money(dto.partidas.reduce((s,x)=>s+x.cantidad*x.costoUnitario*x.tasaIva,0));
      const rows=await queryRows<{idOrden:number}>(manager,`INSERT INTO orden_compra(request_id,id_solicitud,id_proveedor,fecha_promesa,notas,subtotal,impuestos,total,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_orden AS "idOrden"`,[dto.requestId,dto.idSolicitud||null,dto.idProveedor,dto.fechaPromesa||null,dto.notas||null,subtotal,taxes,money(subtotal+taxes),idUser??null]);
      const byId=new Map(products.map(x=>[Number(x.id),x]));
      for(const line of dto.partidas)await manager.query(`INSERT INTO orden_compra_detalle(id_orden,id_producto,descripcion,cantidad,costo_unitario,tasa_iva)
        VALUES($1,$2,$3,$4,$5,$6)`,[rows[0].idOrden,line.idProducto,byId.get(line.idProducto)?.descripcion,line.cantidad,line.costoUnitario,line.tasaIva]);
      if(dto.idSolicitud)await manager.query(`UPDATE solicitud_compra SET estado='Ordenada',updated_at=now() WHERE id_solicitud=$1`,[dto.idSolicitud]);
      return rows[0];
    });
  }

  async receive(idOrden:number,dto:CreateRecepcionDto,idUser?:number){
    return this.transactionRequest('recepcion',dto.requestId,{idOrden,referencia:dto.referencia||null,notas:dto.notas||null,partidas:[...dto.partidas].sort((a,b)=>a.idDetalle-b.idDetalle)},idUser,async manager=>{
      const repeated=await queryRows<{idRecepcion:number}>(manager,'SELECT id_recepcion AS "idRecepcion" FROM recepcion_compra WHERE request_id=$1',[dto.requestId]);
      if(repeated.length)return repeated[0];
      const orders=await queryRows<{estado:string}>(manager,'SELECT estado FROM orden_compra WHERE id_orden=$1 FOR UPDATE',[idOrden]);
      if(!orders.length)throw new NotFoundException('Orden no encontrada');
      if(!['Emitida','Confirmada','Parcialmente recibida'].includes(orders[0].estado))throw new ConflictException('La orden no admite recepciones');
      if(new Set(dto.partidas.map(x=>x.idDetalle)).size!==dto.partidas.length)throw new BadRequestException('Hay partidas repetidas');
      const details=await queryRows<OrderLine>(manager,`SELECT id_detalle AS "idDetalle",id_producto AS "idProducto",cantidad,
        cantidad_recibida AS recibida,costo_unitario AS costo FROM orden_compra_detalle WHERE id_orden=$1 ORDER BY id_producto FOR UPDATE`,[idOrden]);
      const map=new Map(details.map(x=>[x.idDetalle,x]));
      for(const item of dto.partidas){const line=map.get(item.idDetalle);if(!line)throw new BadRequestException('Una partida no pertenece a la orden');if(Number(line.recibida)+item.cantidad>Number(line.cantidad)+0.000001)throw new BadRequestException('La recepción excede la cantidad pendiente');}
      const receipt=await queryRows<{idRecepcion:number}>(manager,`INSERT INTO recepcion_compra(request_id,id_orden,referencia,notas,id_user)
        VALUES($1,$2,$3,$4,$5) RETURNING id_recepcion AS "idRecepcion"`,[dto.requestId,idOrden,dto.referencia||null,dto.notas||null,idUser??null]);
      for(const item of [...dto.partidas].sort((a,b)=>Number(map.get(a.idDetalle)?.idProducto)-Number(map.get(b.idDetalle)?.idProducto))){
        const line=map.get(item.idDetalle)!;
        const stocks=await queryRows<{existencia:string|number}>(manager,'SELECT "Existencia" AS existencia FROM producto WHERE "IdProducto"=$1 FOR UPDATE',[line.idProducto]);
        const before=Number(stocks[0].existencia),after=before+item.cantidad;
        await this.updateStock(manager,line.idProducto,after);
        await manager.query(`INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia,id_referencia)
          VALUES($1,'COMPRA'::tipo_movimiento_enum,$2,$3,$4,$5,$6,$7)`,[line.idProducto,item.cantidad,before,after,Number(line.costo),`Recepción OC-${idOrden}`,receipt[0].idRecepcion]);
        await manager.query(`INSERT INTO recepcion_compra_detalle(id_recepcion,id_orden_detalle,id_producto,cantidad,costo_unitario)
          VALUES($1,$2,$3,$4,$5)`,[receipt[0].idRecepcion,line.idDetalle,line.idProducto,item.cantidad,Number(line.costo)]);
        await manager.query('UPDATE orden_compra_detalle SET cantidad_recibida=cantidad_recibida+$2 WHERE id_detalle=$1',[line.idDetalle,item.cantidad]);
        await this.allocateBackorders(manager,line.idProducto);
      }
      const pending=await queryRows<{total:string|number}>(manager,'SELECT COALESCE(sum(cantidad-cantidad_recibida),0) AS total FROM orden_compra_detalle WHERE id_orden=$1',[idOrden]);
      const next=Number(pending[0].total)>0?'Parcialmente recibida':'Recibida';
      await manager.query('UPDATE orden_compra SET estado=$2,updated_at=now() WHERE id_orden=$1',[idOrden,next]);
      return {...receipt[0],estadoOrden:next};
    });
  }

  requests(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT s.id_solicitud AS "idSolicitud",s.folio,s.estado,s.motivo,s.created_at AS "createdAt",
    u.username AS solicitante,count(d.id_detalle)::int AS partidas,COALESCE(sum(d.cantidad*d.costo_estimado),0) AS estimado FROM solicitud_compra s
    LEFT JOIN auth_user u ON u.id_user=s.id_solicitante JOIN solicitud_compra_detalle d ON d.id_solicitud=s.id_solicitud
    GROUP BY s.id_solicitud,u.username ORDER BY s.created_at DESC LIMIT 100`);}
  orders(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT o.id_orden AS "idOrden",o.id_proveedor AS "idProveedor",o.folio,o.estado,o.total,o.fecha_promesa AS "fechaPromesa",o.created_at AS "createdAt",
    p."RazonSocial" AS proveedor,count(d.id_detalle)::int AS partidas,COALESCE(sum(d.cantidad-d.cantidad_recibida),0) AS pendiente
    FROM orden_compra o JOIN proveedor p ON p."IdProveedor"=o.id_proveedor JOIN orden_compra_detalle d ON d.id_orden=o.id_orden
    GROUP BY o.id_orden,p."RazonSocial" ORDER BY o.created_at DESC LIMIT 100`);}
  receipts(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT r.id_recepcion AS "idRecepcion",r.id_orden AS "idOrden",o.folio,p."RazonSocial" AS proveedor,
    r.referencia,r.created_at AS "createdAt",count(d.id_detalle)::int AS partidas,coalesce(sum(d.cantidad*d.costo_unitario),0) AS total
    FROM recepcion_compra r JOIN orden_compra o ON o.id_orden=r.id_orden JOIN proveedor p ON p."IdProveedor"=o.id_proveedor
    JOIN recepcion_compra_detalle d ON d.id_recepcion=r.id_recepcion GROUP BY r.id_recepcion,o.folio,p."RazonSocial" ORDER BY r.created_at DESC LIMIT 100`);}
  receipt(id:number){return Promise.all([
    queryRows<Record<string,unknown>>(this.dataSource,`SELECT r.id_recepcion AS "idRecepcion",r.id_orden AS "idOrden",o.folio,p."RazonSocial" AS proveedor,r.referencia,r.notas,r.created_at AS "createdAt"
      FROM recepcion_compra r JOIN orden_compra o ON o.id_orden=r.id_orden JOIN proveedor p ON p."IdProveedor"=o.id_proveedor WHERE r.id_recepcion=$1`,[id]),
    queryRows<Record<string,unknown>>(this.dataSource,`SELECT d.id_detalle AS "idDetalle",d.id_producto AS "idProducto",p."Codigo" AS codigo,p."Descripcion" AS descripcion,d.cantidad,d.costo_unitario AS "costoUnitario",
      d.cantidad-coalesce((SELECT sum(dd.cantidad) FROM devolucion_proveedor_detalle dd JOIN devolucion_proveedor dv ON dv.id_devolucion=dd.id_devolucion WHERE dd.id_recepcion_detalle=d.id_detalle AND dv.estado<>'Cancelada'),0) AS "cantidadDisponible"
      FROM recepcion_compra_detalle d JOIN producto p ON p."IdProducto"=d.id_producto WHERE d.id_recepcion=$1 ORDER BY d.id_detalle`,[id])
  ]).then(([rows,partidas])=>{if(!rows.length)throw new NotFoundException('Recepción no encontrada');return {...rows[0],partidas};});}
  order(id:number){return Promise.all([
    queryRows<Record<string,unknown>>(this.dataSource,`SELECT o.*,o.id_orden AS "idOrden",o.id_proveedor AS "idProveedor",p."RazonSocial" AS proveedor FROM orden_compra o JOIN proveedor p ON p."IdProveedor"=o.id_proveedor WHERE o.id_orden=$1`,[id]),
    queryRows<Record<string,unknown>>(this.dataSource,`SELECT d.id_detalle AS "idDetalle",d.id_producto AS "idProducto",p."Codigo" AS codigo,d.descripcion,d.cantidad,d.cantidad_recibida AS "cantidadRecibida",d.costo_unitario AS "costoUnitario",
      coalesce((SELECT sum(fd.cantidad) FROM factura_proveedor_detalle fd JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor WHERE fd.id_orden_detalle=d.id_detalle AND f.estado<>'Cancelada'),0) AS "cantidadFacturada"
      FROM orden_compra_detalle d JOIN producto p ON p."IdProducto"=d.id_producto WHERE d.id_orden=$1 ORDER BY d.id_detalle`,[id])
  ]).then(([rows,partidas])=>{if(!rows.length)throw new NotFoundException('Orden no encontrada');return {...rows[0],partidas};});}

  providerQuotes(idProducto:number){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT q.id_cotizacion_prov AS "idCotizacion",q.id_proveedor AS "idProveedor",p."RazonSocial" AS proveedor,
    q.marca_ofrecida AS marca,q.precio_cotizado AS precio,q.dias_entrega AS "diasEntrega",q.fecha_registro AS "fechaRegistro"
    FROM producto_cotizacion_prov q JOIN proveedor p ON p."IdProveedor"=q.id_proveedor WHERE q.id_producto=$1 ORDER BY q.precio_cotizado,q.dias_entrega,q.fecha_registro DESC LIMIT 50`,[idProducto]);}

  async addReceiptCost(idRecepcion:number,dto:CreateCostoAdicionalDto,idUser?:number){
    return this.transactionRequest('costo',dto.requestId,{idRecepcion,tipo:dto.tipo,monto:dto.monto,criterio:dto.criterio??'Valor',notas:dto.notas||null},idUser,async manager=>{
      const old=await queryRows<{idCosto:number}>(manager,'SELECT id_costo AS "idCosto" FROM recepcion_costo_adicional WHERE request_id=$1',[dto.requestId]);if(old.length)return old[0];
      const lines=await queryRows<{idDetalle:number;idProducto:number;cantidad:string|number;costo:string|number}>(manager,`SELECT id_detalle AS "idDetalle",id_producto AS "idProducto",cantidad,costo_unitario AS costo FROM recepcion_compra_detalle WHERE id_recepcion=$1 ORDER BY id_detalle FOR UPDATE`,[idRecepcion]);
      if(!lines.length)throw new NotFoundException('Recepción no encontrada');
      const weights=lines.map(line=>dto.criterio==='Cantidad'?Number(line.cantidad):Number(line.cantidad)*Number(line.costo));const totalWeight=weights.reduce((sum,value)=>sum+value,0);if(totalWeight<=0)throw new BadRequestException('La recepción no permite distribuir costos');
      const totalCents=Math.round(dto.monto*100);const raw=weights.map(weight=>totalCents*weight/totalWeight);const cents=raw.map(Math.floor);const remainder=totalCents-cents.reduce((sum,value)=>sum+value,0);
      const order=raw.map((value,index)=>({index,fraction:value-Math.floor(value)})).sort((a,b)=>b.fraction-a.fraction||lines[a.index].idDetalle-lines[b.index].idDetalle);for(let i=0;i<remainder;i++)cents[order[i%order.length].index]++;
      const inserted=await queryRows<{idCosto:number}>(manager,`INSERT INTO recepcion_costo_adicional(request_id,id_recepcion,tipo,monto,criterio,notas,id_user) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id_costo AS "idCosto"`,[dto.requestId,idRecepcion,dto.tipo,dto.monto,dto.criterio,dto.notas||null,idUser??null]);
      for(let i=0;i<lines.length;i++){const allocated=cents[i]/100,line=lines[i],unitIncrease=allocated/Number(line.cantidad);await manager.query('INSERT INTO recepcion_costo_adicional_detalle(id_costo,id_recepcion_detalle,monto) VALUES($1,$2,$3)',[inserted[0].idCosto,line.idDetalle,allocated]);await manager.query('UPDATE recepcion_compra_detalle SET costo_unitario=costo_unitario+$2 WHERE id_detalle=$1',[line.idDetalle,unitIncrease]);await manager.query('UPDATE kardex SET precio_unitario=precio_unitario+$3 WHERE id_referencia=$1 AND id_producto=$2 AND referencia LIKE \'Recepción OC-%\'',[idRecepcion,line.idProducto,unitIncrease]);await manager.query('UPDATE producto SET costo_reposicion=$2 WHERE "IdProducto"=$1',[line.idProducto,Number(line.costo)+unitIncrease]);}
      return inserted[0];
    });
  }

  async returnToProvider(dto:CreateDevolucionProveedorDto,idUser?:number){
    return this.transactionRequest('devolucion',dto.requestId,{idRecepcion:dto.idRecepcion,motivo:dto.motivo.trim(),partidas:[...dto.partidas].sort((a,b)=>a.idRecepcionDetalle-b.idRecepcionDetalle)},idUser,async manager=>{
      const old=await queryRows<{idDevolucion:number}>(manager,'SELECT id_devolucion AS "idDevolucion" FROM devolucion_proveedor WHERE request_id=$1',[dto.requestId]);if(old.length)return old[0];
      if(new Set(dto.partidas.map(item=>item.idRecepcionDetalle)).size!==dto.partidas.length)throw new BadRequestException('Hay partidas repetidas');
      const receipts=await queryRows<{idProveedor:number}>(manager,`SELECT o.id_proveedor AS "idProveedor" FROM recepcion_compra r JOIN orden_compra o ON o.id_orden=r.id_orden WHERE r.id_recepcion=$1 FOR UPDATE OF r`,[dto.idRecepcion]);if(!receipts.length)throw new NotFoundException('Recepción no encontrada');
      const ids=dto.partidas.map(item=>item.idRecepcionDetalle);const lines=await queryRows<{idDetalle:number;idProducto:number;cantidad:string|number;costo:string|number;devuelta:string|number}>(manager,`SELECT rd.id_detalle AS "idDetalle",rd.id_producto AS "idProducto",rd.cantidad,rd.costo_unitario AS costo,coalesce((SELECT sum(dd.cantidad) FROM devolucion_proveedor_detalle dd JOIN devolucion_proveedor d ON d.id_devolucion=dd.id_devolucion WHERE dd.id_recepcion_detalle=rd.id_detalle AND d.estado<>'Cancelada'),0) AS devuelta FROM recepcion_compra_detalle rd WHERE rd.id_recepcion=$1 AND rd.id_detalle=ANY($2::int[]) ORDER BY rd.id_producto FOR UPDATE`,[dto.idRecepcion,ids]);if(lines.length!==ids.length)throw new BadRequestException('Una partida no pertenece a la recepción');
      const map=new Map(lines.map(line=>[line.idDetalle,line]));for(const item of dto.partidas){const line=map.get(item.idRecepcionDetalle)!;if(Number(line.devuelta)+item.cantidad>Number(line.cantidad)+.000001)throw new BadRequestException('La devolución excede lo recibido');}
      const head=await queryRows<{idDevolucion:number}>(manager,`INSERT INTO devolucion_proveedor(request_id,id_recepcion,id_proveedor,motivo,id_user) VALUES($1,$2,$3,$4,$5) RETURNING id_devolucion AS "idDevolucion"`,[dto.requestId,dto.idRecepcion,receipts[0].idProveedor,dto.motivo.trim(),idUser??null]);
      for(const item of [...dto.partidas].sort((a,b)=>map.get(a.idRecepcionDetalle)!.idProducto-map.get(b.idRecepcionDetalle)!.idProducto)){const line=map.get(item.idRecepcionDetalle)!;const stock=await queryRows<{existencia:string|number}>(manager,'SELECT "Existencia" AS existencia FROM producto WHERE "IdProducto"=$1 FOR UPDATE',[line.idProducto]);const before=Number(stock[0].existencia);if(before+1e-6<item.cantidad)throw new ConflictException('Existencia insuficiente para devolver al proveedor');const after=before-item.cantidad;await this.updateStock(manager,line.idProducto,after);await manager.query(`INSERT INTO devolucion_proveedor_detalle(id_devolucion,id_recepcion_detalle,id_producto,cantidad,costo_unitario) VALUES($1,$2,$3,$4,$5)`,[head[0].idDevolucion,line.idDetalle,line.idProducto,item.cantidad,line.costo]);await manager.query(`INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia,id_referencia) VALUES($1,'SALIDA POR MERMA/AJUSTE'::tipo_movimiento_enum,$2,$3,$4,$5,$6,$7)`,[line.idProducto,-item.cantidad,before,after,line.costo,`Devolución a proveedor #${head[0].idDevolucion}`,head[0].idDevolucion]);}
      return head[0];
    });
  }

  async evaluateProvider(dto:CreateEvaluacionProveedorDto,idUser?:number){
    if([dto.precio,dto.entrega,dto.calidad,dto.atencion].some(value=>value>5))throw new BadRequestException('Las calificaciones deben estar entre 1 y 5');
    await this.dataSource.query(`INSERT INTO evaluacion_proveedor(id_proveedor,id_orden,precio,entrega,calidad,atencion,comentario,id_user) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id_orden) DO UPDATE SET precio=excluded.precio,entrega=excluded.entrega,calidad=excluded.calidad,atencion=excluded.atencion,comentario=excluded.comentario,id_user=excluded.id_user,created_at=clock_timestamp()`,[dto.idProveedor,dto.idOrden||null,dto.precio,dto.entrega,dto.calidad,dto.atencion,dto.comentario||null,idUser??null]);return {message:'Proveedor evaluado'};
  }
  providerRatings(){return queryRows<Record<string,unknown>>(this.dataSource,`SELECT p."IdProveedor" AS "idProveedor",p."RazonSocial" AS proveedor,count(e.id_evaluacion)::int AS evaluaciones,round(avg(e.precio),2) AS precio,round(avg(e.entrega),2) AS entrega,round(avg(e.calidad),2) AS calidad,round(avg(e.atencion),2) AS atencion,round(avg((e.precio+e.entrega+e.calidad+e.atencion)/4.0),2) AS promedio FROM proveedor p LEFT JOIN evaluacion_proveedor e ON e.id_proveedor=p."IdProveedor" GROUP BY p."IdProveedor" ORDER BY promedio DESC NULLS LAST,p."RazonSocial"`);}

  private async allocateBackorders(manager:EntityManager,idProducto:number){
    const stock=await queryRows<{disponible:string|number}>(manager,`SELECT GREATEST(0,p."Existencia"-COALESCE((SELECT sum(cantidad-cantidad_liberada) FROM reserva_inventario WHERE id_producto=$1 AND estado IN ('Activa','Surtida')),0)) AS disponible FROM producto p WHERE p."IdProducto"=$1`,[idProducto]);
    let available=Number(stock[0].disponible);if(available<=0)return;
    const rows=await queryRows<BackorderRow>(manager,`SELECT id_backorder AS "idBackorder",id_pedido AS "idPedido",id_detalle AS "idDetalle",cantidad-cantidad_asignada AS pendiente FROM backorder_cliente WHERE id_producto=$1 AND estado IN ('Pendiente','Parcial') ORDER BY prioridad,created_at FOR UPDATE SKIP LOCKED`,[idProducto]);
    for(const row of rows){if(available<=0)break;const qty=Math.min(available,Number(row.pendiente));await manager.query('INSERT INTO reserva_inventario(id_pedido,id_detalle,id_producto,cantidad) VALUES($1,$2,$3,$4)',[row.idPedido,row.idDetalle,idProducto,qty]);await manager.query('UPDATE pedido_venta_detalle SET cantidad_reservada=cantidad_reservada+$2 WHERE id_detalle=$1',[row.idDetalle,qty]);await manager.query(`UPDATE backorder_cliente SET cantidad_asignada=cantidad_asignada+$2,estado=CASE WHEN cantidad_asignada+$2>=cantidad THEN 'Cubierto' ELSE 'Parcial' END,updated_at=now() WHERE id_backorder=$1`,[row.idBackorder,qty]);available-=qty;}
  }
}
