import { businessDateTime } from '../common/business-date';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { queryRows } from '../common/database/typed-query';
import { loadFiscalSettings } from './fiscal.config';
import { FiscalIssuer } from './fiscal.types';

interface InvoiceRow {
  id_factura: number; serie: string; folio: number; fecha_emision: Date | string;
  tipo_comprobante: string; rfc_receptor: string; nombre_receptor: string;
  codigo_postal_receptor: string; regimen_fiscal_receptor_clave: string;
  uso_cfdi_clave: string; moneda: string; tipo_cambio: number | string;
  subtotal: number | string; descuento: number | string; total: number | string;
  total_impuestos_trasladados: number | string; total_impuestos_retenidos: number | string;
  forma_pago: string; metodo_pago: string;
}
interface ConceptRow {
  codigo: string | null; clave_sat: string; unidad_sat: string; objeto_impuesto_sat: string;
  descripcion: string; cantidad: number | string; valor_unitario: number | string;
  importe: number | string; descuento: number | string; base_iva: number | string;
  tasa_iva: number | string; importe_iva: number | string; base_ret_isr: number | string;
  tasa_ret_isr: number | string; importe_ret_isr: number | string;
}
interface RelationRow { tipo_relacion: string; uuid_relacionado: string; }
interface RepRow {
  id_rep: number; fecha_emision: Date | string; fecha_pago: Date | string; forma_pago: string;
  moneda: string; monto_total: number | string; cliente_nombre: string; cliente_rfc: string;
  cliente_cp: string; cliente_regimen: string;
}
interface RepInvoiceRow {
  id_rep_factura: number; id_factura: number; uuid_factura: string | null; serie: string;
  folio: number; num_parcialidad: number; saldo_anterior: number | string;
  monto_pagado: number | string; saldo_insoluto: number | string; total_factura: number | string;
  moneda_factura: string;
}
interface RepTaxRow {
  id_rep_factura: number; tasa_iva: number | string; base_iva: number | string;
  importe_iva: number | string; tasa_ret_isr: number | string;
  base_ret_isr: number | string; importe_ret_isr: number | string;
}

const attr = (value: unknown) => {
  const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value) : value instanceof Date ? value.toISOString() : '';
  return scalar.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
};
const money = (value: unknown) => Number(value || 0).toFixed(2);
const quantity = (value: unknown) => Number(value || 0).toFixed(6).replace(/\.?0+$/, '');
const rate = (value: unknown) => Number(value || 0).toFixed(6);
const satDate = businessDateTime;

@Injectable()
export class FiscalXmlBuilder {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  private issuer(): FiscalIssuer {
    const settings = loadFiscalSettings(this.config);
    if (settings.environment !== 'mock' && !settings.ready) {
      throw new BadRequestException(`Configuración fiscal incompleta: ${settings.missing.join(', ')}`);
    }
    return settings.environment === 'mock' && !settings.issuer.rfc ? {
      rfc: 'EKU9003173C9', name: 'ESCUELA KEMPER URGATE', taxRegime: '601', postalCode: '26015',
    } : settings.issuer;
  }

