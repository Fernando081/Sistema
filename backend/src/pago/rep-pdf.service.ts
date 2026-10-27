import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { queryRows } from '../common/database/typed-query';
import { RepInfoRow, RepFacturaRow, RepFiscalPdfRow } from './pago.types';
@Injectable()
export class RepPdfService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async generarRepPdf(idRep: number): Promise<Buffer> {
    // 1. Obtener la cabecera del REP y Cliente
    const repResult = await queryRows<RepInfoRow>(
      this.dataSource,
      `SELECT r.*, c."RazonSocial" as cliente_nombre, c."RFC" as cliente_rfc, c."CodigoPostal" as cliente_cp
       FROM rep r
       JOIN cliente c ON r.id_cliente = c."IdCliente"
       WHERE r.id_rep = $1`,
      [idRep],
    );

    if (!repResult || repResult.length === 0) {
      throw new NotFoundException(
        'Recibo Electrónico de Pago (REP) no encontrado',
      );
    }

    const info = repResult[0];
    const fiscalRows = await queryRows<RepFiscalPdfRow>(
      this.dataSource,
      'SELECT ambiente,estado,fecha_timbrado FROM fiscal_documento WHERE id_rep=$1',
      [idRep],
    );
    const fiscal = fiscalRows[0];
    const fiscalBanner =
      fiscal?.estado === 'Timbrado' && fiscal.ambiente === 'production'
        ? null
        : fiscal?.ambiente === 'sandbox'
          ? 'DOCUMENTO DE PAC SANDBOX — SIN VALIDEZ FISCAL'
          : 'BORRADOR DE PRUEBA — SIN TIMBRAR Y SIN VALIDEZ FISCAL';
    const issuerName =
      process.env.FISCAL_ISSUER_NAME || 'EMISOR NO CONFIGURADO';
    const issuerRfc = process.env.FISCAL_ISSUER_RFC || 'N/A';
    const issuerRegime = process.env.FISCAL_ISSUER_TAX_REGIME || 'N/A';

    // 2. Obtener el desglose de facturas (Documentos Relacionados)
    const facturas = await queryRows<RepFacturaRow>(
      this.dataSource,
      `SELECT rf.*, f.serie, f.folio, f.uuid as uuid_factura,
              f.total AS total_factura, f.subtotal AS subtotal_factura,
              f.total_impuestos_trasladados AS iva_factura,
              f.total_impuestos_retenidos AS isr_factura
       FROM rep_factura rf
       JOIN factura f ON rf.id_factura = f.id_factura
       WHERE rf.id_rep = $1 ORDER BY rf.id_rep_factura ASC`,
      [idRep],
    );

    // 3. Configurar pdfmake
    const fonts = {
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };
    const printer = new PdfPrinter(fonts);

    // Helpers
    const fmtMoney = (value: unknown) => `$${Number(value || 0).toFixed(2)}`;
    const asDate = (value: string | number | Date) => new Date(value);
    const fmtDate = (date: string | number | Date) =>
      asDate(date).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    const fmtDateTime = (date: string | number | Date) =>
      asDate(date).toLocaleString('es-MX');
    const FILL = '#E5E5E5';

    const formasPagoCat: Record<string, string> = {
      Efectivo: '01',
      Transferencia: '03',
      Cheque: '02',
      'Tarjeta de Credito': '04',
    };
    const fpClave = formasPagoCat[info.forma_pago] || '99';

    // Tabla Documentos Relacionados
    const relDocsBody: Record<string, unknown>[][] = [
      [
        { text: 'Id Documento (UUID)', style: 'th' },
        { text: 'Serie/Folio', style: 'th' },
        { text: 'Moneda', style: 'th' },
        { text: 'Método', style: 'th' },
        { text: 'Parcialidad', style: 'th' },
        { text: 'Saldo Anterior', style: 'th' },
        { text: 'Imp. Pagado', style: 'th' },
        { text: 'Saldo Insoluto', style: 'th' },
      ],
    ];
    for (const f of facturas) {
      relDocsBody.push([
        { text: f.uuid_factura || 'N/A', fontSize: 6 },
        { text: `${f.serie || ''}-${f.folio}`, fontSize: 7 },
        { text: info.moneda, fontSize: 7 },
        { text: 'PPD', fontSize: 7 },
        { text: String(f.num_parcialidad), fontSize: 7, alignment: 'center' },
        { text: fmtMoney(f.saldo_anterior), fontSize: 7, alignment: 'right' },
        { text: fmtMoney(f.monto_pagado), fontSize: 7, alignment: 'right' },
        { text: fmtMoney(f.saldo_insoluto), fontSize: 7, alignment: 'right' },
      ]);
    }

