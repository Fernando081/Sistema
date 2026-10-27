import { chooseDocumentSearch } from '../common/document-search';
import { DateRangeQueryDto } from '../common/date-range-query';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { csvDocument } from '../common/csv';

export class CotizacionQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsIn(['', 'Vigente', 'Pendiente', 'Convertida', 'Rechazada']) estado = '';
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() @MaxLength(200) term = '';
  @IsOptional() @IsIn(['id', 'folio', 'fecha', 'cliente', 'total', 'estatus']) sortBy = 'id';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder = 'desc';
}
export const DOCUMENT_LEGACY = "($1='' OR strpos(lower(concat_ws(' ',f.folio::text,'C-'||f.folio::text,f.nombre_receptor,f.rfc_receptor)),lower($1))>0)";
export const DOCUMENT_INDEXED = "public.directory_search_document(ARRAY[f.folio::text,'C-'||f.folio::text,f.nombre_receptor::text,f.rfc_receptor::text])";
async function parts(source: QueryExecutor, query: CotizacionQueryDto) {
  const columns: Record<string, string> = { id: 'id_cotizacion', folio: 'folio', fecha: 'fecha_emision', cliente: 'nombre_receptor', total: 'total', estatus: 'estatus' };
  const column = Object.hasOwn(columns, query.sortBy) ? columns[query.sortBy] : 'id_cotizacion';
  const from = `FROM cotizacion f WHERE ($2='' OR f.estatus=$2) AND (NULLIF($3,'')::date IS NULL OR f.fecha_emision >= (NULLIF($3,'')::date::timestamp AT TIME ZONE 'America/Mexico_City')) AND (NULLIF($4,'')::date IS NULL OR f.fecha_emision < ((NULLIF($4,'')::date + INTERVAL '1 day') AT TIME ZONE 'America/Mexico_City')) AND ${await chooseDocumentSearch(source, query.term, DOCUMENT_LEGACY, DOCUMENT_INDEXED, 'cotizacion')}`;
  return { from, order: `ORDER BY f.${column} ${query.sortOrder === 'asc' ? 'ASC' : 'DESC'}, f.id_cotizacion DESC`, parameters: [query.term.trim(), query.estado, query.desde, query.hasta] };
}
export async function cotizacionPage(source: QueryExecutor, query: CotizacionQueryDto) {
  return readSnapshot(source, manager => cotizacionPageInSnapshot(manager, query));
}

async function cotizacionPageInSnapshot(source: QueryExecutor, query: CotizacionQueryDto) {
  const { from, order, parameters } = await parts(source, query);
  const counts = await queryRows<{ total: string | number }>(source, `SELECT count(*) total ${from}`, parameters);
  const data = await queryRows<Record<string, unknown>>(source, `SELECT f.*,(SELECT pv.id_pedido FROM pedido_venta pv WHERE pv.id_cotizacion=f.id_cotizacion ORDER BY pv.id_pedido DESC LIMIT 1) id_pedido ${from} ${order} LIMIT $5 OFFSET $6`, [...parameters, query.limit, (query.page - 1) * query.limit]);
  const total = Number(counts[0].total);
  return { data, total, page: query.page, totalPages: Math.ceil(total / query.limit) };
}
export async function cotizacionCsv(source: QueryExecutor, query: CotizacionQueryDto) {
  const { from, order, parameters } = await parts(source, query);
  const rows = await queryRows<Record<string, unknown>>(source, `SELECT f.* ${from} ${order} LIMIT 5001`, parameters);
  if (rows.length > 5000) throw new BadRequestException('La exportación supera 5000 registros. Reduce la búsqueda y vuelve a exportar.');
  return csvDocument(['id_cotizacion', 'folio', 'fecha_emision', 'nombre_receptor', 'rfc_receptor', 'total', 'estatus'], rows.map(row => ({ ...row, fecha_emision: row.fecha_emision instanceof Date ? row.fecha_emision.toISOString() : row.fecha_emision })));
}
