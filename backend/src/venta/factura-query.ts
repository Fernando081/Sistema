import { chooseDocumentSearch } from '../common/document-search';
import { DateRangeQueryDto } from '../common/date-range-query';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { csvDocument } from '../common/csv';

export class FacturaQueryDto extends DateRangeQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() @MaxLength(200) term = '';
  @IsOptional() @IsIn(['', 'I', 'E']) tipo = '';
  @IsOptional() @IsIn(['', 'Pendiente', 'Timbrada', 'Cancelada', 'Pagada']) estado = '';
  @IsOptional() @IsIn(['id', 'folio', 'fecha', 'receptor', 'rfc', 'total', 'estatus']) sortBy = 'id';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder = 'desc';
}
export const DOCUMENT_LEGACY = "($1='' OR strpos(lower(concat_ws(' ',f.folio::text,f.serie||f.folio::text,f.serie||'-'||f.folio::text,f.nombre_receptor,f.rfc_receptor)),lower($1))>0)";
export const DOCUMENT_INDEXED = "public.directory_search_document(ARRAY[f.folio::text,f.serie::text||f.folio::text,f.serie::text||'-'||f.folio::text,f.nombre_receptor::text,f.rfc_receptor::text])";
async function parts(source: QueryExecutor, query: FacturaQueryDto) {
  const columns: Record<string, string> = { id: 'id_factura', folio: 'folio', fecha: 'fecha_emision', receptor: 'nombre_receptor', rfc: 'rfc_receptor', total: 'total', estatus: 'estatus' };
  const column = Object.hasOwn(columns, query.sortBy) ? columns[query.sortBy] : 'id_factura';
  const from = `FROM factura f WHERE (NULLIF($4,'')::date IS NULL OR f.fecha_emision >= (NULLIF($4,'')::date::timestamp AT TIME ZONE 'America/Mexico_City')) AND (NULLIF($5,'')::date IS NULL OR f.fecha_emision < ((NULLIF($5,'')::date + INTERVAL '1 day') AT TIME ZONE 'America/Mexico_City')) AND ($3='' OR f.estatus::text=$3) AND ($2='' OR f.tipo_comprobante=$2) AND ${await chooseDocumentSearch(source, query.term, DOCUMENT_LEGACY, DOCUMENT_INDEXED, 'factura')}`;
  return { from, order: `ORDER BY f.${column} ${query.sortOrder === 'asc' ? 'ASC' : 'DESC'}, f.id_factura DESC`, parameters: [query.term.trim(), query.tipo, query.estado, query.desde, query.hasta] };
}
export async function facturaPage(source: QueryExecutor, query: FacturaQueryDto) {
  return readSnapshot(source, manager => facturaPageInSnapshot(manager, query));
}

async function facturaPageInSnapshot(source: QueryExecutor, query: FacturaQueryDto) {
  const { from, order, parameters } = await parts(source, query);
  const counts = await queryRows<{ count: string | number }>(source, `SELECT count(*) count ${from}`, parameters);
  const data = await queryRows<Record<string, unknown>>(source, `SELECT f.* ${from} ${order} LIMIT $6 OFFSET $7`, [...parameters, query.limit, (query.page - 1) * query.limit]);
  return { data, total: Number(counts[0].count), page: query.page, totalPages: Math.ceil(Number(counts[0].count) / query.limit) };
}
export async function facturaCsv(source: QueryExecutor, query: FacturaQueryDto) {
  const { from, order, parameters } = await parts(source, query);
  const rows = await queryRows<Record<string, unknown>>(source, `SELECT f.*,COALESCE((SELECT fd.estado::text FROM fiscal_documento fd WHERE fd.id_factura=f.id_factura LIMIT 1),'Borrador') estado_fiscal ${from} ${order} LIMIT 5001`, parameters);
  if (rows.length > 5000) throw new BadRequestException('La exportación supera 5000 registros. Reduce la búsqueda y vuelve a exportar.');
  return csvDocument(['id_factura', 'serie', 'folio', 'fecha_emision', 'nombre_receptor', 'rfc_receptor', 'tipo_comprobante', 'total', 'estatus', 'estado_fiscal'], rows.map(row => ({ ...row, fecha_emision: row.fecha_emision instanceof Date ? row.fecha_emision.toISOString() : row.fecha_emision })));
}
