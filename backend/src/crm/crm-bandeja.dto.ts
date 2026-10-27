import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
export class CrmBandejaQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsString() @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  q = '';
  @IsIn(['todos', 'tarea', 'oportunidad', 'cotizacion', 'web']) tipo = 'todos';
  @IsIn(['todos', 'vencidas', 'hoy', 'proximas', 'sin-fecha']) plazo = 'todos';
}
