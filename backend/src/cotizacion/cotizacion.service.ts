// backend/src/cotizacion/cotizacion.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCotizacionDto, ConvertirCotizacionDto } from './cotizacion.dto';
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

  async findAll(page: number = 1, limit: number = 10, term: string = ''): Promise<{ data: any[], total: number, page: number, totalPages: number }> {
    const offset = (page - 1) * limit;

    console.log(`[CotizacionService] findAll args: page=${page}, limit=${limit}, term='${term}'`);

    const [totalResult, dataResult] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*) as count FROM fn_get_cotizaciones(NULL, NULL, $1)', [term]),
      this.dataSource.query(
        'SELECT * FROM fn_get_cotizaciones($1, $2, $3)',
        [limit, offset, term]
      ),
    ]);

    console.log(`[CotizacionService] Data query returned ${dataResult?.length} rows`);

    const total = parseInt(totalResult[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult,
      total,
      page,
      totalPages,
    };
  }

  async findOne(idCotizacion: number) {
    const cabecera = await this.dataSource.query(`SELECT * FROM cotizacion WHERE id_cotizacion = $1`, [idCotizacion]);
    if (!cabecera.length) throw new BadRequestException('Cotización no encontrada');
    const conceptos = await this.dataSource.query(`
      SELECT cc.id_concepto, cc.id_producto, cc.descripcion, cc.cantidad, cc.valor_unitario as precio, p."Existencia" as stock
      FROM conceptocotizacion cc
      JOIN producto p ON p."IdProducto" = cc.id_producto
      WHERE cc.id_cotizacion = $1
    `, [idCotizacion]);

    return { ...cabecera[0], conceptos };
  }

  async convertirParcial(
    idCotizacion: number,
    dto: ConvertirCotizacionDto,
    idFormaPago: number,
    idMetodoPago: number,
    idVendedor?: number,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Extraer cabecera para re-calcular impuestos de los confirmados
      const cRows = await queryRunner.query(`SELECT * FROM cotizacion WHERE id_cotizacion = $1`, [idCotizacion]);
      if (cRows.length === 0) throw new BadRequestException('Cotización no encontrada');
      const cot = cRows[0];
      if (cot.estatus === 'Convertida' || cot.estatus === 'Rechazada') {
        throw new BadRequestException('La cotización ya fue cerrada o convertida anteriormente.');
      }

      // 2. Procesar (Win/Loss Tracking)
      // RECHAZADOS
      if (dto.articulosRechazados && dto.articulosRechazados.length > 0) {
        for (const rec of dto.articulosRechazados) {
          await queryRunner.query(
            `UPDATE conceptocotizacion SET estatus = 'Rechazada', motivo_rechazo = $1 WHERE id_cotizacion = $2 AND id_concepto = $3`,
            [rec.motivoRechazo, idCotizacion, rec.idConcepto]
          );
        }
      }

      let nuevoSubtotal = 0;
      let nuevoIva = 0;
      let nuevoRetIsr = 0;
      const conceptosAceptadosJson: any[] = [];

      // ACEPTADOS
      if (dto.articulosAceptados && dto.articulosAceptados.length > 0) {
        for (const acep of dto.articulosAceptados) {
          await queryRunner.query(
            `UPDATE conceptocotizacion SET estatus = 'Comprada', precio_cierre = $1 WHERE id_cotizacion = $2 AND id_concepto = $3`,
            [acep.precioCierre, idCotizacion, acep.idConcepto]
          );

          // Extraer row original de DB para calcular nuevos parciales
          const row = await queryRunner.query(`
            SELECT cc.*, p."ObjetoImpuesto", p."TasaIVA", cps."Clave" as clave_prod_serv, cu."Clave" as clave_unidad, p."Existencia"
            FROM conceptocotizacion cc
            JOIN producto p ON cc.id_producto = p."IdProducto"
            LEFT JOIN claveproductooservicio cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
            LEFT JOIN claveunidad cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
            WHERE cc.id_concepto = $1
          `, [acep.idConcepto]);
          const c = row[0];

          if (c.Existencia < c.cantidad) {
            throw new BadRequestException(`Stock insuficiente para el producto "${c.descripcion}". Tiene ${c.Existencia} pero requiere ${c.cantidad}.`);
          }

          const importeLinea = Number(acep.precioCierre) * Number(c.cantidad);
          nuevoSubtotal += importeLinea;

          let importeIvaLinea = 0;
          if (c.TasaIVA && Number(c.TasaIVA) > 0) {
            importeIvaLinea = importeLinea * Number(c.TasaIVA);
            nuevoIva += importeIvaLinea;
          }

          let importeRetIsrLinea = 0;
          if (Number(c.importe_ret_isr) > 0) {
            importeRetIsrLinea = importeLinea * 0.0125;
            nuevoRetIsr += importeRetIsrLinea;
          }

          conceptosAceptadosJson.push({
            idProducto: c.id_producto,
            cantidad: c.cantidad,
            valorUnitario: acep.precioCierre,
            importe: importeLinea,
            descuento: 0,
            claveProdServ: c.clave_prod_serv,
            claveUnidad: c.clave_unidad,
            objetoImpuesto: c.ObjetoImpuesto,
            descripcion: c.descripcion,
            unidadDescripcion: c.unidad,
            baseIva: importeLinea,
            tasaIva: c.TasaIVA,
            importeIva: importeIvaLinea,
            baseRetIsr: importeLinea,
            tasaRetIsr: importeRetIsrLinea > 0 ? 0.0125 : 0,
            importeRetIsr: importeRetIsrLinea
          });
        }
      }

      const nuevoTotal = nuevoSubtotal + nuevoIva - nuevoRetIsr;
      let idFactura = null;

      if (conceptosAceptadosJson.length > 0) {
        // Lanzamos el fn_crear_venta interno con los nuevos recalculos
        const v = await queryRunner.query(
          `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) as id_factura`,
          [
            cot.id_cliente,
            cot.rfc_receptor,
            cot.nombre_receptor,
            '00000', '616', 'G03', idFormaPago, idMetodoPago, 'MXN', 1,
            nuevoSubtotal,
            nuevoIva,
            nuevoRetIsr,
            nuevoTotal,
            'Venta parcial de Cotización C-' + cot.folio,
            JSON.stringify(conceptosAceptadosJson),
            idVendedor || null
          ]
        );
        idFactura = v[0].id_factura;
        
        // Win/Loss Constraint CRM Binding
        await queryRunner.query(`UPDATE factura SET id_cotizacion = $1 WHERE id_factura = $2`, [idCotizacion, idFactura]);
      }

      await queryRunner.query(`UPDATE cotizacion SET estatus = 'Convertida' WHERE id_cotizacion = $1`, [idCotizacion]);
      await queryRunner.commitTransaction();

      return {
        message: 'Cotización procesada exitosamente (Win/Loss Tracking completo)',
        idFactura
      };

    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(error.message || 'Error grave al transformar cotización.');
    } finally {
      await queryRunner.release();
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
