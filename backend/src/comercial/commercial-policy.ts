import { ConflictException } from '@nestjs/common';
import { QueryExecutor, queryRows } from '../common/database/typed-query';

export interface CommercialPolicyLine {
  idProducto: number;
  cantidad: number;
  precio: number;
}

export interface CommercialPolicyInput {
  idCliente: number;
  operacion?: 'Venta' | 'Pedido' | 'Cotizacion';
  lineas?: CommercialPolicyLine[];
  total?: number;
  moneda?: string;
  tipoCambio?: number;
  idMetodoPago?: number;
  idPedidoExcluido?: number;
  validarPrecios?: boolean;
  validarCredito?: boolean;
}

interface ClientPolicyRow {
  bloqueado: boolean;
  motivoBloqueo: string | null;
  limite: string | number;
  deuda: string | number;
  comprometido: string | number;
  esCredito: boolean;
}

interface PricePolicyRow {
  idProducto: number;
  precio: string | number;
  sugerido: string | number;
  costo: string | number;
  margenMinimo: string | number;
}

async function claimAuthorization(
  executor: QueryExecutor,
  idCliente: number,
  tipo: 'Descuento' | 'Margen bajo' | 'Exceso credito',
  valor: number,
  idProducto?: number,
  operacion: 'Venta' | 'Pedido' | 'Cotizacion' = 'Venta',
  total?: number,
  moneda = 'MXN',
  tipoCambio = 1,
) {
  if(!Number.isFinite(total)||Number(total)<0)throw new ConflictException('La autorización requiere el total calculado de la operación');
  if(moneda!=='MXN'||tipoCambio!==1)throw new ConflictException('Las autorizaciones por monto requieren MXN y tipo de cambio 1');
  // Configuración y decisión/consumo comparten este bloqueo hasta el commit.
  await executor.query("SELECT pg_advisory_xact_lock_shared(hashtext('commercial-approvals'))");
  // Los cambios de permiso/rol bloquean esta misma fila. La consulta posterior
  // obtiene un snapshot nuevo después de esperar al administrador concurrente.
  await executor.query(`SELECT u.id_user FROM auth_user u WHERE u.id_user IN
    (SELECT id_autorizador FROM solicitud_autorizacion_comercial WHERE id_cliente=$1 AND tipo=$2 AND estado='Aprobada')
    ORDER BY u.id_user FOR SHARE`,[idCliente,tipo]);
  const rows = await queryRows<{ id: number }>(executor, `
    SELECT a.id_autorizacion AS id
      FROM solicitud_autorizacion_comercial a
      JOIN comercial_regla_aprobacion r ON r.operacion=$5 AND r.tipo=a.tipo
      JOIN auth_user u ON u.id_user=a.id_autorizador AND u.role='admin' AND u.is_active
      LEFT JOIN comercial_limite_aprobador l ON l.id_usuario=u.id_user AND l.operacion=$5
     WHERE a.id_cliente=$1 AND a.tipo=$2 AND a.estado='Aprobada'
       AND (a.expires_at IS NULL OR a.expires_at>now())
       AND ($3::int IS NULL OR a.id_producto=$3)
       AND ($3::int IS NOT NULL OR a.id_producto IS NULL)
       AND abs(a.valor_solicitado-$4)<=0.01
       AND fn_effective_permission(u.id_user,u.role,'credito.autorizar')
       AND (r.monto_maximo IS NULL OR $6::numeric<=r.monto_maximo)
       AND (l.monto_maximo IS NULL OR $6::numeric<=l.monto_maximo)
       AND (NOT r.requiere_distinto OR (a.id_solicitante IS NOT NULL AND a.id_solicitante<>u.id_user))
       AND ((a.operacion_destino=$5 AND a.monto_operacion >= $6::numeric AND a.regla_version=r.version)
         OR (a.operacion_destino IS NULL AND r.version=1 AND NOT r.requiere_distinto))
     ORDER BY a.resolved_at,a.id_autorizacion
     LIMIT 1
     FOR UPDATE OF a SKIP LOCKED FOR SHARE OF u`, [idCliente, tipo, idProducto ?? null, valor,operacion,total]);
  if (!rows.length) {
    const suffix = idProducto ? ` para el producto ${idProducto}` : '';
    throw new ConflictException(`La operación requiere una autorización vigente de ${tipo.toLowerCase()}${suffix}`);
  }
  return Number(rows[0].id);
}

