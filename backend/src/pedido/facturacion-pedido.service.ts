import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { CreateVentaDto } from '../venta/venta.dto';
import { FacturarPedidoDto } from './pedido.dto';
import { InvoiceOrderRow, InvoiceLineRow } from './pedido.types';
@Injectable()
export class FacturacionPedidoService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async prepareInvoice(
    idPedido: number,
    dto: FacturarPedidoDto,
  ): Promise<CreateVentaDto> {
    const orders = await queryRows<InvoiceOrderRow>(
      this.dataSource,
      `SELECT pv.id_pedido,pv.estado,pv.id_cliente,
      c."RFC" AS rfc,c."RazonSocial" AS nombre,c."CodigoPostal" AS cp,c."IdFormaPago" AS "idFormaPago",
      c."IdMetodoDePago" AS "idMetodoPago",rf."Clave" AS regimen,uc."Clave" AS uso
      FROM pedido_venta pv JOIN cliente c ON c."IdCliente"=pv.id_cliente
      JOIN regimenfiscal rf ON rf."IdRegimenFiscal"=c."IdRegimenFiscal"
      LEFT JOIN usocfdi uc ON uc."IdUsoCFDI"=c."IdUsoCFDI" WHERE pv.id_pedido=$1`,
      [idPedido],
    );
    if (!orders.length) throw new NotFoundException('Pedido no encontrado');
    const order = orders[0];
    if (!['Surtido', 'Entregado'].includes(order.estado))
      throw new ConflictException(
        'El pedido debe estar surtido o entregado antes de facturarse',
      );
    const idFormaPago = dto.idFormaPago || Number(order.idFormaPago);
    const idMetodoPago = dto.idMetodoPago || Number(order.idMetodoPago);
    if (!idFormaPago || !idMetodoPago)
      throw new BadRequestException(
        'Configura forma y método de pago para el cliente o indícalos al facturar',
      );
    const rows = await queryRows<InvoiceLineRow>(
      this.dataSource,
      `SELECT pd.id_producto AS "idProducto",pd.cantidad_surtida AS cantidad,
      pd.valor_unitario AS "valorUnitario",pd.descripcion,p."Codigo" AS codigo,p."ObjetoImpuesto" AS objeto,
      p."TasaIVA" AS tasa,p."AplicaRetencionISR" AS retiene,cps."Clave" AS "claveProdServ",
      cu."Clave" AS "claveUnidad",cu."Descripcion" AS unidad
      FROM pedido_venta_detalle pd JOIN producto p ON p."IdProducto"=pd.id_producto
      LEFT JOIN claveproductooservicio cps ON cps."IdClaveProdOServ"=p."IdClaveProdOServ"
      LEFT JOIN claveunidad cu ON cu."IdClaveUnidad"=p."IdClaveUnidad"
      WHERE pd.id_pedido=$1 AND pd.cantidad_surtida>0 ORDER BY pd.id_detalle`,
      [idPedido],
    );
    if (!rows.length)
      throw new ConflictException(
        'El pedido no tiene mercancía surtida para facturar',
      );
    const moral = order.rfc.trim().length === 12;
    const money = (value: number) =>
      Math.round((value + Number.EPSILON) * 100) / 100;
    const conceptos = rows.map((row) => {
      const cantidad = Number(row.cantidad),
        valorUnitario = Number(row.valorUnitario);
      const importe = money(cantidad * valorUnitario),
        tasaIva = row.objeto === '02' ? Number(row.tasa) : 0;
      const tasaRetIsr = row.retiene && moral ? 0.0125 : 0;
      return {
        idProducto: Number(row.idProducto),
        codigo: row.codigo || '',
        descripcion: row.descripcion,
        unidadDescripcion: row.unidad || 'Pieza',
        claveProdServ: row.claveProdServ || '01010101',
        claveUnidad: row.claveUnidad || 'H87',
        objetoImpuesto: row.objeto || '01',
        cantidad,
        valorUnitario,
        importe,
        descuento: 0,
        baseIva: tasaIva ? importe : 0,
        tasaIva,
        importeIva: money(importe * tasaIva),
        baseRetIsr: tasaRetIsr ? importe : 0,
        tasaRetIsr,
        importeRetIsr: money(importe * tasaRetIsr),
      };
    });
    const subtotal = money(
      conceptos.reduce((sum, line) => sum + line.importe, 0),
    );
    const totalImpuestosTrasladados = money(
      conceptos.reduce((sum, line) => sum + line.importeIva, 0),
    );
    const totalImpuestosRetenidos = money(
      conceptos.reduce((sum, line) => sum + line.importeRetIsr, 0),
    );
    return {
      idPedido,
      requestId: dto.requestId,
      idCliente: Number(order.id_cliente),
      rfcReceptor: order.rfc,
      nombreReceptor: order.nombre,
      cpReceptor: order.cp,
      regimenReceptor: order.regimen,
      usoCfdi: order.uso || 'G03',
      idFormaPago,
      idMetodoPago,
      moneda: 'MXN',
      tipoCambio: 1,
      subtotal,
      totalImpuestosTrasladados,
      totalImpuestosRetenidos,
      total: money(
        subtotal + totalImpuestosTrasladados - totalImpuestosRetenidos,
      ),
      tipoComprobante: 'I',
      serie: 'F',
      conceptos,
    };
  }
}
