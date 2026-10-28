import { BulkSelection } from './bulk-selection';

interface Row {
  id: number;
  ok?: boolean;
}

describe('BulkSelection (U02.3)', () => {
  const page: Row[] = [{ id: 1 }, { id: 2 }, { id: 3, ok: false }];

  it('selecciona, deselecciona y conserva filas entre páginas', () => {
    const s = new BulkSelection<Row>(
      (r) => r.id,
      10,
      (r) => r.ok !== false,
    );
    expect(s.toggle(page[0])).toBeTrue();
    expect(s.toggle({ id: 9 })).toBeTrue();
    expect(s.ids()).toEqual([1, 9]);
    expect(s.someSelected(page)).toBeTrue();
    s.togglePage(page);
    expect(s.allSelected(page)).toBeTrue();
    expect(s.isSelected(page[2])).toBeFalse(); // no seleccionable
    expect(s.toggle(page[2])).toBeFalse();
    s.togglePage(page);
    expect(s.ids()).toEqual([9]);
    s.clear();
    expect(s.count()).toBe(0);
  });

  it('respeta el máximo del lote', () => {
    const s = new BulkSelection<Row>((r) => r.id, 2);
    s.togglePage(page);
    expect(s.count()).toBe(2);
    expect(s.toggle({ id: 4 })).toBeFalse();
  });
});
