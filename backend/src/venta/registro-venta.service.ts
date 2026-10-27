import { JwtPayload } from '../auth/auth.types';
import { commercialActor } from '../comercial/commercial-actor';
import { setAuditActor } from '../auth/audit-actor';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateVentaDto } from './venta.dto';
import { createHash } from 'node:crypto';
import { queryRows } from '../common/database/typed-query';
import {
  consumeCommercialAuthorizations,
  validateCommercialPolicy,
} from '../comercial/commercial-policy';
import {
  IdempotencyRow,
  FacturaRow,
  ProductoVentaRow,
  LineaOrigenRow,
  FolioRow,
  FacturaIdRow,
  GastoIdRow,
} from './venta.types';
@Injectable()
export class RegistroVentaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async create(createVentaDto: CreateVentaDto, idVendedor?: number, actor?:JwtPayload) {
    const queryRunner = this.dataSource.createQueryRunner();

    const tipoComprobante = createVentaDto.tipoComprobante || 'I';
    const serie =
      createVentaDto.serie || (tipoComprobante === 'E' ? 'NC' : 'A');

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if(actor)await commercialActor(queryRunner,actor,'ventas.crear');
      else await setAuditActor(queryRunner,idVendedor);
      const requestPayload = { ...createVentaDto };
      delete requestPayload.requestId;
      const payloadHash = createHash('sha256')
        .update(JSON.stringify(requestPayload))
        .digest('hex');
      if (createVentaDto.requestId) {
        await queryRunner.query(
          `SELECT pg_advisory_xact_lock(hashtext('venta-request:' || $1))`,
          [createVentaDto.requestId],
        );
        const previous = await queryRows<IdempotencyRow>(
          queryRunner,
          `SELECT response, payload_hash FROM operation_idempotency
            WHERE request_id = $1 AND operation_type = 'venta'`,
          [createVentaDto.requestId],
        );
        if (previous.length) {
          if (previous[0].payload_hash !== payloadHash) {
            throw new ConflictException(
              'El identificador de reintento ya fue usado con datos diferentes',
            );
          }
          await queryRunner.commitTransaction();
          return previous[0].response;
        }
      }

      let facturaOrigen: FacturaRow | null = null;
      let pedidoOrigen: {
        id_pedido: number;
        id_cliente: number;
        estado: string;
      } | null = null;
      if (createVentaDto.idPedido) {
        const orders = await queryRows<{
          id_pedido: number;
          id_cliente: number;
          estado: string;
        }>(
          queryRunner,
          'SELECT id_pedido,id_cliente,estado FROM pedido_venta WHERE id_pedido=$1 FOR UPDATE',
          [createVentaDto.idPedido],
        );
        pedidoOrigen = orders[0] || null;
        if (!pedidoOrigen)
          throw new BadRequestException('Pedido no encontrado');
        if (!['Surtido', 'Entregado'].includes(pedidoOrigen.estado))
          throw new ConflictException(
            'El pedido debe estar surtido o entregado antes de facturarse',
          );
        if (Number(pedidoOrigen.id_cliente) !== createVentaDto.idCliente)
          throw new BadRequestException(
            'El cliente de la venta no coincide con el pedido',
          );
      }
      if (tipoComprobante === 'E') {
        if (!createVentaDto.metodoReembolso)
          throw new BadRequestException('Selecciona el método de reembolso');
        const origins = await queryRows<FacturaRow>(
          queryRunner,
          `SELECT * FROM factura WHERE id_factura = $1 FOR UPDATE`,
          [createVentaDto.idFacturaOrigen || 0],
        );
        facturaOrigen = origins[0];
        if (
          !facturaOrigen ||
          Number(facturaOrigen.id_cliente) !== createVentaDto.idCliente ||
          facturaOrigen.tipo_comprobante !== 'I' ||
          facturaOrigen.estatus === 'Cancelada' ||
          facturaOrigen.serie === 'G' ||
          facturaOrigen.id_factura_global
        ) {
          throw new BadRequestException(
            'Selecciona una factura de ingreso vigente del mismo cliente que no esté agrupada',
          );
        }
        if (Number(facturaOrigen.saldo_pendiente) !== 0) {
          throw new BadRequestException(
            'Liquida o concilia el saldo de la factura antes de reembolsar',
          );
        }
        if (createVentaDto.moneda !== facturaOrigen.moneda)
          throw new BadRequestException(
            'La nota debe usar la moneda de su factura de origen',
          );
        const openClaims = await queryRows<Record<string, unknown>>(
          queryRunner,
          `SELECT 1 FROM garantia WHERE id_factura=$1 AND estado NOT IN ('Rechazada','Cerrada') LIMIT 1`,
          [facturaOrigen.id_factura],
        );
        if (openClaims.length)
          throw new BadRequestException(
            'Resuelve las garantías abiertas antes de emitir la nota',
          );
        const previousReturns = await queryRows<Record<string, unknown>>(
          queryRunner,
          'SELECT 1 FROM devolucion WHERE id_factura=$1 LIMIT 1',
          [facturaOrigen.id_factura],
        );
        if (previousReturns.length)
          throw new BadRequestException(
            'La factura ya utiliza devoluciones parciales; continúa con ese flujo',
          );
      } else if (
        createVentaDto.idFacturaOrigen ||
        createVentaDto.metodoReembolso ||
        serie === 'G' ||
        serie === 'NC'
      ) {
        throw new BadRequestException(
          'La serie o los datos de devolución no corresponden a una venta de ingreso',
        );
      }