  async buildInvoice(idFactura: number): Promise<string> {
    const invoices = await queryRows<InvoiceRow>(this.dataSource, `
      SELECT f.*, fp."Clave" AS forma_pago, mp."Clave" AS metodo_pago
      FROM factura f
      JOIN formadepago fp ON fp."IdFormaPago"=f.id_forma_pago
      JOIN metododepago mp ON mp."IdMetodoDePago"=f.id_metodo_pago
      WHERE f.id_factura=$1`, [idFactura]);
    if (!invoices.length) throw new NotFoundException('Factura no encontrada');
    const invoice = invoices[0];
    if (invoice.tipo_comprobante === 'P') throw new BadRequestException('Utiliza el timbrado de REP');
    const required = [invoice.rfc_receptor, invoice.nombre_receptor, invoice.codigo_postal_receptor,
      invoice.regimen_fiscal_receptor_clave, invoice.uso_cfdi_clave];
    if (required.some(value => !String(value || '').trim())) {
      throw new BadRequestException('Completa RFC, razón social, CP, régimen y uso CFDI del receptor');
    }

    const concepts = await queryRows<ConceptRow>(this.dataSource, `
      SELECT p."Codigo" AS codigo, cf.clave_sat, cf.unidad_sat, cf.objeto_impuesto_sat,
        cf.descripcion, cf.cantidad, cf.valor_unitario, cf.importe, cf.descuento,
        cf.base_iva, cf.tasa_iva, cf.importe_iva, cf.base_ret_isr,
        cf.tasa_ret_isr, cf.importe_ret_isr
      FROM conceptofactura cf
      LEFT JOIN producto p ON p."IdProducto"=cf.id_producto
      WHERE cf.id_factura=$1 ORDER BY cf.id_concepto`, [idFactura]);
    if (!concepts.length) throw new BadRequestException('La factura no tiene conceptos');
    const relations = await queryRows<RelationRow>(this.dataSource,
      'SELECT tipo_relacion,uuid_relacionado FROM cfdi_relacionado WHERE id_factura=$1 ORDER BY id_relacion',
      [idFactura]);
    if (relations.some(item => item.tipo_relacion !== relations[0]?.tipo_relacion)) {
      throw new BadRequestException('Una factura no puede mezclar tipos de relación CFDI');
    }
    const issuer = this.issuer();

    const relationsXml = relations.length ? `<cfdi:CfdiRelacionados TipoRelacion="${attr(relations[0].tipo_relacion)}">${relations
      .map(item => `<cfdi:CfdiRelacionado UUID="${attr(item.uuid_relacionado)}"/>`).join('')}</cfdi:CfdiRelacionados>` : '';
    const conceptXml = concepts.map(item => {
      const taxable = item.objeto_impuesto_sat === '02';
      const iva = Number(item.importe_iva || 0);
      const isr = Number(item.importe_ret_isr || 0);
      const transfers = taxable && iva > 0
        ? `<cfdi:Traslados><cfdi:Traslado Base="${money(item.base_iva)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${rate(item.tasa_iva)}" Importe="${money(iva)}"/></cfdi:Traslados>` : '';
      const retentions = taxable && isr > 0
        ? `<cfdi:Retenciones><cfdi:Retencion Base="${money(item.base_ret_isr)}" Impuesto="001" TipoFactor="Tasa" TasaOCuota="${rate(item.tasa_ret_isr)}" Importe="${money(isr)}"/></cfdi:Retenciones>` : '';
      const taxes = transfers || retentions ? `<cfdi:Impuestos>${transfers}${retentions}</cfdi:Impuestos>` : '';
      const discount = Number(item.descuento || 0) > 0 ? ` Descuento="${money(item.descuento)}"` : '';
      const identification = item.codigo ? ` NoIdentificacion="${attr(item.codigo)}"` : '';
      return `<cfdi:Concepto ClaveProdServ="${attr(item.clave_sat)}"${identification} Cantidad="${quantity(item.cantidad)}" ClaveUnidad="${attr(item.unidad_sat)}" Descripcion="${attr(item.descripcion)}" ValorUnitario="${money(item.valor_unitario)}" Importe="${money(item.importe)}"${discount} ObjetoImp="${attr(item.objeto_impuesto_sat)}">${taxes}</cfdi:Concepto>`;
    }).join('');

    const ivaGroups = new Map<string, { base: number; amount: number }>();
    let retainedIsr = 0;
    for (const item of concepts) {
      if (item.objeto_impuesto_sat !== '02') continue;
      if (Number(item.importe_iva || 0) > 0) {
        const key = rate(item.tasa_iva);
        const group = ivaGroups.get(key) || { base: 0, amount: 0 };
        group.base += Number(item.base_iva || 0);
        group.amount += Number(item.importe_iva || 0);
        ivaGroups.set(key, group);
      }
      retainedIsr += Number(item.importe_ret_isr || 0);
    }
    const rootTransfers = [...ivaGroups.entries()].map(([taxRate, values]) =>
      `<cfdi:Traslado Base="${money(values.base)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${taxRate}" Importe="${money(values.amount)}"/>`,
    ).join('');
    const rootRetentions = retainedIsr > 0
      ? `<cfdi:Retenciones><cfdi:Retencion Impuesto="001" Importe="${money(retainedIsr)}"/></cfdi:Retenciones>` : '';
    const rootTaxes = rootTransfers || rootRetentions ? `<cfdi:Impuestos${Number(invoice.total_impuestos_retenidos || 0) > 0 ? ` TotalImpuestosRetenidos="${money(invoice.total_impuestos_retenidos)}"` : ''}${Number(invoice.total_impuestos_trasladados || 0) > 0 ? ` TotalImpuestosTrasladados="${money(invoice.total_impuestos_trasladados)}"` : ''}>${rootRetentions}${rootTransfers ? `<cfdi:Traslados>${rootTransfers}</cfdi:Traslados>` : ''}</cfdi:Impuestos>` : '';

    const isPpd = invoice.metodo_pago === 'PPD';
    const discount = Number(invoice.descuento || 0) > 0 ? ` Descuento="${money(invoice.descuento)}"` : '';
    const exchangeRate = invoice.moneda !== 'MXN' && invoice.moneda !== 'XXX'
      ? ` TipoCambio="${quantity(invoice.tipo_cambio)}"` : '';
    return `<?xml version="1.0" encoding="utf-8"?>\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="${attr(invoice.serie)}" Folio="${invoice.folio}" Fecha="${satDate(invoice.fecha_emision)}" Sello="" NoCertificado="" Certificado="" FormaPago="${attr(isPpd ? '99' : invoice.forma_pago)}" SubTotal="${money(invoice.subtotal)}"${discount} Moneda="${attr(invoice.moneda)}"${exchangeRate} Total="${money(invoice.total)}" TipoDeComprobante="${attr(invoice.tipo_comprobante)}" Exportacion="01" MetodoPago="${attr(invoice.metodo_pago)}" LugarExpedicion="${attr(issuer.postalCode)}">${relationsXml}<cfdi:Emisor Rfc="${attr(issuer.rfc)}" Nombre="${attr(issuer.name)}" RegimenFiscal="${attr(issuer.taxRegime)}"/><cfdi:Receptor Rfc="${attr(invoice.rfc_receptor)}" Nombre="${attr(invoice.nombre_receptor)}" DomicilioFiscalReceptor="${attr(invoice.codigo_postal_receptor)}" RegimenFiscalReceptor="${attr(invoice.regimen_fiscal_receptor_clave)}" UsoCFDI="${attr(invoice.uso_cfdi_clave)}"/><cfdi:Conceptos>${conceptXml}</cfdi:Conceptos>${rootTaxes}</cfdi:Comprobante>`;
  }

