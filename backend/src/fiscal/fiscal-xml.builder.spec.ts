import { ConfigService } from '@nestjs/config';
import { FiscalXmlBuilder } from './fiscal-xml.builder';

describe('FiscalXmlBuilder', () => {
  it('construye CFDI 4.0 desde snapshots de la factura y escapa texto', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM factura f')) return [{
        id_factura: 4, serie: 'A', folio: 9, fecha_emision: '2026-09-25T18:00:00Z',
        tipo_comprobante: 'I', rfc_receptor: 'XAXX010101000', nombre_receptor: 'CLIENTE & HIJOS',
        codigo_postal_receptor: '89000', regimen_fiscal_receptor_clave: '616', uso_cfdi_clave: 'S01',
        moneda: 'MXN', tipo_cambio: 1, subtotal: 100, descuento: 0, total: 116,
        total_impuestos_trasladados: 16, total_impuestos_retenidos: 0,
        forma_pago: '01', metodo_pago: 'PUE',
      }];
      if (sql.includes('FROM conceptofactura')) return [{
        codigo: 'FIL-1', clave_sat: '26101700', unidad_sat: 'H87', objeto_impuesto_sat: '02',
        descripcion: 'FILTRO & ACEITE', cantidad: 1, valor_unitario: 100, importe: 100,
        descuento: 0, base_iva: 100, tasa_iva: 0.16, importe_iva: 16,
        base_ret_isr: 0, tasa_ret_isr: 0, importe_ret_isr: 0,
      }];
      return [];
    });
    const cfg = { get: (key: string) => ({
      FISCAL_MODE: 'sandbox', PAC_PROVIDER: 'sw', FISCAL_ISSUER_RFC: 'EKU9003173C9',
      FISCAL_ISSUER_NAME: 'EMISOR DE PRUEBA', FISCAL_ISSUER_TAX_REGIME: '601',
      FISCAL_ISSUER_POSTAL_CODE: '26015', PAC_SW_TOKEN: 'token',
    } as Record<string, string>)[key] } as ConfigService;
    const xml = await new FiscalXmlBuilder({ query } as any, cfg).buildInvoice(4);
    expect(xml).toContain('Version="4.0"');
    expect(xml).toContain('Rfc="EKU9003173C9"');
    expect(xml).toContain('CLIENTE &amp; HIJOS');
    expect(xml).toContain('TasaOCuota="0.160000"');
    expect(xml).not.toContain('SelloSimulado');
  });

  it('construye el REP con fechas en hora de Tampico y escapa al receptor', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM rep r')) return [{
        id_rep: 3, fecha_emision: '2026-10-28T02:30:00Z', fecha_pago: '2026-10-28T01:00:00Z',
        forma_pago: 'Transferencia', moneda: 'MXN', monto_total: 116,
        cliente_nombre: 'TALLER & "DIESEL"', cliente_rfc: 'XAXX010101000', cliente_cp: '89000', cliente_regimen: '616',
      }];
      if (sql.includes('FROM rep_factura rf JOIN factura f')) return [{
        id_rep_factura: 1, id_factura: 4, uuid_factura: '11111111-1111-4111-8111-111111111111', serie: 'A', folio: 9,
        num_parcialidad: 1, saldo_anterior: 116, monto_pagado: 116, saldo_insoluto: 0, total_factura: 116, moneda_factura: 'MXN',
      }];
      if (sql.includes('FROM rep_factura rf JOIN conceptofactura')) return [{
        id_rep_factura: 1, tasa_iva: 0.16, base_iva: 100, importe_iva: 16, tasa_ret_isr: 0, base_ret_isr: 0, importe_ret_isr: 0,
      }];
      return [];
    });
    const cfg = { get: (key: string) => ({
      FISCAL_MODE: 'sandbox', PAC_PROVIDER: 'sw', FISCAL_ISSUER_RFC: 'EKU9003173C9',
      FISCAL_ISSUER_NAME: 'EMISOR DE PRUEBA', FISCAL_ISSUER_TAX_REGIME: '601',
      FISCAL_ISSUER_POSTAL_CODE: '26015', PAC_SW_TOKEN: 'token',
    } as Record<string, string>)[key] } as ConfigService;
    const xml = await new FiscalXmlBuilder({ query } as any, cfg).buildRep(3);
    // 02:30 UTC del 28/10 son las 20:30 del 27/10 en Tampico.
    expect(xml).toContain('Fecha="2026-10-27T20:30:00"');
    expect(xml).toContain('FechaPago="2026-10-27T19:00:00"');
    expect(xml).toContain('TALLER &amp; &quot;DIESEL&quot;');
    expect(xml).toContain('TipoDeComprobante="P"');
  });
});
