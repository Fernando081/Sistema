import { compraSearch } from './compra-search';
import { DateRangeQueryDto } from '../common/date-range-query';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { csvDocument } from '../common/csv';

export class CompraQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsIn(['', 'Pendiente', 'Completada', 'Pagada']) estado = '';
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() @MaxLength(200) term = '';
  @IsOptional() @IsIn(['', 'id_compra', 'fecha_compra', 'total', 'estatus', 'folio_factura', 'nombre_proveedor']) sortBy = '';
  @IsOptional() @IsIn(['', 'asc', 'desc']) sortOrder = '';
}
// Misma proyección que fn_get_compras; el subquery SQL permite aplicar filtros/límite en el plan.
export const COMPRA_SOURCE = `(SELECT base.id_compra,base.fecha_compra,
  base.folio_factura_proveedor AS folio_factura,base.total,base.estatus,
  p."RazonSocial" AS nombre_proveedor,p."RFC" AS rfc_proveedor
  FROM compra base JOIN proveedor p ON base.id_proveedor=p."IdProveedor")`;
async function parts(source: QueryExecutor, query: CompraQueryDto) {
  const columns: Record<string, string> = { id_compra: 'id_compra', fecha_compra: 'fecha_compra', total: 'total', estatus: 'estatus', folio_factura: 'folio_factura', nombre_proveedor: 'nombre_proveedor' };
  const column = Object.hasOwn(columns, query.sortBy) ? columns[query.sortBy] : 'id_compra';
  const from = `FROM ${COMPRA_SOURCE} c WHERE ($2='' OR c.estatus=$2) AND (NULLIF($3,'')::date IS NULL OR c.fecha_compra >= (NULLIF($3,'')::date::timestamp AT TIME ZONE 'America/Mexico_City')) AND (NULLIF($4,'')::date IS NULL OR c.fecha_compra < ((NULLIF($4,'')::date + INTERVAL '1 day') AT TIME ZONE 'America/Mexico_City')) AND ${await compraSearch(source, query.term)}`;
  return { from, order: `ORDER BY c.${column} ${query.sortOrder === 'asc' ? 'ASC' : 'DESC'}, c.id_compra DESC`, parameters: [query.term.trim(), query.estado, query.desde, query.hasta] };
}
export async function compraPage(source: QueryExecutor, query: CompraQueryDto) {
  return readSnapshot(source, manager => compraPageInSnapshot(manager, query));
}

async function compraPageInSnapshot(source: QueryExecutor, query: CompraQueryDto) {
  const { from, order, parameters } = await parts(source, query);
  const counts = await queryRows<{ total: string | number }>(source, `SELECT count(*) total ${from}`, parameters);
  const data = await queryRows<Record<string, unknown>>(source, `SELECT c.* ${from} ${order} LIMIT $5 OFFSET $6`, [...parameters, query.limit, (query.page - 1) * query.limit]);
  const total = Number(counts[0].total);
  return { data, total, page: query.page, totalPages: Math.ceil(total / query.limit) };
}
export async function compraCsv(source: QueryExecutor, query: CompraQueryDto) {
  const { from, order, parameters } = await parts(source, query);
  const rows = await queryRows<Record<string, unknown>>(source, `SELECT c.* ${from} ${order} LIMIT 5001`, parameters);
  if (rows.length > 5000) throw new BadRequestException('La exportación supera 5000 registros. Reduce la búsqueda y vuelve a exportar.');
  return csvDocument(['id_compra', 'fecha_compra', 'nombre_proveedor', 'rfc_proveedor', 'folio_factura', 'total', 'estatus'], rows.map(row => ({ ...row, fecha_compra: row.fecha_compra instanceof Date ? row.fecha_compra.toISOString() : row.fecha_compra })));
}
