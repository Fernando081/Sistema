// backend/src/pago/pago.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoDto, RegistrarRepDto } from './pago.dto';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { queryRows } from '../common/database/typed-query';
import { FiscalService } from '../fiscal/fiscal.service';
import { CancelFiscalDocumentDto } from '../fiscal/fiscal.dto';

interface FacturaSaldoRow { saldo_pendiente: number | string; estatus: string; }
interface PagoIdRow { id_pago: number; }
interface RepIdRow { id_rep: number; }
interface FacturaRepRow { saldo_pendiente: number | string; id_cliente: number; estatus: string; moneda: string; metodo_clave: string; nueva_parcialidad: number | string; }
interface RepEstadoRow { estado: string; }
interface FacturaPagadaRow { id_factura: number; monto_pagado: number | string; estatus: string; saldo_pendiente: number | string; total: number | string; tiene_devolucion: boolean; tiene_nota: boolean; }
interface RepInfoRow {
  id_rep: number;
  uuid: string | null;
  no_certificado_emisor: string | null;
  no_serie_certificado: string | null;
  fecha_emision: string | Date;
  fecha_pago: string | Date;
  forma_pago: string;
  moneda: string;
  cuenta_beneficiario: string | null;
  monto_total: number | string;
  cliente_nombre: string;
  cliente_rfc: string;
  cliente_cp: string | null;
  cadena_original: string | null;
  sello_sat: string | null;
  sello_cfdi: string | null;
  lugar_emision: string | null;
}
interface RepFacturaRow {
  uuid_factura: string | null;
  serie: string;
  folio: string | number;
  num_parcialidad: number;
  saldo_anterior: number | string;
  monto_pagado: number | string;
  saldo_insoluto: number | string;
  total_factura: number | string;
  subtotal_factura: number | string;
  iva_factura: number | string;
  isr_factura: number | string;
}
interface RepFiscalPdfRow { ambiente: string; estado: string; fecha_timbrado: Date | string | null; }

@Injectable()
export class PagoService {
  constructor(@InjectDataSource() private dataSource: DataSource, private readonly fiscalService?: FiscalService) {}

