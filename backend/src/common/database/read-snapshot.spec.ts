import { readSnapshot, QueryExecutor } from './typed-query';
describe('Snapshot de listados', () => {
  it('usa aislamiento repetible y solo lectura sobre el manager, sin transacciones anidadas', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const nested = jest.fn();
    const transaction = jest.fn(
      async (
        _isolation: string,
        work: (source: QueryExecutor) => Promise<number>,
      ) => work({ query, transaction: nested }),
    );
    const source = { query: jest.fn(), transaction };
    const value = await readSnapshot(source, (context) =>
      readSnapshot(context, async (same) => {
        await same.query('SELECT 1');
        return 12;
      }),
    );
    expect(value).toBe(12);
    expect(transaction.mock.calls[0][0]).toBe('REPEATABLE READ');
    expect(query.mock.calls.map((x) => x[0])).toEqual([
      'SET TRANSACTION READ ONLY',
      'SELECT 1',
    ]);
    expect(source.query).not.toHaveBeenCalled();
    expect(nested).not.toHaveBeenCalled();
  });
  it('propaga fallo original al propietario de la transacción', async () => {
    const error = new Error('consulta fallida');
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(
      async (
        _level: string,
        work: (source: QueryExecutor) => Promise<unknown>,
      ) => work({ query }),
    );
    await expect(
      readSnapshot({ query, transaction }, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
  it('conserva adaptadores de pruebas sin transacción', async () => {
    const source = { query: jest.fn() };
    expect(await readSnapshot(source, async (same) => same === source)).toBe(
      true,
    );
  });
});
