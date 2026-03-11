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
  IsArray,
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

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  imagenes?: string[];
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

export interface PrediccionDemandaItem {
  id_producto: number;
  codigo: string;
  descripcion: string;
  stock_actual: number;
  precio_unitario: number;

  // Moving averages
  vendido_30d: number;
  vendido_60d: number;
  vendido_90d: number;
  prom_diario_30d: number;
  prom_diario_60d: number;
  prom_diario_90d: number;

  // Regression stats
  pendiente_regresion: number;
  intercepto_regresion: number;
  r_cuadrado: number;
  num_semanas: number;

  // Trend & prediction
  tendencia: 'ALTA' | 'BAJA' | 'ESTABLE';
  demanda_proyectada_30d: number;
  cantidad_sugerida_compra: number;
}

