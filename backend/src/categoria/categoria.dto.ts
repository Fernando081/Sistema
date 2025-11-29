// backend/src/categoria/categoria.dto.ts (NUEVO ARCHIVO)

import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateCategoriaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  descripcion: string;
}

export class UpdateCategoriaDto extends PartialType(CreateCategoriaDto) {}