    // Tabla Impuestos por Documento (Proporcionales al pago)
    const taxBody: Record<string, unknown>[][] = [
      [
        { text: 'Folio', style: 'th' },
        { text: 'Base', style: 'th' },
        { text: 'IVA 16% Trasladado', style: 'th' },
        { text: 'ISR Retenido (Moral)', style: 'th' },
      ],
    ];

    for (const f of facturas) {
      const montoPagado = Number(f.monto_pagado) || 0;
      const totalFactura = Number(f.total_factura) || 0;
      const proportion = totalFactura > 0 ? montoPagado / totalFactura : 0;
      const base = (Number(f.subtotal_factura) || 0) * proportion;
      const iva = (Number(f.iva_factura) || 0) * proportion;
      const isr = (Number(f.isr_factura) || 0) * proportion;

      taxBody.push([
        { text: `${f.serie || ''}-${f.folio}`, fontSize: 7 },
        { text: fmtMoney(base), fontSize: 7, alignment: 'right' },
        { text: fmtMoney(iva), fontSize: 7, alignment: 'right' },
        { text: fmtMoney(isr), fontSize: 7, alignment: 'right' },
      ]);
    }

    // 4. Premium docDefinition CFDI 4.0
    const docDefinition = {
      pageSize: 'LETTER' as const,
      pageMargins: [30, 30, 30, 60] as [number, number, number, number],
      footer: () => ({
        text: fiscalBanner || 'REPRESENTACIÓN IMPRESA DE UN CFDI',
        alignment: 'center',
        fontSize: 7,
        color: '#888',
        margin: [0, 20, 0, 0],
      }),
      content: [
        ...(fiscalBanner
          ? [
              {
                text: fiscalBanner,
                color: '#b91c1c',
                bold: true,
                alignment: 'center',
                margin: [0, 0, 0, 10],
              },
            ]
          : []),
        // ═══ ENCABEZADO 3 COLUMNAS ═══
        {
          columns: [
            {
              width: 100,
              stack: [
                {
                  text: '[LOGO]',
                  fontSize: 10,
                  color: '#AAA',
                  alignment: 'center',
                  margin: [0, 15, 0, 0],
                },
              ],
            },
            {
              width: '*',
              stack: [
                {
                  text: issuerName,
                  fontSize: 12,
                  bold: true,
                  alignment: 'center',
                  color: '#1a1a1a',
                },
                {
                  text: 'REFACCIONES Y TRACTOREPUESTOS TAMPICO',
                  fontSize: 9,
                  bold: true,
                  alignment: 'center',
                  color: '#1a1a1a',
                },
                {
                  text: `RFC: ${issuerRfc}`,
                  fontSize: 8,
                  alignment: 'center',
                  margin: [0, 2, 0, 0],
                },
                {
                  text: `Régimen Fiscal: ${issuerRegime}`,
                  fontSize: 7,
                  alignment: 'center',
                  color: '#555',
                },
              ],
            },
            {
              width: 200,
              table: {
                widths: ['*'],
                body: [
                  [
                    {
                      text: 'Tipo de comprobante: P - CFDI de Pago',
                      style: 'fBox',
                    },
                  ],
                  [
                    {
                      text: `Comprobante No. REP-${info.id_rep}`,
                      style: 'fBox',
                    },
                  ],
                  [
                    {
                      text: `Folio Fiscal:\n${info.uuid || 'Pendiente de timbrado'}`,
                      style: 'fBox',
                      fontSize: 6,
                    },
                  ],
                  [
                    {
                      text: `No. Serie CSD Emisor: ${info.no_certificado_emisor || 'N/A'}`,
                      style: 'fBox',
                    },
                  ],
                  [
                    {
                      text: `No. Serie CSD SAT: ${info.no_serie_certificado || 'N/A'}`,
                      style: 'fBox',
                    },
                  ],
                  [
                    {
                      text: `Fecha certificación: ${fiscal?.fecha_timbrado ? fmtDateTime(fiscal.fecha_timbrado) : 'Pendiente'}`,
                      style: 'fBox',
                    },
                  ],
                ],
              },
              layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' },
            },
          ],
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 0,
              x2: 552,
              y2: 0,
              lineWidth: 1,
              lineColor: '#999',
            },
          ],
          margin: [0, 0, 0, 8] as [number, number, number, number],
        },

