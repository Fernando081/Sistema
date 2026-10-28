import { csvDocument } from './csv';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { QueryExecutor, queryRows, readSnapshot } from './database/typed-query';

export class DirectoryQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() @MaxLength(200) term = '';
  @IsOptional() @IsIn(['id', 'rfc', 'razonSocial', 'codigoPostal']) sortBy =
    'id';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder = 'desc';
}

type Directory = 'cliente' | 'proveedor';
async function parts(
  source: QueryExecutor,
  directory: Directory,
  query: DirectoryQueryDto,
) {
  const id = directory === 'cliente' ? 'IdCliente' : 'IdProveedor';
  const columns: Record<string, string> = {
    id,
    rfc: 'RFC',
    razonSocial: 'RazonSocial',
    codigoPostal: 'CodigoPostal',
  };
  const sort = Object.hasOwn(columns, query.sortBy)
    ? columns[query.sortBy]
    : id;
  const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const term = query.term.trim();
  const literal = () => {
    const units =
      directory === 'cliente'
        ? `OR EXISTS (SELECT 1 FROM crm_unidad_cliente u WHERE u.id_cliente=d."IdCliente" AND strpos(lower(concat_ws(' ',u.vin,u.esn,u.numero_economico,u.placas)),lower($1))>0)`
        : '';
    return {
      from: `FROM ${directory} d WHERE (strpos(lower(concat_ws(' ',d."${id}"::text,d."RFC",d."RazonSocial",d."CodigoPostal")),lower($1))>0 ${units})`,
      order: `ORDER BY d."${sort}" ${direction}, d."${id}" DESC`,
      parameters: [term],
    };
  };
  // Los signos y términos sin tres letras/números consecutivos no aprovechan GIN.
  if (term && !/[\p{L}\p{N}]{3}/u.test(term)) return literal();
  const pattern = '%' + term.replace(/[\\%_]/g, (value) => '\\' + value) + '%';
  const document = (alias: string) =>
    `public.directory_search_document(ARRAY[${alias}."${id}"::text,${alias}."RFC"::text,${alias}."RazonSocial"::text,${alias}."CodigoPostal"::text])`;
  const matched =
    directory === 'cliente'
      ? `JOIN (
    SELECT found."IdCliente" AS id FROM cliente found WHERE ${document('found')} LIKE lower($1) ESCAPE chr(92)
    UNION
    SELECT u.id_cliente AS id FROM crm_unidad_cliente u
    WHERE public.directory_search_document(ARRAY[u.vin::text,u.esn::text,u.numero_economico::text,u.placas::text]) LIKE lower($1) ESCAPE chr(92)
  ) hits ON hits.id=d."IdCliente"`
      : `WHERE ${document('d')} LIKE lower($1) ESCAPE chr(92)`;
  const from = `FROM ${directory} d ${term ? matched : ''}`;
  if (term) {
    const unitProbe =
      directory === 'cliente'
        ? `UNION ALL SELECT u.id_cliente FROM crm_unidad_cliente u WHERE public.directory_search_document(ARRAY[u.vin::text,u.esn::text,u.numero_economico::text,u.placas::text]) LIKE lower($1) ESCAPE chr(92)`
        : '';
    const matches = await queryRows(
      source,
      `SELECT 1 FROM (SELECT d."${id}" FROM ${directory} d WHERE ${document('d')} LIKE lower($1) ESCAPE chr(92) ${unitProbe}) candidates LIMIT 257`,
      [pattern],
    );
    if (matches.length >= 257) return literal();
  }
  return {
    from,
    order: `ORDER BY d."${sort}" ${direction}, d."${id}" DESC`,
    parameters: term ? [pattern] : [],
  };
}

export async function directoryPage<Row>(
  source: QueryExecutor,
  directory: Directory,
  query: DirectoryQueryDto,
) {
  return readSnapshot(source, (manager) =>
    directoryPageInSnapshot<Row>(manager, directory, query),
  );
}

async function directoryPageInSnapshot<Row>(
  source: QueryExecutor,
  directory: Directory,
  query: DirectoryQueryDto,
) {
  const { from, order, parameters } = await parts(source, directory, query);
  const counts = await queryRows<{ total: string | number }>(
    source,
    `SELECT count(*) AS total ${from}`,
    parameters,
  );
  const data = await queryRows<Row>(
    source,
    `SELECT d.* ${from} ${order} LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
    [...parameters, query.limit, (query.page - 1) * query.limit],
  );
  const total = Number(counts[0].total);
  return {
    data,
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function directoryCsv(
  source: QueryExecutor,
  directory: Directory,
  query: DirectoryQueryDto,
) {
  const { from, order, parameters } = await parts(source, directory, query);
  const id = directory === 'cliente' ? 'IdCliente' : 'IdProveedor';
  const columns = [id, 'RFC', 'RazonSocial', 'CodigoPostal'];
  // El límite se rechaza explícitamente: nunca exportar silenciosamente una parte.
  const rows = await queryRows<Record<string, unknown>>(
    source,
    `SELECT d.* ${from} ${order} LIMIT 5001`,
    parameters,
  );
  if (rows.length > 5000)
    throw new BadRequestException(
      'La exportación supera 5000 registros. Reduce la búsqueda y vuelve a exportar.',
    );
  return csvDocument(columns, rows);
}
