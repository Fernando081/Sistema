import { QueryExecutor, queryRows } from './database/typed-query';

export function documentSearch(term: string, legacy: string, document: string): string {
  if (!/[\p{L}\p{N}]{3}/u.test(term.trim())) return legacy;
  return `${document} LIKE '%'||replace(replace(replace(lower($1),chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%' ESCAPE chr(92)`;
}

export async function chooseDocumentSearch(source: QueryExecutor, term: string, legacy: string, document: string, table: 'factura' | 'cotizacion'): Promise<string> {
  const indexed = documentSearch(term, legacy, document);
  if (indexed === legacy) return legacy;
  // Tabla interna y parámetros separados. El sondeo se ejecuta una vez por
  // petición; limita filas devueltas, no trabajo máximo del planificador.
  const matches = await queryRows(source, `SELECT 1 FROM (WITH candidates AS MATERIALIZED
    (SELECT 1 FROM ${table} f WHERE ${indexed}) SELECT 1 FROM candidates) bounded LIMIT 257`, [term.trim()]);
  return matches.length >= 257 ? legacy : indexed;
}