  // Registrar un pago
  async registrarPago(dto: RegistrarPagoDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const factura = await queryRows<FacturaSaldoRow>(queryRunner,
        `SELECT saldo_pendiente, estatus::text AS estatus
           FROM factura WHERE id_factura = $1 FOR UPDATE`,
        [dto.idFactura],
      );
      if (!factura.length) throw new NotFoundException('Factura no encontrada');
      if (factura[0].estatus === 'Cancelada') {
        throw new BadRequestException('No se puede pagar una factura cancelada');
      }
      const saldo = Number(factura[0].saldo_pendiente);
      if (Math.round(dto.monto * 100) > Math.round(saldo * 100)) {
        throw new BadRequestException('El pago supera el saldo pendiente');
      }

      const result = await queryRows<PagoIdRow>(queryRunner,
        `SELECT fn_registrar_pago($1, $2, $3, $4, $5) as id_pago`,
        [
          dto.idFactura,
          dto.monto,
          dto.formaPago,
          dto.referencia || '',
          dto.notas || '',
        ],
      );
      await queryRunner.commitTransaction();
      return {
        message: 'Pago registrado con éxito',
        idPago: result[0].id_pago,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Obtener historial de pagos de una factura
  async getPagosPorFactura(idFactura: number) {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT * FROM pago WHERE id_factura = $1 ORDER BY fecha_pago DESC`,
      [idFactura],
    );
  }

  // Buscar facturas pendientes de un cliente (Para el selector)
  async getPendientesPorCliente(idCliente: number) {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE f.id_cliente = $1 AND saldo_pendiente > 0 AND f.estatus::text <> 'Cancelada'
         AND COALESCE(f.tipo_comprobante, 'I') = 'I'
       ORDER BY fecha_emision ASC`,
      [idCliente],
    );
  }

  // Buscar TODAS las facturas pendientes
  async getAllPendientes() {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       WHERE saldo_pendiente > 0 AND f.estatus::text <> 'Cancelada'
         AND COALESCE(f.tipo_comprobante, 'I') = 'I'
       ORDER BY fecha_emision ASC`
    );
  }

  // Obtener facturas PPD pendientes para el módulo REP
  async getPpdPendientesPorCliente(idCliente: number) {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT id_factura, f.id_cliente, serie, folio, fecha_emision, total, saldo_pendiente, c."RazonSocial" as cliente_nombre
       FROM factura f
       JOIN cliente c ON f.id_cliente = c."IdCliente"
       JOIN metododepago mp ON mp."IdMetodoDePago" = f.id_metodo_pago
       WHERE f.id_cliente = $1 AND saldo_pendiente > 0 AND mp."Clave" = 'PPD'
         AND f.estatus::text <> 'Cancelada' AND COALESCE(f.tipo_comprobante, 'I') = 'I'
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
      const facturaIds = dto.facturas.map((item) => item.idFactura);
      if (new Set(facturaIds).size !== facturaIds.length) {
        throw new BadRequestException('Una factura no puede repetirse en el mismo REP');
      }
      const appliedTotal = dto.facturas.reduce(
        (sum, item) => sum + Number(item.montoSaldado),
        0,
      );
      if (Math.round(appliedTotal * 100) !== Math.round(dto.montoTotal * 100)) {
        throw new BadRequestException(
          'La suma aplicada a facturas debe coincidir con el monto total del REP',
        );
      }

      // 1. Insertar Cabecera REP
      const repInsert = await queryRows<RepIdRow>(queryRunner,
        `INSERT INTO rep (
          id_cliente, fecha_pago, forma_pago, moneda, monto_total, 
          cuenta_beneficiario, rfc_beneficiario,
          uuid, no_serie_certificado, no_certificado_emisor, 
          lugar_emision, fecha_emision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          NULL, NULL, NULL,
          NULL, NOW()
        ) RETURNING id_rep`,
        [
          dto.idCliente, dto.fechaPago, dto.formaPago, dto.moneda || 'MXN', dto.montoTotal,
          dto.cuentaBeneficiario, dto.rfcBeneficiario
        ]
      );
      const idRep = repInsert[0].id_rep;

      // 2. Procesar cada Factura PPD
      for (const item of [...dto.facturas].sort((a, b) => a.idFactura - b.idFactura)) {
        // Encontrar saldo actual y calcular parcialidad
        const factData = await queryRows<FacturaRepRow>(queryRunner,
          `SELECT f.saldo_pendiente, f.id_cliente, f.estatus::text AS estatus, f.moneda,
             mp."Clave" AS metodo_clave,
             (SELECT COUNT(*) FROM rep_factura WHERE id_factura = $1) + 1 AS nueva_parcialidad
           FROM factura f
           LEFT JOIN metododepago mp ON mp."IdMetodoDePago" = f.id_metodo_pago
           WHERE f.id_factura = $1 FOR UPDATE OF f`,
          [item.idFactura]
        );
        
        if (!factData.length) throw new NotFoundException(`Factura ${item.idFactura} no encontrada`);
        if (Number(factData[0].id_cliente) !== dto.idCliente) {
          throw new BadRequestException(`La factura ${item.idFactura} no pertenece al cliente del REP`);
        }
        if (factData[0].estatus === 'Cancelada') {
          throw new BadRequestException(`La factura ${item.idFactura} está cancelada`);
        }
        if (factData[0].metodo_clave !== 'PPD') {
          throw new BadRequestException(`La factura ${item.idFactura} no tiene método PPD`);
        }
        if (factData[0].moneda !== (dto.moneda || 'MXN')) {
          throw new BadRequestException('La moneda del REP debe coincidir con la de cada factura');
        }
        const saldoAnterior = Number(factData[0].saldo_pendiente);
        const montoPagado = item.montoSaldado;
        const saldoInsoluto = (Math.round(saldoAnterior * 100) - Math.round(montoPagado * 100)) / 100;
        const numParcialidad = Number(factData[0].nueva_parcialidad);

        if (saldoInsoluto < 0) {
           throw new BadRequestException(`El abono a la factura ${item.idFactura} supera el saldo pendiente`);
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
          `UPDATE factura SET saldo_pendiente = $1,
             estatus = CASE WHEN $1::numeric = 0 THEN 'Pagada'::estatus_factura_enum ELSE 'Pendiente'::estatus_factura_enum END
           WHERE id_factura = $2`,
          [saldoInsoluto, item.idFactura]
        );

        // Guardar compatibilidad antigua en 'pago' (Opcional, pero bueno para el app viejo)
        await queryRunner.query(
           `INSERT INTO pago (id_factura, fecha_pago, monto, forma_pago, referencia, notas, id_rep)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
           [item.idFactura, dto.fechaPago, montoPagado, dto.formaPago, 'REP-' + idRep, 'Generado via Módulo REP', idRep]
        );
      }