      const productIds = [
        ...new Set(createVentaDto.conceptos.map((c) => c.idProducto)),
      ].sort((a, b) => a - b);
      const products = await queryRows<ProductoVentaRow>(
        queryRunner,
        `SELECT p."IdProducto" AS id, p."Existencia" AS existencia,
                GREATEST(p."Existencia"-COALESCE((SELECT sum(r.cantidad-r.cantidad_liberada) FROM reserva_inventario r
                  WHERE r.id_producto=p."IdProducto" AND r.estado IN ('Activa','Surtida')),0),0) AS disponible,
                COALESCE((SELECT sum(r.cantidad-r.cantidad_liberada) FROM reserva_inventario r
                  WHERE r.id_producto=p."IdProducto" AND r.id_pedido=$2 AND r.estado IN ('Activa','Surtida')),0) AS pedido_reservado,
                "ObjetoImpuesto" AS objeto_impuesto, "TasaIVA" AS tasa_iva,
                "AplicaRetencionISR" AS retiene_isr
           FROM producto p
          WHERE "IdProducto" = ANY($1::int[])
          ORDER BY "IdProducto"
          FOR UPDATE`,
        [productIds, createVentaDto.idPedido || 0],
      );
      if (products.length !== productIds.length) {
        throw new BadRequestException('Uno o más productos ya no existen');
      }

      const productMap = new Map(products.map((p) => [Number(p.id), p]));
      const requestedByProduct = new Map<number, number>();
      for (const concept of createVentaDto.conceptos) {
        requestedByProduct.set(
          concept.idProducto,
          (requestedByProduct.get(concept.idProducto) || 0) +
            Number(concept.cantidad),
        );
      }

      if (pedidoOrigen) {
        const orderLines = await queryRows<{
          id_producto: number;
          cantidad: number | string;
          valor_unitario: number | string;
        }>(
          queryRunner,
          `SELECT id_producto,cantidad_surtida AS cantidad,valor_unitario FROM pedido_venta_detalle
           WHERE id_pedido=$1 ORDER BY id_producto FOR UPDATE`,
          [pedidoOrigen.id_pedido],
        );
        if (
          !orderLines.length ||
          orderLines.some(
            (line) =>
              Math.abs(
                (requestedByProduct.get(Number(line.id_producto)) || 0) -
                  Number(line.cantidad),
              ) > 0.000001,
          ) ||
          requestedByProduct.size !== orderLines.length
        )
          throw new BadRequestException(
            'Las partidas de la venta no coinciden con lo surtido en el pedido',
          );
        const salePrices = new Map(
          createVentaDto.conceptos.map((line) => [
            line.idProducto,
            Number(line.valorUnitario),
          ]),
        );
        if (
          orderLines.some(
            (line) =>
              Math.abs(
                (salePrices.get(Number(line.id_producto)) ?? -1) -
                  Number(line.valor_unitario),
              ) > 0.000001,
          )
        ) {
          throw new BadRequestException(
            'Los precios de la venta no coinciden con el pedido',
          );
        }
      }

