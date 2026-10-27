import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Saldo } from './entities/saldo.entity';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { queryRows } from '../common/database/typed-query';

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};
interface GastoResumenRow {
  categoria: string;
  total_gastado: string | number;
}
interface PagoProveedorResumenRow {
  forma_pago: string;
  total_pagado: string | number;
}
interface IngresoResumenRow {
  forma_pago: string;
  total_ingreso: string | number;
}

@Injectable()
export class CorteFinancieroService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Saldo)
    private readonly saldoRepository: Repository<Saldo>,
  ) {}

  async generarCortePdf(
    fechaInicio?: string,
    fechaFin?: string,
  ): Promise<Buffer> {
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la final',
      );
    }
    try {
      const start = fechaInicio || new Date().toISOString().slice(0, 10);
      const end = fechaFin || start;
      const saldos = await this.saldoRepository.find();
      const saldoActual =
        saldos.length > 0 ? saldos[0] : { cajaChica: 0, cuentaBanco: 0 };

      // Sum of expenses by category (weekly scope or all-time for this base implementation)
      // Usually would receive dates, but following requirements: Income summary, Expense summary, Final balances
      const gastosRaw = await queryRows<GastoResumenRow>(
        this.dataSource,
        `SELECT categoria, SUM(monto) as total_gastado
           FROM gasto
          WHERE fecha::date BETWEEN $1::date AND $2::date
            AND NOT anulado
          GROUP BY categoria ORDER BY total_gastado DESC`,
        [start, end],
      );

      const proveedoresRaw = await queryRows<PagoProveedorResumenRow>(
        this.dataSource,
        `
        SELECT forma_pago, SUM(monto) AS total_pagado FROM pago_proveedor
         WHERE fecha_pago::date BETWEEN $1::date AND $2::date GROUP BY forma_pago`,
        [start, end],
      );

      const ingresosRaw = await queryRows<IngresoResumenRow>(
        this.dataSource,
        `SELECT p.forma_pago, SUM(p.monto) as total_ingreso
           FROM pago p
           JOIN factura f ON f.id_factura = p.id_factura
          WHERE p.fecha_pago::date BETWEEN $1::date AND $2::date
            AND f.estatus::text <> 'Cancelada'
          GROUP BY p.forma_pago ORDER BY total_ingreso DESC`,
        [start, end],
      );

      const printer = new PdfPrinter(fonts);

      const docDefinition: TDocumentDefinitions = {
        pageSize: 'LETTER',
        pageMargins: [40, 60, 40, 60],
        defaultStyle: { font: 'Helvetica' },
        content: [
          { text: 'Corte Financiero', style: 'header' },
          {
            text: `Periodo: ${start} a ${end} · Generado: ${new Date().toLocaleString('es-MX')}`,
            margin: [0, 0, 0, 20],
          },

          { text: 'Saldos Finales Esperados', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', '*'],
              body: [
                [
                  { text: 'Caja Chica (Efectivo)', style: 'tableHeader' },
                  {
                    text: 'Cuenta Banco (Transferencias)',
                    style: 'tableHeader',
                  },
                ],
                [
                  `$${Number(saldoActual.cajaChica).toFixed(2)}`,
                  `$${Number(saldoActual.cuentaBanco).toFixed(2)}`,
                ],
              ],
            },
            margin: [0, 0, 0, 20],
          },

          { text: 'Resumen de Ingresos', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Forma de Pago', style: 'tableHeader' },
                  { text: 'Total Ingresado', style: 'tableHeader' },
                ],
                ...ingresosRaw.map((i) => [
                  i.forma_pago,
                  `$${Number(i.total_ingreso).toFixed(2)}`,
                ]),
              ],
            },
            margin: [0, 0, 0, 20],
          },

          { text: 'Resumen de Gastos por Categoría', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Categoría', style: 'tableHeader' },
                  { text: 'Total Gastado', style: 'tableHeader' },
                ],
                ...gastosRaw.map((g) => [
                  g.categoria,
                  `$${Number(g.total_gastado).toFixed(2)}`,
                ]),
              ],
            },
          },
          { text: 'Pagos a Proveedores', style: 'subheader' },
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Forma de Pago', style: 'tableHeader' },
                  { text: 'Total Pagado', style: 'tableHeader' },
                ],
                ...proveedoresRaw.map((p) => [
                  p.forma_pago,
                  `$${Number(p.total_pagado).toFixed(2)}`,
                ]),
              ],
            },
          },
        ],
        styles: {
          header: {
            fontSize: 18,
            bold: true,
            alignment: 'center',
            margin: [0, 0, 0, 10],
          },
          subheader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
          tableHeader: { bold: true, fontSize: 12, color: 'black' },
        },
      };

      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      });
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Error al generar el PDF de finanzas',
      );
    }
  }
}
