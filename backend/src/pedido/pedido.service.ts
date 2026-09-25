import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { CreateVentaDto } from '../venta/venta.dto';
import { consumeCommercialAuthorizations, validateCommercialPolicy } from '../comercial/commercial-policy';
import { CreatePedidoDto, CreatePedidoFromCotizacionDto, EntregarPedidoDto, FacturarPedidoDto, PedidoQueryDto, SurtirPedidoDto } from './pedido.dto';

interface ProductRow { id: number; descripcion: string; existencia: string | number; tasa: string | number; objeto: string; }
interface DetailRow { idDetalle: number; idProducto: number; cantidad: string | number; reservada: string | number; surtida: string | number; descripcion: string; }
interface OrderRow { idPedido: number; estado: string; version: number; }
interface QuoteRow { idCliente: number; folio: string | number; estado: string; }
interface QuoteDetailRow { idProducto: number; descripcion: string; cantidad: string | number; valorUnitario: string | number; tasa: string | number; objeto: string; }
interface InvoiceOrderRow { id_pedido: number; estado: string; id_cliente: number; rfc: string; nombre: string; cp: string; idFormaPago: number | null; idMetodoPago: number | null; regimen: string; uso: string | null; }
interface InvoiceLineRow { idProducto: number; cantidad: string | number; valorUnitario: string | number; descripcion: string; codigo: string; objeto: string; tasa: string | number; retiene: boolean; claveProdServ: string | null; claveUnidad: string | null; unidad: string | null; }
interface ExpiredReservationRow { idReserva: number; idPedido: number; idDetalle: number; cantidadPendiente: string | number; }