      const originLines = new Map<number, LineaOrigenRow>();
      if (facturaOrigen) {
        const original = await queryRows<LineaOrigenRow>(
          queryRunner,
          `
          SELECT cf.id_producto, SUM(cf.cantidad) AS cantidad,
                 SUM(cf.importe - COALESCE(cf.descuento, 0)) AS neto,
                 SUM(COALESCE(cf.importe_iva,0)) AS iva,
                 SUM(COALESCE(cf.importe_ret_isr,0)) AS retencion,
                 (SELECT COALESCE(SUM(nc.cantidad),0) FROM conceptofactura nc
                   JOIN factura nf ON nf.id_factura=nc.id_factura
                   WHERE nf.id_factura_origen=$1 AND nf.estatus::text <> 'Cancelada'
                     AND nc.id_producto=cf.id_producto) AS devuelto
            FROM conceptofactura cf WHERE cf.id_factura=$1 GROUP BY cf.id_producto`,
          [facturaOrigen.id_factura],
        );
        for (const row of original)
          originLines.set(Number(row.id_producto), row);
        for (const [product, quantity] of requestedByProduct) {
          const source = originLines.get(product);
          if (
            !source ||
            quantity + Number(source.devuelto) > Number(source.cantidad)
          ) {
            throw new BadRequestException(
              `La nota excede la cantidad pendiente de devolver del producto ${product}`,
            );
          }
        }
      }

      if (tipoComprobante === 'I') {
        for (const [idProducto, cantidad] of requestedByProduct) {
          const product = productMap.get(idProducto);
          if (!product)
            throw new BadRequestException(
              `Producto ${idProducto} no encontrado`,
            );
          const disponible =
            Number(product.disponible ?? product.existencia) +
            Number(product.pedido_reservado || 0);
          if (cantidad > disponible) {
            throw new ConflictException(
              `Stock insuficiente para el producto ${idProducto}. Disponible después de apartados: ${disponible}`,
            );
          }
        }
      } else if (!createVentaDto.cfdisRelacionados?.length) {
        throw new BadRequestException(
          'Una nota de crédito debe relacionarse con al menos un CFDI',
        );
      }