        // ═══ DATOS DEL RECEPTOR ═══
        {
          table: {
            widths: ['*'],
            body: [
              [{ text: 'DATOS DEL RECEPTOR / CLIENTE', style: 'secTitle' }],
              [
                {
                  columns: [
                    {
                      stack: [
                        {
                          text: [
                            { text: 'Nombre: ', bold: true },
                            info.cliente_nombre,
                          ],
                          fontSize: 8,
                        },
                        {
                          text: [
                            { text: 'R.F.C.: ', bold: true },
                            info.cliente_rfc,
                          ],
                          fontSize: 8,
                          margin: [0, 2, 0, 0] as [
                            number,
                            number,
                            number,
                            number,
                          ],
                        },
                      ],
                      width: '*',
                    },
                    {
                      stack: [
                        {
                          text: [
                            { text: 'Uso de CFDI: ', bold: true },
                            'CP01 - Pagos',
                          ],
                          fontSize: 8,
                        },
                        {
                          text: [
                            { text: 'Domicilio Fiscal: ', bold: true },
                            info.cliente_cp || '00000',
                          ],
                          fontSize: 8,
                          margin: [0, 2, 0, 0] as [
                            number,
                            number,
                            number,
                            number,
                          ],
                        },
                      ],
                      width: '*',
                    },
                  ],
                  margin: [5, 5, 5, 5] as [number, number, number, number],
                },
              ],
            ],
          },
          layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' },
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },

