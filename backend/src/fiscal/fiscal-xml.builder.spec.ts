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
});