export async function validateCommercialPolicy(
  executor: QueryExecutor,
  input: CommercialPolicyInput,
): Promise<number[]> {
  const policies = await queryRows<ClientPolicyRow>(executor, `
    SELECT cc.bloqueado,cc.motivo_bloqueo AS "motivoBloqueo",cc.limite_credito AS limite,
      COALESCE((SELECT sum(f.saldo_pendiente) FROM factura f
        WHERE f.id_cliente=cc.id_cliente AND f.estatus::text<>'Cancelada'),0) AS deuda,
      COALESCE((SELECT sum(pv.total) FROM pedido_venta pv
        WHERE pv.id_cliente=cc.id_cliente
          AND pv.estado IN ('Borrador','Confirmado','En espera','Parcialmente surtido','Surtido','Entregado')
          AND ($3::int IS NULL OR pv.id_pedido<>$3)),0) AS comprometido,
      COALESCE(mp."Clave"='PPD',false) AS "esCredito"
    FROM cliente_comercial cc
    LEFT JOIN metododepago mp ON mp."IdMetodoDePago"=$2
    WHERE cc.id_cliente=$1
    FOR UPDATE OF cc`, [input.idCliente, input.idMetodoPago ?? null, input.idPedidoExcluido ?? null]);

  // Los clientes todavía no configurados conservan el comportamiento histórico.
  if (!policies.length) return [];
  const policy = policies[0];
  if (policy.bloqueado) {
    throw new ConflictException(policy.motivoBloqueo?.trim() || 'El cliente está bloqueado por política comercial');
  }

  const authorizationIds: number[] = [];
  const lines = input.lineas || [];
  if (input.validarPrecios !== false && lines.length) {
    const priceRows = await queryRows<PricePolicyRow>(executor, `
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset($2::jsonb)
          AS x("idProducto" int,cantidad numeric,precio numeric)
      )
      SELECT r."idProducto" AS "idProducto",r.precio,
        COALESCE(pe.precio,ld.precio,p."PrecioUnitario") AS sugerido,
        COALESCE(p.costo_reposicion,
          (SELECT avg(rd.costo_unitario) FROM recepcion_compra_detalle rd WHERE rd.id_producto=p."IdProducto"),
          (SELECT avg(k.precio_unitario) FROM kardex k WHERE k.id_producto=p."IdProducto" AND k.tipo_movimiento::text='COMPRA'),
          p."PrecioUnitario"*.6) AS costo,
        p.margen_minimo AS "margenMinimo"
      FROM requested r
      JOIN producto p ON p."IdProducto"=r."idProducto"
      LEFT JOIN lista_precio lp ON lp.id_lista=(SELECT id_lista FROM cliente_comercial WHERE id_cliente=$1)
        AND lp.activa AND (lp.valid_from IS NULL OR lp.valid_from<=current_date)
        AND (lp.valid_to IS NULL OR lp.valid_to>=current_date)
      LEFT JOIN LATERAL(SELECT precio FROM lista_precio_detalle
        WHERE id_lista=lp.id_lista AND id_producto=p."IdProducto" AND cantidad_minima<=r.cantidad
        ORDER BY cantidad_minima DESC LIMIT 1)ld ON true
      LEFT JOIN precio_especial_cliente pe ON pe.id_cliente=$1 AND pe.id_producto=p."IdProducto"
        AND (pe.valid_from IS NULL OR pe.valid_from<=current_date)
        AND (pe.valid_to IS NULL OR pe.valid_to>=current_date)`, [input.idCliente, JSON.stringify(lines)]);

    for (const row of priceRows) {
      const price = Number(row.precio);
      const suggested = Number(row.sugerido);
      const cost = Number(row.costo);
      const minimum = cost / (1 - Number(row.margenMinimo));
      if (price + 0.000001 < minimum) {
        authorizationIds.push(await claimAuthorization(executor, input.idCliente, 'Margen bajo', price, row.idProducto,input.operacion,input.total,input.moneda,input.tipoCambio));
      } else if (price + 0.000001 < suggested) {
        authorizationIds.push(await claimAuthorization(executor, input.idCliente, 'Descuento', price, row.idProducto,input.operacion,input.total,input.moneda,input.tipoCambio));
      }
    }
  }

  if (input.validarCredito !== false && policy.esCredito) {
    const total = Number(input.total || 0);
    const available = Number(policy.limite) - Number(policy.deuda) - Number(policy.comprometido);
    if (total > available + 0.01) {
      authorizationIds.push(await claimAuthorization(executor, input.idCliente, 'Exceso credito', total,undefined,input.operacion,total,input.moneda,input.tipoCambio));
    }
  }
  return [...new Set(authorizationIds)];
}

export async function consumeCommercialAuthorizations(
  executor: QueryExecutor,
  ids: number[],
  operationType: 'Venta' | 'Pedido' | 'Cotizacion',
  operationId: number,
) {
  if (!ids.length) return;
  const result = await queryRows<{ id: number }>(executor, `
    WITH changed AS (UPDATE solicitud_autorizacion_comercial
       SET estado='Utilizada',operacion_tipo=$2,operacion_id=$3,used_at=now()
     WHERE id_autorizacion=ANY($1::int[]) AND estado='Aprobada'
     RETURNING id_autorizacion AS id) SELECT id FROM changed`, [ids, operationType, operationId]);
  if (result.length !== ids.length) {
    throw new ConflictException('Una autorización comercial ya fue utilizada por otra operación');
  }
}
