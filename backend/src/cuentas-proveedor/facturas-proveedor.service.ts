import { supplierRequest } from './supplier-request';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import {
  CreateFacturaProveedorDto,
  ResolveDiscrepancyDto,
} from './cuentas-proveedor.dto';
import {
  IdRow,
  OrderRow,
  OrderLineRow,
  InvoiceRow,
  ReceiptAvailableRow,
} from './cuentas-proveedor.types';
@Injectable()
export class FacturasProveedorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async createInvoice(dto: CreateFacturaProveedorDto, idUser?: number) {
    try {
      return await this.dataSource.transaction(async (manager) =>
        supplierRequest(
          manager,
          dto.requestId,
          'supplier-invoice',
          {
            idProveedor: dto.idProveedor,
            idOrden: dto.idOrden,
            serie: dto.serie || null,
            folio: dto.folio,
            uuid: dto.uuid || null,
            fechaEmision: dto.fechaEmision,
            fechaVencimiento: dto.fechaVencimiento,
            moneda: dto.moneda || 'MXN',
            tipoCambio: dto.tipoCambio ?? 1,
            subtotal: dto.subtotal,
            impuestos: dto.impuestos ?? 0,
            retenciones: dto.retenciones ?? 0,
            total: dto.total,
            observaciones: dto.observaciones || null,
            xml: dto.xml || null,
            partidas: [...dto.partidas]
              .sort((a, b) => a.idOrdenDetalle - b.idOrdenDetalle)
              .map((p) => ({
                idOrdenDetalle: p.idOrdenDetalle,
                descripcion: p.descripcion,
                cantidad: p.cantidad,
                costoUnitario: p.costoUnitario,
                tasaIva: p.tasaIva ?? 0.16,
              })),
          },
          async () => {
            await manager.query(
              `SELECT pg_advisory_xact_lock(hashtext('supplier-invoice:' || $1))`,
              [dto.requestId],
            );
            const old = await queryRows<IdRow>(
              manager,
              'SELECT id_factura_proveedor AS id FROM factura_proveedor WHERE request_id=$1',
              [dto.requestId],
            );
            if (old.length)
              throw new ConflictException(
                'Operación anterior sin huella de contenido; revisa el registro antes de reintentar',
              );
            const orders = await queryRows<OrderRow>(
              manager,
              `SELECT id_proveedor AS "idProveedor",estado,moneda,tipo_cambio AS "tipoCambio" FROM orden_compra WHERE id_orden=$1 FOR SHARE`,
              [dto.idOrden],
            );
            if (!orders.length)
              throw new NotFoundException('Orden de compra no encontrada');
            if (orders[0].idProveedor !== dto.idProveedor)
              throw new BadRequestException(
                'La orden pertenece a otro proveedor',
              );
            if (orders[0].estado === 'Cancelada')
              throw new ConflictException(
                'No se puede facturar una orden cancelada',
              );
            if (
              orders[0].moneda !== dto.moneda ||
              Math.abs(Number(orders[0].tipoCambio) - dto.tipoCambio) > 0.000001
            )
              throw new BadRequestException(
                'Moneda y tipo de cambio deben coincidir con la orden',
              );
            if (new Date(dto.fechaVencimiento) < new Date(dto.fechaEmision))
              throw new BadRequestException(
                'El vencimiento no puede ser anterior a la emisión',
              );
            const ids = dto.partidas.map((item) => item.idOrdenDetalle);
            if (new Set(ids).size !== ids.length)
              throw new BadRequestException('Hay partidas de orden repetidas');
            const orderLines = await queryRows<OrderLineRow>(
              manager,
              `SELECT id_detalle AS "idDetalle",id_producto AS "idProducto",cantidad,
          costo_unitario AS costo,tasa_iva AS "tasaIva" FROM orden_compra_detalle WHERE id_orden=$1 AND id_detalle=ANY($2::int[]) ORDER BY id_detalle FOR SHARE`,
              [dto.idOrden, ids],
            );
            if (orderLines.length !== ids.length)
              throw new BadRequestException(
                'Una partida no pertenece a la orden',
              );
            const subtotal = this.money(
              dto.partidas.reduce(
                (sum, item) => sum + item.cantidad * item.costoUnitario,
                0,
              ),
            );
            const taxes = this.money(
              dto.partidas.reduce(
                (sum, item) =>
                  sum + item.cantidad * item.costoUnitario * item.tasaIva,
                0,
              ),
            );
            const total = this.money(subtotal + taxes - dto.retenciones);
            if (
              Math.abs(subtotal - dto.subtotal) > 0.01 ||
              Math.abs(taxes - dto.impuestos) > 0.01 ||
              Math.abs(total - dto.total) > 0.01
            ) {
              throw new BadRequestException(
                'Subtotal, impuestos o total no coinciden con las partidas',
              );
            }
            const xml = this.xmlMetadata(dto.xml);
            const providers = await queryRows<{ rfc: string }>(
              manager,
              'SELECT "RFC" AS rfc FROM proveedor WHERE "IdProveedor"=$1',
              [dto.idProveedor],
            );
            if (!providers.length)
              throw new NotFoundException('Proveedor no encontrado');
            if (
              xml.issuerRfc &&
              xml.issuerRfc.toUpperCase() !== providers[0].rfc.toUpperCase()
            )
              throw new BadRequestException(
                'El RFC emisor del XML no coincide con el proveedor',
              );
            if (xml.total && Math.abs(Number(xml.total) - dto.total) > 0.01)
              throw new BadRequestException(
                'El total del XML no coincide con la factura',
              );
            if (
              dto.uuid &&
              xml.uuid &&
              dto.uuid.toLowerCase() !== xml.uuid.toLowerCase()
            )
              throw new BadRequestException(
                'El UUID capturado no coincide con el XML',
              );
            const uuid = dto.uuid || xml.uuid || null;
            const head = await queryRows<IdRow>(
              manager,
              `INSERT INTO factura_proveedor(request_id,id_proveedor,id_orden,serie,folio,uuid,
          fecha_emision,fecha_vencimiento,moneda,tipo_cambio,subtotal,impuestos,retenciones,total,saldo_pendiente,xml_original,xml_sha256,observaciones,id_user)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18) RETURNING id_factura_proveedor AS id`,
              [
                dto.requestId,
                dto.idProveedor,
                dto.idOrden,
                dto.serie || null,
                dto.folio,
                uuid,
                dto.fechaEmision,
                dto.fechaVencimiento,
                dto.moneda,
                dto.tipoCambio,
                dto.subtotal,
                dto.impuestos,
                dto.retenciones,
                dto.total,
                xml.xml || null,
                xml.sha256 || null,
                dto.observaciones || null,
                idUser ?? null,
              ],
            );
            const byId = new Map(
              orderLines.map((item) => [item.idDetalle, item]),
            );
            for (const item of dto.partidas) {
              const order = byId.get(item.idOrdenDetalle)!;
              const detail = await queryRows<IdRow>(
                manager,
                `INSERT INTO factura_proveedor_detalle(id_factura_proveedor,id_orden_detalle,id_producto,descripcion,cantidad,costo_unitario,tasa_iva,importe)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_detalle AS id`,
                [
                  head[0].id,
                  item.idOrdenDetalle,
                  order.idProducto,
                  item.descripcion,
                  item.cantidad,
                  item.costoUnitario,
                  item.tasaIva,
                  this.money(item.cantidad * item.costoUnitario),
                ],
              );
              await this.matchLine(
                manager,
                head[0].id,
                detail[0].id,
                item,
                order,
              );
            }
            const pending = await queryRows<{ count: string }>(
              manager,
              `SELECT count(*)::text AS count FROM factura_proveedor_discrepancia WHERE id_factura_proveedor=$1`,
              [head[0].id],
            );
            const state = Number(pending[0].count)
              ? 'Con discrepancias'
              : 'Conciliada';
            await manager.query(
              'UPDATE factura_proveedor SET estado=$2,updated_at=clock_timestamp() WHERE id_factura_proveedor=$1',
              [head[0].id, state],
            );
            return {
              idFacturaProveedor: head[0].id,
              estado: state,
              discrepancias: Number(pending[0].count),
            };
          },
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'El UUID o folio de esta factura ya fue registrado',
        );
      throw error;
    }
  }

