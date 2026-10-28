import { CompraQueryDto, compraPage, compraCsv } from './compra-query';
// backend/src/compra/compra.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CreateCompraDto } from './compra.dto';
import { createHash, randomUUID } from 'node:crypto';
import { queryRows } from '../common/database/typed-query';
import { setAuditActor } from '../auth/audit-actor';
import { businessDate } from '../common/business-date';
import { AbastecimientoService } from '../abastecimiento/abastecimiento.service';
import { FacturasProveedorService } from '../cuentas-proveedor/facturas-proveedor.service';
import { PagosProveedorService } from '../cuentas-proveedor/pagos-proveedor.service';

interface IdempotencyRow { response: Record<string, unknown>; payload_hash: string; }
interface ProductoIdRow { IdProducto: number; }

/** Plazo de pago de una compra a crédito capturada en "Nueva compra" (la factura vence a 30 días). */
export const COMPRA_CREDITO_DIAS = 30;

export type CompraFuente = 'compra' | 'orden';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class CompraService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private readonly abastecimiento: AbastecimientoService,
    private readonly facturas: FacturasProveedorService,
    private readonly pagos: PagosProveedorService,
  ) {}

  /**
   * H02-b · "Nueva compra" registra el flujo formal en una sola transacción: orden de compra
   * (origen "Compra directa"), recepción completa (inventario, kárdex y backorders), factura de
   * proveedor conciliada y aprobada, y el pago si es de contado. La deuda queda en Cuentas por
   * pagar; ya no se crea saldo en compra.saldo_pendiente.
   */
  async create(dto: CreateCompraDto, idUser?: number) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await setAuditActor(manager, idUser);
        const requestPayload: Partial<CreateCompraDto> = { ...dto };
        delete requestPayload.requestId;
        const payloadHash = createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');
        if (dto.requestId) {
          await manager.query(`SELECT pg_advisory_xact_lock(hashtext('compra-request:' || $1))`, [dto.requestId]);
          const previous = await queryRows<IdempotencyRow>(manager,
            `SELECT response, payload_hash FROM operation_idempotency
              WHERE request_id = $1 AND operation_type = 'compra'`, [dto.requestId]);
          if (previous.length) {
            if (previous[0].payload_hash !== payloadHash) {
              throw new BadRequestException('El identificador de reintento ya fue usado con datos diferentes');
            }
            return previous[0].response;
          }
        }
        const response = await this.createWithin(manager, dto, idUser);
        if (dto.requestId) {
          await manager.query(
            `INSERT INTO operation_idempotency(request_id, operation_type, id_user, payload_hash, response)
             VALUES ($1, 'compra', $2, $3, $4::jsonb)`,
            [dto.requestId, idUser ?? null, payloadHash, JSON.stringify(response)],
          );
        }
        return response;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Ese folio de factura ya está registrado para este proveedor');
      }
      throw error;
    }
  }

  private async createWithin(manager: EntityManager, dto: CreateCompraDto, idUser?: number) {
    const productIds = dto.conceptos.map((c) => c.idProducto);
    const uniqueIds = [...new Set(productIds)].sort((a, b) => a - b);
    if (uniqueIds.length !== productIds.length) {
      throw new BadRequestException('Cada producto debe aparecer una sola vez; suma las cantidades en un solo renglón');
    }
    const products = await queryRows<ProductoIdRow>(manager,
      `SELECT "IdProducto" FROM producto WHERE "IdProducto" = ANY($1::int[]) ORDER BY "IdProducto" FOR UPDATE`,
      [uniqueIds]);
    if (products.length !== uniqueIds.length) throw new BadRequestException('Uno o más productos ya no existen');

    const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const total = money(dto.conceptos.reduce((sum, c) => sum + money(Number(c.cantidad) * Number(c.costoUnitario)), 0));
    if (Math.abs(total - dto.total) > 0.01) {
      throw new BadRequestException('El total de la compra no coincide con el cálculo del servidor');
    }

    // 1) Orden de compra. Los costos se registran como se capturan, sin desglose de IVA (igual que antes).
    const order = await this.abastecimiento.createOrderIn(manager, {
      requestId: randomUUID(),
      idProveedor: dto.idProveedor,
      notas: dto.observaciones || undefined,
      partidas: dto.conceptos.map((c) => ({ idProducto: c.idProducto, cantidad: Number(c.cantidad), costoUnitario: Number(c.costoUnitario), tasaIva: 0 })),
    }, idUser, 'Compra directa');
    const lines = await queryRows<{ idDetalle: number; idProducto: number; descripcion: string; cantidad: string | number; costo: string | number; folio: string | number }>(manager,
      `SELECT d.id_detalle AS "idDetalle", d.id_producto AS "idProducto", d.descripcion, d.cantidad, d.costo_unitario AS costo, o.folio
         FROM orden_compra_detalle d JOIN orden_compra o ON o.id_orden = d.id_orden
        WHERE d.id_orden = $1 ORDER BY d.id_detalle`, [order.idOrden]);
    const folioOrden = String(lines[0].folio);

    // 2) Recepción completa: entrada de inventario, kárdex y asignación de backorders.
    const receipt = await this.abastecimiento.receiveIn(manager, order.idOrden, {
      requestId: randomUUID(),
      referencia: dto.folioFactura || undefined,
      notas: 'Recepción de compra directa',
      partidas: lines.map((line) => ({ idDetalle: line.idDetalle, cantidad: Number(line.cantidad) })),
    }, idUser);

    // 3) Factura de proveedor conciliada contra la orden y aprobada (póliza inventario/proveedores).
    const today = businessDate();
    const invoice = await this.facturas.createInvoiceIn(manager, {
      requestId: randomUUID(),
      idProveedor: dto.idProveedor,
      idOrden: order.idOrden,
      folio: dto.folioFactura?.trim() || `OC-${folioOrden}`,
      fechaEmision: today,
      fechaVencimiento: dto.esCredito ? addDays(today, COMPRA_CREDITO_DIAS) : today,
      moneda: 'MXN',
      tipoCambio: 1,
      subtotal: total,
      impuestos: 0,
      retenciones: 0,
      total,
      observaciones: dto.observaciones || undefined,
      partidas: lines.map((line) => ({ idOrdenDetalle: line.idDetalle, descripcion: line.descripcion, cantidad: Number(line.cantidad), costoUnitario: Number(line.costo), tasaIva: 0 })),
    }, idUser);
    if (invoice.estado !== 'Conciliada') {
      throw new ConflictException('La factura de la compra no concilió con su orden; revisa cantidades y costos');
    }
    await this.facturas.approveInvoiceIn(manager, invoice.idFacturaProveedor, idUser);

    // 4) Contado: pago inmediato por el total (descuenta caja o banco y genera la póliza de egreso).
    let idPago: number | null = null;
    if (!dto.esCredito) {
      const payment = await this.pagos.payIn(manager, invoice.idFacturaProveedor, {
        requestId: randomUUID(),
        fecha: today,
        monto: total,
        formaPago: dto.formaPago || 'Efectivo',
        notas: 'Pago de compra directa de contado',
      }, idUser);
      idPago = payment.idPago;
    }

    return {
      message: dto.esCredito
        ? 'Compra registrada. Inventario actualizado y factura por pagar en Cuentas por pagar.'
        : 'Compra registrada y pagada. Inventario actualizado.',
      idOrden: order.idOrden,
      folioOrden,
      idRecepcion: receipt.idRecepcion,
      idFacturaProveedor: invoice.idFacturaProveedor,
      idPago,
    };
  }

  async findAll(page = 1, limit = 10, term = '', sortBy = '', sortOrder = '', estado = '', desde = '', hasta = '') {
    return compraPage(this.dataSource, Object.assign(new CompraQueryDto(), { page: Math.max(1, page), limit: Math.min(100, Math.max(1, limit)), term, sortBy, sortOrder, estado, desde, hasta }));
  }
  exportCsv(query: CompraQueryDto) { return compraCsv(this.dataSource, query); }

  /** Detalle de una compra anterior (`compra`) o de una compra directa registrada como orden (`orden`). */
  async findDetalle(id: number, fuente: CompraFuente = 'compra') {
    if (fuente === 'orden') {
      return queryRows<Record<string, unknown>>(this.dataSource,
        `SELECT d.cantidad, d.costo_unitario, round(d.cantidad * d.costo_unitario, 2) AS importe,
                COALESCE(p."Descripcion", d.descripcion)::text AS descripcion, COALESCE(p."Codigo", 'ELIMINADO')::text AS codigo
           FROM orden_compra_detalle d JOIN orden_compra o ON o.id_orden = d.id_orden
           LEFT JOIN producto p ON p."IdProducto" = d.id_producto
          WHERE d.id_orden = $1 AND o.origen = 'Compra directa' ORDER BY d.id_detalle`, [id]);
    }
    return queryRows<Record<string, unknown>>(this.dataSource, 'SELECT * FROM fn_get_detalle_compra($1)', [id]);
  }
}
