import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { FiscalService } from '../fiscal/fiscal.service';
import { RepInfoRow, RepFacturaRow } from './pago.types';
@Injectable()
export class RepXmlService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fiscalService?: FiscalService,
  ) {}
  async generarRepXml(idRep: number): Promise<string> {
    if (this.fiscalService) return this.fiscalService.previewXml('REP', idRep);
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

    // 2. Obtener el desglose de facturas (Documentos Relacionados)
    const facturas = await queryRows<RepFacturaRow>(
      this.dataSource,
      `SELECT rf.*, f.serie, f.folio, f.uuid as uuid_factura
       FROM rep_factura rf
       JOIN factura f ON rf.id_factura = f.id_factura
       WHERE rf.id_rep = $1 ORDER BY rf.id_rep_factura ASC`,
      [idRep],
    );

    const xmlAttr = (value: unknown) => {
      const scalar =
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
          ? String(value)
          : '';
      return scalar.replace(
        /[&<>"']/g,
        (character) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;',
          })[character]!,
      );
    };
    // Formatear fechas a ISO SAT sin milisegundos ni Z
    const formatSatDate = (d: Date) => d.toISOString().split('.')[0];

    // Map Forma de Pago to SAT Catalog (Simplificado)
    const formasPagoCatalogo: Record<string, string> = {
      Efectivo: '01',
      Transferencia: '03',
      Cheque: '02',
      'Tarjeta de Credito': '04',
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
