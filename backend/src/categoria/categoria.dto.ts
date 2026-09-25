// backend/src/categoria/categoria.dto.ts (NUEVO ARCHIVO)

import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, TransformFnParams } from 'class-transformer';

export class CreateCategoriaDto {
  @Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  descripcion: string;
}

export class UpdateCategoriaDto extends PartialType(CreateCategoriaDto, { skipNullProperties: false }) {}
