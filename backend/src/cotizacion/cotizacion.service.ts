// backend/src/cotizacion/cotizacion.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCotizacionDto } from './cotizacion.dto';
import { TDocumentDefinitions } from 'pdfmake/interfaces';

const PdfPrinter = require('pdfmake');

@Injectable()
export class CotizacionService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async create(dto: CreateCotizacionDto) {
    const json = JSON.stringify(dto.conceptos);
    const result = await this.dataSource.query(
      `SELECT fn_crear_cotizacion($1, $2, $3, $4, $5, $6, $7, $8) as id`,
      [
        dto.idCliente,
        dto.nombreReceptor,
        dto.rfcReceptor,
        dto.subtotal,
        dto.totalImpuestos,
        dto.totalRetenciones,
        dto.total,
        json,
      ],
    );
    return { message: 'Cotización creada', id: result[0].id };
  }

  async findAll() {
    return this.dataSource.query('SELECT * FROM fn_get_cotizaciones()');
  }

  async convertirAVenta(id: number) {
    try {
      const result = await this.dataSource.query(
        'SELECT fn_convertir_cotizacion_a_venta($1) as id_factura',
        [id],
      );
      return {
        message: 'Cotización convertida en Venta exitosamente',
        idFactura: result[0].id_factura,
      };
    } catch (error) {
      // Si el error viene de nuestro RAISE EXCEPTION en SQL
      if (error.message && error.message.includes('Stock insuficiente')) {
        // Devolvemos un error 400 limpio con el mensaje exacto de la BD
        throw new BadRequestException(error.message);
      }

      // Si es otro error, lo lanzamos normal (será 500)
      throw error;
    }
  }

  // --- GENERAR PDF COTIZACIÓN ---
  async generarPdf(id: number): Promise<Buffer> {
    const res = await this.dataSource.query(
      'SELECT fn_get_datos_cotizacion_pdf($1) as datos',
      [id],
    );
    const datos = res[0].datos;

    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition: TDocumentDefinitions = {
      pageSize: 'LETTER', // Tamaño carta para cotizaciones
      pageMargins: [40, 40, 40, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 10 },
      content: [
        {
          text: 'COTIZACIÓN',
          style: 'header',
          alignment: 'right',
          color: '#555',
        },
        { text: `Folio: ${datos.folio}`, alignment: 'right', bold: true },
        { text: `Fecha: ${datos.fecha}`, alignment: 'right' },
        {
          text: `Vence: ${datos.vencimiento}`,
          alignment: 'right',
          color: 'red',
          fontSize: 9,
        },

        { text: 'Refacciones y Tractorepuestos', style: 'empresa' },
        { text: 'Miramar, Tamaulipas', margin: [0, 0, 0, 20] },

        { text: 'ATENCIÓN A:', bold: true },
        { text: datos.cliente.nombre, fontSize: 12 },
        { text: `RFC: ${datos.cliente.rfc}`, margin: [0, 0, 0, 20] },

        // Tabla de Conceptos
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto', 'auto'],
            body: [
              [
                { text: 'CANT', style: 'tableHeader' },
                { text: 'DESCRIPCIÓN', style: 'tableHeader' },
                { text: 'P. UNIT', style: 'tableHeader' },
                { text: 'IMPORTE', style: 'tableHeader' },
              ],
              ...datos.conceptos.map((p: any) => [
                p.cantidad,
                p.descripcion,
                `$${Number(p.precio).toFixed(2)}`,
                `$${Number(p.importe).toFixed(2)}`,
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
        },

        // Totales
        {
          margin: [0, 20, 0, 0],
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                { text: 'Subtotal:', alignment: 'right' },
                {
                  text: `$${Number(datos.subtotal).toFixed(2)}`,
                  alignment: 'right',
                },
              ],
              [
                { text: 'IVA:', alignment: 'right' },
                {
                  text: `$${Number(datos.iva).toFixed(2)}`,
                  alignment: 'right',
                },
              ],
              [
                { text: 'Retenciones:', alignment: 'right' },
                {
                  text: `-$${Number(datos.retenciones).toFixed(2)}`,
                  alignment: 'right',
                },
              ],
              [
                {
                  text: 'TOTAL:',
                  alignment: 'right',
                  bold: true,
                  fontSize: 14,
                },
                {
                  text: `$${Number(datos.total).toFixed(2)}`,
                  alignment: 'right',
                  bold: true,
                  fontSize: 14,
                },
              ],
            ],
          },
          layout: 'noBorders',
        },
      ],
      styles: {
        header: { fontSize: 22, bold: true },
        empresa: { fontSize: 16, bold: true, color: '#005fcc' },
        tableHeader: {
          bold: true,
          fontSize: 10,
          color: 'black',
          fillColor: '#eeeeee',
        },
      },
    };

    const doc = printer.createPdfKitDocument(docDefinition);
    return new Promise((resolve, reject) => {
      const chunks: any[] = [];
      doc.on('data', (chunk: any) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: any) => reject(err));
      doc.end();
    });
  }
}