      const esPersonaMoral = createVentaDto.rfcReceptor.trim().length === 12;
      const money = (value: number) =>
        Math.round((value + Number.EPSILON) * 100) / 100;
      const conceptosNormalizados = createVentaDto.conceptos.map((concept) => {
        const product = productMap.get(concept.idProducto);
        if (!product)
          throw new BadRequestException(
            `Producto ${concept.idProducto} no encontrado`,
          );
        const importe = money(
          Number(concept.cantidad) * Number(concept.valorUnitario),
        );
        if (Number(concept.descuento || 0) > importe)
          throw new BadRequestException(
            'El descuento excede el importe del renglón',
          );
        const descuento = money(Number(concept.descuento || 0));
        const base = money(importe - descuento);
        const source = originLines.get(concept.idProducto);
        if (
          source &&
          base >
            money(
              (Number(source.neto) * Number(concept.cantidad)) /
                Number(source.cantidad),
            )
        ) {
          throw new BadRequestException(
            'El reembolso no puede superar el precio neto originalmente vendido',
          );
        }
        const objetoImpuesto = String(
          product.objeto_impuesto || concept.objetoImpuesto,
        );
        const tasaIva = source
          ? Number(source.iva) / (Number(source.neto) || 1)
          : objetoImpuesto === '02'
            ? Number(product.tasa_iva || 0)
            : 0;
        const tasaRetIsr = source
          ? Number(source.retencion) / (Number(source.neto) || 1)
          : product.retiene_isr && esPersonaMoral
            ? 0.0125
            : 0;

        return {
          ...concept,
          objetoImpuesto: source && tasaIva > 0 ? '02' : objetoImpuesto,
          importe,
          descuento,
          baseIva: tasaIva > 0 ? base : 0,
          tasaIva,
          importeIva: money(base * tasaIva),
          baseRetIsr: tasaRetIsr > 0 ? base : 0,
          tasaRetIsr,
          importeRetIsr: tasaRetIsr > 0 ? money(base * tasaRetIsr) : 0,
        };
      });
      const subtotal = money(
        conceptosNormalizados.reduce(
          (sum, c) => sum + c.importe - c.descuento,
          0,
        ),
      );
      const totalImpuestosTrasladados = money(
        conceptosNormalizados.reduce((sum, c) => sum + c.importeIva, 0),
      );
      const totalImpuestosRetenidos = money(
        conceptosNormalizados.reduce((sum, c) => sum + c.importeRetIsr, 0),
      );
      const total = money(
        subtotal + totalImpuestosTrasladados - totalImpuestosRetenidos,
      );
      const receivedTotals = [
        createVentaDto.subtotal,
        createVentaDto.totalImpuestosTrasladados,
        createVentaDto.totalImpuestosRetenidos,
        createVentaDto.total,
      ];
      const calculatedTotals = [
        subtotal,
        totalImpuestosTrasladados,
        totalImpuestosRetenidos,
        total,
      ];
      if (
        receivedTotals.some(
          (value, index) => Math.abs(value - calculatedTotals[index]) > 0.01,
        )
      ) {
        throw new BadRequestException(
          'Los totales de la venta no coinciden con el cálculo del servidor',
        );
      }
      const commercialAuthorizationIds =
        tipoComprobante === 'I'
          ? await validateCommercialPolicy(queryRunner, {
              idCliente: createVentaDto.idCliente,
              operacion: 'Venta',
              moneda: createVentaDto.moneda,
              tipoCambio: createVentaDto.tipoCambio,
              idMetodoPago: createVentaDto.idMetodoPago,
              idPedidoExcluido: createVentaDto.idPedido,
              total,
              validarPrecios: !pedidoOrigen,
              validarCredito: true,
              lineas: conceptosNormalizados.map((line) => ({
                idProducto: line.idProducto,
                cantidad: Number(line.cantidad),
                precio: (Number(line.importe)-Number(line.descuento||0))/Number(line.cantidad),
              })),
            })
          : [];
      const conceptosJson = JSON.stringify(conceptosNormalizados);

      // 1. Calcular el folio con MAX(folio) filtrando por serie
      await queryRunner.query(
        `SELECT pg_advisory_xact_lock(hashtext('factura-folio:' || $1))`,
        [serie],
      );
      const folioResult = await queryRows<FolioRow>(
        queryRunner,
        'SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1',
        [serie],
      );
      const folio = Number(folioResult[0].next_folio);

      await queryRunner.query(
        "SELECT set_config('app.current_order_id',$1,true)",
        [pedidoOrigen ? String(pedidoOrigen.id_pedido) : ''],
      );
      const result = await queryRows<FacturaIdRow>(
        queryRunner,
        `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) as id_factura`,
        [
          createVentaDto.idCliente,
          createVentaDto.rfcReceptor,
          createVentaDto.nombreReceptor,
          createVentaDto.cpReceptor,
          createVentaDto.regimenReceptor,
          createVentaDto.usoCfdi,
          createVentaDto.idFormaPago,
          createVentaDto.idMetodoPago,
          createVentaDto.moneda,
          createVentaDto.tipoCambio,
          subtotal,
          totalImpuestosTrasladados,
          totalImpuestosRetenidos,
          total,
          '',
          conceptosJson,
          idVendedor || null,
          folio,
          serie,
          tipoComprobante,
        ],
      );
      await queryRunner.query(
        "SELECT set_config('app.current_order_id','',true)",
      );