      await queryRunner.commitTransaction();
      return { message: 'REP Registrado correctamente', idRep };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // Obtener Historial de todos los REPs
  async getHistorialReps() {
    return queryRows<Record<string, unknown>>(this.dataSource,
      `SELECT r.*, c."RazonSocial" as cliente_nombre,
        COALESCE(fd.estado,'Borrador') AS estado_fiscal,
        (fd.xml_timbrado IS NOT NULL) AS tiene_xml_fiscal,
        (fd.acuse_cancelacion IS NOT NULL) AS tiene_acuse,
        fd.ultimo_error AS error_fiscal
       FROM rep r
       JOIN cliente c ON r.id_cliente = c."IdCliente"
       LEFT JOIN fiscal_documento fd ON fd.id_rep=r.id_rep
       ORDER BY r.fecha_pago DESC`
    );
  }

  // Cancelar un REP
  async cancelarRep(idRep: number, fiscalDto: CancelFiscalDocumentDto = {}, idUsuario?: number) {
    const fiscalResult = this.fiscalService
      ? await this.fiscalService.cancel('REP', idRep, fiscalDto, idUsuario)
      : { fiscal: false, cancelled: true, state: 'Sin timbrar' };
    if (!fiscalResult.cancelled) {
      return {
        message: 'La cancelación del REP está pendiente de confirmación del SAT; los saldos permanecen sin cambios.',
        ...fiscalResult,
      };
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Verificar si existe y no está ya cancelado
      const repInfo = await queryRows<RepEstadoRow>(queryRunner, `SELECT estado FROM rep WHERE id_rep = $1 FOR UPDATE`, [idRep]);
      if (!repInfo.length) throw new NotFoundException('Recibo Electrónico de Pago no encontrado');
      if (repInfo[0].estado === 'Cancelado') throw new BadRequestException('El REP ya se encuentra cancelado');

      // 2. Marcar como Cancelado
      await queryRunner.query(`UPDATE rep SET estado = 'Cancelado' WHERE id_rep = $1`, [idRep]);

      // 3. Revertir saldos de factura
      // Seleccionamos todos los pagos hechos por este REP
      const facturasPagadas = await queryRows<FacturaPagadaRow>(queryRunner, `
        SELECT rf.id_factura, rf.monto_pagado, f.estatus::text AS estatus,
               f.saldo_pendiente, f.total,
               EXISTS (SELECT 1 FROM devolucion d WHERE d.id_factura=f.id_factura) AS tiene_devolucion,
               EXISTS (SELECT 1 FROM factura nc WHERE nc.id_factura_origen=f.id_factura AND nc.estatus::text <> 'Cancelada') AS tiene_nota
          FROM rep_factura rf JOIN factura f ON f.id_factura=rf.id_factura
         WHERE rf.id_rep=$1 ORDER BY f.id_factura FOR UPDATE OF f`, [idRep]);
      
      for (const fp of facturasPagadas) {
         if (fp.estatus === 'Cancelada' || fp.tiene_devolucion || fp.tiene_nota) {
           throw new BadRequestException('Concilia la cancelación o devolución de la factura antes de cancelar su REP');
         }
         if (Math.round((Number(fp.saldo_pendiente) + Number(fp.monto_pagado)) * 100) > Math.round(Number(fp.total) * 100)) {
           throw new BadRequestException('El reverso excedería el total de la factura; revisa su conciliación');
         }
         // Le sumamos de regreso el monto pagado al saldo pendiente
         await queryRunner.query(
           `UPDATE factura SET saldo_pendiente = saldo_pendiente + $1, estatus='Pendiente' WHERE id_factura = $2`,
           [fp.monto_pagado, fp.id_factura]
         );
      }

      // El alta del REP crea pagos de compatibilidad que afectan caja/banco.
      // Al cancelar, se eliminan dentro de la misma transacción; el trigger de
      // reverso definido en la migración 027 revierte esos saldos.
      await queryRunner.query(
        `DELETE FROM pago WHERE id_rep = $1`,
        [idRep],
      );

      await queryRunner.commitTransaction();
      return { message: 'REP cancelado correctamente', idRep, ...fiscalResult };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // Generar Recibo Electrónico de Pago (REP) en PDF (CFDI 4.0)
  async generarRepPdf(idRep: number): Promise<Buffer> {
    // 1. Obtener la cabecera del REP y Cliente
    const repResult = await queryRows<RepInfoRow>(this.dataSource,
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
    const fiscalRows = await queryRows<RepFiscalPdfRow>(this.dataSource,
      'SELECT ambiente,estado,fecha_timbrado FROM fiscal_documento WHERE id_rep=$1', [idRep]);
    const fiscal = fiscalRows[0];
    const fiscalBanner = fiscal?.estado === 'Timbrado' && fiscal.ambiente === 'production'
      ? null
      : fiscal?.ambiente === 'sandbox'
        ? 'DOCUMENTO DE PAC SANDBOX — SIN VALIDEZ FISCAL'
        : 'BORRADOR DE PRUEBA — SIN TIMBRAR Y SIN VALIDEZ FISCAL';
    const issuerName = process.env.FISCAL_ISSUER_NAME || 'EMISOR NO CONFIGURADO';
    const issuerRfc = process.env.FISCAL_ISSUER_RFC || 'N/A';
    const issuerRegime = process.env.FISCAL_ISSUER_TAX_REGIME || 'N/A';

    // 2. Obtener el desglose de facturas (Documentos Relacionados)
    const facturas = await queryRows<RepFacturaRow>(this.dataSource,
      `SELECT rf.*, f.serie, f.folio, f.uuid as uuid_factura,
              f.total AS total_factura, f.subtotal AS subtotal_factura,
              f.total_impuestos_trasladados AS iva_factura,
              f.total_impuestos_retenidos AS isr_factura
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
    const fmtMoney = (value: unknown) => `$${Number(value || 0).toFixed(2)}`;
    const asDate = (value: string | number | Date) => new Date(value);
    const fmtDate = (date: string | number | Date) => asDate(date).toLocaleDateString('es-MX', { year:'numeric', month:'2-digit', day:'2-digit' });
    const fmtDateTime = (date: string | number | Date) => asDate(date).toLocaleString('es-MX');
    const FILL = '#E5E5E5';

    const formasPagoCat: Record<string, string> = { 'Efectivo':'01','Transferencia':'03','Cheque':'02','Tarjeta de Credito':'04' };
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

    // Tabla Impuestos por Documento (Proporcionales al pago)
    const taxBody: Record<string, unknown>[][] = [
      [
        { text: 'Folio', style: 'th' },
        { text: 'Base', style: 'th' },
        { text: 'IVA 16% Trasladado', style: 'th' },
        { text: 'ISR Retenido (Moral)', style: 'th' },
      ]
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
        alignment: 'center', fontSize: 7, color: '#888', margin: [0, 20, 0, 0]
      }),
      content: [
        ...(fiscalBanner ? [{
              text: fiscalBanner,
              color: '#b91c1c', bold: true, alignment: 'center', margin: [0, 0, 0, 10],
            }] : []),
        // ═══ ENCABEZADO 3 COLUMNAS ═══
        {
          columns: [
            { width: 100, stack: [{ text: '[LOGO]', fontSize: 10, color: '#AAA', alignment: 'center', margin: [0, 15, 0, 0] }] },
            { width: '*', stack: [
              { text: issuerName, fontSize: 12, bold: true, alignment: 'center', color: '#1a1a1a' },
              { text: 'REFACCIONES Y TRACTOREPUESTOS TAMPICO', fontSize: 9, bold: true, alignment: 'center', color: '#1a1a1a' },
              { text: `RFC: ${issuerRfc}`, fontSize: 8, alignment: 'center', margin: [0, 2, 0, 0] },
              { text: `Régimen Fiscal: ${issuerRegime}`, fontSize: 7, alignment: 'center', color: '#555' },
            ]},
            { width: 200, table: { widths: ['*'], body: [
              [{ text: 'Tipo de comprobante: P - CFDI de Pago', style: 'fBox' }],
              [{ text: `Comprobante No. REP-${info.id_rep}`, style: 'fBox' }],
              [{ text: `Folio Fiscal:\n${info.uuid || 'Pendiente de timbrado'}`, style: 'fBox', fontSize: 6 }],
              [{ text: `No. Serie CSD Emisor: ${info.no_certificado_emisor || 'N/A'}`, style: 'fBox' }],
              [{ text: `No. Serie CSD SAT: ${info.no_serie_certificado || 'N/A'}`, style: 'fBox' }],
              [{ text: `Fecha certificación: ${fiscal?.fecha_timbrado ? fmtDateTime(fiscal.fecha_timbrado) : 'Pendiente'}`, style: 'fBox' }],
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
              { text: [{ text: 'R.F.C.: ', bold: true }, info.cliente_rfc], fontSize: 8, margin: [0, 2, 0, 0] as [number, number, number, number] },
            ], width: '*' },
            { stack: [
              { text: [{ text: 'Uso de CFDI: ', bold: true }, 'CP01 - Pagos'], fontSize: 8 },
              { text: [{ text: 'Domicilio Fiscal: ', bold: true }, info.cliente_cp || '00000'], fontSize: 8, margin: [0, 2, 0, 0] as [number, number, number, number] },
            ], width: '*' },
          ], margin: [5, 5, 5, 5] as [number, number, number, number] }]
        ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ CONCEPTO (fila única) ═══
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto'], body: [
          [{ text: 'Cantidad', style: 'th' }, { text: 'Clave Unidad', style: 'th' }, { text: 'Clave Prod/Serv', style: 'th' }, { text: 'Descripción', style: 'th' }, { text: 'Valor Unitario', style: 'th' }, { text: 'Importe', style: 'th' }],
          [{ text: '1', fontSize: 8, alignment: 'center' }, { text: 'ACT', fontSize: 8, alignment: 'center' }, { text: '84111506', fontSize: 8 }, { text: 'Pago', fontSize: 8 }, { text: '$0.00', fontSize: 8, alignment: 'right' }, { text: '$0.00', fontSize: 8, alignment: 'right' }],
        ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ INFORMACIÓN DE LOS PAGOS ═══
        { text: 'INFORMACIÓN DE LOS PAGOS RECIBIDOS', style: 'secTitle', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto'], body: [
          [{ text: 'Fecha de Pago', style: 'th' }, { text: 'Forma de Pago', style: 'th' }, { text: 'Moneda', style: 'th' }, { text: 'Tipo Cambio', style: 'th' }, { text: 'No. Operación', style: 'th' }, { text: 'Monto', style: 'th' }],
          [{ text: fmtDate(info.fecha_pago), fontSize: 8 }, { text: `${fpClave} - ${info.forma_pago}`, fontSize: 8 }, { text: info.moneda, fontSize: 8 }, { text: '1', fontSize: 8, alignment: 'center' }, { text: info.cuenta_beneficiario || 'N/A', fontSize: 8 }, { text: fmtMoney(info.monto_total), fontSize: 8, bold: true, alignment: 'right' }],
        ]}, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ DOCUMENTOS RELACIONADOS ═══
        { text: 'DOCUMENTOS RELACIONADOS (DOCTO RELACIONADO)', style: 'secTitle', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], body: relDocsBody }, layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' }, margin: [0, 0, 0, 6] as [number, number, number, number] },

        // ═══ IMPUESTOS POR DOCUMENTO ═══
        { text: 'IMPUESTOS POR DOCUMENTO', style: 'secTitle', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto'], body: taxBody }, layout: { hLineColor: () => '#ddd', vLineColor: () => '#ddd' }, margin: [0, 0, 0, 10] as [number, number, number, number] },

        // ═══ FOOTER: QR + SELLOS ═══
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 552, y2: 0, lineWidth: 0.5, lineColor: '#ccc' }], margin: [0, 5, 0, 5] as [number, number, number, number] },
        { columns: [
          { width: 100, stack: [{ table: { widths: [90], body: [[{ text: 'QR\nCódigo', alignment: 'center', fontSize: 10, color: '#aaa', margin: [0, 25, 0, 25] as [number, number, number, number] }]] }, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc' } }] },
          { width: '*', stack: [
            { text: 'Cadena Original del Complemento de Certificación Digital del SAT:', bold: true, fontSize: 6, color: '#333' },
            { text: info.cadena_original || '||1.1|...|...||', fontSize: 5, color: '#555', margin: [0, 1, 0, 4] as [number, number, number, number] },
            { text: 'Sello Digital del SAT:', bold: true, fontSize: 6, color: '#333' },
            { text: info.sello_sat || 'Pendiente de timbrado', fontSize: 5, color: '#555', margin: [0, 1, 0, 4] as [number, number, number, number] },
            { text: 'Sello Digital del CFDI:', bold: true, fontSize: 6, color: '#333' },
            { text: info.sello_cfdi || 'Pendiente de timbrado', fontSize: 5, color: '#555', margin: [0, 1, 0, 0] as [number, number, number, number] },
          ], margin: [10, 0, 0, 0] as [number, number, number, number] }
        ] },
      ],
      styles: {
        secTitle: { fontSize: 8, bold: true, fillColor: FILL, color: '#1a1a1a', margin: [4, 3, 4, 3] as [number, number, number, number] },
        th: { fontSize: 7, bold: true, fillColor: FILL, color: '#1a1a1a', margin: [2, 2, 2, 2] as [number, number, number, number] },
        fBox: { fontSize: 7, color: '#333', margin: [3, 2, 3, 2] as [number, number, number, number] },
      },
      defaultStyle: { font: 'Roboto', fontSize: 8 }
    };
    // 4. Generar el PDF y retornar el Buffer
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = printer.createPdfKitDocument(docDefinition as unknown as TDocumentDefinitions);
        const chunks: Buffer[] = [];
        
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        
        pdfDoc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error('No fue posible generar el PDF del REP'));
      }
    });
  }

  // Generar XML CFDI 4.0 Complemento Carta Porte (Pre-timbrado para PAC Sandbox)
  async generarRepXml(idRep: number): Promise<string> {
    if (this.fiscalService) return this.fiscalService.previewXml('REP', idRep);
    // 1. Obtener la cabecera del REP y Cliente
    const repResult = await queryRows<RepInfoRow>(this.dataSource,
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
    const facturas = await queryRows<RepFacturaRow>(this.dataSource,
      `SELECT rf.*, f.serie, f.folio, f.uuid as uuid_factura
       FROM rep_factura rf
       JOIN factura f ON rf.id_factura = f.id_factura
       WHERE rf.id_rep = $1 ORDER BY rf.id_rep_factura ASC`,
      [idRep]
    );

    const xmlAttr = (value: unknown) => {
      const scalar =
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
          ? String(value)
          : '';
      return scalar.replace(/[&<>"']/g, (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
      );
    };
    // Formatear fechas a ISO SAT sin milisegundos ni Z
    const formatSatDate = (d: Date) => d.toISOString().split('.')[0];

    // Map Forma de Pago to SAT Catalog (Simplificado)
    const formasPagoCatalogo: Record<string, string> = {
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
      const impPagado = Number(f.monto_pagado);
      totalPago += impPagado;
      const noParcialidad = f.num_parcialidad;
      const saldoAnterior = Number(f.saldo_anterior).toFixed(2);
      const saldoInsoluto = Number(f.saldo_insoluto).toFixed(2);
      
      // Aproximación de impuestos para el XML (asumiendo 16% IVA y 0% ISR por defecto)
      const base = impPagado / 1.16;
      const iva = base * 0.16;
      const isr = 0;
      
      doctosRelacionadosXml += `
        <pago20:DoctoRelacionado 
          IdDocumento="${xmlAttr(f.uuid_factura || 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX')}"
          Serie="${xmlAttr(f.serie || '')}"
          Folio="${f.folio}" 
          MonedaDR="${xmlAttr(info.moneda)}"
          EquivalenciaDR="1" 
          NumParcialidad="${noParcialidad}" 
          ImpSaldoAnt="${saldoAnterior}" 
          ImpPagado="${impPagado.toFixed(2)}" 
          ImpSaldoInsoluto="${saldoInsoluto}" 
          ObjetoImpDR="02">
          
          <pago20:ImpuestosDR>
            <pago20:RetencionesDR>
              ${isr > 0 ? `<pago20:RetencionDR BaseDR="${base.toFixed(2)}" ImpuestoDR="01" TipoFactorDR="Tasa" TasaOCuotaDR="0.012500" ImporteDR="${isr.toFixed(2)}" />` : ''}
            </pago20:RetencionesDR>
            <pago20:TrasladosDR>
              <pago20:TrasladoDR BaseDR="${base.toFixed(2)}" ImpuestoDR="02" TipoFactorDR="Tasa" TasaOCuotaDR="0.160000" ImporteDR="${iva.toFixed(2)}" />
            </pago20:TrasladosDR>
          </pago20:ImpuestosDR>
        </pago20:DoctoRelacionado>`;
    }

    const fechaEmision = formatSatDate(new Date(info.fecha_emision));
    const fechaPago = formatSatDate(new Date(info.fecha_pago));

    // Estructura XML CFDI 4.0 - Pagos 2.0
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- BORRADOR DE PRUEBA: XML NO TIMBRADO Y SIN VALIDEZ FISCAL -->
<cfdi:Comprobante 
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/Pagos20 http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd" 
  xmlns:pago20="http://www.sat.gob.mx/Pagos20" 
  Version="4.0" 
  Serie="REP" 
  Folio="${info.id_rep}" 
  Fecha="${fechaEmision}" 
  NoCertificado="${xmlAttr(info.no_certificado_emisor || '00001000000500000001')}"
  SubTotal="0" 
  Moneda="XXX" 
  Total="0" 
  TipoDeComprobante="P" 
  Exportacion="01" 
  LugarExpedicion="${xmlAttr(info.lugar_emision || '01000')}"
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
  Certificado="MII...">
  
  <cfdi:Emisor Rfc="ERP010203XYZ" Nombre="ERPSystem SA de CV" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="${xmlAttr(info.cliente_rfc)}" Nombre="${xmlAttr(info.cliente_nombre)}" DomicilioFiscalReceptor="${xmlAttr(info.cliente_cp || '00000')}" RegimenFiscalReceptor="601" UsoCFDI="CP01" />
  
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01" />
  </cfdi:Conceptos>
  
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Totales MontoTotalPagos="${totalPago.toFixed(2)}" />
      <pago20:Pago 
        FechaPago="${fechaPago}" 
        FormaDePagoP="${fpClave}" 
        MonedaP="${xmlAttr(info.moneda)}"
        TipoCambioP="1" 
        Monto="${totalPago.toFixed(2)}" 
${info.cuenta_beneficiario ? `        RfcEmisorCtaOrd="OpcionalRfcBanco" CtaOrdenante="${xmlAttr(info.cuenta_beneficiario)}"` : ''}>
        ${doctosRelacionadosXml}
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    return xml;
  }
}
