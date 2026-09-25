// backend/src/venta/venta.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateVentaDto, ProcesarDevolucionDto } from './venta.dto';
import * as nodemailer from 'nodemailer';
import { TicketService } from './ticket.service';
import { createHash } from 'node:crypto';
import { queryRows } from '../common/database/typed-query';
import { TicketQueryResult } from './ticket.types';
import { consumeCommercialAuthorizations, validateCommercialPolicy } from '../comercial/commercial-policy';

interface IdempotencyRow { response: Record<string, unknown>; payload_hash: string; }
interface FacturaRow { id_factura: number; id_cliente: number; tipo_comprobante: string; estatus: string; serie: string; id_factura_global: number | null; saldo_pendiente: number | string; moneda: string; }
interface ProductoVentaRow { id: number; existencia: number | string; disponible?: number | string; pedido_reservado?: number | string; objeto_impuesto: string; tasa_iva: number | string; retiene_isr: boolean; }
interface LineaOrigenRow { id_producto: number; cantidad: number | string; neto: number | string; iva: number | string; retencion: number | string; devuelto: number | string; }
interface FolioRow { next_folio: number | string; }
interface FacturaIdRow { id_factura: number; }
interface GastoIdRow { id_gasto: number; }
interface CountRow { count: string | number; }
interface EmailFacturaRow { destinatario: string; asunto: string; cuerpo_mensaje: string; nombre_archivo: string; }
interface DevolucionIdRow { id_devolucion: number | string; }
export interface TicketResumenRow { idFactura: number; subtotal: number | string; totalImpuestosTrasladados: number | string; totalImpuestosRetenidos: number | string; total: number | string; [key: string]: unknown; }
interface TicketGlobalRow { id_factura: number; subtotal: number | string; total_impuestos_trasladados: number | string; total_impuestos_retenidos: number | string; total: number | string; [key: string]: unknown; }
interface ClienteGenericoRow { IdCliente: number; RFC: string; RazonSocial: string; CodigoPostal: string; IdFormaPago: number | null; IdMetodoDePago: number | null; }