      const idFactura = result[0].id_factura;
      await consumeCommercialAuthorizations(
        queryRunner,
        commercialAuthorizationIds,
        'Venta',
        idFactura,
      );
      if (pedidoOrigen) {
        await queryRunner.query(
          `UPDATE factura SET id_pedido=$2,
          id_unidad=(SELECT id_unidad FROM pedido_venta WHERE id_pedido=$2) WHERE id_factura=$1`,
          [idFactura, pedidoOrigen.id_pedido],
        );
        await queryRunner.query(
          `UPDATE reserva_inventario SET estado='Consumida',updated_at=now()
          WHERE id_pedido=$1 AND estado IN ('Activa','Surtida')`,
          [pedidoOrigen.id_pedido],
        );
        await queryRunner.query(
          `UPDATE pedido_venta SET estado='Facturado',updated_at=now(),version=version+1 WHERE id_pedido=$1`,
          [pedidoOrigen.id_pedido],
        );
        await queryRunner.query(
          `INSERT INTO pedido_estado_historial(id_pedido,estado_anterior,estado_nuevo,detalle,id_user)
          VALUES($1,$2,'Facturado',$3,$4)`,
          [
            pedidoOrigen.id_pedido,
            pedidoOrigen.estado,
            `Factura ${serie}-${folio}`,
            idVendedor ?? null,
          ],
        );
      }
      if (facturaOrigen) {
        // fn_crear_venta también crea un cobro PUE: una nota de crédito nunca es un ingreso.
        await queryRunner.query('DELETE FROM pago WHERE id_factura=$1', [
          idFactura,
        ]);
        await queryRunner.query(
          `UPDATE factura SET id_factura_origen=$2, metodo_reembolso=$3,
          saldo_pendiente=0, estatus='Pagada', comision_vendedor=0 WHERE id_factura=$1`,
          [idFactura, facturaOrigen.id_factura, createVentaDto.metodoReembolso],
        );
      }

      // 2. Insertar cfdi_relacionado si existen
      if (
        createVentaDto.cfdisRelacionados &&
        createVentaDto.cfdisRelacionados.length > 0
      ) {
        for (const relacion of createVentaDto.cfdisRelacionados) {
          await queryRunner.query(
            `INSERT INTO cfdi_relacionado (id_factura, tipo_relacion, uuid_relacionado) VALUES ($1, $2, $3)`,
            [idFactura, relacion.tipoRelacion, relacion.uuidRelacionado],
          );
        }
      }

      // 3. Lógica Financiera de Reembolso para Egresos
      if (tipoComprobante === 'E' && createVentaDto.metodoReembolso) {
        if (createVentaDto.metodoReembolso === 'Saldo a Favor') {
          await queryRunner.query(
            'UPDATE cliente SET saldo_a_favor = saldo_a_favor + $1 WHERE "IdCliente" = $2',
            [total, createVentaDto.idCliente],
          );
        } else if (createVentaDto.metodoReembolso === 'Efectivo') {
          const expenses = await queryRows<GastoIdRow>(
            queryRunner,
            'INSERT INTO gasto (concepto, monto, categoria, metodo_pago, id_user) VALUES ($1, $2, $3, $4, $5) RETURNING id_gasto',
            [
              'DEVOLUCION EFECTIVO NOTA DE CREDITO ' + serie + '-' + folio,
              total,
              'Devoluciones y Reembolsos',
              'Efectivo',
              idVendedor || null,
            ],
          );
          await queryRunner.query(
            'UPDATE factura SET id_gasto_reembolso=$2 WHERE id_factura=$1',
            [idFactura, expenses[0].id_gasto],
          );
        }
      }

      const response = {
        message: 'Venta registrada con éxito',
        idFactura: idFactura,
      };
      if (createVentaDto.requestId) {
        await queryRunner.query(
          `INSERT INTO operation_idempotency(request_id, operation_type, id_user, payload_hash, response)
           VALUES ($1, 'venta', $2, $3, $4::jsonb)`,
          [
            createVentaDto.requestId,
            idVendedor || null,
            payloadHash,
            JSON.stringify(response),
          ],
        );
      }
      await queryRunner.commitTransaction();
      return response;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
