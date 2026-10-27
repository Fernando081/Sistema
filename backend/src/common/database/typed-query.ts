export interface QueryExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
  transaction?<T>(isolation: 'REPEATABLE READ', work: (source: QueryExecutor) => Promise<T>): Promise<T>;
}

// DataSource/EntityManager mantiene una conexión y libera/rollback al fallar.
// Adaptadores sin transacciones se conservan para verificadores y mocks.
export async function readSnapshot<T>(source: QueryExecutor, work: (source: QueryExecutor) => Promise<T>): Promise<T> {
  if (!source.transaction) return work(source);
  return source.transaction('REPEATABLE READ', async manager => {
    await manager.query('SET TRANSACTION READ ONLY');
    // Contexto ya protegido: evita abrir un segundo snapshot/savepoint.
    return work({ query: (sql, parameters) => manager.query(sql, parameters) });
  });
}

export async function queryRows<Row>(
  executor: QueryExecutor,
  sql: string,
  parameters?: unknown[],
): Promise<Row[]> {
  const result = await executor.query(sql, parameters);
  if (!Array.isArray(result)) {
    throw new Error('La consulta no devolvió una colección de filas');
  }
  return result as Row[];
}
