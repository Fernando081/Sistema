export interface QueryExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
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
