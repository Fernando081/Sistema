import { supplierJson } from './supplier-json';
describe('Supplier JSON IDs', () => {
  it('normalizes nested database IDs while preserving money and dates', () => {
    const date = new Date('2026-10-02T12:00:00Z');
    const result = supplierJson({
      idFacturaProveedor: '42',
      total: '4.00',
      fecha: date,
      pagos: [{ idPago: '7', monto: '2.00' }],
      id_proveedor: '1',
    });
    expect(result).toEqual({
      idFacturaProveedor: 42,
      total: '4.00',
      fecha: date,
      pagos: [{ idPago: 7, monto: '2.00' }],
      id_proveedor: 1,
    });
    expect(result.fecha).toBe(date);
  });
  it('rejects IDs that would lose precision', () => {
    expect(() => supplierJson({ idPago: '9007199254740993' })).toThrow(
      'rango seguro',
    );
  });
  it('preserves optional IDs, existing numbers and non-plain objects', () => {
    const buffer = Buffer.from('pdf');
    expect(
      supplierJson({ id: 1, idOrden: null, folio: '123', file: buffer }),
    ).toEqual({ id: 1, idOrden: null, folio: '123', file: buffer });
  });
});
