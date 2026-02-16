// backend/src/venta/venta.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateVentaDto } from './venta.dto';
import * as nodemailer from 'nodemailer';

const PdfPrinter = require('pdfmake');

// --- FUNCIÓN AUXILIAR: NÚMERO A LETRAS ---
function numeroALetras(amount: number, moneda: string): string {
  const unidades = ['', 'UN ', 'DOS ', 'TRES ', 'CUATRO ', 'CINCO ', 'SEIS ', 'SIETE ', 'OCHO ', 'NUEVE '];
  const decenas = ['', 'DIEZ ', 'VEINTE ', 'TREINTA ', 'CUARENTA ', 'CINCUENTA ', 'SESENTA ', 'SETENTA ', 'OCHENTA ', 'NOVENTA '];
  const diez = ['DIEZ ', 'ONCE ', 'DOCE ', 'TRECE ', 'CATORCE ', 'QUINCE ', 'DIECISEIS ', 'DIECISIETE ', 'DIECIOCHO ', 'DIECINUEVE '];
  const veinti = ['VEINTE ', 'VEINTIUN ', 'VEINTIDOS ', 'VEINTITRES ', 'VEINTICUATRO ', 'VEINTICINCO ', 'VEINTISEIS ', 'VEINTISIETE ', 'VEINTIOCHO ', 'VEINTINUEVE '];
  const centenas = ['', 'CIENTO ', 'DOSCIENTOS ', 'TRESCIENTOS ', 'CUATROCIENTOS ', 'QUINIENTOS ', 'SEISCIENTOS ', 'SETECIENTOS ', 'OCHOCIENTOS ', 'NOVECIENTOS '];

  function convertGroup(n: number): string {
    let output = '';
    if (n === 100) return 'CIEN ';
    
    if (n >= 100) {
      output += centenas[Math.floor(n / 100)];
      n %= 100;
    }

    if (n >= 30 && n <= 99) {
      output += decenas[Math.floor(n / 10)];
      if (n % 10 !== 0) output += 'Y ' + unidades[n % 10];
    } else if (n >= 20 && n <= 29) {
      output += veinti[n - 20];
    } else if (n >= 10 && n <= 19) {
      output += diez[n - 10];
    } else if (n > 0) {
      output += unidades[n];
    }
    return output;
  }

  const millones = Math.floor(amount / 1000000);
  const miles = Math.floor((amount % 1000000) / 1000);
  const resto = Math.floor(amount % 1000);
  const centavos = Math.round((amount - Math.floor(amount)) * 100);

  let texto = '';
  if (millones > 0) texto += (millones === 1 ? 'UN MILLON ' : convertGroup(millones) + 'MILLONES ');
  if (miles > 0) texto += (miles === 1 ? 'MIL ' : convertGroup(miles) + 'MIL ');
  if (resto > 0) texto += convertGroup(resto);
  if (millones === 0 && miles === 0 && resto === 0) texto += 'CERO ';

  return `${texto}PESOS ${centavos.toString().padStart(2, '0')}/100 ${moneda}`;
}

@Injectable()
export class VentaService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async generarTicketPdf(idFactura: number): Promise<Buffer> {
    const resultado = await this.dataSource.query('SELECT fn_get_datos_ticket($1) as datos', [idFactura]);
    const datos = resultado[0].datos;

    // --- PREPARACIÓN DE DATOS ---
    
    // 1. Total con Letra
    const textoImporte = numeroALetras(Number(datos.total), datos.moneda || 'M.N.');
    const totalConLetra = `(${textoImporte.trim()})`;
    
    // 2. Fechas
    const fechaEmision = new Date(datos.fecha);
    const fechaVencimiento = new Date(fechaEmision);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
    const fechaVencimientoStr = fechaVencimiento.toISOString().split('T')[0];
    const fechaEmisionStr = fechaEmision.toISOString().replace('T', ' ').substring(0, 19);
    const fechaCertStr = fechaEmisionStr; 