        // ═══ CONCEPTO (fila única) ═══
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto'],
            body: [
              [
                { text: 'Cantidad', style: 'th' },
                { text: 'Clave Unidad', style: 'th' },
                { text: 'Clave Prod/Serv', style: 'th' },
                { text: 'Descripción', style: 'th' },
                { text: 'Valor Unitario', style: 'th' },
                { text: 'Importe', style: 'th' },
              ],
              [
                { text: '1', fontSize: 8, alignment: 'center' },
                { text: 'ACT', fontSize: 8, alignment: 'center' },
                { text: '84111506', fontSize: 8 },
                { text: 'Pago', fontSize: 8 },
                { text: '$0.00', fontSize: 8, alignment: 'right' },
                { text: '$0.00', fontSize: 8, alignment: 'right' },
              ],
            ],
          },
          layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' },
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },

        // ═══ INFORMACIÓN DE LOS PAGOS ═══
        {
          text: 'INFORMACIÓN DE LOS PAGOS RECIBIDOS',
          style: 'secTitle',
          margin: [0, 0, 0, 4] as [number, number, number, number],
        },
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto'],
            body: [
              [
                { text: 'Fecha de Pago', style: 'th' },
                { text: 'Forma de Pago', style: 'th' },
                { text: 'Moneda', style: 'th' },
                { text: 'Tipo Cambio', style: 'th' },
                { text: 'No. Operación', style: 'th' },
                { text: 'Monto', style: 'th' },
              ],
              [
                { text: fmtDate(info.fecha_pago), fontSize: 8 },
                { text: `${fpClave} - ${info.forma_pago}`, fontSize: 8 },
                { text: info.moneda, fontSize: 8 },
                { text: '1', fontSize: 8, alignment: 'center' },
                { text: info.cuenta_beneficiario || 'N/A', fontSize: 8 },
                {
                  text: fmtMoney(info.monto_total),
                  fontSize: 8,
                  bold: true,
                  alignment: 'right',
                },
              ],
            ],
          },
          layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' },
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },

        // ═══ DOCUMENTOS RELACIONADOS ═══
        {
          text: 'DOCUMENTOS RELACIONADOS (DOCTO RELACIONADO)',
          style: 'secTitle',
          margin: [0, 0, 0, 4] as [number, number, number, number],
        },
        {
          table: {
            headerRows: 1,
            widths: [
              '*',
              'auto',
              'auto',
              'auto',
              'auto',
              'auto',
              'auto',
              'auto',
            ],
            body: relDocsBody,
          },
          layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' },
          margin: [0, 0, 0, 6] as [number, number, number, number],
        },

        // ═══ IMPUESTOS POR DOCUMENTO ═══
        {
          text: 'IMPUESTOS POR DOCUMENTO',
          style: 'secTitle',
          margin: [0, 0, 0, 4] as [number, number, number, number],
        },
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', 'auto'],
            body: taxBody,
          },
          layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' },
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },

        // ═══ FOOTER: QR + SELLOS ═══
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 0,
              x2: 552,
              y2: 0,
              lineWidth: 0.5,
              lineColor: '#ccc',
            },
          ],
          margin: [0, 5, 0, 5] as [number, number, number, number],
        },
        {
          columns: [
            {
              width: 100,
              stack: [
                {
                  table: {
                    widths: [90],
                    body: [
                      [
                        {
                          text: 'QR\nCódigo',
                          alignment: 'center',
                          fontSize: 10,
                          color: '#aaa',
                          margin: [0, 25, 0, 25] as [
                            number,
                            number,
                            number,
                            number,
                          ],
                        },
                      ],
                    ],
                  },
                  layout: {
                    hLineColor: () => '#ccc',
                    vLineColor: () => '#ccc',
                  },
                },
              ],
            },
            {
              width: '*',
              stack: [
                {
                  text: 'Cadena Original del Complemento de Certificación Digital del SAT:',
                  bold: true,
                  fontSize: 6,
                  color: '#333',
                },
                {
                  text: info.cadena_original || '||1.1|...|...||',
                  fontSize: 5,
                  color: '#555',
                  margin: [0, 1, 0, 4] as [number, number, number, number],
                },
                {
                  text: 'Sello Digital del SAT:',
                  bold: true,
                  fontSize: 6,
                  color: '#333',
                },
                {
                  text: info.sello_sat || 'Pendiente de timbrado',
                  fontSize: 5,
                  color: '#555',
                  margin: [0, 1, 0, 4] as [number, number, number, number],
                },
                {
                  text: 'Sello Digital del CFDI:',
                  bold: true,
                  fontSize: 6,
                  color: '#333',
                },
                {
                  text: info.sello_cfdi || 'Pendiente de timbrado',
                  fontSize: 5,
                  color: '#555',
                  margin: [0, 1, 0, 0] as [number, number, number, number],
                },
              ],
              margin: [10, 0, 0, 0] as [number, number, number, number],
            },
          ],
        },
      ],
      styles: {
        secTitle: {
          fontSize: 8,
          bold: true,
          fillColor: FILL,
          color: '#1a1a1a',
          margin: [4, 3, 4, 3] as [number, number, number, number],
        },
        th: {
          fontSize: 7,
          bold: true,
          fillColor: FILL,
          color: '#1a1a1a',
          margin: [2, 2, 2, 2] as [number, number, number, number],
        },
        fBox: {
          fontSize: 7,
          color: '#333',
          margin: [3, 2, 3, 2] as [number, number, number, number],
        },
      },
      defaultStyle: { font: 'Roboto', fontSize: 8 },
    };
    // 4. Generar el PDF y retornar el Buffer
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = printer.createPdfKitDocument(
          docDefinition as unknown as TDocumentDefinitions,
        );
        const chunks: Buffer[] = [];

        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));

        pdfDoc.end();
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error('No fue posible generar el PDF del REP'),
        );
      }
    });
  }
}