  async buildRep(idRep: number): Promise<string> {
    const reps = await queryRows<RepRow>(this.dataSource, `
      SELECT r.id_rep,r.fecha_emision,r.fecha_pago,r.forma_pago,r.moneda,r.monto_total,
        c."RazonSocial" AS cliente_nombre,c."RFC" AS cliente_rfc,c."CodigoPostal" AS cliente_cp,
        rf."Clave" AS cliente_regimen
      FROM rep r JOIN cliente c ON c."IdCliente"=r.id_cliente
      JOIN regimenfiscal rf ON rf."IdRegimenFiscal"=c."IdRegimenFiscal"
      WHERE r.id_rep=$1`, [idRep]);
    if (!reps.length) throw new NotFoundException('REP no encontrado');
    const rep = reps[0];
    if (rep.moneda !== 'MXN') {
      throw new BadRequestException('El REP requiere capturar tipo de cambio antes de timbrar pagos en moneda distinta de MXN');
    }
    const documents = await queryRows<RepInvoiceRow>(this.dataSource, `
      SELECT rf.id_rep_factura,rf.id_factura,COALESCE(fd.uuid,f.uuid) AS uuid_factura,
        f.serie,f.folio,rf.num_parcialidad,rf.saldo_anterior,rf.monto_pagado,
        rf.saldo_insoluto,f.total AS total_factura,f.moneda AS moneda_factura
      FROM rep_factura rf JOIN factura f ON f.id_factura=rf.id_factura
      LEFT JOIN fiscal_documento fd ON fd.id_factura=f.id_factura AND fd.estado='Timbrado'
      WHERE rf.id_rep=$1 ORDER BY rf.id_rep_factura`, [idRep]);
    if (!documents.length) throw new BadRequestException('El REP no contiene documentos relacionados');
    const missingUuid = documents.find(item => !item.uuid_factura);
    if (missingUuid) throw new BadRequestException(`La factura ${missingUuid.serie}-${missingUuid.folio} debe timbrarse antes del REP`);
    if (documents.some(item => item.moneda_factura !== rep.moneda)) {
      throw new BadRequestException('El REP todavía no admite equivalencias entre monedas distintas');
    }
    const taxes = await queryRows<RepTaxRow>(this.dataSource, `
      SELECT rf.id_rep_factura,cf.tasa_iva,SUM(cf.base_iva) AS base_iva,
        SUM(cf.importe_iva) AS importe_iva,cf.tasa_ret_isr,
        SUM(cf.base_ret_isr) AS base_ret_isr,SUM(cf.importe_ret_isr) AS importe_ret_isr
      FROM rep_factura rf JOIN conceptofactura cf ON cf.id_factura=rf.id_factura
      WHERE rf.id_rep=$1 GROUP BY rf.id_rep_factura,cf.tasa_iva,cf.tasa_ret_isr`, [idRep]);
    const taxByDocument = new Map<number, RepTaxRow[]>();
    for (const item of taxes) taxByDocument.set(item.id_rep_factura, [...(taxByDocument.get(item.id_rep_factura) || []), item]);

    const paymentTransfers = new Map<string, { base: number; amount: number }>();
    let paymentRetainedIsr = 0;
    const documentsXml = documents.map(document => {
      const ratio = Number(document.total_factura) > 0 ? Number(document.monto_pagado) / Number(document.total_factura) : 0;
      const documentTaxes = taxByDocument.get(document.id_rep_factura) || [];
      const transfers: string[] = [];
      const retentions: string[] = [];
      for (const tax of documentTaxes) {
        const ivaAmount = Number(tax.importe_iva || 0) * ratio;
        if (ivaAmount > 0) {
          const base = Number(tax.base_iva || 0) * ratio;
          const taxRate = rate(tax.tasa_iva);
          transfers.push(`<pago20:TrasladoDR BaseDR="${money(base)}" ImpuestoDR="002" TipoFactorDR="Tasa" TasaOCuotaDR="${taxRate}" ImporteDR="${money(ivaAmount)}"/>`);
          const group = paymentTransfers.get(taxRate) || { base: 0, amount: 0 };
          group.base += base; group.amount += ivaAmount; paymentTransfers.set(taxRate, group);
        }
        const isrAmount = Number(tax.importe_ret_isr || 0) * ratio;
        if (isrAmount > 0) {
          const base = Number(tax.base_ret_isr || 0) * ratio;
          retentions.push(`<pago20:RetencionDR BaseDR="${money(base)}" ImpuestoDR="001" TipoFactorDR="Tasa" TasaOCuotaDR="${rate(tax.tasa_ret_isr)}" ImporteDR="${money(isrAmount)}"/>`);
          paymentRetainedIsr += isrAmount;
        }
      }
      const taxXml = transfers.length || retentions.length
        ? `<pago20:ImpuestosDR>${retentions.length ? `<pago20:RetencionesDR>${retentions.join('')}</pago20:RetencionesDR>` : ''}${transfers.length ? `<pago20:TrasladosDR>${transfers.join('')}</pago20:TrasladosDR>` : ''}</pago20:ImpuestosDR>` : '';
      return `<pago20:DoctoRelacionado IdDocumento="${attr(document.uuid_factura)}" Serie="${attr(document.serie)}" Folio="${document.folio}" MonedaDR="${attr(document.moneda_factura)}" EquivalenciaDR="1" NumParcialidad="${document.num_parcialidad}" ImpSaldoAnt="${money(document.saldo_anterior)}" ImpPagado="${money(document.monto_pagado)}" ImpSaldoInsoluto="${money(document.saldo_insoluto)}" ObjetoImpDR="${taxXml ? '02' : '01'}">${taxXml}</pago20:DoctoRelacionado>`;
    }).join('');

    const paymentTransferXml = [...paymentTransfers.entries()].map(([taxRate, values]) =>
      `<pago20:TrasladoP BaseP="${money(values.base)}" ImpuestoP="002" TipoFactorP="Tasa" TasaOCuotaP="${taxRate}" ImporteP="${money(values.amount)}"/>`,
    ).join('');
    const paymentTaxes = paymentTransferXml || paymentRetainedIsr > 0
      ? `<pago20:ImpuestosP>${paymentRetainedIsr > 0 ? `<pago20:RetencionesP><pago20:RetencionP ImpuestoP="001" ImporteP="${money(paymentRetainedIsr)}"/></pago20:RetencionesP>` : ''}${paymentTransferXml ? `<pago20:TrasladosP>${paymentTransferXml}</pago20:TrasladosP>` : ''}</pago20:ImpuestosP>` : '';
    let totalsAttributes = `MontoTotalPagos="${money(rep.monto_total)}"`;
    for (const [taxRate, values] of paymentTransfers) {
      if (taxRate === '0.160000') totalsAttributes += ` TotalTrasladosBaseIVA16="${money(values.base)}" TotalTrasladosImpuestoIVA16="${money(values.amount)}"`;
      else if (taxRate === '0.080000') totalsAttributes += ` TotalTrasladosBaseIVA8="${money(values.base)}" TotalTrasladosImpuestoIVA8="${money(values.amount)}"`;
      else if (taxRate === '0.000000') totalsAttributes += ` TotalTrasladosBaseIVA0="${money(values.base)}" TotalTrasladosImpuestoIVA0="${money(values.amount)}"`;
      else throw new BadRequestException(`Tasa IVA ${taxRate} no soportada en REP`);
    }
    if (paymentRetainedIsr > 0) totalsAttributes += ` TotalRetencionesISR="${money(paymentRetainedIsr)}"`;
    const paymentMethods: Record<string, string> = {
      Efectivo: '01', Cheque: '02', Transferencia: '03', 'Transferencia Electrónica': '03',
      'Tarjeta de Credito': '04', 'Tarjeta de Crédito': '04',
    };
    const paymentMethod = paymentMethods[rep.forma_pago];
    if (!paymentMethod) throw new BadRequestException(`Forma de pago REP no mapeada al catálogo SAT: ${rep.forma_pago}`);
    const issuer = this.issuer();
    return `<?xml version="1.0" encoding="utf-8"?>\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/Pagos20 http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd" Version="4.0" Serie="REP" Folio="${rep.id_rep}" Fecha="${satDate(rep.fecha_emision)}" Sello="" NoCertificado="" Certificado="" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P" Exportacion="01" LugarExpedicion="${attr(issuer.postalCode)}"><cfdi:Emisor Rfc="${attr(issuer.rfc)}" Nombre="${attr(issuer.name)}" RegimenFiscal="${attr(issuer.taxRegime)}"/><cfdi:Receptor Rfc="${attr(rep.cliente_rfc)}" Nombre="${attr(rep.cliente_nombre)}" DomicilioFiscalReceptor="${attr(rep.cliente_cp)}" RegimenFiscalReceptor="${attr(rep.cliente_regimen)}" UsoCFDI="CP01"/><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01"/></cfdi:Conceptos><cfdi:Complemento><pago20:Pagos Version="2.0"><pago20:Totales ${totalsAttributes}/><pago20:Pago FechaPago="${satDate(rep.fecha_pago)}" FormaDePagoP="${paymentMethod}" MonedaP="MXN" TipoCambioP="1" Monto="${money(rep.monto_total)}">${documentsXml}${paymentTaxes}</pago20:Pago></pago20:Pagos></cfdi:Complemento></cfdi:Comprobante>`;
  }
}
