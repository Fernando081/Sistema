// backend/src/pago/pago.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
const PdfPrinter = require('pdfmake');
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoDto, RegistrarRepDto } from './pago.dto';

@Injectable()
export class PagoService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // Registrar un pago
  async registrarPago(dto: RegistrarPagoDto) {
    try {
      const result = await this.dataSource.query(
        `SELECT fn_registrar_pago($1, $2, $3, $4, $5) as id_pago`,
        [
          dto.idFactura,
          dto.monto,
          dto.formaPago,
          dto.referencia || '',
          dto.notas || '',
        ],
      );
      return {
        message: 'Pago registrado con éxito',
        idPago: result[0].id_pago,
      };
    } catch (error: any) {
      // Tipado como any para acceder a message
      throw new BadRequestException(error.message || 'Error al registrar pago');
    }
  }

  // Obtener historial de pagos de una factura
  async getPagosPorFactura(idFactura: number) {
    return this.dataSource.query(
      `SELECT * FROM pago WHERE id_factura = $1 ORDER BY fecha_pago DESC`,
      [idFactura],
    );
  }

  // Buscar facturas pendientes de un cliente (Para el selector)
  async getPendientesPorCliente(idCliente: number) {
    return this.dataSource.query(
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE f.id_cliente = $1 AND saldo_pendiente > 0 
       ORDER BY fecha_emision ASC`,
      [idCliente],
    );
  }

  // Buscar TODAS las facturas pendientes
  async getAllPendientes() {
    return this.dataSource.query(
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE saldo_pendiente > 0 
       ORDER BY fecha_emision ASC`
    );
  }

  // Obtener facturas PPD pendientes para el módulo REP
  async getPpdPendientesPorCliente(idCliente: number) {
    return this.dataSource.query(
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE f.id_cliente = $1 AND saldo_pendiente > 0 AND f.id_metodo_pago = 2 -- 2 asume PPD en el catalogo
       ORDER BY fecha_emision ASC`,
      [idCliente],
    );
  }

  // Registrar REP con N facturas usando Transacción
  async registrarRepComplejo(dto: RegistrarRepDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Insertar Cabecera REP
      const repInsert = await queryRunner.query(
        `INSERT INTO rep (
          id_cliente, fecha_pago, forma_pago, moneda, monto_total, 
          cuenta_beneficiario, rfc_beneficiario,
          uuid, no_serie_certificado, no_certificado_emisor, 
          lugar_emision, fecha_emision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          gen_random_uuid(), '00001000000500000000', '00001000000500000001',
          '01000', NOW()
        ) RETURNING id_rep`,
        [
          dto.idCliente, dto.fechaPago, dto.formaPago, dto.moneda || 'MXN', dto.montoTotal,
          dto.cuentaBeneficiario, dto.rfcBeneficiario
        ]
      );
      const idRep = repInsert[0].id_rep;

      // 2. Procesar cada Factura PPD
      for (const item of dto.facturas) {
        // Encontrar saldo actual y calcular parcialidad
        const factData = await queryRunner.query(
          `SELECT saldo_pendiente, 
             (SELECT COUNT(*) FROM rep_factura WHERE id_factura = $1) + 1 AS nueva_parcialidad
           FROM factura WHERE id_factura = $1 FOR UPDATE`,
          [item.idFactura]
        );
        
        if (!factData.length) throw new Error(`Factura ${item.idFactura} no encontrada`);
        const saldoAnterior = parseFloat(factData[0].saldo_pendiente);
        const montoPagado = item.montoSaldado;
        const saldoInsoluto = saldoAnterior - montoPagado;
        const numParcialidad = parseInt(factData[0].nueva_parcialidad, 10);

        if (saldoInsoluto < -0.01) {
           throw new Error(`El abono a la factura ${item.idFactura} supera el saldo pendiente`);
        }

        // Insertar en rep_factura
        await queryRunner.query(
          `INSERT INTO rep_factura (
            id_rep, id_factura, num_parcialidad, saldo_anterior, monto_pagado, saldo_insoluto
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [idRep, item.idFactura, numParcialidad, saldoAnterior, montoPagado, saldoInsoluto]
        );

        // Actualizar saldo factura
        await queryRunner.query(
          `UPDATE factura SET saldo_pendiente = $1 WHERE id_factura = $2`,
          [saldoInsoluto, item.idFactura]
        );

        // Guardar compatibilidad antigua en 'pago' (Opcional, pero bueno para el app viejo)
        await queryRunner.query(
           `INSERT INTO pago (id_factura, fecha_pago, monto, forma_pago, referencia, notas)
            VALUES ($1, $2, $3, $4, $5, $6)`,
           [item.idFactura, dto.fechaPago, montoPagado, dto.formaPago, 'REP-' + idRep, 'Generado via Módulo REP']
        );
      }

      await queryRunner.commitTransaction();
      return { message: 'REP Registrado correctamente', idRep };
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err.message || 'Error registrando REP');
    } finally {
      await queryRunner.release();
    }
  }

  // Obtener Historial de todos los REPs
  async getHistorialReps() {
    return this.dataSource.query(
      `SELECT r.*, c."RazonSocial" as cliente_nombre 
       FROM rep r
       JOIN cliente c ON r.id_cliente = c."IdCliente"
       ORDER BY r.fecha_pago DESC`
    );
  }

  // Cancelar un REP
  async cancelarRep(idRep: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Verificar si existe y no está ya cancelado
      const repInfo = await queryRunner.query(`SELECT estado FROM rep WHERE id_rep = $1 FOR UPDATE`, [idRep]);
      if (!repInfo.length) throw new Error(`Recibo Electrónico de Pago no encontrado`);
      if (repInfo[0].estado === 'Cancelado') throw new Error(`El REP ya se encuentra cancelado`);

      // 2. Marcar como Cancelado
      await queryRunner.query(`UPDATE rep SET estado = 'Cancelado' WHERE id_rep = $1`, [idRep]);

      // 3. Revertir saldos de factura
      // Seleccionamos todos los pagos hechos por este REP
      const facturasPagadas = await queryRunner.query(`SELECT id_factura, monto_pagado FROM rep_factura WHERE id_rep = $1`, [idRep]);
      
      for (const fp of facturasPagadas) {
         // Le sumamos de regreso el monto pagado al saldo pendiente
         await queryRunner.query(
           `UPDATE factura SET saldo_pendiente = saldo_pendiente + $1 WHERE id_factura = $2`,
           [fp.monto_pagado, fp.id_factura]
         );
      }

      await queryRunner.commitTransaction();
      return { message: 'REP cancelado correctamente', idRep };
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(err.message || 'Error cancelando REP');
    } finally {
      await queryRunner.release();
    }
  }

  // Generar Recibo Electrónico de Pago (REP) en PDF (CFDI 4.0)
  async generarRepPdf(idRep: number): Promise<Buffer> {
    // 1. Obtener la cabecera del REP y Cliente
    const repResult = await this.dataSource.query(
      `SELECT r.*, c."RazonSocial" as cliente_nombre, c."RFC" as cliente_rfc, c."CodigoPostal" as cliente_cp
       FROM rep r
       JOIN cliente c ON r.id_cliente = c."IdCliente"
       WHERE r.id_rep = $1`,
      [idRep],
    );

    if (!repResult || repResult.length === 0) {
      throw new NotFoundException('Recibo Electrónico de Pago (REP) no encontrado');
    }

    const info = repResult[0];

    // 2. Obtener el desglose de facturas (Documentos Relacionados)
    const facturas = await this.dataSource.query(
      `SELECT rf.*, f.serie, f.folio, f.uuid as uuid_factura
       FROM rep_factura rf
       JOIN factura f ON rf.id_factura = f.id_factura
       WHERE rf.id_rep = $1 ORDER BY rf.id_rep_factura ASC`,
      [idRep]
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
    const fmtMoney = (v: any) => `$${parseFloat(v || 0).toFixed(2)}`;
    const fmtDate = (d: any) => new Date(d).toLocaleDateString('es-MX', { year:'numeric', month:'2-digit', day:'2-digit' });
    const fmtDateTime = (d: any) => new Date(d).toLocaleString('es-MX');
    const FILL = '#E5E5E5';

    const formasPagoCat: any = { 'Efectivo':'01','Transferencia':'03','Cheque':'02','Tarjeta de Credito':'04' };
    const fpClave = formasPagoCat[info.forma_pago] || '99';

    // Tabla Documentos Relacionados
    const relDocsBody: any[][] = [
      [
        { text: 'Id Documento (UUID)', style: 'th' },
        { text: 'Serie/Folio', style: 'th' },
        { text: 'Moneda', style: 'th' },
        { text: 'Método', style: 'th' },
        { text: 'Parcialidad', style: 'th' },
        { text: 'Saldo Anterior', style: 'th' },
        { text: 'Imp. Pagado', style: 'th' },
        { text: 'Saldo Insoluto', style: 'th' },
      ]
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

    // Tabla Impuestos por Documento
    const taxBody: any[][] = [
      [
        { text: 'Folio', style: 'th' },
        { text: 'Base', style: 'th' },
        { text: 'IVA 16% Trasladado', style: 'th' },
        { text: 'ISR Retenido', style: 'th' },
      ]
    ];
    for (const f of facturas) {
      taxBody.push([
        { text: `${f.serie || ''}-${f.folio}`, fontSize: 7 },
        { text: fmtMoney(f.monto_pagado), fontSize: 7, alignment: 'right' },
        { text: fmtMoney(f.impuestos_trasladados || 0), fontSize: 7, alignment: 'right' },
        { text: fmtMoney(f.impuestos_retenidos || 0), fontSize: 7, alignment: 'right' },
      ]);
    }

    // 4. Premium docDefinition CFDI 4.0
    const docDefinition = {
      pageSize: 'LETTER' as const,
      pageMargins: [30, 30, 30, 60] as [number, number, number, number],
      footer: () => ({
        text: 'ESTE DOCUMENTO ES UNA REPRESENTACIÓN IMPRESA DE UN CFDI 4.0',
        alignment: 'center', fontSize: 7, color: '#888', margin: [0, 20, 0, 0]
      }),
      content: [
        // ═══ ENCABEZADO 3 COLUMNAS ═══
        {
          columns: [
            { width: 100, stack: [{ text: '[LOGO]', fontSize: 10, color: '#AAA', alignment: 'center', margin: [0, 15, 0, 0] }] },
            { width: '*', stack: [
              { text: 'REFACCIONES Y TRACTOREPUESTOS', fontSize: 12, bold: true, alignment: 'center', color: '#1a1a1a' },
              { text: 'RFC: OECR8905308K8', fontSize: 8, alignment: 'center', margin: [0, 2, 0, 0] },
              { text: 'Régimen Fiscal: 626 - Régimen Simplificado de Confianza', fontSize: 7, alignment: 'center', color: '#555' },
            ]},
            { width: 200, table: { widths: ['*'], body: [
              [{ text: 'Tipo de comprobante: P - CFDI de Pago', style: 'fBox' }],
              [{ text: `Comprobante No. REP-${info.id_rep}`, style: 'fBox' }],
              [{ text: `Folio Fiscal:\n${info.uuid || 'Pendiente de timbrado'}`, style: 'fBox', fontSize: 6 }],
              [{ text: `No. Serie CSD Emisor: ${info.no_certificado_emisor || 'N/A'}`, style: 'fBox' }],
              [{ text: `No. Serie CSD SAT: ${info.no_serie_certificado || 'N/A'}`, style: 'fBox' }],
              [{ text: `Fecha certificación: ${fmtDateTime(info.fecha_emision)}`, style: 'fBox' }],
            ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' } },
          ],
          margin: [0, 0, 0, 10] as [number, number, number, number]
        },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 552, y2: 0, lineWidth: 1, lineColor: '#999' }], margin: [0, 0, 0, 8] as [number, number, number, number] },

        // ═══ DATOS DEL RECEPTOR ═══
        { table: { widths: ['*'], body: [
          [{ text: 'DATOS DEL RECEPTOR / CLIENTE', style: 'secTitle' }],
          [{ columns: [
            { stack: [
              { text: [{ text: 'Nombre: ', bold: true }, info.cliente_nombre], fontSize: 8 },
              { text: [{ text: 'R.F.C.: ', bold: true }, info.cliente_rfc], fontSize: 8, margin: [0, 2, 0, 0] as any },
            ], width: '*' },
            { stack: [
              { text: [{ text: 'Uso de CFDI: ', bold: true }, 'CP01 - Pagos'], fontSize: 8 },
              { text: [{ text: 'Domicilio Fiscal: ', bold: true }, info.cliente_cp || '00000'], fontSize: 8, margin: [0, 2, 0, 0] as any },
            ], width: '*' },
          ], margin: [5, 5, 5, 5] as any }]
        ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ CONCEPTO (fila única) ═══
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto'], body: [
          [{ text: 'Cantidad', style: 'th' }, { text: 'Clave Unidad', style: 'th' }, { text: 'Clave Prod/Serv', style: 'th' }, { text: 'Descripción', style: 'th' }, { text: 'Valor Unitario', style: 'th' }, { text: 'Importe', style: 'th' }],
          [{ text: '1', fontSize: 8, alignment: 'center' }, { text: 'ACT', fontSize: 8, alignment: 'center' }, { text: '84111506', fontSize: 8 }, { text: 'Pago', fontSize: 8 }, { text: '$0.00', fontSize: 8, alignment: 'right' }, { text: '$0.00', fontSize: 8, alignment: 'right' }],
        ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ INFORMACIÓN DE LOS PAGOS ═══
        { text: 'INFORMACIÓN DE LOS PAGOS RECIBIDOS', style: 'secTitle', margin: [0, 0, 0, 4] as any },
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto'], body: [
          [{ text: 'Fecha de Pago', style: 'th' }, { text: 'Forma de Pago', style: 'th' }, { text: 'Moneda', style: 'th' }, { text: 'Tipo Cambio', style: 'th' }, { text: 'No. Operación', style: 'th' }, { text: 'Monto', style: 'th' }],
          [{ text: fmtDate(info.fecha_pago), fontSize: 8 }, { text: `${fpClave} - ${info.forma_pago}`, fontSize: 8 }, { text: info.moneda, fontSize: 8 }, { text: '1', fontSize: 8, alignment: 'center' }, { text: info.cuenta_beneficiario || 'N/A', fontSize: 8 }, { text: fmtMoney(info.monto_total), fontSize: 8, bold: true, alignment: 'right' }],
        ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ DOCUMENTOS RELACIONADOS ═══
        { text: 'DOCUMENTOS RELACIONADOS (DOCTO RELACIONADO)', style: 'secTitle', margin: [0, 0, 0, 4] as any },
        { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], body: relDocsBody }, layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' }, margin: [0, 0, 0, 6] as [number, number, number, number] },

        // ═══ IMPUESTOS POR DOCUMENTO ═══
        { text: 'IMPUESTOS POR DOCUMENTO', style: 'secTitle', margin: [0, 0, 0, 4] as any },
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto'], body: taxBody }, layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ FOOTER: QR + SELLOS ═══
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 552, y2: 0, lineWidth: 0.5, lineColor: '#ccc' }], margin: [0, 5, 0, 5] as [number, number, number, number] },
        { columns: [
          { width: 100, stack: [{ table: { widths: [90], body: [[{ text: 'QR\nCódigo', alignment: 'center', fontSize: 10, color: '#aaa', margin: [0, 25, 0, 25] as any }]] }, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' } }] },
          { width: '*', stack: [
            { text: 'Cadena Original del Complemento de Certificación Digital del SAT:', bold: true, fontSize: 6, color: '#333' },
            { text: info.cadena_original || '||1.1|...|...||', fontSize: 5, color: '#555', margin: [0, 1, 0, 4] as any },
            { text: 'Sello Digital del SAT:', bold: true, fontSize: 6, color: '#333' },
            { text: info.sello_sat || 'Pendiente de timbrado', fontSize: 5, color: '#555', margin: [0, 1, 0, 4] as any },
            { text: 'Sello Digital del CFDI:', bold: true, fontSize: 6, color: '#333' },
            { text: info.sello_cfdi || 'Pendiente de timbrado', fontSize: 5, color: '#555', margin: [0, 1, 0, 0] as any },
          ], margin: [10, 0, 0, 0] as [number, number, number, number] }
        ] },
      ],
      styles: {
        secTitle: { fontSize: 8, bold: true, fillColor: FILL, color: '#1a1a1a', margin: [4, 3, 4, 3] as any },
        th: { fontSize: 7, bold: true, fillColor: FILL, color: '#1a1a1a', margin: [2, 2, 2, 2] as any },
        fBox: { fontSize: 7, color: '#333', margin: [3, 2, 3, 2] as any },
      },
      defaultStyle: { font: 'Roboto', fontSize: 8 }
    };
    // 4. Generar el PDF y retornar el Buffer
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = printer.createPdfKitDocument(docDefinition as any);
        const chunks: Buffer[] = [];
        
        pdfDoc.on('data', (chunk) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err) => reject(err));
        
        pdfDoc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // Generar XML CFDI 4.0 Complemento Carta Porte (Pre-timbrado para PAC Sandbox)
  async generarRepXml(idRep: number): Promise<string> {
    // 1. Obtener la cabecera del REP y Cliente
    const repResult = await this.dataSource.query(
      `SELECT r.*, c."RazonSocial" as cliente_nombre, c."RFC" as cliente_rfc, c."CodigoPostal" as cliente_cp
       FROM rep r
       JOIN cliente c ON r.id_cliente = c."IdCliente"
       WHERE r.id_rep = $1`,
      [idRep]
    );

    if (!repResult || repResult.length === 0) {
      throw new NotFoundException('Recibo Electrónico de Pago (REP) no encontrado');
    }

    const info = repResult[0];

    // 2. Obtener el desglose de facturas (Documentos Relacionados)
    const facturas = await this.dataSource.query(
      `SELECT rf.*, f.serie, f.folio, f.uuid as uuid_factura
       FROM rep_factura rf
       JOIN factura f ON rf.id_factura = f.id_factura
       WHERE rf.id_rep = $1 ORDER BY rf.id_rep_factura ASC`,
      [idRep]
    );

    // Formatear fechas a ISO SAT sin milisegundos ni Z
    const formatSatDate = (d: Date) => d.toISOString().split('.')[0];

    // Map Forma de Pago to SAT Catalog (Simplificado)
    const formasPagoCatalogo: any = {
      'Efectivo': '01',
      'Transferencia': '03',
      'Cheque': '02',
      'Tarjeta de Credito': '04'
    };
    const fpClave = formasPagoCatalogo[info.forma_pago] || '03';

    // Construir Nodos de Documento Relacionado
    let doctosRelacionadosXml = '';
    let totalPago = 0;

    for (const f of facturas) {
      const impPagado = parseFloat(f.monto_pagado);
      totalPago += impPagado;
      const noParcialidad = f.num_parcialidad;
      const saldoAnterior = parseFloat(f.saldo_anterior).toFixed(2);
      const saldoInsoluto = parseFloat(f.saldo_insoluto).toFixed(2);
      
      doctosRelacionadosXml += `
        <pago20:DoctoRelacionado 
          IdDocumento="${f.uuid_factura || 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX'}" 
          Serie="${f.serie || ''}" 
          Folio="${f.folio}" 
          MonedaDR="${info.moneda}" 
          EquivalenciaDR="1" 
          NumParcialidad="${noParcialidad}" 
          ImpSaldoAnt="${saldoAnterior}" 
          ImpPagado="${impPagado.toFixed(2)}" 
          ImpSaldoInsoluto="${saldoInsoluto}" 
          ObjetoImpDR="01">
        </pago20:DoctoRelacionado>`;
    }

    const fechaEmision = formatSatDate(new Date(info.fecha_emision));
    const fechaPago = formatSatDate(new Date(info.fecha_pago));

    // Estructura XML CFDI 4.0 - Pagos 2.0
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante 
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/Pagos20 http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd" 
  xmlns:pago20="http://www.sat.gob.mx/Pagos20" 
  Version="4.0" 
  Serie="REP" 
  Folio="${info.id_rep}" 
  Fecha="${fechaEmision}" 
  NoCertificado="${info.no_certificado_emisor || '00001000000500000001'}" 
  SubTotal="0" 
  Moneda="XXX" 
  Total="0" 
  TipoDeComprobante="P" 
  Exportacion="01" 
  LugarExpedicion="${info.lugar_emision || '01000'}" 
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
  Certificado="MII...">
  
  <cfdi:Emisor Rfc="ERP010203XYZ" Nombre="ERPSystem SA de CV" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="${info.cliente_rfc}" Nombre="${info.cliente_nombre}" DomicilioFiscalReceptor="${info.cliente_cp || '00000'}" RegimenFiscalReceptor="601" UsoCFDI="CP01" />
  
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01" />
  </cfdi:Conceptos>
  
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Totales MontoTotalPagos="${totalPago.toFixed(2)}" />
      <pago20:Pago 
        FechaPago="${fechaPago}" 
        FormaDePagoP="${fpClave}" 
        MonedaP="${info.moneda}" 
        TipoCambioP="1" 
        Monto="${totalPago.toFixed(2)}" 
${info.cuenta_beneficiario ? `        RfcEmisorCtaOrd="OpcionalRfcBanco" CtaOrdenante="${info.cuenta_beneficiario}"` : ''}>
        ${doctosRelacionadosXml}
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    return xml;
  }
}
