import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Gasto } from './entities/gasto.entity';
import { Saldo } from './entities/saldo.entity';
import { CreateGastoDto } from './finanzas.dto';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { join } from 'path';

// Fonts for pdfmake using standard fonts
const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

@Injectable()
export class FinanzasService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @InjectRepository(Gasto) private gastoRepository: Repository<Gasto>,
    @InjectRepository(Saldo) private saldoRepository: Repository<Saldo>,
  ) {}

  async crearGasto(createGastoDto: CreateGastoDto, idUsuario?: number) {
    const gasto = this.gastoRepository.create({
      ...createGastoDto,
      idUsuario: idUsuario || undefined,
    });
    // This simple save will trigger the DB trigger trg_gasto_saldos_y_landed_cost automatically
    // resolving cash logic and Landed Cost.
    await this.gastoRepository.save(gasto);
    return { message: 'Gasto registrado con éxito' };
  }

  async findAllGastos() {
    return this.gastoRepository.find({ order: { fecha: 'DESC' } });
  }

  async getSaldos() {
    return this.saldoRepository.find();
  }

  async generarCortePdf(): Promise<Buffer> {
    try {
      const saldos = await this.saldoRepository.find();
      const saldoActual =
        saldos.length > 0 ? saldos[0] : { cajaChica: 0, cuentaBanco: 0 };

      // Sum of expenses by category (weekly scope or all-time for this base implementation)
      // Usually would receive dates, but following requirements: Income summary, Expense summary, Final balances
      const gastosRaw = await this.dataSource.query(
        `SELECT categoria, SUM(monto) as total_gastado FROM gasto GROUP BY categoria ORDER BY total_gastado DESC`,
      );

      const ingresosRaw = await this.dataSource.query(
        `SELECT forma_pago, SUM(monto) as total_ingreso FROM pago GROUP BY forma_pago ORDER BY total_ingreso DESC`,
      );

      const printer = new PdfPrinter(fonts);

      const docDefinition: TDocumentDefinitions = {
        pageSize: 'LETTER',
        pageMargins: [40, 60, 40, 60],
        defaultStyle: { font: 'Helvetica' },
        content: [
          { text: 'Corte Financiero', style: 'header' },
          {
            text: 'Fecha de Generación: ' + new Date().toLocaleString(),
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
        pdfDoc.on('data', (chunk) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err) => reject(err));
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
