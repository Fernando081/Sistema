import { documentSearch, chooseDocumentSearch } from './document-search';
import {
  cotizacionPage,
  cotizacionCsv,
  CotizacionQueryDto,
  DOCUMENT_INDEXED as QUOTE,
} from '../cotizacion/cotizacion-query';
import {
  facturaPage,
  facturaCsv,
  FacturaQueryDto,
  DOCUMENT_INDEXED as INVOICE,
} from '../venta/factura-query';

describe('Búsqueda de documentos', () => {
  it('conserva consulta literal para signos, vacío y términos cortos', () => {
    for (const term of ['', ' ', '%', '_', '\\', 'AB', 'A B', 'Ñ']) {
      expect(documentSearch(term, 'legacy', 'document')).toBe('legacy');
    }
  });
  it('usa expresión indexable con escape explícito sin interpolar texto del usuario', () => {
    const sql = documentSearch("ÁRBOL%_'\\", 'legacy', 'document');
    expect(sql).toContain('document LIKE');
    expect(sql).toContain('lower($1)');
    expect(sql).toContain('ESCAPE chr(92)');
    expect(sql).not.toContain('ÁRBOL');
  });
  it('elige ruta anterior desde 257 coincidencias sin cambiar parámetros ni omitir términos cortos', async () => {
    for (const size of [256, 257]) {
      const query = jest
        .fn()
        .mockResolvedValue(Array.from({ length: size }, () => ({})));
      const result = await chooseDocumentSearch(
        { query },
        'Cliente',
        'legacy',
        'document',
        'factura',
      );
      expect(result === 'legacy').toBe(size === 257);
      expect(query.mock.calls[0][1]).toEqual(['Cliente']);
      expect(query.mock.calls[0][0]).toContain('LIMIT 257');
    }
    const query = jest.fn();
    expect(
      await chooseDocumentSearch(
        { query },
        '%',
        'legacy',
        'document',
        'factura',
      ),
    ).toBe('legacy');
    expect(query).not.toHaveBeenCalled();
  });
  it('página, conteo y CSV de ambos documentos comparten búsqueda y conservan filtros', async () => {
    for (const d of [
      {
        page: cotizacionPage,
        csv: cotizacionCsv,
        dto: new CotizacionQueryDto(),
        expression: QUOTE,
      },
      {
        page: facturaPage,
        csv: facturaCsv,
        dto: new FacturaQueryDto(),
        expression: INVOICE,
      },
    ]) {
      const query = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0, total: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const values = Object.assign(d.dto, {
        term: '100%_',
        estado: 'Pendiente',
        desde: '2026-10-01',
        hasta: '2026-10-01',
      });
      await d.page({ query }, values);
      await d.csv({ query }, values);
      for (const call of query.mock.calls) {
        expect(call[0]).toContain(d.expression);
        expect(call[0]).toContain('ESCAPE chr(92)');
        if (!call[0].startsWith('SELECT 1 '))
          expect(call[0]).toContain("AT TIME ZONE 'America/Mexico_City'");
        expect(call[1][0]).toBe('100%_');
      }
      expect(query.mock.calls[4][1]).toEqual(query.mock.calls[1][1]);
    }
  });
});
