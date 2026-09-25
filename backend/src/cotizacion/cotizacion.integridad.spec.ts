import { CotizacionService } from './cotizacion.service';

function fixture(lines: any[], counts = { total: 0, compradas: 1 }) {
  const runner = { connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(), release: jest.fn(), query: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM cotizacion')) return [{ id_cliente: 1, folio: 7, estatus: 'Pendiente', rfc_receptor: 'AAAA010101AAA' }];
      if (sql.includes('SELECT cc.*')) return lines;
      if (sql.includes('AS next_folio')) return [{ next_folio: 4 }];
      if (sql.includes('SELECT "CodigoPostal"')) return [{ cp: '89000' }];
      if (sql.includes('SELECT fn_crear_venta')) return [{ id_factura: 10 }];
      if (sql.includes('COUNT(*) FILTER')) return [counts];
      return [];
    }) };
  const service = new CotizacionService({ createQueryRunner: () => runner } as any);
  return { service, runner };
}
const line = { id_concepto: 1, id_producto: 2, cantidad: 2, Existencia: 10,
  estatus: 'Pendiente', TasaIVA: 0.16, ObjetoImpuesto: '02', descripcion: 'Filtro', importe_ret_isr: 0 };
const accepted = (ids: number[]) => ({ idFormaPago: 1, idMetodoPago: 1,
  articulosAceptados: ids.map((idConcepto) => ({ idConcepto, precioCierre: 100 })), articulosRechazados: [] });

describe('Cotización: integridad al convertir', () => {
  it('impide vender de nuevo un renglón ya procesado aunque la cabecera siga pendiente', async () => {
    const { service, runner } = fixture([{ ...line, estatus: 'Comprada' }]);
    await expect(service.convertirParcial(1, accepted([1]), 1, 1)).rejects.toThrow('renglones pendientes');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.query.mock.calls.some(([sql]) => sql.includes('fn_crear_venta'))).toBe(false);
  });
  it('suma el stock solicitado cuando varios renglones usan el mismo producto', async () => {
    const { service } = fixture([{ ...line, Existencia: 3 }, { ...line, id_concepto: 2, Existencia: 3 }]);
    await expect(service.convertirParcial(1, accepted([1, 2]), 1, 1)).rejects.toThrow('Stock insuficiente');
  });
  it('conserva Convertida al rechazar el último pendiente si ya hubo ventas anteriores', async () => {
    const { service, runner } = fixture([line], { total: 0, compradas: 1 });
    await service.convertirParcial(1, { ...accepted([]), articulosRechazados: [{ idConcepto: 1, motivoRechazo: 'Precio' }] }, 1, 1);
    expect(runner.query).toHaveBeenCalledWith('UPDATE cotizacion SET estatus = $1 WHERE id_cotizacion = $2', ['Convertida', 1]);
  });
  it('asigna folio bloqueado y omite IVA cuando el objeto no lo causa', async () => {
    const { service, runner } = fixture([{ ...line, ObjetoImpuesto: '01' }]);
    await service.convertirParcial(1, accepted([1]), 1, 1);
    const calls = runner.query.mock.calls as unknown as [string, any[]][];
    const sale = calls.find(([sql]) => sql.includes('fn_crear_venta'))!;
    expect(sale[1][11]).toBe(0);
    expect(sale[1].slice(17)).toEqual([4, 'A', 'I']);
    expect(calls.findIndex(([sql]) => sql.includes('pg_advisory_xact_lock'))).toBeLessThan(calls.indexOf(sale));
  });
});
