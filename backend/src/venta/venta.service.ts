// backend/src/venta/venta.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateVentaDto } from './venta.dto';
import * as nodemailer from 'nodemailer';
// IMPORTANTE: Quitamos la importación de TDocumentDefinitions para evitar conflictos de tipos estrictos
// import { TDocumentDefinitions } from 'pdfmake/interfaces'; 

// Usamos require para evitar problemas de compatibilidad
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake');

@Injectable()
export class VentaService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // --- GENERAR PDF FACTURA ---
  async generarTicketPdf(idFactura: number): Promise<Buffer> {
    const resultado = await this.dataSource.query('SELECT fn_get_datos_ticket($1) as datos', [idFactura]);
    const datos = resultado[0].datos;

    const totalConLetra = `(SON: ${datos.total} ${datos.moneda} 00/100 M.N.)`;

    // Fuentes estándar
    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };

    // CORRECCIÓN CLAVE: Tipamos como 'any' para evitar conflictos estrictos de TS con la librería vieja
    const docDefinition: any = {
      pageSize: 'LETTER',
      pageMargins: [40, 40, 40, 60],
      content: [
        // --- ENCABEZADO ---
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: 'Refacciones y Tractorepuestos', style: 'empresa' },
                { text: 'RFC: OECR8905308K8', style: 'emisor' },
                { text: 'Régimen Fiscal: 626 - Simplificado de Confianza', style: 'emisor' },
                { text: 'Lugar de Expedición: 89605', style: 'emisor' },
                { text: 'Tampico, Tamaulipas', style: 'emisor' }
              ]
            },
            {
              width: 200,
              stack: [
                { text: 'FACTURA', style: 'tipoComprobante', alignment: 'center' },
                {
                  table: {
                    widths: [60, '*'],
                    body: [
                      [{ text: 'Folio:', bold: true }, datos.folio],
                      [{ text: 'Fecha:', bold: true }, datos.fecha],
                      [{ text: 'Tipo:', bold: true }, datos.tipo_comprobante]
                    ]
                  },
                  layout: 'noBorders'
                },
                { text: 'Folio Fiscal (UUID):', bold: true, fontSize: 8, margin: [0, 5, 0, 0] },
                { text: '00000000-0000-0000-0000-000000000000', fontSize: 7, color: '#555' }
              ]
            }
          ]
        },

        { text: '', margin: [0, 10] },

        // --- CLIENTE ---
        {
          table: {
            widths: ['*'],
            body: [
              [{ text: 'INFORMACIÓN DEL CLIENTE', fillColor: '#e5e7eb', bold: true, fontSize: 9 }],
              [
                {
                  stack: [
                    { text: [{ text: 'Receptor: ', bold: true }, datos.cliente.nombre] },
                    { text: [{ text: 'RFC: ', bold: true }, datos.cliente.rfc] },
                    { text: [{ text: 'C.P.: ', bold: true }, datos.cliente.cp] },
                    { text: [{ text: 'Régimen: ', bold: true }, datos.cliente.regimen] },
                    { text: [{ text: 'Uso CFDI: ', bold: true }, datos.uso_cfdi] },
                  ],
                  margin: [5, 5],
                  fontSize: 9
                }
              ]
            ]
          },
          layout: 'lightHorizontalLines'
        },

        { text: '', margin: [0, 15] },

        // --- CONCEPTOS ---
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto'],
            body: [
              [
                { text: 'Cant', style: 'tableHeader' },
                { text: 'Unidad', style: 'tableHeader' },
                { text: 'Clave SAT', style: 'tableHeader' },
                { text: 'Descripción', style: 'tableHeader' },
                { text: 'P. Unitario', style: 'tableHeader' },
                { text: 'Importe', style: 'tableHeader' }
              ],
              ...datos.conceptos.map((p: any) => [
                { text: p.cantidad, alignment: 'center', fontSize: 9 },
                { text: p.clave_unidad, alignment: 'center', fontSize: 8 },
                { text: p.clave_prod_serv, alignment: 'center', fontSize: 8 },
                { text: p.descripcion, fontSize: 9 },
                { text: `$${Number(p.precio).toFixed(2)}`, alignment: 'right', fontSize: 9 },
                { text: `$${Number(p.importe).toFixed(2)}`, alignment: 'right', fontSize: 9 }
              ])
            ]
          },
          layout: {
            fillColor: function (rowIndex: number) {
              return (rowIndex === 0) ? '#1e3a8a' : null;
            },
            hLineWidth: function (i: number, node: any) {
              return (i === 0 || i === node.table.body.length) ? 0 : 1;
            },
            vLineWidth: () => 0,
            hLineColor: () => '#e5e7eb'
          }
        },

        { text: '', margin: [0, 10] },

        // --- TOTALES ---
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: 'Importe con letra:', bold: true, fontSize: 8 },
                { text: totalConLetra, fontSize: 8, margin: [0, 0, 0, 5] },
                { text: [{ text: 'Forma de Pago: ', bold: true }, datos.forma_pago], fontSize: 8 },
                { text: [{ text: 'Método de Pago: ', bold: true }, datos.metodo_pago], fontSize: 8 },
                { text: [{ text: 'Moneda: ', bold: true }, datos.moneda], fontSize: 8 },
              ]
            },
            {
              width: 180,
              table: {
                widths: ['*', 'auto'],
                body: [
                  [{ text: 'Subtotal:', alignment: 'right', bold: true }, { text: `$${Number(datos.subtotal).toFixed(2)}`, alignment: 'right' }],
                  [{ text: 'IVA Trasladado:', alignment: 'right', bold: true }, { text: `$${Number(datos.iva).toFixed(2)}`, alignment: 'right' }],
                  ...(datos.retenciones > 0 ? [
                    [{ text: 'Retenciones:', alignment: 'right', color: 'red', bold: true }, { text: `-$${Number(datos.retenciones).toFixed(2)}`, alignment: 'right', color: 'red' }]
                  ] : []),
                  [{ text: 'TOTAL:', alignment: 'right', bold: true, fontSize: 11, fillColor: '#f3f4f6' }, { text: `$${Number(datos.total).toFixed(2)}`, alignment: 'right', bold: true, fontSize: 11, fillColor: '#f3f4f6' }]
                ]
              },
              layout: 'noBorders'
            }
          ]
        },

        { text: '', margin: [0, 20] },

        // --- SELLOS ---
        { text: 'Sello Digital del CFDI:', fontSize: 7, bold: true, color: '#333' },
        { text: 'kJS8s7d89s7d98s7d98s7d98s7d...', fontSize: 6, color: '#555', margin: [0, 0, 0, 5] },
        
        { text: 'Sello del SAT:', fontSize: 7, bold: true, color: '#333' },
        { text: 'O9s8d09s8d09s8d09s8d09s8d0...', fontSize: 6, color: '#555' },
        
        { text: 'Este documento es una representación impresa de un CFDI 4.0', alignment: 'center', margin: [0, 20], fontSize: 8, bold: true }
      ],
      styles: {
        empresa: { fontSize: 14, bold: true, color: '#1e3a8a' },
        emisor: { fontSize: 9, color: '#444' },
        tipoComprobante: { fontSize: 10, bold: true, margin: [0, 0, 0, 5] },
        tableHeader: { fontSize: 9, bold: true, color: 'white' }
      },
      defaultStyle: {
        fontSize: 9,
        font: 'Helvetica'
      }
    };

    const printer = new PdfPrinter(fonts);
    const doc = printer.createPdfKitDocument(docDefinition);
    
    return new Promise((resolve, reject) => {
      const chunks: any[] = [];
      doc.on('data', (chunk: any) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: any) => reject(err));
      doc.end();
    });
  }

  // --- CREAR VENTA ---
  async create(createVentaDto: CreateVentaDto) {
    const conceptosJson = JSON.stringify(createVentaDto.conceptos);
    const result = await this.dataSource.query(
      `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) as id_factura`,
      [
        createVentaDto.idCliente,
        createVentaDto.rfcReceptor,
        createVentaDto.nombreReceptor,
        createVentaDto.cpReceptor,
        createVentaDto.regimenReceptor,
        createVentaDto.usoCfdi,
        createVentaDto.idFormaPago,
        createVentaDto.idMetodoPago,
        createVentaDto.moneda,
        createVentaDto.tipoCambio,
        createVentaDto.subtotal,
        createVentaDto.totalImpuestosTrasladados,
        createVentaDto.totalImpuestosRetenidos,
        createVentaDto.total,
        '', 
        conceptosJson
      ]
    );
    return { message: 'Venta registrada con éxito', idFactura: result[0].id_factura };
  }

  async findAll() {
    return this.dataSource.query('SELECT * FROM fn_get_facturas()');
  }

  async findDetalle(idFactura: number) {
    return this.dataSource.query('SELECT * FROM fn_get_detalle_factura($1)', [idFactura]);
  }

  async enviarFacturaPorCorreo(idFactura: number) {
    // 1. PREGUNTAR A LA BASE DE DATOS QUÉ HACER
    // La BD valida el email, construye el asunto y el mensaje.
    // Si el cliente no tiene email, la BD lanza error y NestJS lo atrapa.
    const res = await this.dataSource.query('SELECT * FROM fn_preparar_envio_correo($1)', [idFactura]);
    
    if (!res || res.length === 0) {
      throw new Error('No se pudieron obtener los datos de envío.');
    }

    const datosEnvio = res[0]; // { destinatario, asunto, cuerpo_mensaje, nombre_archivo }

    // 2. Generar el PDF (Esto sí lo hace Node porque requiere librerías gráficas)
    const pdfBuffer = await this.generarTicketPdf(idFactura);

    // 3. Configurar el transportador (Tu Gmail)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS
      }
    });

    // 4. Enviar usando los datos EXACTOS que dio la BD
    await transporter.sendMail({
      from: '"Refacciones y Tractorepuestos" <dusk081.eth@gmail.com>',
      to: datosEnvio.destinatario,
      subject: datosEnvio.asunto,
      text: datosEnvio.cuerpo_mensaje, // El texto viene de SQL
      attachments: [
        {
          filename: datosEnvio.nombre_archivo,
          content: pdfBuffer
        }
      ]
    });

    return { message: `Correo enviado a ${datosEnvio.destinatario}` };
  }
}