    // 3. Datos Fiscales (Simulados)
    const uuid = '3D2A8C2E-1975-4CDF-8E8B-BDA47F916F81'; 
    const certEmisor = '00001000000515786200';
    const certSAT = '00001000000706199269';
    const qrData = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${uuid}&re=OECR8905308K8&rr=${datos.cliente.rfc}&tt=${datos.total}&fe=SelloSimulado`;

    // 4. Dirección del Cliente ROBUSTA
    const cl = datos.cliente;
    // Concatenamos las partes de la dirección que existan
    const direccionCliente = [
        cl.calle,
        cl.numero_exterior ? `#${cl.numero_exterior}` : '',
        cl.numero_interior ? `Int. ${cl.numero_interior}` : '',
        cl.colonia ? `Col. ${cl.colonia}` : '',
        cl.municipio || cl.ciudad, // Intentamos municipio, si no ciudad
        cl.estado,
        cl.cp ? `CP: ${cl.cp}` : ''
    ].filter(Boolean).join(', '); // Une con comas y elimina vacíos

    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };

    const docDefinition: any = {
      pageSize: 'LETTER',
      // MARGEN INFERIOR GRANDE (380): Reserva espacio para el footer
      pageMargins: [20, 20, 20, 380], 
      
      content: [
        // ==========================================
        // 1. ENCABEZADO
        // ==========================================
        {
          columns: [
            { width: 120, text: '' }, // Espacio para Logo
            {
              width: '*',
              alignment: 'center',
              stack: [
                { text: 'RODRIGO DANIEL ORTEGA CORREA', fontSize: 11, bold: true },
                { text: 'REFACCIONES Y TRACTOREPUESTOS', fontSize: 10, bold: true, italics: true, margin: [0, 2] },
                { text: 'RFC: OECR8905308K8', fontSize: 8, bold: true },
                { text: 'RÉGIMEN FISCAL: 626 - SIMPLIFICADO DE CONFIANZA', fontSize: 7, bold: true },
                { text: 'SOR JUANA INES DE LA CRUZ 201-A, COL. NUEVO PROGRESO', fontSize: 7 },
                { text: 'TAMPICO, TAMAULIPAS. CP 89318', fontSize: 7 },
              ]
            },
            {
              width: 170,
              stack: [
                { text: 'EFECTOS FISCALES AL PAGO', fontSize: 7, bold: true, alignment: 'center', decoration: 'underline' },
                { text: 'CFDI', fontSize: 8, bold: true, alignment: 'center' },
                {
                  style: 'headerTable',
                  table: {
                    widths: ['auto', '*'],
                    body: [
                      [{ text: 'FACTURA', bold: true, fontSize: 7 }, { text: `${datos.serie || ''} ${datos.folio}`, alignment: 'right', fontSize: 7, bold: true }],
                      [{ text: 'FECHA EMISIÓN:', bold: true, fontSize: 6 }, { text: fechaEmisionStr, alignment: 'right', fontSize: 6 }],
                      [{ text: 'FECHA CERTIF:', bold: true, fontSize: 6 }, { text: fechaCertStr, alignment: 'right', fontSize: 6 }],
                      [{ text: 'CERTIFICADO EMISOR:', bold: true, fontSize: 6, colSpan: 2 }, {}],
                      [{ text: certEmisor, fontSize: 6, colSpan: 2, alignment: 'right' }, {}],
                      [{ text: 'CERTIFICADO SAT:', bold: true, fontSize: 6, colSpan: 2 }, {}],
                      [{ text: certSAT, fontSize: 6, colSpan: 2, alignment: 'right' }, {}],
                      [{ text: 'FOLIO FISCAL:', bold: true, fontSize: 6, colSpan: 2 }, {}],
                      [{ text: uuid, fontSize: 6, colSpan: 2, alignment: 'center' }, {}]
                    ]
                  },
                  layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: 'black', vLineColor: 'black' }
                }
              ]
            }
          ]
        },

        { text: '', margin: [0, 5] },

        // ==========================================
        // 2. SECCIÓN CLIENTE (VENDIDO A)
        // ==========================================
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  border: [true, true, true, true],
                  stack: [
                    { text: 'VENDIDO A:', fontSize: 8, bold: true, decoration: 'underline', margin: [0, 0, 0, 2] },
                    {
                      columns: [
                        { width: 50, text: 'NOMBRE:', fontSize: 7, bold: true },
                        { width: '*', text: datos.cliente.nombre, fontSize: 7 },
                        { width: 50, text: 'RFC:', fontSize: 7, bold: true },
                        { width: 80, text: datos.cliente.rfc, fontSize: 7 }
                      ]
                    },
                    {
                      columns: [
                        { width: 50, text: 'DIRECCIÓN:', fontSize: 7, bold: true },
                        // DIRECCIÓN COMPLETA CONCATENADA
                        { width: '*', text: direccionCliente, fontSize: 7 },
                        { width: 50, text: 'PEDIDO:', fontSize: 7, bold: true },
                        { width: 80, text: 'MOSTRADOR', fontSize: 7 }
                      ]
                    },
                    {
                      columns: [
                        { width: 50, text: 'RÉGIMEN:', fontSize: 7, bold: true },
                        { width: '*', text: datos.cliente.regimen, fontSize: 7 },
                        { width: 50, text: 'USO CFDI:', fontSize: 7, bold: true },
                        { width: 80, text: datos.uso_cfdi, fontSize: 7 }
                      ]
                    }
                  ],
                  margin: [5, 5]
                }
              ]
            ]
          },
          layout: { defaultBorder: false }
        },

        // Lugar de Expedición
        {
          table: {
            widths: ['auto', '*'],
            body: [[
                { text: 'LUGAR DE EXPEDICIÓN:', fontSize: 7, bold: true, fillColor: '#eee' },
                { text: `Tampico, Tamaulipas - CP: 89605`, fontSize: 7, fillColor: '#eee' }
            ]]
          },
          layout: 'noBorders',
          margin: [0, 2]
        },

        // ==========================================
        // 3. TABLA DE PRODUCTOS
        // ==========================================
        {
          table: {
            headerRows: 1,
            widths: [15, 30, 40, 60, '*', 50, 40, 45],
            body: [
              // Encabezado
              [
                { text: '#', style: 'tableHeader' },
                { text: 'CANT.', style: 'tableHeader' },
                { text: 'UNIDAD', style: 'tableHeader' },
                { text: 'CÓDIGO', style: 'tableHeader' },
                { text: 'DESCRIPCIÓN', style: 'tableHeader' },
                { text: 'CLAVE SAT', style: 'tableHeader' },
                { text: 'PRECIO', style: 'tableHeader', alignment: 'right' },
                { text: 'IMPORTE', style: 'tableHeader', alignment: 'right' }
              ],
              // Filas dinámicas
              ...datos.conceptos.map((p: any, i: number) => [
                { text: i + 1, fontSize: 7, alignment: 'center' },
                { text: p.cantidad, fontSize: 7, alignment: 'center' },
                { text: p.clave_unidad, fontSize: 7, alignment: 'center' },
                // CÓDIGO REAL: Preferencia no_identificacion (BD) > codigo (BD) > S/C
                { text: p.no_identificacion || p.codigo || 'S/C', fontSize: 7 }, 
                { text: p.descripcion, fontSize: 7 },
                { text: p.clave_prod_serv, fontSize: 7, alignment: 'center' },
                { text: Number(p.precio).toFixed(2), fontSize: 7, alignment: 'right' },
                { text: Number(p.importe).toFixed(2), fontSize: 7, alignment: 'right' }
              ])
            ]
          },
          layout: {
            hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length) ? 1.5 : 0.5,
            vLineWidth: () => 0,
            hLineColor: () => 'black'
          },
          margin: [0, 5, 0, 10]
        },
      ],

      // ==========================================
      // 4. FOOTER (ORDEN: TOTALES -> BANCO -> PAGARÉ)
      // ==========================================
      footer: (currentPage, pageCount) => {
        if (currentPage === pageCount) {
          return {
            // AJUSTE POSICIÓN: MarginTop 20 empuja el contenido hacia abajo dentro del área reservada
            margin: [20, 20, 20, 0], 
            stack: [
              
              // --- A. TOTALES Y SELLOS (PRIMERO) ---
              {
                columns: [
                  // Lado Izquierdo: Letra, Datos Pago, QR, Sellos
                  {
                    width: '*',
                    stack: [
                      { text: totalConLetra, fontSize: 8, bold: true, margin: [0, 5] },
                      { text: `Forma de Pago: ${datos.forma_pago}`, fontSize: 7 },
                      { text: `Método de Pago: ${datos.metodo_pago}`, fontSize: 7 },
                      { text: `Moneda: ${datos.moneda}`, fontSize: 7 },
                      
                      { text: ' ', margin: [0, 2] },

                      // QR y Sellos
                      {
                        columns: [
                          { qr: qrData, fit: 70, width: 80 },
                          {
                            width: '*',
                            fontSize: 5,
                            stack: [
                              { text: 'SELLO DIGITAL DEL CFDI:', bold: true },
                              { text: 'kJS8s7d89s7d98s7d98s7d98s7d9s8d7s9d87s9d87s9d87s9d87s9d87s9d87s9d87s9d87s9d87s9d87sd7s9d87s9...', margin: [0, 0, 0, 2] },
                              { text: 'TIMBRE FISCAL SAT:', bold: true },
                              { text: '||1.1|3D2A8C2E-1975-4CDF-8E8B-BDA47F916F81|2025-12-11T12:09:24|SED1102088J7|kJS8s7d89s7d98s7d...||', margin: [0, 0, 0, 2] },
                              { text: 'CADENA ORIGINAL:', bold: true },
                              { text: '||1.1|3D2A8C2E-1975-4CDF-8E8B-BDA47F916F81|2025-12-11T12:09:24|SED1102088J7|kJS8s7d89s7d98s7d...||' }
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  
                  // Lado Derecho: Tabla Totales Numéricos
                  {
                    width: 150,
                    table: {
                      widths: ['*', 'auto'],
                      body: [
                        [{ text: 'Subtotal', fontSize: 8 }, { text: Number(datos.subtotal).toFixed(2), fontSize: 8, alignment: 'right' }],
                        [{ text: 'Descuento', fontSize: 8 }, { text: '0.00', fontSize: 8, alignment: 'right' }],
                        [{ text: 'IVA 16%', fontSize: 8 }, { text: Number(datos.iva).toFixed(2), fontSize: 8, alignment: 'right' }],
                        
                        // Fila Condicional de Retención
                        ...(Number(datos.retenciones) > 0 ? [
                           [{ text: '(-) Retención ISR', fontSize: 8, bold: true, color: '#b91c1c' }, { text: Number(datos.retenciones).toFixed(2), fontSize: 8, alignment: 'right', color: '#b91c1c' }]
                        ] : []),

                        [{ text: 'Total', fontSize: 9, bold: true, fillColor: '#eee' }, { text: Number(datos.total).toFixed(2), fontSize: 9, bold: true, alignment: 'right', fillColor: '#eee' }]
                      ]
                    },
                    layout: { hLineWidth: () => 1, vLineWidth: () => 1 }
                  }
                ]
              },

              { text: '', margin: [0, 10] },

              // --- B. INFORMACIÓN BANCARIA (SEGUNDO) ---
              {
                text: 'INFORMACIÓN BANCARIA PARA PAGO', fontSize: 7, bold: true, decoration: 'underline', margin: [0, 0, 0, 2]
              },
              {
                table: {
                  widths: ['30%', '30%', '40%'],
                  body: [
                    [
                        { text: 'BANCO', style: 'bankHeader' }, 
                        { text: 'NÚMERO DE CUENTA', style: 'bankHeader' }, 
                        { text: 'CLABE INTERBANCARIA', style: 'bankHeader' }
                    ],
                    [
                        { text: 'SANTANDER', style: 'bankCell' },
                        { text: '92-00207854-4', style: 'bankCell' },
                        { text: '014813920020785448', style: 'bankCell' }
                    ]
                  ]
                },
                layout: {
                    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
                    hLineColor: 'gray', vLineColor: 'gray'
                },
                margin: [0, 0, 0, 10]
              },

              // --- C. PAGARÉ (TERCERO Y ÚLTIMO) ---
              {
                table: {
                  widths: ['*'],
                  body: [
                    [
                      {
                        stack: [
                          { text: '* AVISOS IMPORTANTES *', fontSize: 7, bold: true },
                          { text: 'Recibí Mercancía a mi entera satisfacción. Firma _____________________', fontSize: 6, alignment: 'right', margin: [0, -10, 20, 10] },
                          
                          { 
                            text: [
                              { text: `Por el presente PAGARÉ me (nos) obligo (amos) a pagar en esta plaza el día `, fontSize: 6 },
                              { text: `${fechaVencimientoStr} (AAAA-MM-DD)`, fontSize: 6, bold: true },
                              { text: ` en moneda nacional a la orden de RODRIGO DANIEL ORTEGA CORREA la cantidad de `, fontSize: 6 },
                              { text: `$${Number(datos.total).toFixed(2)}`, fontSize: 7, bold: true },
                              { text: `, ${totalConLetra}. Valor en mercancías que hemos recibido a mi (nuestra) entera satisfacción. Si no fuere pagado satisfactoriamente este pagaré me (nos) obligo (amos) además a pagar durante todo el tiempo que permaneciera total o parcialmente el adeudo insoluto, causará intereses moratorios a razón del _______% sin que por esto considere prorrogado el plazo para el cumplimiento de esta obligación.`, fontSize: 6 }
                            ],
                            alignment: 'justify',
                            margin: [0, 0, 0, 5]
                          },
                          
                          { text: `A ${fechaEmisionStr} (AAAA-MM-DD HH:MM:SS)`, fontSize: 6, margin: [0, 5] },
                          
                          { text: ' ', margin: [0, 15] },
                          
                          {
                            columns: [
                              { text: '__________________________________\nNOMBRE', alignment: 'center', fontSize: 6 },
                              { text: '__________________________________\nFIRMA', alignment: 'center', fontSize: 6 }
                            ]
                          }
                        ],
                        border: [true, true, true, true],
                        margin: [0, 5]
                      }
                    ]
                  ]
                }
              },
              
              { text: 'ESTE DOCUMENTO ES UNA REPRESENTACIÓN IMPRESA DE UN CFDI 4.0', fontSize: 6, bold: true, alignment: 'center', margin: [0, 5] }
            ]
          };
        }
        return {};
      },

      styles: {
        tableHeader: { fontSize: 7, bold: true, fillColor: '#eee', alignment: 'center' },
        bankHeader: { fontSize: 7, bold: true, fillColor: '#e0e0e0', alignment: 'center' },
        bankCell: { fontSize: 7, alignment: 'center' }
      },
      defaultStyle: {
        fontSize: 8,
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

  // --- MÉTODOS EXISTENTES SIN CAMBIOS ---
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
    const res = await this.dataSource.query('SELECT * FROM fn_preparar_envio_correo($1)', [idFactura]);
    if (!res || res.length === 0) throw new Error('Error al obtener datos de envío.');
    const datosEnvio = res[0];
    const pdfBuffer = await this.generarTicketPdf(idFactura);
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    await transporter.sendMail({ from: '"Refacciones y Tractorepuestos" <dusk081.eth@gmail.com>', to: datosEnvio.destinatario, subject: datosEnvio.asunto, text: datosEnvio.cuerpo_mensaje, attachments: [{ filename: datosEnvio.nombre_archivo, content: pdfBuffer }] });
    return { message: `Correo enviado a ${datosEnvio.destinatario}` };
  }
}