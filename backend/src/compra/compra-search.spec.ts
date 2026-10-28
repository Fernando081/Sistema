import { compraSearch, COMPRA_LEGACY, COMPRA_CANDIDATES } from './compra-search';
import { compraPage, compraCsv, CompraQueryDto } from './compra-query';
describe('Búsqueda de compras', () => {
  it('conserva términos cortos, signos y coincidencias entre campos sin sondeo', async () => {
    const query=jest.fn();
    for(const term of ['', '%', 'AB', 'F1000 Proveedor', 'A\tB']) expect(await compraSearch({query},term)).toBe(COMPRA_LEGACY);
    expect(query).not.toHaveBeenCalled();
  });
  it('elige ruta por umbral y conserva filtro final, parámetros y candidatos actuales', async () => {
    for(const count of [256,257]) {
      const query=jest.fn().mockResolvedValue(Array.from({length:count},()=>({})));
      const result=await compraSearch({query},"RFC%_'");
      expect(result).toBe(count===257?COMPRA_LEGACY:`${COMPRA_LEGACY} AND (c.fuente='orden' OR c.id_compra IN (${COMPRA_CANDIDATES}))`);
      expect(query.mock.calls[0][1]).toEqual(["RFC%_'"]);
      expect(query.mock.calls[0][0]).toContain('UNION ALL');
      expect(query.mock.calls[0][0]).toContain('ESCAPE chr(92)');
      expect(query.mock.calls[0][0]).toContain('LIMIT 257');
      expect(query.mock.calls[0][0]).not.toContain("RFC%_'");
    }
  });
  it('página, conteo y CSV comparten ruta indexada y filtros de estado/fecha', async () => {
    const query=jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{total:0}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const filters=Object.assign(new CompraQueryDto(),{term:'RFC1000',estado:'Pendiente',desde:'2026-10-01',hasta:'2026-10-01'});
    await compraPage({query},filters);await compraCsv({query},filters);
    for(const index of [1,2,4]) {
      expect(query.mock.calls[index][0]).toContain(`c.id_compra IN (${COMPRA_CANDIDATES})`);
      expect(query.mock.calls[index][0]).toContain("AT TIME ZONE 'America/Mexico_City'");
      expect(query.mock.calls[index][1].slice(0,4)).toEqual(['RFC1000','Pendiente','2026-10-01','2026-10-01']);
    }
    expect(query.mock.calls[4][1]).toEqual(query.mock.calls[1][1]);
  });
});