  private async matchLine(
    manager: EntityManager,
    invoiceId: number,
    detailId: number,
    item: CreateFacturaProveedorDto['partidas'][number],
    order: OrderLineRow,
  ) {
    let pending = item.cantidad;
    const receipts = await queryRows<ReceiptAvailableRow>(
      manager,
      `SELECT rd.id_detalle AS "idRecepcionDetalle",
      rd.cantidad-coalesce((SELECT sum(fr.cantidad) FROM factura_proveedor_recepcion fr
        JOIN factura_proveedor_detalle fd ON fd.id_detalle=fr.id_factura_detalle
        JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor
        WHERE fr.id_recepcion_detalle=rd.id_detalle AND f.estado<>'Cancelada'),0) AS disponible
      FROM recepcion_compra_detalle rd JOIN recepcion_compra r ON r.id_recepcion=rd.id_recepcion
      WHERE r.id_orden=(SELECT id_orden FROM orden_compra_detalle WHERE id_detalle=$1) AND rd.id_orden_detalle=$1
      ORDER BY r.created_at,rd.id_detalle FOR UPDATE OF rd`,
      [item.idOrdenDetalle],
    );
    for (const receipt of receipts) {
      const amount = Math.min(pending, Number(receipt.disponible));
      if (amount <= 0) continue;
      await manager.query(
        'INSERT INTO factura_proveedor_recepcion(id_factura_detalle,id_recepcion_detalle,cantidad) VALUES($1,$2,$3)',
        [detailId, receipt.idRecepcionDetalle, amount],
      );
      pending -= amount;
      if (pending <= 0.000001) break;
    }
    if (pending > 0.000001)
      await this.addDiscrepancy(
        manager,
        invoiceId,
        detailId,
        'Sin recepcion',
        item.cantidad,
        item.cantidad - pending,
      );
    if (Math.abs(Number(order.costo) - item.costoUnitario) > 0.01)
      await this.addDiscrepancy(
        manager,
        invoiceId,
        detailId,
        'Precio',
        Number(order.costo),
        item.costoUnitario,
      );
    if (Math.abs(Number(order.tasaIva) - item.tasaIva) > 0.000001)
      await this.addDiscrepancy(
        manager,
        invoiceId,
        detailId,
        'Impuesto',
        Number(order.tasaIva),
        item.tasaIva,
      );
    const invoiced = await queryRows<{ total: string | number }>(
      manager,
      `SELECT coalesce(sum(fd.cantidad),0) AS total FROM factura_proveedor_detalle fd
      JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor WHERE fd.id_orden_detalle=$1 AND f.estado<>'Cancelada'`,
      [item.idOrdenDetalle],
    );
    if (Number(invoiced[0].total) > Number(order.cantidad) + 0.000001)
      await this.addDiscrepancy(
        manager,
        invoiceId,
        detailId,
        'Cantidad',
        Number(order.cantidad),
        Number(invoiced[0].total),
      );
  }