@Injectable()
export class PedidoService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(dto: CreatePedidoDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const repeated = await queryRows<{ idPedido: number }>(manager, 'SELECT id_pedido AS "idPedido" FROM pedido_venta WHERE request_id=$1', [dto.requestId]);
      if (repeated.length) return repeated[0];
      const ids = [...new Set(dto.partidas.map(p => p.idProducto))];
      if (ids.length !== dto.partidas.length) throw new BadRequestException('Cada producto debe aparecer una sola vez en el pedido');
      const clients = await queryRows<{ id: number }>(manager, 'SELECT "IdCliente" AS id FROM cliente WHERE "IdCliente"=$1', [dto.idCliente]);
      if (!clients.length) throw new NotFoundException('Cliente no encontrado');
      if (dto.idUnidad) {
        const units = await queryRows<{ id: number }>(manager, 'SELECT id_unidad AS id FROM crm_unidad_cliente WHERE id_unidad=$1 AND id_cliente=$2', [dto.idUnidad, dto.idCliente]);
        if (!units.length) throw new BadRequestException('La unidad no pertenece al cliente seleccionado');
      }
      const products = await queryRows<ProductRow>(manager, `SELECT "IdProducto" AS id,"Descripcion" AS descripcion,"Existencia" AS existencia,
        "TasaIVA" AS tasa,"ObjetoImpuesto" AS objeto FROM producto WHERE "IdProducto"=ANY($1::int[]) ORDER BY "IdProducto" FOR UPDATE`, [ids]);
      if (products.length !== ids.length) throw new BadRequestException('Uno o más productos no existen');
      const productMap = new Map(products.map(p => [Number(p.id), p]));
      const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
      const lines = dto.partidas.map(line => {
        const product = productMap.get(line.idProducto)!;
        const importe = money(line.cantidad * line.valorUnitario);
        const iva = product.objeto === '02' ? money(importe * Number(product.tasa)) : 0;
        return { ...line, descripcion: product.descripcion, tasa: product.objeto === '02' ? Number(product.tasa) : 0, importe, iva };
      });
      const subtotal = money(lines.reduce((sum, line) => sum + line.importe, 0));
      const impuestos = money(lines.reduce((sum, line) => sum + line.iva, 0));
      const orders = await queryRows<{ idPedido: number }>(manager, `INSERT INTO pedido_venta(request_id,id_cliente,id_unidad,id_cotizacion,notas,subtotal,impuestos,total,id_vendedor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_pedido AS "idPedido"`,
      [dto.requestId, dto.idCliente, dto.idUnidad ?? null, dto.idCotizacion ?? null, dto.notas || null, subtotal, impuestos, money(subtotal + impuestos), idUser ?? null]);
      const idPedido = orders[0].idPedido;
      for (const line of lines) await manager.query(`INSERT INTO pedido_venta_detalle(id_pedido,id_producto,descripcion,cantidad,valor_unitario,tasa_iva,importe,importe_iva)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [idPedido, line.idProducto, line.descripcion, line.cantidad, line.valorUnitario, line.tasa, line.importe, line.iva]);
      const commercialAuthorizationIds = await validateCommercialPolicy(manager, {
        idCliente: dto.idCliente,
        total: money(subtotal + impuestos),
        validarCredito: false,
        lineas: lines.map((line) => ({ idProducto: line.idProducto, cantidad: line.cantidad, precio: line.valorUnitario })),
      });
      await consumeCommercialAuthorizations(manager, commercialAuthorizationIds, 'Pedido', idPedido);
      await this.history(manager, idPedido, null, 'Borrador', 'Pedido creado', idUser);
      return { idPedido };
    });
  }

  async createFromQuote(idCotizacion: number, dto: CreatePedidoFromCotizacionDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const repeated = await queryRows<{ idPedido: number }>(manager, 'SELECT id_pedido AS "idPedido" FROM pedido_venta WHERE request_id=$1 OR id_cotizacion=$2', [dto.requestId, idCotizacion]);
      if (repeated.length) return repeated[0];
      const quotes = await queryRows<QuoteRow>(manager, `SELECT id_cliente AS "idCliente",folio,estatus AS estado
        FROM cotizacion WHERE id_cotizacion=$1 FOR UPDATE`, [idCotizacion]);
      if (!quotes.length) throw new NotFoundException('Cotización no encontrada');
      if (['Convertida','Rechazada'].includes(quotes[0].estado)) throw new ConflictException('La cotización ya está cerrada');
      if (dto.idUnidad) {
        const units = await queryRows<{ id: number }>(manager, 'SELECT id_unidad AS id FROM crm_unidad_cliente WHERE id_unidad=$1 AND id_cliente=$2', [dto.idUnidad, quotes[0].idCliente]);
        if (!units.length) throw new BadRequestException('La unidad no pertenece al cliente de la cotización');
      }
      const quoteLines = await queryRows<QuoteDetailRow>(manager, `SELECT cc.id_producto AS "idProducto",cc.descripcion,cc.cantidad,
        cc.valor_unitario AS "valorUnitario",p."TasaIVA" AS tasa,p."ObjetoImpuesto" AS objeto
        FROM conceptocotizacion cc JOIN producto p ON p."IdProducto"=cc.id_producto
        WHERE cc.id_cotizacion=$1 AND cc.estatus='Pendiente' ORDER BY cc.id_producto FOR UPDATE OF cc,p`, [idCotizacion]);
      if (!quoteLines.length) throw new ConflictException('La cotización no tiene partidas pendientes para pedir');
      const grouped = new Map<number, { idProducto: number; descripcion: string; cantidad: number; importe: number; tasa: number; objeto: string }>();
      for (const line of quoteLines) {
        const quantity = Number(line.cantidad);
        const amount = quantity * Number(line.valorUnitario);
        const current = grouped.get(Number(line.idProducto));
        if (current) { current.cantidad += quantity; current.importe += amount; }
        else grouped.set(Number(line.idProducto), { idProducto: Number(line.idProducto), descripcion: line.descripcion, cantidad: quantity, importe: amount, tasa: Number(line.tasa), objeto: line.objeto });
      }
      const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
      const lines = [...grouped.values()].map(line => ({ ...line, valorUnitario: line.importe / line.cantidad,
        importe: money(line.importe), iva: line.objeto === '02' ? money(line.importe * line.tasa) : 0 }));
      const subtotal = money(lines.reduce((sum, line) => sum + line.importe, 0));
      const impuestos = money(lines.reduce((sum, line) => sum + line.iva, 0));
      const orders = await queryRows<{ idPedido: number }>(manager, `INSERT INTO pedido_venta(request_id,id_cliente,id_unidad,id_cotizacion,notas,subtotal,impuestos,total,id_vendedor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_pedido AS "idPedido"`, [dto.requestId, quotes[0].idCliente, dto.idUnidad ?? null,
        idCotizacion, dto.notas || `Originado por cotización C-${quotes[0].folio}`, subtotal, impuestos, money(subtotal + impuestos), idUser ?? null]);
      const idPedido = orders[0].idPedido;
      for (const line of lines) await manager.query(`INSERT INTO pedido_venta_detalle(id_pedido,id_producto,descripcion,cantidad,valor_unitario,tasa_iva,importe,importe_iva)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [idPedido, line.idProducto, line.descripcion, line.cantidad, line.valorUnitario, line.objeto === '02' ? line.tasa : 0, line.importe, line.iva]);
      const commercialAuthorizationIds = await validateCommercialPolicy(manager, {
        idCliente: quotes[0].idCliente,
        total: money(subtotal + impuestos),
        validarCredito: false,
        lineas: lines.map((line) => ({ idProducto: line.idProducto, cantidad: line.cantidad, precio: line.valorUnitario })),
      });
      await consumeCommercialAuthorizations(manager, commercialAuthorizationIds, 'Pedido', idPedido);
      await this.history(manager, idPedido, null, 'Borrador', `Creado desde cotización C-${quotes[0].folio}`, idUser);
      return { idPedido };
    });
  }

  async confirm(idPedido: number, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const order = await this.lockOrder(manager, idPedido);
      if (order.estado !== 'Borrador') throw new ConflictException('Solo se puede confirmar un pedido en borrador');
      const details = await this.details(manager, idPedido, true);
      let hasBackorder = false;
      for (const detail of details.sort((a, b) => a.idProducto - b.idProducto)) {
        const products = await queryRows<{ existencia: string | number }>(manager, 'SELECT "Existencia" AS existencia FROM producto WHERE "IdProducto"=$1 FOR UPDATE', [detail.idProducto]);
        const reserved = await queryRows<{ total: string | number }>(manager, `SELECT COALESCE(sum(cantidad-cantidad_liberada),0) AS total FROM reserva_inventario
          WHERE id_producto=$1 AND estado IN ('Activa','Surtida')`, [detail.idProducto]);
        const available = Math.max(0, Number(products[0].existencia) - Number(reserved[0].total));
        const requested = Number(detail.cantidad);
        const quantity = Math.min(requested, available);
        if (quantity > 0) await manager.query(`INSERT INTO reserva_inventario(id_pedido,id_detalle,id_producto,cantidad) VALUES($1,$2,$3,$4)`, [idPedido, detail.idDetalle, detail.idProducto, quantity]);
        if (requested > quantity) {
          hasBackorder = true;
          await manager.query(`INSERT INTO backorder_cliente(id_pedido,id_detalle,id_cliente,id_producto,cantidad)
            SELECT $1,$2,id_cliente,$3,$4 FROM pedido_venta WHERE id_pedido=$1`, [idPedido, detail.idDetalle, detail.idProducto, requested - quantity]);
        }
        await manager.query('UPDATE pedido_venta_detalle SET cantidad_reservada=$2 WHERE id_detalle=$1', [detail.idDetalle, quantity]);
      }
      const next = hasBackorder ? 'En espera' : 'Confirmado';
      await manager.query('UPDATE pedido_venta SET estado=$2,updated_at=now(),version=version+1 WHERE id_pedido=$1', [idPedido, next]);
      await this.history(manager, idPedido, order.estado, next, hasBackorder ? 'Confirmado con partidas pendientes' : 'Existencia reservada', idUser);
      return this.findOneWith(manager, idPedido);
    });
  }

  async fulfill(idPedido: number, dto: SurtirPedidoDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const order = await this.lockOrder(manager, idPedido);
      if (!['Confirmado','En espera','Parcialmente surtido'].includes(order.estado)) throw new ConflictException('El pedido no está disponible para surtido');
      const details = await this.details(manager, idPedido, true);
      const map = new Map(details.map(d => [d.idDetalle, d]));
      if (new Set(dto.partidas.map(p => p.idDetalle)).size !== dto.partidas.length) throw new BadRequestException('Hay partidas repetidas');
      for (const item of dto.partidas) {
        const detail = map.get(item.idDetalle);
        if (!detail) throw new BadRequestException('Una partida no pertenece al pedido');
        if (Number(detail.surtida) + item.cantidad > Number(detail.reservada) + 0.000001) throw new BadRequestException(`La cantidad surtida de ${detail.descripcion} supera lo reservado`);
        await this.allocatePicking(manager, idPedido, detail, item.cantidad, idUser);
        await manager.query('UPDATE pedido_venta_detalle SET cantidad_surtida=cantidad_surtida+$2 WHERE id_detalle=$1', [item.idDetalle, item.cantidad]);
      }
      const pending = await queryRows<{ reservedPending: string | number; backorderPending: string | number }>(manager, `SELECT
        COALESCE((SELECT sum(cantidad_reservada-cantidad_surtida) FROM pedido_venta_detalle WHERE id_pedido=$1),0) AS "reservedPending",
        COALESCE((SELECT sum(cantidad-cantidad_asignada) FROM backorder_cliente WHERE id_pedido=$1 AND estado IN ('Pendiente','Parcial')),0) AS "backorderPending"`, [idPedido]);
      const hasReservedPending = Number(pending[0].reservedPending) > 0;
      const hasBackorderPending = Number(pending[0].backorderPending) > 0;
      const next = hasReservedPending || hasBackorderPending ? 'Parcialmente surtido' : 'Surtido';
      await manager.query(`UPDATE reserva_inventario r SET estado=CASE WHEN d.cantidad_surtida>=d.cantidad_reservada THEN 'Surtida' ELSE r.estado END,updated_at=now()
        FROM pedido_venta_detalle d WHERE r.id_detalle=d.id_detalle AND r.id_pedido=$1 AND r.estado='Activa'`, [idPedido]);
      await manager.query('UPDATE pedido_venta SET estado=$2,updated_at=now(),version=version+1 WHERE id_pedido=$1', [idPedido, next]);
      await this.history(manager, idPedido, order.estado, next, 'Surtido registrado', idUser);
      return this.findOneWith(manager, idPedido);
    });
  }

  async cancel(idPedido: number, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const order = await this.lockOrder(manager, idPedido);
      if (['Cancelado','Entregado','Facturado'].includes(order.estado)) throw new ConflictException('El pedido ya no se puede cancelar');
      await manager.query(`UPDATE reserva_inventario SET cantidad_liberada=cantidad,estado='Liberada',updated_at=now() WHERE id_pedido=$1 AND estado IN ('Activa','Surtida')`, [idPedido]);
      await manager.query(`UPDATE pedido_surtido_ubicacion SET estado='Liberada',updated_at=now()
        WHERE id_pedido=$1 AND estado='Reservada'`, [idPedido]);
      await manager.query(`UPDATE backorder_cliente SET estado='Cancelado',updated_at=now() WHERE id_pedido=$1 AND estado IN ('Pendiente','Parcial')`, [idPedido]);
      await manager.query(`UPDATE pedido_venta SET estado='Cancelado',updated_at=now(),version=version+1 WHERE id_pedido=$1`, [idPedido]);
      await this.history(manager, idPedido, order.estado, 'Cancelado', 'Reservas y pendientes liberados', idUser);
      return { message: 'Pedido cancelado' };
    });
  }

  async deliver(idPedido: number, dto: EntregarPedidoDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const order = await this.lockOrder(manager, idPedido);
      if (order.estado !== 'Surtido') throw new ConflictException('Solo un pedido completamente surtido puede entregarse');
      await manager.query('INSERT INTO entrega_pedido(id_pedido,recibido_por,notas,id_user) VALUES($1,$2,$3,$4)',
        [idPedido, dto.recibidoPor || null, dto.notas || null, idUser ?? null]);
      await manager.query(`UPDATE pedido_venta SET estado='Entregado',updated_at=now(),version=version+1 WHERE id_pedido=$1`, [idPedido]);
      await this.history(manager, idPedido, order.estado, 'Entregado', dto.recibidoPor ? `Recibió: ${dto.recibidoPor}` : 'Entrega registrada', idUser);
      return this.findOneWith(manager, idPedido);
    });
  }

  async prepareInvoice(idPedido: number, dto: FacturarPedidoDto): Promise<CreateVentaDto> {
    const orders = await queryRows<InvoiceOrderRow>(this.dataSource, `SELECT pv.id_pedido,pv.estado,pv.id_cliente,
      c."RFC" AS rfc,c."RazonSocial" AS nombre,c."CodigoPostal" AS cp,c."IdFormaPago" AS "idFormaPago",
      c."IdMetodoDePago" AS "idMetodoPago",rf."Clave" AS regimen,uc."Clave" AS uso
      FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente
      JOIN regimenfiscal rf ON rf."IdRegimenFiscal"=c."IdRegimenFiscal"
      LEFT JOIN usocfdi uc ON uc."IdUsoCFDI"=c."IdUsoCFDI" WHERE pv.id_pedido=$1`, [idPedido]);
    if (!orders.length) throw new NotFoundException('Pedido no encontrado');
    const order = orders[0];
    if (!['Surtido','Entregado'].includes(order.estado)) throw new ConflictException('El pedido debe estar surtido o entregado antes de facturarse');
    const idFormaPago = dto.idFormaPago || Number(order.idFormaPago);
    const idMetodoPago = dto.idMetodoPago || Number(order.idMetodoPago);
    if (!idFormaPago || !idMetodoPago) throw new BadRequestException('Configura forma y método de pago para el cliente o indícalos al facturar');
    const rows = await queryRows<InvoiceLineRow>(this.dataSource, `SELECT pd.id_producto AS "idProducto",pd.cantidad_surtida AS cantidad,
      pd.valor_unitario AS "valorUnitario",pd.descripcion,p."Codigo" AS codigo,p."ObjetoImpuesto" AS objeto,
      p."TasaIVA" AS tasa,p."AplicaRetencionISR" AS retiene,cps."Clave" AS "claveProdServ",
      cu."Clave" AS "claveUnidad",cu."Descripcion" AS unidad
      FROM pedido_venta_detalle pd JOIN producto p ON p."IdProducto"=pd.id_producto
      LEFT JOIN claveproductooservicio cps ON cps."IdClaveProdOServ"=p."IdClaveProdOServ"
      LEFT JOIN claveunidad cu ON cu."IdClaveUnidad"=p."IdClaveUnidad"
      WHERE pd.id_pedido=$1 AND pd.cantidad_surtida>0 ORDER BY pd.id_detalle`, [idPedido]);
    if (!rows.length) throw new ConflictException('El pedido no tiene mercancía surtida para facturar');
    const moral = order.rfc.trim().length === 12;
    const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const conceptos = rows.map(row => {
      const cantidad = Number(row.cantidad), valorUnitario = Number(row.valorUnitario);
      const importe = money(cantidad * valorUnitario), tasaIva = row.objeto === '02' ? Number(row.tasa) : 0;
      const tasaRetIsr = row.retiene && moral ? 0.0125 : 0;
      return { idProducto: Number(row.idProducto), codigo: row.codigo || '', descripcion: row.descripcion,
        unidadDescripcion: row.unidad || 'Pieza', claveProdServ: row.claveProdServ || '01010101',
        claveUnidad: row.claveUnidad || 'H87', objetoImpuesto: row.objeto || '01', cantidad, valorUnitario,
        importe, descuento: 0, baseIva: tasaIva ? importe : 0, tasaIva, importeIva: money(importe * tasaIva),
        baseRetIsr: tasaRetIsr ? importe : 0, tasaRetIsr, importeRetIsr: money(importe * tasaRetIsr) };
    });
    const subtotal = money(conceptos.reduce((sum, line) => sum + line.importe, 0));
    const totalImpuestosTrasladados = money(conceptos.reduce((sum, line) => sum + line.importeIva, 0));
    const totalImpuestosRetenidos = money(conceptos.reduce((sum, line) => sum + line.importeRetIsr, 0));
    return { idPedido, requestId: dto.requestId, idCliente: Number(order.id_cliente), rfcReceptor: order.rfc,
      nombreReceptor: order.nombre, cpReceptor: order.cp, regimenReceptor: order.regimen,
      usoCfdi: order.uso || 'G03', idFormaPago, idMetodoPago, moneda: 'MXN', tipoCambio: 1,
      subtotal, totalImpuestosTrasladados, totalImpuestosRetenidos,
      total: money(subtotal + totalImpuestosTrasladados - totalImpuestosRetenidos), tipoComprobante: 'I', serie: 'F', conceptos };
  }

  async findAll(query: PedidoQueryDto) {
    const page = query.page || 1, limit = query.limit || 25, offset = (page - 1) * limit;
    const q = `%${(query.q || '').replace(/[\\%_]/g, '\\$&')}%`;
    const params = [query.estado || null, q, limit, offset];
    const where = `WHERE ($1::text IS NULL OR pv.estado=$1) AND (pv.folio::text ILIKE $2 ESCAPE '\\' OR c."RazonSocial" ILIKE $2 ESCAPE '\\' OR c."RFC" ILIKE $2 ESCAPE '\\')`;
    const [data, counts] = await Promise.all([
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT pv.id_pedido AS "idPedido",pv.folio,pv.estado,pv.total,pv.created_at AS "createdAt",pv.updated_at AS "updatedAt",
        c."RazonSocial" AS cliente,c."RFC" AS rfc,COALESCE(sum(pd.cantidad-pd.cantidad_reservada),0) AS "cantidadPendiente"
        FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente JOIN pedido_venta_detalle pd ON pd.id_pedido=pv.id_pedido ${where}
        GROUP BY pv.id_pedido,c."RazonSocial",c."RFC" ORDER BY pv.created_at DESC LIMIT $3 OFFSET $4`, params),
      queryRows<{ total: string | number }>(this.dataSource, `SELECT count(*) AS total FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente ${where}`, params.slice(0, 2)),
    ]);
    return { data, total: Number(counts[0].total), page, limit };
  }

  findOne(idPedido: number) { return this.findOneWith(this.dataSource, idPedido); }

  async backorders() {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT b.id_backorder AS "idBackorder",b.id_pedido AS "idPedido",pv.folio,b.cantidad,b.cantidad_asignada AS "cantidadAsignada",b.prioridad,b.estado,b.created_at AS "createdAt",
      c."RazonSocial" AS cliente,p."Codigo" AS codigo,p."Descripcion" AS producto FROM backorder_cliente b
      JOIN pedido_venta pv ON pv.id_pedido=b.id_pedido JOIN cliente c ON c."IdCliente"=b.id_cliente JOIN producto p ON p."IdProducto"=b.id_producto
      WHERE b.estado IN ('Pendiente','Parcial') ORDER BY b.prioridad,b.created_at`);
  }

  async expiredReservations() {
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT r.id_reserva AS "idReserva",r.id_pedido AS "idPedido",pv.folio,
      r.id_producto AS "idProducto",p."Codigo" AS codigo,p."Descripcion" AS producto,
      r.cantidad-r.cantidad_liberada AS cantidad,r.expires_at AS "expiresAt",c."RazonSocial" AS cliente
      FROM reserva_inventario r JOIN pedido_venta pv ON pv.id_pedido=r.id_pedido
      JOIN cliente c ON c."IdCliente"=pv.id_cliente JOIN producto p ON p."IdProducto"=r.id_producto
      WHERE r.estado='Activa' AND r.expires_at IS NOT NULL AND r.expires_at<=now()
      ORDER BY r.expires_at,r.id_reserva`);
  }

  async releaseExpiredReservations(idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const expired = await queryRows<ExpiredReservationRow>(manager, `SELECT r.id_reserva AS "idReserva",r.id_pedido AS "idPedido",
        r.id_detalle AS "idDetalle",r.cantidad-r.cantidad_liberada AS "cantidadPendiente"
        FROM reserva_inventario r JOIN pedido_venta pv ON pv.id_pedido=r.id_pedido
        WHERE r.estado='Activa' AND r.expires_at IS NOT NULL AND r.expires_at<=now()
          AND pv.estado IN ('Confirmado','En espera','Parcialmente surtido')
        ORDER BY r.id_pedido,r.id_reserva FOR UPDATE OF r,pv`, []);
      const affectedOrders = new Set<number>();
      for (const reservation of expired) {
        const quantity = Number(reservation.cantidadPendiente);
        if (quantity <= 0) continue;
        await manager.query(`UPDATE reserva_inventario SET cantidad_liberada=cantidad,estado='Liberada',updated_at=now()
          WHERE id_reserva=$1`, [reservation.idReserva]);
        await manager.query(`UPDATE pedido_venta_detalle SET cantidad_reservada=GREATEST(cantidad_surtida,cantidad_reservada-$2)
          WHERE id_detalle=$1`, [reservation.idDetalle, quantity]);
        await manager.query(`INSERT INTO backorder_cliente(id_pedido,id_detalle,id_cliente,id_producto,cantidad)
          SELECT d.id_pedido,d.id_detalle,pv.id_cliente,d.id_producto,$2 FROM pedido_venta_detalle d
          JOIN pedido_venta pv ON pv.id_pedido=d.id_pedido WHERE d.id_detalle=$1
          ON CONFLICT(id_detalle) DO UPDATE SET cantidad=backorder_cliente.cantidad+$2,
            estado='Pendiente',updated_at=now()`, [reservation.idDetalle, quantity]);
        affectedOrders.add(reservation.idPedido);
      }
      for (const idPedido of affectedOrders) {
        const orders = await queryRows<OrderRow>(manager, `SELECT id_pedido AS "idPedido",estado,version
          FROM pedido_venta WHERE id_pedido=$1 FOR UPDATE`, [idPedido]);
        const previous = orders[0].estado;
        const next = previous === 'Parcialmente surtido' ? previous : 'En espera';
        if (previous !== next) await manager.query(`UPDATE pedido_venta SET estado=$2,updated_at=now(),version=version+1
          WHERE id_pedido=$1`, [idPedido, next]);
        await this.history(manager, idPedido, previous, next, 'Reserva vencida; mercancía liberada y pendiente restituido', idUser);
      }
      return { reservasLiberadas: expired.length, pedidosAfectados: affectedOrders.size };
    });
  }

  async availability(idProducto: number) {
    const rows = await queryRows<{ existencia: string | number; reservada: string | number }>(this.dataSource, `SELECT p."Existencia" AS existencia,
      COALESCE(sum(r.cantidad-r.cantidad_liberada) FILTER(WHERE r.estado IN ('Activa','Surtida')),0) AS reservada
      FROM producto p LEFT JOIN reserva_inventario r ON r.id_producto=p."IdProducto" WHERE p."IdProducto"=$1 GROUP BY p."IdProducto"`, [idProducto]);
    if (!rows.length) throw new NotFoundException('Producto no encontrado');
    const physical = Number(rows[0].existencia), reserved = Number(rows[0].reservada);
    return { existenciaFisica: physical, reservada: reserved, disponible: Math.max(0, physical - reserved) };
  }

  private async findOneWith(source: DataSource | EntityManager, idPedido: number) {
    const rows = await queryRows<Record<string, unknown>>(source, `SELECT pv.*,pv.id_pedido AS "idPedido",pv.id_cliente AS "idCliente",pv.id_unidad AS "idUnidad",c."RazonSocial" AS cliente
      FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente WHERE pv.id_pedido=$1`, [idPedido]);
    if (!rows.length) throw new NotFoundException('Pedido no encontrado');
    const partidas = await queryRows<Record<string, unknown>>(source, `SELECT pd.id_detalle AS "idDetalle",pd.id_producto AS "idProducto",p."Codigo" AS codigo,pd.descripcion,pd.cantidad,pd.valor_unitario AS "valorUnitario",
      pd.importe,pd.importe_iva AS "importeIva",pd.cantidad_reservada AS "cantidadReservada",pd.cantidad_surtida AS "cantidadSurtida"
      FROM pedido_venta_detalle pd JOIN producto p ON p."IdProducto"=pd.id_producto WHERE pd.id_pedido=$1 ORDER BY pd.id_detalle`, [idPedido]);
    const picking = await queryRows<{ idDetalle: number; ubicacion: string; almacen: string; cantidad: string | number; estado: string }>(source, `
      SELECT ps.id_detalle AS "idDetalle",u.codigo AS ubicacion,a.nombre AS almacen,
        ps.cantidad,ps.estado FROM pedido_surtido_ubicacion ps
      JOIN almacen_ubicacion u ON u.id_ubicacion=ps.id_ubicacion
      JOIN almacen a ON a.id_almacen=u.id_almacen
      WHERE ps.id_pedido=$1 ORDER BY ps.id_surtido`, [idPedido]);
    return { ...rows[0], partidas: partidas.map((partida) => ({
      ...partida,
      picking: picking.filter((pick) => Number(pick.idDetalle) === Number(partida.idDetalle)),
    })) };
  }

  private async allocatePicking(manager: EntityManager, idPedido: number, detail: DetailRow, quantity: number, idUser?: number) {
    const locations = await queryRows<{ idUbicacion: number; disponible: string | number }>(manager, `
      SELECT i.id_ubicacion AS "idUbicacion",i.cantidad-COALESCE((SELECT sum(ps.cantidad-ps.cantidad_consumida)
        FROM pedido_surtido_ubicacion ps WHERE ps.id_ubicacion=i.id_ubicacion AND ps.id_producto=i.id_producto
          AND ps.estado='Reservada'),0) AS disponible
      FROM inventario_ubicacion i JOIN almacen_ubicacion u ON u.id_ubicacion=i.id_ubicacion
      JOIN almacen a ON a.id_almacen=u.id_almacen
      WHERE i.id_producto=$1 AND i.cantidad>0 AND u.activa AND a.activo
      ORDER BY(a.es_principal AND u.codigo='GENERAL')DESC,a.es_principal DESC,i.id_ubicacion
      FOR UPDATE OF i`, [detail.idProducto]);
    let pending = quantity;
    for (const location of locations) {
      if (pending < 0.000001) break;
      const picked = Math.min(pending, Math.max(0, Number(location.disponible)));
      if (picked <= 0) continue;
      await manager.query(`INSERT INTO pedido_surtido_ubicacion(id_pedido,id_detalle,id_producto,id_ubicacion,cantidad,id_user)
        VALUES($1,$2,$3,$4,$5,$6)`, [idPedido, detail.idDetalle, detail.idProducto, location.idUbicacion, picked, idUser ?? null]);
      pending -= picked;
    }
    if (pending >= 0.000001) throw new ConflictException(`No hay existencia libre por ubicación para surtir ${detail.descripcion}`);
  }

  private async lockOrder(manager: EntityManager, idPedido: number) {
    const rows = await queryRows<OrderRow>(manager, 'SELECT id_pedido AS "idPedido",estado,version FROM pedido_venta WHERE id_pedido=$1 FOR UPDATE', [idPedido]);
    if (!rows.length) throw new NotFoundException('Pedido no encontrado');
    return rows[0];
  }
  private details(source: EntityManager, idPedido: number, lock = false) {
    return queryRows<DetailRow>(source, `SELECT id_detalle AS "idDetalle",id_producto AS "idProducto",cantidad,cantidad_reservada AS reservada,cantidad_surtida AS surtida,descripcion
      FROM pedido_venta_detalle WHERE id_pedido=$1 ORDER BY id_producto${lock ? ' FOR UPDATE' : ''}`, [idPedido]);
  }
  private history(manager: EntityManager, idPedido: number, previous: string | null, next: string, detail: string, idUser?: number) {
    return manager.query('INSERT INTO pedido_estado_historial(id_pedido,estado_anterior,estado_nuevo,detalle,id_user) VALUES($1,$2,$3,$4,$5)', [idPedido, previous, next, detail, idUser ?? null]);
  }
}
