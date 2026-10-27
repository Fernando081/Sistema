import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import {
  FolioRow,
  FacturaIdRow,
  TicketResumenRow,
  TicketGlobalRow,
  ClienteGenericoRow,
} from './venta.types';
@Injectable()
export class FacturaGlobalService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async getTicketsPendientesGlobal(fechaInicio: string, fechaFin: string) {
    if (fechaInicio > fechaFin)
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la final',
      );
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
    const tickets = await queryRows<TicketResumenRow>(this.dataSource, query, [
      fechaInicio,
      fechaFin,
    ]);

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
      },
    };
  }

  async generarFacturaGlobal(
    fechaInicio: string,
    fechaFin: string,
    idsTickets: number[],
    idVendedor?: number,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(
        "SELECT set_config('app.current_user_id', $1, true)",
        [idVendedor?.toString() || ''],
      );
      if (!idsTickets || idsTickets.length === 0) {
        throw new BadRequestException(
          'Debe proporcionar al menos un ticket para agrupar.',
        );
      }
      if (fechaInicio > fechaFin)
        throw new BadRequestException(
          'La fecha inicial no puede ser posterior a la final',
        );
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)
      ) {
        throw new BadRequestException('El rango de fechas no es válido');
      }
      const uniqueIds = [...new Set(idsTickets.map(Number))];
      if (
        uniqueIds.length !== idsTickets.length ||
        uniqueIds.some((id) => !Number.isInteger(id) || id < 1)
      ) {
        throw new BadRequestException(
          'La selección contiene tickets inválidos o repetidos',
        );
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
      const tickets = await queryRows<TicketGlobalRow>(
        queryRunner,
        ticketsQuery,
        [uniqueIds, fechaInicio, fechaFin],
      );

      if (tickets.length !== uniqueIds.length) {
        throw new BadRequestException(
          'Uno o más tickets no pertenecen al periodo, ya fueron agrupados o no son elegibles',
        );
      }

      const clientQuery = `SELECT "IdCliente", "RFC", "RazonSocial", "CodigoPostal", "IdRegimenFiscal", "IdUsoCFDI", "IdFormaPago", "IdMetodoDePago" FROM cliente WHERE "RFC" = 'XAXX010101000' LIMIT 1`;
      const clientResult = await queryRows<ClienteGenericoRow>(
        queryRunner,
        clientQuery,
      );
      if (clientResult.length === 0) {
        throw new Error(
          'El cliente genérico para PUBLICO EN GENERAL no existe en la base de datos.',
        );
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
          baseRetIsr:
            Number(t.total_impuestos_retenidos) > 0 ? ticketSubtotal : 0,
          tasaRetIsr:
            ticketSubtotal > 0
              ? Number(t.total_impuestos_retenidos || 0) / ticketSubtotal
              : 0,
          importeRetIsr: Number(t.total_impuestos_retenidos || 0),
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
      const folioResult = await queryRows<FolioRow>(
        queryRunner,
        'SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1',
        [serie],
      );
      const folio = Number(folioResult[0].next_folio);

      const conceptosJson = JSON.stringify(conceptos);
      const result = await queryRows<FacturaIdRow>(
        queryRunner,
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
          'I',
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
        [idGlobalInvoice, tickets.map((ticket) => Number(ticket.id_factura))],
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
