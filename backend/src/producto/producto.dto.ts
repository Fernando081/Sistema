// backend/src/producto/producto.dto.ts (NUEVO ARCHIVO)
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  IsBoolean,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { APP_CONSTANTS } from '../common/constants/app.constants';

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
  objetoImpuestoSat?: string; // APP_CONSTANTS.TAX_OBJECT_DEFAULT

  @IsNumber()
  @IsOptional()
  tasaIva?: number; // APP_CONSTANTS.TAX_RATE_DEFAULT

  @IsBoolean()
  @IsOptional()
  aplicaRetencionIsr?: boolean;

  @IsBoolean()
  @IsOptional()
  aplicaRetencionIva?: boolean;
}

export class UpdateProductoDto extends PartialType(CreateProductoDto) {}

export interface SmartRestockItem {
  id_producto: number;
  codigo: string;
  descripcion: string;
  unidades_vendidas_30d: number;
  stock_actual: number;
  precio_unitario: number;
  margen: number;
}
