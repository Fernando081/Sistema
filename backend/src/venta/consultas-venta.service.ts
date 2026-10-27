import { FacturaQueryDto, facturaPage, facturaCsv } from './factura-query';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows, readSnapshot } from '../common/database/typed-query';
import { FiscalStatusRow } from './venta.types';
@Injectable()
export class ConsultasVentaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async getFacturasRelacionables(idCliente: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_factura, serie, folio, COALESCE(uuid, '00000000-0000-0000-0000-000000000000') as uuid, fecha_emision, total 
       FROM factura 
       WHERE id_cliente = $1 AND estatus::text <> 'Cancelada'
         AND COALESCE(tipo_comprobante, 'I') = 'I' AND serie <> 'G'
       ORDER BY fecha_emision DESC`,
      [idCliente],
    );
  }

  async getComisionesSemanales() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      'SELECT * FROM fn_get_comisiones_semanales()',
    );
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    term: string = '',
    tipo: string = '',
    sortBy = 'id', sortOrder = 'desc', estado = '', desde = '', hasta = '',
  ) {
    return readSnapshot(this.dataSource, async source => {
      const result = await facturaPage(source, Object.assign(new FacturaQueryDto(), { page: Math.max(1, page), limit: Math.min(100, Math.max(1, limit)), term, tipo, sortBy, sortOrder, estado, desde, hasta }));
      const { data: dataResult, total, totalPages } = result;
      const invoiceIds = dataResult
        .map((row) => Number(row['id_factura']))
        .filter(Number.isSafeInteger);
      const fiscalRows = invoiceIds.length
        ? await queryRows<FiscalStatusRow>(
            source,
            `SELECT id_factura,estado AS estado_fiscal FROM fiscal_documento WHERE id_factura=ANY($1::int[])`,
            [invoiceIds],
          )
        : [];
      const fiscalByInvoice = new Map(
        fiscalRows.map((row) => [Number(row.id_factura), row.estado_fiscal]),
      );
      const data = dataResult.map((row) => ({
        ...row,
        estado_fiscal:
          fiscalByInvoice.get(Number(row['id_factura'])) || 'Borrador',
      }));

      return {
        data,
        total,
        page: result.page,
        totalPages,
      };
    });
  }

  exportCsv(query: FacturaQueryDto) { return facturaCsv(this.dataSource, query); }

  async findDetalle(idFactura: number) {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      'SELECT * FROM fn_get_detalle_factura($1)',
      [idFactura],
    );
  }
}
