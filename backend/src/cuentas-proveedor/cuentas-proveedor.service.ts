import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { CreateFacturaProveedorDto, CreateSupplierAdvanceDto, CreateSupplierCreditDto, PaySupplierInvoiceDto, ResolveDiscrepancyDto, ScheduleSupplierPaymentDto } from './cuentas-proveedor.dto';

interface IdRow { id: number; }
interface OrderRow { idProveedor: number; estado: string; moneda: string; tipoCambio: number | string; }
interface OrderLineRow { idDetalle: number; idProducto: number; cantidad: number | string; costo: number | string; tasaIva: number | string; }
interface InvoiceRow { idFactura: number; idProveedor: number; saldo: number | string; total: number | string; estado: string; tipoCambio: number | string; }
interface ReceiptAvailableRow { idRecepcionDetalle: number; disponible: number | string; }

@Injectable()
export class CuentasProveedorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

  private xmlMetadata(xml?: string) {
    if (!xml) return {};
    const value = xml.trim();
    if (!value.startsWith('<?xml') || !/<(?:\w+:)?Comprobante\b/i.test(value) || /<!DOCTYPE|<!ENTITY/i.test(value)) {
      throw new BadRequestException('El archivo XML no corresponde a un CFDI seguro');
    }
    const root = value.match(/<(?:\w+:)?Comprobante\b([^>]*)>/i)?.[1] || '';
    const emisor = value.match(/<(?:\w+:)?Emisor\b([^>]*)>/i)?.[1] || '';
    const timbre = value.match(/<(?:\w+:)?TimbreFiscalDigital\b([^>]*)>/i)?.[1] || '';
    const attribute = (source: string, name: string) => source.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1];
    return {
      uuid: attribute(timbre, 'UUID'), total: attribute(root, 'Total'),
      issuerRfc: attribute(emisor, 'Rfc'), sha256: createHash('sha256').update(value).digest('hex'), xml: value,
    };
  }

  async createInvoice(dto: CreateFacturaProveedorDto, idUser?: number) {
    try {
      return await this.dataSource.transaction(async manager => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext('supplier-invoice:' || $1))`, [dto.requestId]);
        const old = await queryRows<IdRow>(manager, 'SELECT id_factura_proveedor AS id FROM factura_proveedor WHERE request_id=$1', [dto.requestId]);
        if (old.length) return { idFacturaProveedor: old[0].id, repeated: true };
        const orders = await queryRows<OrderRow>(manager, `SELECT id_proveedor AS "idProveedor",estado,moneda,tipo_cambio AS "tipoCambio" FROM orden_compra WHERE id_orden=$1 FOR SHARE`, [dto.idOrden]);
        if (!orders.length) throw new NotFoundException('Orden de compra no encontrada');
        if (orders[0].idProveedor !== dto.idProveedor) throw new BadRequestException('La orden pertenece a otro proveedor');
        if (orders[0].estado === 'Cancelada') throw new ConflictException('No se puede facturar una orden cancelada');
        if (orders[0].moneda !== dto.moneda || Math.abs(Number(orders[0].tipoCambio)-dto.tipoCambio)>.000001) throw new BadRequestException('Moneda y tipo de cambio deben coincidir con la orden');
        if (new Date(dto.fechaVencimiento) < new Date(dto.fechaEmision)) throw new BadRequestException('El vencimiento no puede ser anterior a la emisión');
        const ids = dto.partidas.map(item => item.idOrdenDetalle);
        if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay partidas de orden repetidas');
        const orderLines = await queryRows<OrderLineRow>(manager, `SELECT id_detalle AS "idDetalle",id_producto AS "idProducto",cantidad,
          costo_unitario AS costo,tasa_iva AS "tasaIva" FROM orden_compra_detalle WHERE id_orden=$1 AND id_detalle=ANY($2::int[]) ORDER BY id_detalle FOR SHARE`, [dto.idOrden, ids]);
        if (orderLines.length !== ids.length) throw new BadRequestException('Una partida no pertenece a la orden');
        const subtotal = this.money(dto.partidas.reduce((sum, item) => sum + item.cantidad * item.costoUnitario, 0));
        const taxes = this.money(dto.partidas.reduce((sum, item) => sum + item.cantidad * item.costoUnitario * item.tasaIva, 0));
        const total = this.money(subtotal + taxes - dto.retenciones);
        if (Math.abs(subtotal - dto.subtotal) > .01 || Math.abs(taxes - dto.impuestos) > .01 || Math.abs(total - dto.total) > .01) {
          throw new BadRequestException('Subtotal, impuestos o total no coinciden con las partidas');
        }
        const xml = this.xmlMetadata(dto.xml);
        const providers = await queryRows<{ rfc: string }>(manager, 'SELECT "RFC" AS rfc FROM proveedor WHERE "IdProveedor"=$1', [dto.idProveedor]);
        if (!providers.length) throw new NotFoundException('Proveedor no encontrado');
        if (xml.issuerRfc && xml.issuerRfc.toUpperCase() !== providers[0].rfc.toUpperCase()) throw new BadRequestException('El RFC emisor del XML no coincide con el proveedor');
        if (xml.total && Math.abs(Number(xml.total) - dto.total) > .01) throw new BadRequestException('El total del XML no coincide con la factura');
        if (dto.uuid && xml.uuid && dto.uuid.toLowerCase() !== xml.uuid.toLowerCase()) throw new BadRequestException('El UUID capturado no coincide con el XML');
        const uuid = dto.uuid || xml.uuid || null;
        const head = await queryRows<IdRow>(manager, `INSERT INTO factura_proveedor(request_id,id_proveedor,id_orden,serie,folio,uuid,
          fecha_emision,fecha_vencimiento,moneda,tipo_cambio,subtotal,impuestos,retenciones,total,saldo_pendiente,xml_original,xml_sha256,observaciones,id_user)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18) RETURNING id_factura_proveedor AS id`,
        [dto.requestId,dto.idProveedor,dto.idOrden,dto.serie||null,dto.folio,uuid,dto.fechaEmision,dto.fechaVencimiento,dto.moneda,dto.tipoCambio,
          dto.subtotal,dto.impuestos,dto.retenciones,dto.total,xml.xml||null,xml.sha256||null,dto.observaciones||null,idUser??null]);
        const byId = new Map(orderLines.map(item => [item.idDetalle, item]));
        for (const item of dto.partidas) {
          const order = byId.get(item.idOrdenDetalle)!;
          const detail = await queryRows<IdRow>(manager, `INSERT INTO factura_proveedor_detalle(id_factura_proveedor,id_orden_detalle,id_producto,descripcion,cantidad,costo_unitario,tasa_iva,importe)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_detalle AS id`, [head[0].id,item.idOrdenDetalle,order.idProducto,item.descripcion,item.cantidad,item.costoUnitario,item.tasaIva,this.money(item.cantidad*item.costoUnitario)]);
          await this.matchLine(manager, head[0].id, detail[0].id, item, order);
        }
        const pending = await queryRows<{ count: string }>(manager, `SELECT count(*)::text AS count FROM factura_proveedor_discrepancia WHERE id_factura_proveedor=$1`, [head[0].id]);
        const state = Number(pending[0].count) ? 'Con discrepancias' : 'Conciliada';
        await manager.query('UPDATE factura_proveedor SET estado=$2,updated_at=clock_timestamp() WHERE id_factura_proveedor=$1', [head[0].id,state]);
        return { idFacturaProveedor: head[0].id, estado: state, discrepancias: Number(pending[0].count) };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('El UUID o folio de esta factura ya fue registrado');
      throw error;
    }
  }

  private async matchLine(manager: EntityManager, invoiceId: number, detailId: number,
    item: CreateFacturaProveedorDto['partidas'][number], order: OrderLineRow) {
    let pending = item.cantidad;
    const receipts = await queryRows<ReceiptAvailableRow>(manager, `SELECT rd.id_detalle AS "idRecepcionDetalle",
      rd.cantidad-coalesce((SELECT sum(fr.cantidad) FROM factura_proveedor_recepcion fr
        JOIN factura_proveedor_detalle fd ON fd.id_detalle=fr.id_factura_detalle
        JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor
        WHERE fr.id_recepcion_detalle=rd.id_detalle AND f.estado<>'Cancelada'),0) AS disponible
      FROM recepcion_compra_detalle rd JOIN recepcion_compra r ON r.id_recepcion=rd.id_recepcion
      WHERE r.id_orden=(SELECT id_orden FROM orden_compra_detalle WHERE id_detalle=$1) AND rd.id_orden_detalle=$1
      ORDER BY r.created_at,rd.id_detalle FOR UPDATE OF rd`, [item.idOrdenDetalle]);
    for (const receipt of receipts) {
      const amount = Math.min(pending, Number(receipt.disponible));
      if (amount <= 0) continue;
      await manager.query('INSERT INTO factura_proveedor_recepcion(id_factura_detalle,id_recepcion_detalle,cantidad) VALUES($1,$2,$3)', [detailId,receipt.idRecepcionDetalle,amount]);
      pending -= amount;
      if (pending <= .000001) break;
    }
    if (pending > .000001) await this.addDiscrepancy(manager, invoiceId, detailId, 'Sin recepcion', item.cantidad, item.cantidad-pending);
    if (Math.abs(Number(order.costo)-item.costoUnitario) > .01) await this.addDiscrepancy(manager, invoiceId, detailId, 'Precio', Number(order.costo), item.costoUnitario);
    if (Math.abs(Number(order.tasaIva)-item.tasaIva) > .000001) await this.addDiscrepancy(manager, invoiceId, detailId, 'Impuesto', Number(order.tasaIva), item.tasaIva);
    const invoiced = await queryRows<{ total: string | number }>(manager, `SELECT coalesce(sum(fd.cantidad),0) AS total FROM factura_proveedor_detalle fd
      JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor WHERE fd.id_orden_detalle=$1 AND f.estado<>'Cancelada'`, [item.idOrdenDetalle]);
    if (Number(invoiced[0].total) > Number(order.cantidad)+.000001) await this.addDiscrepancy(manager, invoiceId, detailId, 'Cantidad', Number(order.cantidad), Number(invoiced[0].total));
  }

  private addDiscrepancy(manager: EntityManager, invoiceId: number, detailId: number, type: string, expected: number, actual: number) {
    return manager.query(`INSERT INTO factura_proveedor_discrepancia(id_factura_proveedor,id_factura_detalle,tipo,esperado,recibido,diferencia)
      VALUES($1,$2,$3,$4,$5,$5-$4)`, [invoiceId,detailId,type,expected,actual]);
  }

  async uploadPdf(id: number, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Selecciona un PDF');
    const tail = file.buffer.subarray(Math.max(0,file.buffer.length-1024)).toString('latin1');
    if (file.mimetype !== 'application/pdf' || file.buffer.subarray(0,5).toString('ascii') !== '%PDF-' || !tail.includes('%%EOF')) {
      throw new BadRequestException('El archivo no es un PDF válido');
    }
    const rows = await queryRows<IdRow>(this.dataSource, `UPDATE factura_proveedor SET pdf_original=$2,pdf_mime='application/pdf',
      pdf_sha256=$3,updated_at=clock_timestamp() WHERE id_factura_proveedor=$1 RETURNING id_factura_proveedor AS id`,
    [id,file.buffer,createHash('sha256').update(file.buffer).digest('hex')]);
    if (!rows.length) throw new NotFoundException('Factura de proveedor no encontrada');
    return { message: 'PDF resguardado', sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  async document(id: number, kind: 'xml'|'pdf') {
    const rows = await queryRows<{ xml: string|null; pdf: Buffer|null }>(this.dataSource,
      'SELECT xml_original AS xml,pdf_original AS pdf FROM factura_proveedor WHERE id_factura_proveedor=$1', [id]);
    if (!rows.length) throw new NotFoundException('Factura de proveedor no encontrada');
    const data = kind === 'xml' ? rows[0].xml : rows[0].pdf;
    if (!data) throw new NotFoundException(`La factura no tiene ${kind.toUpperCase()}`);
    return data;
  }

  listInvoices() { return queryRows<Record<string,unknown>>(this.dataSource, `SELECT f.id_factura_proveedor AS "idFacturaProveedor",f.id_proveedor AS "idProveedor",f.id_orden AS "idOrden",
    f.serie,f.folio,f.uuid,f.fecha_emision AS "fechaEmision",f.fecha_vencimiento AS "fechaVencimiento",f.total,f.saldo_pendiente AS saldo,
    f.estado,f.moneda,p."RazonSocial" AS proveedor,o.folio AS "folioOrden",(f.xml_original IS NOT NULL) AS "tieneXml",(f.pdf_original IS NOT NULL) AS "tienePdf",
    count(d.id_discrepancia) FILTER(WHERE d.estado='Pendiente')::int AS "discrepanciasPendientes"
    FROM factura_proveedor f JOIN proveedor p ON p."IdProveedor"=f.id_proveedor JOIN orden_compra o ON o.id_orden=f.id_orden
    LEFT JOIN factura_proveedor_discrepancia d ON d.id_factura_proveedor=f.id_factura_proveedor
    GROUP BY f.id_factura_proveedor,p."RazonSocial",o.folio ORDER BY f.created_at DESC LIMIT 250`); }

  async invoice(id: number) {
    const rows = await queryRows<Record<string,unknown>>(this.dataSource, `SELECT f.*,f.id_factura_proveedor AS "idFacturaProveedor",f.id_proveedor AS "idProveedor",
      f.fecha_emision AS "fechaEmision",f.fecha_vencimiento AS "fechaVencimiento",f.saldo_pendiente AS saldo,
      (f.xml_original IS NOT NULL) AS "tieneXml",(f.pdf_original IS NOT NULL) AS "tienePdf",
      p."RazonSocial" AS proveedor,o.folio AS "folioOrden" FROM factura_proveedor f JOIN proveedor p ON p."IdProveedor"=f.id_proveedor
      JOIN orden_compra o ON o.id_orden=f.id_orden WHERE f.id_factura_proveedor=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Factura de proveedor no encontrada');
    const [details, discrepancies, schedules, payments, applications] = await Promise.all([
      queryRows<Record<string,unknown>>(this.dataSource, `SELECT d.id_detalle AS "idDetalle",d.id_producto AS "idProducto",p."Codigo" AS codigo,d.descripcion,d.cantidad,
        d.costo_unitario AS "costoUnitario",d.tasa_iva AS "tasaIva",d.importe,coalesce(sum(r.cantidad),0) AS conciliada
        FROM factura_proveedor_detalle d JOIN producto p ON p."IdProducto"=d.id_producto LEFT JOIN factura_proveedor_recepcion r ON r.id_factura_detalle=d.id_detalle
        WHERE d.id_factura_proveedor=$1 GROUP BY d.id_detalle,p."Codigo" ORDER BY d.id_detalle`, [id]),
      queryRows<Record<string,unknown>>(this.dataSource, `SELECT id_discrepancia AS "idDiscrepancia",tipo,esperado,recibido,diferencia,estado,justificacion,created_at AS "createdAt"
        FROM factura_proveedor_discrepancia WHERE id_factura_proveedor=$1 ORDER BY id_discrepancia`, [id]),
      queryRows<Record<string,unknown>>(this.dataSource, `SELECT id_programacion AS "idProgramacion",fecha_programada AS "fechaProgramada",monto,estado,notas
        FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1 ORDER BY fecha_programada`, [id]),
      queryRows<Record<string,unknown>>(this.dataSource, `SELECT id_pago AS "idPago",fecha,monto,forma_pago AS "formaPago",referencia
        FROM factura_proveedor_pago WHERE id_factura_proveedor=$1 ORDER BY fecha DESC,id_pago DESC`, [id]),
      queryRows<Record<string,unknown>>(this.dataSource, `SELECT tipo,monto,created_at AS "createdAt" FROM aplicacion_proveedor WHERE id_factura_proveedor=$1 ORDER BY created_at DESC`, [id]),
    ]);
    return { ...rows[0], partidas: details, discrepancias: discrepancies, programaciones: schedules, pagos: payments, aplicaciones: applications };
  }

  async resolveDiscrepancy(id: number, dto: ResolveDiscrepancyDto, idUser?: number) {
    const rows = await queryRows<{ invoiceId: number }>(this.dataSource, `UPDATE factura_proveedor_discrepancia SET estado=$2,justificacion=$3,
      resuelta_por=$4,resuelta_at=clock_timestamp() WHERE id_discrepancia=$1 AND estado='Pendiente' RETURNING id_factura_proveedor AS "invoiceId"`,
    [id,dto.estado,dto.justificacion,idUser??null]);
    if (!rows.length) throw new ConflictException('La discrepancia ya fue resuelta o no existe');
    return { message: dto.estado === 'Aprobada' ? 'Excepción aprobada' : 'Discrepancia rechazada', idFacturaProveedor: rows[0].invoiceId };
  }

  async approveInvoice(id: number, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const invoices = await queryRows<InvoiceRow>(manager, `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
        FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`, [id]);
      if (!invoices.length) throw new NotFoundException('Factura de proveedor no encontrada');
      if (!['Conciliada','Con discrepancias'].includes(invoices[0].estado)) throw new ConflictException('La factura no está lista para aprobación');
      const unresolved = await queryRows<{ count: string }>(manager, `SELECT count(*)::text AS count FROM factura_proveedor_discrepancia
        WHERE id_factura_proveedor=$1 AND estado<>'Aprobada'`, [id]);
      if (Number(unresolved[0].count)) throw new ConflictException('Resuelve y aprueba todas las discrepancias antes de liberar el pago');
      await manager.query(`UPDATE factura_proveedor SET estado='Aprobada',aprobada_por=$2,aprobada_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id_factura_proveedor=$1`, [id,idUser??null]);
      await manager.query(`INSERT INTO factura_proveedor_programacion(id_factura_proveedor,fecha_programada,monto,notas,id_user)
        SELECT id_factura_proveedor,fecha_vencimiento,saldo_pendiente,'Programación inicial', $2 FROM factura_proveedor WHERE id_factura_proveedor=$1
        AND NOT EXISTS(SELECT 1 FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1)`, [id,idUser??null]);
      return { message: 'Factura aprobada y cuenta por pagar liberada' };
    });
  }

  schedule(id: number, dto: ScheduleSupplierPaymentDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const invoices = await queryRows<InvoiceRow>(manager, `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
        FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`, [id]);
      if (!invoices.length) throw new NotFoundException('Factura no encontrada');
      if (!['Aprobada','Parcialmente pagada'].includes(invoices[0].estado)) throw new ConflictException('La factura no está aprobada');
      await manager.query(`DELETE FROM factura_proveedor_programacion WHERE id_factura_proveedor=$1 AND estado='Pendiente' AND notas='Programación inicial'`, [id]);
      const pending = await queryRows<{ total: string|number }>(manager, `SELECT coalesce(sum(monto),0) AS total FROM factura_proveedor_programacion
        WHERE id_factura_proveedor=$1 AND estado='Pendiente'`, [id]);
      if (this.money(Number(pending[0].total)+dto.monto) > this.money(Number(invoices[0].saldo))) throw new BadRequestException('La programación supera el saldo sin programar');
      return queryRows<IdRow>(manager, `INSERT INTO factura_proveedor_programacion(id_factura_proveedor,fecha_programada,monto,notas,id_user)
        VALUES($1,$2,$3,$4,$5) RETURNING id_programacion AS id`, [id,dto.fechaProgramada,dto.monto,dto.notas||null,idUser??null]);
    }).then(rows => ({ idProgramacion: rows[0].id }));
  }

  pay(id: number, dto: PaySupplierInvoiceDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const old = await queryRows<IdRow>(manager, 'SELECT id_pago AS id FROM factura_proveedor_pago WHERE request_id=$1', [dto.requestId]);
      if (old.length) return { idPago: old[0].id, repeated: true };
      const invoices = await queryRows<InvoiceRow>(manager, `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
        FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`, [id]);
      if (!invoices.length) throw new NotFoundException('Factura no encontrada');
      if (!['Aprobada','Parcialmente pagada'].includes(invoices[0].estado)) throw new ConflictException('La factura no admite pagos');
      if (this.money(dto.monto) > this.money(Number(invoices[0].saldo))) throw new BadRequestException('El pago supera el saldo pendiente');
      if (dto.idProgramacion) {
        const schedule = await queryRows<{ monto:number|string }>(manager, `SELECT monto FROM factura_proveedor_programacion WHERE id_programacion=$1
          AND id_factura_proveedor=$2 AND estado='Pendiente' FOR UPDATE`, [dto.idProgramacion,id]);
        if (!schedule.length) throw new BadRequestException('La programación no está disponible');
        if (this.money(Number(schedule[0].monto)) !== this.money(dto.monto)) throw new BadRequestException('El pago debe coincidir con la programación');
      }
      const payment = await queryRows<IdRow>(manager, `INSERT INTO factura_proveedor_pago(request_id,id_factura_proveedor,id_programacion,fecha,monto,forma_pago,referencia,notas,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_pago AS id`, [dto.requestId,id,dto.idProgramacion||null,dto.fecha,dto.monto,dto.formaPago,dto.referencia||null,dto.notas||null,idUser??null]);
      const balance = this.money(Number(invoices[0].saldo)-dto.monto);
      await manager.query(`UPDATE factura_proveedor SET saldo_pendiente=$2::numeric,estado=CASE WHEN $2::numeric=0 THEN 'Pagada' ELSE 'Parcialmente pagada' END,
        updated_at=clock_timestamp() WHERE id_factura_proveedor=$1`, [id,balance]);
      if (dto.idProgramacion) await manager.query(`UPDATE factura_proveedor_programacion SET estado='Pagada' WHERE id_programacion=$1`, [dto.idProgramacion]);
      if (balance === 0) await manager.query(`UPDATE factura_proveedor_programacion SET estado='Cancelada'
        WHERE id_factura_proveedor=$1 AND estado='Pendiente'`, [id]);
      const mxnAmount=this.money(dto.monto*Number(invoices[0].tipoCambio));
      await manager.query(`UPDATE saldos SET caja_chica=caja_chica-CASE WHEN $2 ILIKE '%Efectivo%' THEN $1::numeric ELSE 0::numeric END,
        cuenta_banco=cuenta_banco-CASE WHEN $2 ILIKE '%Efectivo%' THEN 0::numeric ELSE $1::numeric END,updated_at=now()`, [mxnAmount,dto.formaPago]);
      return { idPago: payment[0].id, saldo: balance };
    });
  }

  createCredit(dto: CreateSupplierCreditDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const old = await queryRows<IdRow>(manager, 'SELECT id_nota AS id FROM nota_credito_proveedor WHERE request_id=$1', [dto.requestId]);
      if (old.length) return { idNota: old[0].id, repeated: true };
      const note = await queryRows<IdRow>(manager, `INSERT INTO nota_credito_proveedor(request_id,id_proveedor,uuid,folio,fecha,total,saldo_disponible,notas,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING id_nota AS id`, [dto.requestId,dto.idProveedor,dto.uuid||null,dto.folio,dto.fecha,dto.total,dto.notas||null,idUser??null]);
      if (dto.idFacturaProveedor) await this.applyBalance(manager,'NotaCredito',note[0].id,dto.idFacturaProveedor,dto.montoAplicar||dto.total,idUser);
      return { idNota: note[0].id };
    }).catch(error => { if ((error as {code?:string}).code==='23505') throw new ConflictException('La nota de crédito ya fue registrada'); throw error; });
  }

  createAdvance(dto: CreateSupplierAdvanceDto, idUser?: number) {
    return this.dataSource.transaction(async manager => {
      const old = await queryRows<IdRow>(manager, 'SELECT id_anticipo AS id FROM anticipo_proveedor WHERE request_id=$1', [dto.requestId]);
      if (old.length) return { idAnticipo: old[0].id, repeated: true };
      const advance = await queryRows<IdRow>(manager, `INSERT INTO anticipo_proveedor(request_id,id_proveedor,fecha,monto,saldo_disponible,forma_pago,referencia,notas,id_user)
        VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8) RETURNING id_anticipo AS id`, [dto.requestId,dto.idProveedor,dto.fecha,dto.monto,dto.formaPago,dto.referencia||null,dto.notas||null,idUser??null]);
      await manager.query(`UPDATE saldos SET caja_chica=caja_chica-CASE WHEN $2 ILIKE '%Efectivo%' THEN $1::numeric ELSE 0::numeric END,
        cuenta_banco=cuenta_banco-CASE WHEN $2 ILIKE '%Efectivo%' THEN 0::numeric ELSE $1::numeric END,updated_at=now()`, [dto.monto,dto.formaPago]);
      if (dto.idFacturaProveedor) await this.applyBalance(manager,'Anticipo',advance[0].id,dto.idFacturaProveedor,dto.montoAplicar||dto.monto,idUser);
      return { idAnticipo: advance[0].id };
    });
  }

  private async applyBalance(manager: EntityManager, type: 'NotaCredito'|'Anticipo', sourceId: number, invoiceId: number, amount: number, idUser?: number) {
    const invoice = await queryRows<InvoiceRow>(manager, `SELECT id_factura_proveedor AS "idFactura",id_proveedor AS "idProveedor",saldo_pendiente AS saldo,total,estado,tipo_cambio AS "tipoCambio"
      FROM factura_proveedor WHERE id_factura_proveedor=$1 FOR UPDATE`, [invoiceId]);
    if (!invoice.length || !['Aprobada','Parcialmente pagada'].includes(invoice[0].estado)) throw new ConflictException('La factura no está disponible para aplicaciones');
    if (Number(invoice[0].tipoCambio)!==1) throw new BadRequestException('Anticipos y notas de crédito deben aplicarse en la misma moneda; esta pantalla opera saldos MXN');
    const table = type === 'NotaCredito' ? 'nota_credito_proveedor' : 'anticipo_proveedor';
    const idColumn = type === 'NotaCredito' ? 'id_nota' : 'id_anticipo';
    const source = await queryRows<{ saldo:number|string; idProveedor:number }>(manager, `SELECT saldo_disponible AS saldo,id_proveedor AS "idProveedor" FROM ${table} WHERE ${idColumn}=$1 FOR UPDATE`, [sourceId]);
    if (!source.length || source[0].idProveedor !== invoice[0].idProveedor) throw new BadRequestException('El saldo pertenece a otro proveedor');
    if (amount > Number(source[0].saldo)+.001 || amount > Number(invoice[0].saldo)+.001) throw new BadRequestException('La aplicación supera el saldo disponible');
    await manager.query(`INSERT INTO aplicacion_proveedor(id_factura_proveedor,tipo,id_nota,id_anticipo,monto,id_user)
      VALUES($1,$2,$3,$4,$5,$6)`, [invoiceId,type,type==='NotaCredito'?sourceId:null,type==='Anticipo'?sourceId:null,amount,idUser??null]);
    const sourceBalance = this.money(Number(source[0].saldo)-amount);
    await manager.query(`UPDATE ${table} SET saldo_disponible=$2::numeric,estado=CASE WHEN $2::numeric=0 THEN $3 ELSE 'Disponible' END WHERE ${idColumn}=$1`,
      [sourceId,sourceBalance,type==='NotaCredito'?'Aplicada':'Aplicado']);
    const invoiceBalance = this.money(Number(invoice[0].saldo)-amount);
    await manager.query(`UPDATE factura_proveedor SET saldo_pendiente=$2::numeric,estado=CASE WHEN $2::numeric=0 THEN 'Pagada' ELSE 'Parcialmente pagada' END,
      updated_at=clock_timestamp() WHERE id_factura_proveedor=$1`, [invoiceId,invoiceBalance]);
    if (invoiceBalance === 0) await manager.query(`UPDATE factura_proveedor_programacion SET estado='Cancelada'
      WHERE id_factura_proveedor=$1 AND estado='Pendiente'`, [invoiceId]);
  }

  dashboard() { return Promise.all([
    queryRows<Record<string,unknown>>(this.dataSource, `SELECT coalesce(sum(saldo_pendiente*tipo_cambio),0) AS total,
      coalesce(sum(saldo_pendiente*tipo_cambio) FILTER(WHERE fecha_vencimiento<current_date),0) AS vencido,
      count(*) FILTER(WHERE estado='Con discrepancias')::int AS discrepancias,
      count(*) FILTER(WHERE estado='Por conciliar')::int AS "porConciliar" FROM factura_proveedor WHERE estado<>'Cancelada'`),
    queryRows<Record<string,unknown>>(this.dataSource, `SELECT CASE WHEN fecha_vencimiento>=current_date THEN 'Por vencer'
      WHEN current_date-fecha_vencimiento BETWEEN 1 AND 30 THEN '1-30' WHEN current_date-fecha_vencimiento BETWEEN 31 AND 60 THEN '31-60'
      WHEN current_date-fecha_vencimiento BETWEEN 61 AND 90 THEN '61-90' ELSE 'Más de 90' END AS rango,
      count(*)::int AS facturas,coalesce(sum(saldo_pendiente*tipo_cambio),0) AS saldo FROM factura_proveedor
      WHERE saldo_pendiente>0 AND estado IN ('Aprobada','Parcialmente pagada') GROUP BY 1 ORDER BY min(fecha_vencimiento)`),
    queryRows<Record<string,unknown>>(this.dataSource, `SELECT rd.id_detalle AS "idRecepcionDetalle",r.id_recepcion AS "idRecepcion",o.folio AS "folioOrden",
      p."RazonSocial" AS proveedor,pr."Codigo" AS codigo,pr."Descripcion" AS producto,r.created_at AS "fechaRecepcion",
      rd.cantidad-coalesce(sum(fr.cantidad),0) AS pendiente
      FROM recepcion_compra_detalle rd JOIN recepcion_compra r ON r.id_recepcion=rd.id_recepcion JOIN orden_compra o ON o.id_orden=r.id_orden
      JOIN proveedor p ON p."IdProveedor"=o.id_proveedor JOIN producto pr ON pr."IdProducto"=rd.id_producto
      LEFT JOIN factura_proveedor_recepcion fr ON fr.id_recepcion_detalle=rd.id_detalle
      LEFT JOIN factura_proveedor_detalle fd ON fd.id_detalle=fr.id_factura_detalle
      LEFT JOIN factura_proveedor f ON f.id_factura_proveedor=fd.id_factura_proveedor AND f.estado<>'Cancelada'
      GROUP BY rd.id_detalle,r.id_recepcion,o.folio,p."RazonSocial",pr."Codigo",pr."Descripcion",r.created_at
      HAVING rd.cantidad-coalesce(sum(fr.cantidad) FILTER(WHERE f.id_factura_proveedor IS NOT NULL),0)>.000001 ORDER BY r.created_at LIMIT 200`),
    queryRows<Record<string,unknown>>(this.dataSource, `SELECT id_anticipo AS id,id_proveedor AS "idProveedor",fecha,monto,saldo_disponible AS saldo,
      forma_pago AS "formaPago",referencia FROM anticipo_proveedor WHERE saldo_disponible>0 AND estado='Disponible' ORDER BY fecha`),
    queryRows<Record<string,unknown>>(this.dataSource, `SELECT id_nota AS id,id_proveedor AS "idProveedor",fecha,folio,total,saldo_disponible AS saldo
      FROM nota_credito_proveedor WHERE saldo_disponible>0 AND estado='Disponible' ORDER BY fecha`),
  ]).then(([summary,aging,unbilled,advances,credits]) => ({ resumen: summary[0], antiguedad: aging, recibidoSinFactura: unbilled, anticipos: advances, notasCredito: credits })); }
}
