import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProductoExportDto {
  @IsOptional() @IsString() @MaxLength(200) term = '';
  @IsOptional() @IsIn(['', 'codigo', 'descripcion', 'categoriaNombre', 'marca', 'ubicacion', 'precioUnitario', 'existencia']) sort = '';
  @IsOptional() @IsIn(['', 'asc', 'desc']) order = '';
}
