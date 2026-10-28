import { queryRows } from './typed-query';

const executor = (result: unknown) => ({
  query: jest.fn().mockResolvedValue(result),
});

describe('queryRows', () => {
  it('devuelve las filas de SELECT/INSERT tal cual', async () => {
    await expect(
      queryRows(executor([{ id: 1 }, { id: 2 }]), 'SELECT 1'),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    await expect(queryRows(executor([]), 'SELECT 1')).resolves.toEqual([]);
  });

  it('desempaca [filas, afectadas] de UPDATE/DELETE ... RETURNING (TypeORM + PostgreSQL)', async () => {
    await expect(
      queryRows(executor([[{ id: 7 }], 1]), 'UPDATE x RETURNING id'),
    ).resolves.toEqual([{ id: 7 }]);
    await expect(
      queryRows(executor([[], 0]), 'DELETE FROM x RETURNING id'),
    ).resolves.toEqual([]);
  });

  it('rechaza resultados que no son colecciones', async () => {
    await expect(queryRows(executor(undefined), 'SELECT 1')).rejects.toThrow(
      'colección de filas',
    );
  });
});