@Injectable()
export class VentaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ticketService: TicketService,
  ) {}

  async generarTicketPdf(idFactura: number): Promise<Buffer> {
    const resultado = await queryRows<TicketQueryResult>(this.dataSource,
      'SELECT fn_get_datos_ticket($1) as datos',
      [idFactura],
    );

    return this.ticketService.crearPdfFactura(resultado[0].datos);
  }

  async getFacturasRelacionables(idCliente: number) {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT id_factura, serie, folio, COALESCE(uuid, '00000000-0000-0000-0000-000000000000') as uuid, fecha_emision, total 
       FROM factura 
       WHERE id_cliente = $1 AND estatus::text <> 'Cancelada'
         AND COALESCE(tipo_comprobante, 'I') = 'I' AND serie <> 'G'
       ORDER BY fecha_emision DESC`,
      [idCliente]
    );
  }

  async create(createVentaDto: CreateVentaDto, idVendedor?: number) {
    const queryRunner = this.dataSource.createQueryRunner();

    const tipoComprobante = createVentaDto.tipoComprobante || 'I';
    const serie = createVentaDto.serie || (tipoComprobante === 'E' ? 'NC' : 'A');

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query("SELECT set_config('app.current_user_id', $1, true)", [idVendedor?.toString() || '']);
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
        const previous = await queryRows<IdempotencyRow>(queryRunner,
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
      let pedidoOrigen: { id_pedido: number; id_cliente: number; estado: string } | null = null;
      if (createVentaDto.idPedido) {
        const orders = await queryRows<{ id_pedido: number; id_cliente: number; estado: string }>(queryRunner,
          'SELECT id_pedido,id_cliente,estado FROM pedido_venta WHERE id_pedido=$1 FOR UPDATE', [createVentaDto.idPedido]);
        pedidoOrigen = orders[0] || null;
        if (!pedidoOrigen) throw new BadRequestException('Pedido no encontrado');
        if (!['Surtido','Entregado'].includes(pedidoOrigen.estado)) throw new ConflictException('El pedido debe estar surtido o entregado antes de facturarse');
        if (Number(pedidoOrigen.id_cliente) !== createVentaDto.idCliente) throw new BadRequestException('El cliente de la venta no coincide con el pedido');
      }
      if (tipoComprobante === 'E') {
        if (!createVentaDto.metodoReembolso) throw new BadRequestException('Selecciona el método de reembolso');
        const origins = await queryRows<FacturaRow>(queryRunner,
          `SELECT * FROM factura WHERE id_factura = $1 FOR UPDATE`, [createVentaDto.idFacturaOrigen || 0],
        );
        facturaOrigen = origins[0];
        if (!facturaOrigen || Number(facturaOrigen.id_cliente) !== createVentaDto.idCliente ||
            facturaOrigen.tipo_comprobante !== 'I' || facturaOrigen.estatus === 'Cancelada' ||
            facturaOrigen.serie === 'G' || facturaOrigen.id_factura_global) {
          throw new BadRequestException('Selecciona una factura de ingreso vigente del mismo cliente que no esté agrupada');
        }
        if (Number(facturaOrigen.saldo_pendiente) !== 0) {
          throw new BadRequestException('Liquida o concilia el saldo de la factura antes de reembolsar');
        }
        if (createVentaDto.moneda !== facturaOrigen.moneda) throw new BadRequestException('La nota debe usar la moneda de su factura de origen');
        const openClaims = await queryRows<Record<string, unknown>>(queryRunner,
          `SELECT 1 FROM garantia WHERE id_factura=$1 AND estado NOT IN ('Rechazada','Cerrada') LIMIT 1`, [facturaOrigen.id_factura],
        );
        if (openClaims.length) throw new BadRequestException('Resuelve las garantías abiertas antes de emitir la nota');
        const previousReturns = await queryRows<Record<string, unknown>>(queryRunner,
          'SELECT 1 FROM devolucion WHERE id_factura=$1 LIMIT 1', [facturaOrigen.id_factura],
        );
        if (previousReturns.length) throw new BadRequestException('La factura ya utiliza devoluciones parciales; continúa con ese flujo');
      } else if (createVentaDto.idFacturaOrigen || createVentaDto.metodoReembolso || serie === 'G' || serie === 'NC') {
        throw new BadRequestException('La serie o los datos de devolución no corresponden a una venta de ingreso');
      }

      const productIds = [...new Set(createVentaDto.conceptos.map((c) => c.idProducto))].sort(
        (a, b) => a - b,
      );
      const products = await queryRows<ProductoVentaRow>(queryRunner,
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
          (requestedByProduct.get(concept.idProducto) || 0) + Number(concept.cantidad),
        );
      }

      if (pedidoOrigen) {
        const orderLines = await queryRows<{ id_producto: number; cantidad: number | string; valor_unitario: number | string }>(queryRunner,
          `SELECT id_producto,cantidad_surtida AS cantidad,valor_unitario FROM pedido_venta_detalle
           WHERE id_pedido=$1 ORDER BY id_producto FOR UPDATE`, [pedidoOrigen.id_pedido]);
        if (!orderLines.length || orderLines.some(line => Math.abs((requestedByProduct.get(Number(line.id_producto)) || 0) - Number(line.cantidad)) > 0.000001) ||
            requestedByProduct.size !== orderLines.length) throw new BadRequestException('Las partidas de la venta no coinciden con lo surtido en el pedido');
        const salePrices = new Map(createVentaDto.conceptos.map(line => [line.idProducto, Number(line.valorUnitario)]));
        if (orderLines.some(line => Math.abs((salePrices.get(Number(line.id_producto)) ?? -1) - Number(line.valor_unitario)) > 0.000001)) {
          throw new BadRequestException('Los precios de la venta no coinciden con el pedido');
        }
      }

      const originLines = new Map<number, LineaOrigenRow>();
      if (facturaOrigen) {
        const original = await queryRows<LineaOrigenRow>(queryRunner, `
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
        for (const row of original) originLines.set(Number(row.id_producto), row);
        for (const [product, quantity] of requestedByProduct) {
          const source = originLines.get(product);
          if (!source || quantity + Number(source.devuelto) > Number(source.cantidad)) {
            throw new BadRequestException(`La nota excede la cantidad pendiente de devolver del producto ${product}`);
          }
        }
      }

      if (tipoComprobante === 'I') {
        for (const [idProducto, cantidad] of requestedByProduct) {
          const product = productMap.get(idProducto);
          if (!product) throw new BadRequestException(`Producto ${idProducto} no encontrado`);
          const disponible = Number(product.disponible ?? product.existencia) + Number(product.pedido_reservado || 0);
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
      const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
      const conceptosNormalizados = createVentaDto.conceptos.map((concept) => {
        const product = productMap.get(concept.idProducto);
        if (!product) throw new BadRequestException(`Producto ${concept.idProducto} no encontrado`);
        const importe = money(Number(concept.cantidad) * Number(concept.valorUnitario));
        if (Number(concept.descuento || 0) > importe) throw new BadRequestException('El descuento excede el importe del renglón');
        const descuento = money(Number(concept.descuento || 0));
        const base = money(importe - descuento);
        const source = originLines.get(concept.idProducto);
        if (source && base > money(Number(source.neto) * Number(concept.cantidad) / Number(source.cantidad))) {
          throw new BadRequestException('El reembolso no puede superar el precio neto originalmente vendido');
        }
        const objetoImpuesto = String(product.objeto_impuesto || concept.objetoImpuesto);
        const tasaIva = source ? Number(source.iva) / (Number(source.neto) || 1)
          : objetoImpuesto === '02' ? Number(product.tasa_iva || 0) : 0;
        const tasaRetIsr = source ? Number(source.retencion) / (Number(source.neto) || 1)
          : product.retiene_isr && esPersonaMoral ? 0.0125 : 0;

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
        conceptosNormalizados.reduce((sum, c) => sum + c.importe - c.descuento, 0),
      );
      const totalImpuestosTrasladados = money(
        conceptosNormalizados.reduce((sum, c) => sum + c.importeIva, 0),
      );
      const totalImpuestosRetenidos = money(
        conceptosNormalizados.reduce((sum, c) => sum + c.importeRetIsr, 0),
      );
      const total = money(subtotal + totalImpuestosTrasladados - totalImpuestosRetenidos);
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
      if (receivedTotals.some((value, index) => Math.abs(value - calculatedTotals[index]) > 0.01)) {
        throw new BadRequestException(
          'Los totales de la venta no coinciden con el cálculo del servidor',
        );
      }
      const commercialAuthorizationIds = tipoComprobante === 'I'
        ? await validateCommercialPolicy(queryRunner, {
            idCliente: createVentaDto.idCliente,
            idMetodoPago: createVentaDto.idMetodoPago,
            idPedidoExcluido: createVentaDto.idPedido,
            total,
            validarPrecios: !pedidoOrigen,
            validarCredito: true,
            lineas: conceptosNormalizados.map((line) => ({
              idProducto: line.idProducto,
              cantidad: Number(line.cantidad),
              precio: Number(line.valorUnitario),
            })),
          })
        : [];
      const conceptosJson = JSON.stringify(conceptosNormalizados);

      // 1. Calcular el folio con MAX(folio) filtrando por serie
      await queryRunner.query(
        `SELECT pg_advisory_xact_lock(hashtext('factura-folio:' || $1))`,
        [serie],
      );
      const folioResult = await queryRows<FolioRow>(queryRunner,
        'SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1',
        [serie]
      );
      const folio = Number(folioResult[0].next_folio);

      await queryRunner.query("SELECT set_config('app.current_order_id',$1,true)", [
        pedidoOrigen ? String(pedidoOrigen.id_pedido) : '',
      ]);
      const result = await queryRows<FacturaIdRow>(queryRunner,
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
          tipoComprobante
        ],
      );
      await queryRunner.query("SELECT set_config('app.current_order_id','',true)");

      const idFactura = result[0].id_factura;
      await consumeCommercialAuthorizations(queryRunner, commercialAuthorizationIds, 'Venta', idFactura);
      if (pedidoOrigen) {
        await queryRunner.query(`UPDATE factura SET id_pedido=$2,
          id_unidad=(SELECT id_unidad FROM pedido_venta WHERE id_pedido=$2) WHERE id_factura=$1`,
        [idFactura, pedidoOrigen.id_pedido]);
        await queryRunner.query(`UPDATE reserva_inventario SET estado='Consumida',updated_at=now()
          WHERE id_pedido=$1 AND estado IN ('Activa','Surtida')`, [pedidoOrigen.id_pedido]);
        await queryRunner.query(`UPDATE pedido_venta SET estado='Facturado',updated_at=now(),version=version+1 WHERE id_pedido=$1`, [pedidoOrigen.id_pedido]);
        await queryRunner.query(`INSERT INTO pedido_estado_historial(id_pedido,estado_anterior,estado_nuevo,detalle,id_user)
          VALUES($1,$2,'Facturado',$3,$4)`, [pedidoOrigen.id_pedido, pedidoOrigen.estado, `Factura ${serie}-${folio}`, idVendedor ?? null]);
      }
      if (facturaOrigen) {
        // fn_crear_venta también crea un cobro PUE: una nota de crédito nunca es un ingreso.
        await queryRunner.query('DELETE FROM pago WHERE id_factura=$1', [idFactura]);
        await queryRunner.query(`UPDATE factura SET id_factura_origen=$2, metodo_reembolso=$3,
          saldo_pendiente=0, estatus='Pagada', comision_vendedor=0 WHERE id_factura=$1`,
          [idFactura, facturaOrigen.id_factura, createVentaDto.metodoReembolso]);
      }

      // 2. Insertar cfdi_relacionado si existen
      if (createVentaDto.cfdisRelacionados && createVentaDto.cfdisRelacionados.length > 0) {
        for (const relacion of createVentaDto.cfdisRelacionados) {
          await queryRunner.query(
            `INSERT INTO cfdi_relacionado (id_factura, tipo_relacion, uuid_relacionado) VALUES ($1, $2, $3)`,
            [idFactura, relacion.tipoRelacion, relacion.uuidRelacionado]
          );
        }
      }

      // 3. Lógica Financiera de Reembolso para Egresos
      if (tipoComprobante === 'E' && createVentaDto.metodoReembolso) {
        if (createVentaDto.metodoReembolso === 'Saldo a Favor') {
          await queryRunner.query(
            'UPDATE cliente SET saldo_a_favor = saldo_a_favor + $1 WHERE "IdCliente" = $2',
            [total, createVentaDto.idCliente]
          );
        } else if (createVentaDto.metodoReembolso === 'Efectivo') {
          const expenses = await queryRows<GastoIdRow>(queryRunner,
            'INSERT INTO gasto (concepto, monto, categoria, metodo_pago, id_user) VALUES ($1, $2, $3, $4, $5) RETURNING id_gasto',
            ['DEVOLUCION EFECTIVO NOTA DE CREDITO ' + serie + '-' + folio, total, 'Devoluciones y Reembolsos', 'Efectivo', idVendedor || null]
          );
          await queryRunner.query('UPDATE factura SET id_gasto_reembolso=$2 WHERE id_factura=$1', [idFactura, expenses[0].id_gasto]);
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
          [createVentaDto.requestId, idVendedor || null, payloadHash, JSON.stringify(response)],
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

  async getComisionesSemanales() {
    return queryRows<Record<string, unknown>>(this.dataSource, 'SELECT * FROM fn_get_comisiones_semanales()');
  }

  async findAll(page: number = 1, limit: number = 10, term: string = '', tipo: string = '') {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const offset = (safePage - 1) * safeLimit;


    const [totalResult, dataResult] = await Promise.all([
      queryRows<CountRow>(this.dataSource, 'SELECT COUNT(*) as count FROM fn_get_facturas(NULL, NULL, $1, $2)', [term, tipo]),
      queryRows<Record<string, unknown>>(this.dataSource,
        'SELECT * FROM fn_get_facturas($1, $2, $3, $4)',
        [safeLimit, offset, term, tipo]
      ),
    ]);


    const total = Number(totalResult[0].count);
    const totalPages = Math.ceil(total / safeLimit);

    return {
      data: dataResult,
      total,
      page: safePage,
      totalPages,
    };
  }


  async findDetalle(idFactura: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, 'SELECT * FROM fn_get_detalle_factura($1)', [
      idFactura,
    ]);
  }

  async enviarFacturaPorCorreo(idFactura: number) {
    const res = await queryRows<EmailFacturaRow>(this.dataSource,
      'SELECT * FROM fn_preparar_envio_correo($1)',
      [idFactura],
    );
    if (!res || res.length === 0)
      throw new Error('Error al obtener datos de envío.');
    const datosEnvio = res[0];
    const pdfBuffer = await this.generarTicketPdf(idFactura);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: '"Refacciones y Tractorepuestos" <dusk081.eth@gmail.com>',
      to: datosEnvio.destinatario,
      subject: datosEnvio.asunto,
      text: datosEnvio.cuerpo_mensaje,
      attachments: [
        { filename: datosEnvio.nombre_archivo, content: pdfBuffer },
      ],
    });
    return { message: `Correo enviado a ${datosEnvio.destinatario}` };
  }

  async cancelarFactura(idFactura: number, idUsuario?: number) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Mantiene el mismo orden de bloqueo que el alta de notas de crédito.
      await queryRunner.query(`SELECT f.id_factura FROM factura f
        WHERE f.id_factura=(SELECT id_factura_origen FROM factura WHERE id_factura=$1) FOR UPDATE`, [idFactura]);
      await queryRunner.query('CALL sp_cancelar_factura($1, $2)', [idFactura, idUsuario ?? null]);
      await queryRunner.commitTransaction();
      return { message: 'Factura cancelada y stock restaurado en Kardex con éxito' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async procesarDevolucion(
    idFactura: number,
    dto: ProcesarDevolucionDto,
    idUsuario?: number,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await queryRows<DevolucionIdRow>(queryRunner,
        'SELECT sp_procesar_devolucion_parcial($1, $2, $3::jsonb, $4) AS id_devolucion',
        [idFactura, dto.metodoReembolso, JSON.stringify(dto.articulos), idUsuario ?? null],
      );
      await queryRunner.commitTransaction();
      return {
        idDevolucion: Number(result[0].id_devolucion),
        message: 'Devolución registrada e inventario actualizado',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getTicketsPendientesGlobal(fechaInicio: string, fechaFin: string) {
    if (fechaInicio > fechaFin) throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
    const query = `
      SELECT 
        id_factura AS "idFactura",
        serie,
        folio,
        fecha_emision AS "fechaEmision",
        rfc_receptor AS "rfcReceptor",
        nombre_receptor AS "nombreReceptor",
        subtotal,
        total_impuestos_trasladados AS "totalImpuestosTrasladados",
        total_impuestos_retenidos AS "totalImpuestosRetenidos",
        total
      FROM factura
      WHERE fecha_emision::date >= $1::date 
        AND fecha_emision::date <= $2::date
        AND uuid IS NULL
        AND id_factura_global IS NULL
        AND estatus != 'Cancelada'
        AND COALESCE(tipo_comprobante, 'I') = 'I'
        AND saldo_pendiente = 0 AND serie <> 'G'
        AND NOT EXISTS (SELECT 1 FROM devolucion d WHERE d.id_factura=factura.id_factura)
        AND NOT EXISTS (SELECT 1 FROM factura nc WHERE nc.id_factura_origen=factura.id_factura AND nc.estatus::text <> 'Cancelada')
      ORDER BY id_factura ASC
    `;
    const tickets = await queryRows<TicketResumenRow>(this.dataSource, query, [fechaInicio, fechaFin]);

    let subtotalSum = 0;
    let impuestosTrasladadosSum = 0;
    let impuestosRetenidosSum = 0;
    let totalSum = 0;

    for (const t of tickets) {
      subtotalSum += Number(t.subtotal || 0);
      impuestosTrasladadosSum += Number(t.totalImpuestosTrasladados || 0);
      impuestosRetenidosSum += Number(t.totalImpuestosRetenidos || 0);
      totalSum += Number(t.total || 0);
    }

    return {
      tickets,
      totales: {
        subtotal: Number(subtotalSum.toFixed(2)),
        totalImpuestosTrasladados: Number(impuestosTrasladadosSum.toFixed(2)),
        totalImpuestosRetenidos: Number(impuestosRetenidosSum.toFixed(2)),
        total: Number(totalSum.toFixed(2)),
      }
    };
  }

  async generarFacturaGlobal(fechaInicio: string, fechaFin: string, idsTickets: number[], idVendedor?: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query("SELECT set_config('app.current_user_id', $1, true)", [
        idVendedor?.toString() || '',
      ]);
      if (!idsTickets || idsTickets.length === 0) {
        throw new BadRequestException('Debe proporcionar al menos un ticket para agrupar.');
      }
      if (fechaInicio > fechaFin) throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)) {
        throw new BadRequestException('El rango de fechas no es válido');
      }
      const uniqueIds = [...new Set(idsTickets.map(Number))];
      if (uniqueIds.length !== idsTickets.length || uniqueIds.some((id) => !Number.isInteger(id) || id < 1)) {
        throw new BadRequestException('La selección contiene tickets inválidos o repetidos');
      }

      const ticketsQuery = `
        SELECT id_factura, serie, folio, subtotal, total_impuestos_trasladados, total_impuestos_retenidos, total
        FROM factura
        WHERE id_factura = ANY($1::int[])
          AND fecha_emision::date BETWEEN $2::date AND $3::date
          AND uuid IS NULL
          AND id_factura_global IS NULL
          AND estatus != 'Cancelada'
          AND COALESCE(tipo_comprobante, 'I') = 'I'
          AND saldo_pendiente = 0 AND serie <> 'G'
          AND NOT EXISTS (SELECT 1 FROM devolucion d WHERE d.id_factura=factura.id_factura)
          AND NOT EXISTS (SELECT 1 FROM factura nc WHERE nc.id_factura_origen=factura.id_factura AND nc.estatus::text <> 'Cancelada')
        ORDER BY id_factura
        FOR UPDATE
      `;
      const tickets = await queryRows<TicketGlobalRow>(queryRunner, ticketsQuery, [uniqueIds, fechaInicio, fechaFin]);

      if (tickets.length !== uniqueIds.length) {
        throw new BadRequestException(
          'Uno o más tickets no pertenecen al periodo, ya fueron agrupados o no son elegibles',
        );
      }

      const clientQuery = `SELECT "IdCliente", "RFC", "RazonSocial", "CodigoPostal", "IdRegimenFiscal", "IdUsoCFDI", "IdFormaPago", "IdMetodoDePago" FROM cliente WHERE "RFC" = 'XAXX010101000' LIMIT 1`;
      const clientResult = await queryRows<ClienteGenericoRow>(queryRunner, clientQuery);
      if (clientResult.length === 0) {
        throw new Error('El cliente genérico para PUBLICO EN GENERAL no existe en la base de datos.');
      }
      const genericClient = clientResult[0];

      let subtotal = 0;
      let totalImpuestosTrasladados = 0;
      let totalImpuestosRetenidos = 0;
      let total = 0;

      const conceptos: Record<string, unknown>[] = [];

      for (const t of tickets) {
        const ticketSubtotal = Number(t.subtotal || 0);
        const ticketIva = Number(t.total_impuestos_trasladados || 0);
        const ticketTotal = Number(t.total || 0);

        subtotal += ticketSubtotal;
        totalImpuestosTrasladados += ticketIva;
        totalImpuestosRetenidos += Number(t.total_impuestos_retenidos || 0);
        total += ticketTotal;

        conceptos.push({
          idProducto: null,
          claveProdServ: '84111506',
          claveUnidad: 'ACT',
          objetoImpuesto: '02',
          descripcion: 'Venta',
          cantidad: 1,
          valorUnitario: ticketSubtotal,
          importe: ticketSubtotal,
          descuento: 0,
          baseIva: ticketSubtotal,
          tasaIva: 0.16,
          importeIva: ticketIva,
          baseRetIsr: Number(t.total_impuestos_retenidos) > 0 ? ticketSubtotal : 0,
          tasaRetIsr: ticketSubtotal > 0 ? Number(t.total_impuestos_retenidos || 0) / ticketSubtotal : 0,
          importeRetIsr: Number(t.total_impuestos_retenidos || 0)
        });
      }

      subtotal = Number(subtotal.toFixed(2));
      totalImpuestosTrasladados = Number(totalImpuestosTrasladados.toFixed(2));
      total = Number(total.toFixed(2));

      const serie = 'G';
      await queryRunner.query(
        `SELECT pg_advisory_xact_lock(hashtext('factura-folio:' || $1))`,
        [serie],
      );
      const folioResult = await queryRows<FolioRow>(queryRunner,
        'SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1',
        [serie]
      );
      const folio = Number(folioResult[0].next_folio);

      const conceptosJson = JSON.stringify(conceptos);
      const result = await queryRows<FacturaIdRow>(queryRunner,
        `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) as id_factura`,
        [
          genericClient.IdCliente,
          genericClient.RFC,
          genericClient.RazonSocial,
          genericClient.CodigoPostal,
          '616',
          'S01',
          genericClient.IdFormaPago || 1,
          genericClient.IdMetodoDePago || 1,
          'MXN',
          1,
          subtotal,
          totalImpuestosTrasladados,
          Number(totalImpuestosRetenidos.toFixed(2)),
          total,
          'Factura Global del periodo ' + fechaInicio + ' al ' + fechaFin,
          conceptosJson,
          null,
          folio,
          serie,
          'I'
        ],
      );

      const idGlobalInvoice = result[0].id_factura;

      // La factura global consolida cobros ya realizados; no debe volver a
      // registrar ingreso ni comisión. El trigger de reverso mantiene saldos.
      await queryRunner.query(
        `DELETE FROM pago
          WHERE id_factura = $1 AND notas = 'Pago automático Venta PUE'`,
        [idGlobalInvoice],
      );
      await queryRunner.query(
        `UPDATE factura
            SET saldo_pendiente = 0, estatus = 'Pagada', comision_vendedor = 0
          WHERE id_factura = $1`,
        [idGlobalInvoice],
      );

      await queryRunner.query(
        'UPDATE factura SET id_factura_global = $1 WHERE id_factura = ANY($2::int[])',
        [idGlobalInvoice, tickets.map((ticket) => Number(ticket.id_factura))]
      );

      await queryRunner.commitTransaction();

      return {
        message: 'Factura Global generada con éxito',
        idFactura: idGlobalInvoice,
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

}

