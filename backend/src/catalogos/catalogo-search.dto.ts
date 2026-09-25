import { Transform, TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CatalogoSearchQuery {
  @Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString() @MaxLength(150) @IsOptional()
  q?: string;
}
