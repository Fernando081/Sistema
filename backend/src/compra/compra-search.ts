import { documentSearch } from '../common/document-search';
import { QueryExecutor, queryRows } from '../common/database/typed-query';

export const COMPRA_LEGACY = "($1='' OR strpos(lower(concat_ws(' ',c.id_compra::text,c.folio_factura,c.nombre_proveedor,c.rfc_proveedor)),lower($1))>0)";
const purchase = documentSearch('search', '', 'public.directory_search_document(ARRAY[b.id_compra::text,b.folio_factura_proveedor::text])');
const supplier = documentSearch('search', '', 'public.directory_search_document(ARRAY[p."IdProveedor"::text,p."RFC"::text,p."RazonSocial"::text,p."CodigoPostal"::text])');
export const COMPRA_CANDIDATES = `SELECT b.id_compra FROM compra b WHERE ${purchase}
 UNION SELECT b.id_compra FROM proveedor p JOIN compra b ON b.id_proveedor=p."IdProveedor" WHERE ${supplier}`;

export async function compraSearch(source: QueryExecutor, term: string): Promise<string> {
  const text = term.trim();
  // Espacios pueden cruzar campos: mantener la concatenación completa original.
  if (!/[\p{L}\p{N}]{3}/u.test(text) || /\s/u.test(text)) return COMPRA_LEGACY;
  const probe = `SELECT b.id_compra FROM compra b WHERE ${purchase}
    UNION ALL SELECT owned.id_compra FROM proveedor p CROSS JOIN LATERAL
      (SELECT b.id_compra FROM compra b WHERE b.id_proveedor=p."IdProveedor" LIMIT 257) owned
    WHERE ${supplier}`;
  const rows = await queryRows(source, `SELECT 1 FROM (${probe}) candidates LIMIT 257`, [text]);
  if (rows.length >= 257) return COMPRA_LEGACY;
  // Proveedor es un superconjunto. El filtro final descarta ID/CP extra.
  // Reconsultar candidatos evita congelar los IDs obtenidos en el sondeo.
  // Los candidatos indexados sólo cubren compras anteriores; las directas (fuente orden) usan el filtro textual.
  return `${COMPRA_LEGACY} AND (c.fuente='orden' OR c.id_compra IN (${COMPRA_CANDIDATES}))`;
}
