// backend/src/producto/producto.dto.ts (NUEVO ARCHIVO)
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsInt, IsNumber, Min, IsBoolean } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateProductoDto {
  @IsString()
  @IsOptional()
  @MaxLength(30)
  codigo: string;

  @IsInt()
  @IsOptional()
  idUnidad: number;

  @IsInt()
  @IsOptional()
  idObjetoImpuesto: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  descripcion: string;

  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @IsInt()
  @IsOptional()
  idCategoria: number;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  ubicacion: string;

  @IsInt()
  @IsOptional()
  idClaveProdOServ: number;

  @IsInt()
  @IsOptional()
  idClaveUnidad: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  marca: string;

  // --- NUEVOS CAMPOS ---
  @IsString()
  @IsOptional()
  objetoImpuestoSat?: string; // '01', '02'

  @IsNumber()
  @IsOptional()
  tasaIva?: number; // 0.16

  @IsBoolean()
  @IsOptional()
  aplicaRetencionIsr?: boolean;

  @IsBoolean()
  @IsOptional()
  aplicaRetencionIva?: boolean;
}

export class UpdateProductoDto extends PartialType(CreateProductoDto) {}