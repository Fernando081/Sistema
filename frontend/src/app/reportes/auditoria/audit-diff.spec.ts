import { auditDiff } from './audit-diff';

describe('Diferencias de auditoría JSON', () => {
  it('no marca como cambiado un objeto igual con diferente orden de claves', () => {
    expect(auditDiff({ datos: { a: 1, b: [true, null] } },
      { datos: { b: [true, null], a: 1 } }, 'UPDATE')).toEqual([]);
  });

  it('distingue campos eliminados, null y objetos modificados legibles', () => {
    expect(auditDiff({ eliminado: 2, vacio: null, datos: { cantidad: 1 } },
      { vacio: 0, datos: { cantidad: 2 } }, 'UPDATE')).toEqual([
      { field: 'eliminado', old: '2', new: '(No existe)' },
      { field: 'vacio', old: 'null', new: '0' },
      { field: 'datos', old: '{"cantidad":1}', new: '{"cantidad":2}' },
    ]);
  });

  it('no confunde claves JSON con propiedades heredadas del objeto', () => {
    expect(auditDiff({}, JSON.parse('{"__proto__":null}'), 'UPDATE'))
      .toEqual([{ field: '__proto__', old: '(No existe)', new: 'null' }]);
  });

  it('hace visible la diferencia entre una cadena y un número', () => {
    expect(auditDiff({ importe: '1' }, { importe: 1 }, 'UPDATE'))
      .toEqual([{ field: 'importe', old: '"1"', new: '1' }]);
  });
});