  private addDiscrepancy(
    manager: EntityManager,
    invoiceId: number,
    detailId: number,
    type: string,
    expected: number,
    actual: number,
  ) {
    return manager.query(
      `INSERT INTO factura_proveedor_discrepancia(id_factura_proveedor,id_factura_detalle,tipo,esperado,recibido,diferencia)
      VALUES($1,$2,$3,$4,$5,$5-$4)`,
      [invoiceId, detailId, type, expected, actual],
    );
  }

  private xmlMetadata(xml?: string) {
    if (!xml) return {};
    const value = xml.trim();
    if (
      !value.startsWith('<?xml') ||
      !/<(?:\w+:)?Comprobante\b/i.test(value) ||
      /<!DOCTYPE|<!ENTITY/i.test(value)
    ) {
      throw new BadRequestException(
        'El archivo XML no corresponde a un CFDI seguro',
      );
    }
    const root = value.match(/<(?:\w+:)?Comprobante\b([^>]*)>/i)?.[1] || '';
    const emisor = value.match(/<(?:\w+:)?Emisor\b([^>]*)>/i)?.[1] || '';
    const timbre =
      value.match(/<(?:\w+:)?TimbreFiscalDigital\b([^>]*)>/i)?.[1] || '';
    const attribute = (source: string, name: string) =>
      source.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1];
    return {
      uuid: attribute(timbre, 'UUID'),
      total: attribute(root, 'Total'),
      issuerRfc: attribute(emisor, 'Rfc'),
      sha256: createHash('sha256').update(value).digest('hex'),
      xml: value,
    };
  }

  async uploadPdf(id: number, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Selecciona un PDF');
    const tail = file.buffer
      .subarray(Math.max(0, file.buffer.length - 1024))
      .toString('latin1');
    if (
      file.mimetype !== 'application/pdf' ||
      file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !tail.includes('%%EOF')
    ) {
      throw new BadRequestException('El archivo no es un PDF válido');
    }
    const rows = await queryRows<IdRow>(
      this.dataSource,
      `UPDATE factura_proveedor SET pdf_original=$2,pdf_mime='application/pdf',
      pdf_sha256=$3,updated_at=clock_timestamp() WHERE id_factura_proveedor=$1 RETURNING id_factura_proveedor AS id`,
      [id, file.buffer, createHash('sha256').update(file.buffer).digest('hex')],
    );
    if (!rows.length)
      throw new NotFoundException('Factura de proveedor no encontrada');
    return {
      message: 'PDF resguardado',
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  async document(id: number, kind: 'xml' | 'pdf') {
    const rows = await queryRows<{ xml: string | null; pdf: Buffer | null }>(
      this.dataSource,
      'SELECT xml_original AS xml,pdf_original AS pdf FROM factura_proveedor WHERE id_factura_proveedor=$1',
      [id],
    );
    if (!rows.length)
      throw new NotFoundException('Factura de proveedor no encontrada');
    const data = kind === 'xml' ? rows[0].xml : rows[0].pdf;
    if (!data)
      throw new NotFoundException(`La factura no tiene ${kind.toUpperCase()}`);
    return data;
  }

  async resolveDiscrepancy(
    id: number,
    dto: ResolveDiscrepancyDto,
    idUser?: number,
  ) {
    const rows = await queryRows<{ invoiceId: number }>(
      this.dataSource,
      `UPDATE factura_proveedor_discrepancia SET estado=$2,justificacion=$3,
      resuelta_por=$4,resuelta_at=clock_timestamp() WHERE id_discrepancia=$1 AND estado='Pendiente' RETURNING id_factura_proveedor AS "invoiceId"`,
      [id, dto.estado, dto.justificacion, idUser ?? null],
    );
    if (!rows.length)
      throw new ConflictException(
        'La discrepancia ya fue resuelta o no existe',
      );
    return {
      message:
        dto.estado === 'Aprobada'
          ? 'Excepción aprobada'
          : 'Discrepancia rechazada',
      idFacturaProveedor: rows[0].invoiceId,
    };
  }

  async approveInvoice(id: number, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const invoices = await queryRows<InvoiceRow>(
        manager,
        `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
        FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`,
        [id],
      );
      if (!invoices.length)
        throw new NotFoundException('Factura de proveedor no encontrada');
      if (!['Conciliada', 'Con discrepancias'].includes(invoices[0].estado))
        throw new ConflictException('La factura no está lista para aprobación');
      const unresolved = await queryRows<{ count: string }>(
        manager,
        `SELECT count(*)::text AS count FROM factura_proveedor_discrepancia
        WHERE id_factura_proveedor=$1 AND estado<>'Aprobada'`,
        [id],
      );
      if (Number(unresolved[0].count))
        throw new ConflictException(
          'Resuelve y aprueba todas las discrepancias antes de liberar el pago',
        );
      await manager.query(
        `UPDATE factura_proveedor SET estado='Aprobada',aprobada_por=$2,aprobada_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id_factura_proveedor=$1`,
        [id, idUser ?? null],
      );
      await manager.query(
        `INSERT INTO factura_proveedor_programacion(id_factura_proveedor,fecha_programada,monto,notas,id_user)
        SELECT id_factura_proveedor,fecha_vencimiento,saldo_pendiente,'Programación inicial', $2 FROM factura_proveedor WHERE id_factura_proveedor=$1
        AND NOT EXISTS(SELECT 1 FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1)`,
        [id, idUser ?? null],
      );
      return { message: 'Factura aprobada y cuenta por pagar liberada' };
    });
  }

  cancelInvoice(id: number, reason: string, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const invoices = await queryRows<InvoiceRow>(
        manager,
        `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",
        saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio" FROM factura_proveedor
        WHERE id_factura_proveedor=$1 FOR UPDATE`,
        [id],
      );
      if (!invoices.length)
        throw new NotFoundException('Factura de proveedor no encontrada');
      if (invoices[0].estado === 'Cancelada')
        return {
          message: 'La factura ya estaba cancelada',
          idFacturaProveedor: id,
          repeated: true,
        };
      const payments = await queryRows<IdRow>(
        manager,
        `SELECT id_pago AS id FROM factura_proveedor_pago
        WHERE id_factura_proveedor=$1 AND estado='Activo' ORDER BY id_pago FOR UPDATE`,
        [id],
      );
      if (payments.length)
        throw new ConflictException(
          'Revierte los pagos activos antes de cancelar la factura',
        );
      const applications = await queryRows<{
        id: number;
        type: 'NotaCredito' | 'Anticipo';
        sourceId: number;
        amount: number | string;
      }>(
        manager,
        `SELECT
        id_aplicacion AS id,tipo AS type,coalesce(id_nota,id_anticipo) AS "sourceId",monto AS amount
        FROM aplicacion_proveedor WHERE id_factura_proveedor=$1 AND estado='Activa' ORDER BY id_aplicacion FOR UPDATE`,
        [id],
      );
      await manager.query(`SELECT set_config('app.current_user_id',$1,true)`, [
        idUser ? String(idUser) : '',
      ]);
      for (const application of applications) {
        const table =
          application.type === 'NotaCredito'
            ? 'nota_credito_proveedor'
            : 'anticipo_proveedor';
        const idColumn =
          application.type === 'NotaCredito' ? 'id_nota' : 'id_anticipo';
        await manager.query(
          `UPDATE ${table} SET saldo_disponible=saldo_disponible+$2,estado='Disponible' WHERE ${idColumn}=$1`,
          [application.sourceId, application.amount],
        );
        await manager.query(
          `UPDATE aplicacion_proveedor SET estado='Revertida',revertida_por=$2,revertida_at=clock_timestamp(),
          motivo_reversion=$3 WHERE id_aplicacion=$1`,
          [application.id, idUser ?? null, `Cancelación de factura: ${reason}`],
        );
      }
      await manager.query(
        `UPDATE factura_proveedor_programacion SET estado='Cancelada' WHERE id_factura_proveedor=$1 AND estado='Pendiente'`,
        [id],
      );
      await manager.query(
        `UPDATE factura_proveedor_discrepancia SET estado='Rechazada',justificacion=$2,resuelta_por=$3,resuelta_at=clock_timestamp()
        WHERE id_factura_proveedor=$1 AND estado='Pendiente'`,
        [id, `Factura cancelada: ${reason}`, idUser ?? null],
      );
      await manager.query(
        `UPDATE factura_proveedor SET estado='Cancelada',saldo_pendiente=0,cancelada_por=$2,cancelada_at=clock_timestamp(),
        motivo_cancelacion=$3,updated_at=clock_timestamp() WHERE id_factura_proveedor=$1`,
        [id, idUser ?? null, reason],
      );
      return {
        message: 'Factura de proveedor cancelada',
        idFacturaProveedor: id,
        aplicacionesLiberadas: applications.length,
      };
    });
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
