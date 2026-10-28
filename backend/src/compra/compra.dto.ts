// backend/src/compra/compra.dto.ts
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsBoolean,
  ArrayMinSize,
  Min,
  IsUUID,
  IsIn,
  IsInt,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DetalleCompraDto {
  @IsInt() @Min(1) idProducto: number;

  @IsString()
  @IsOptional()
  codigo: string;

  @IsString() descripcion: string;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) cantidad: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) costoUnitario: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) importe: number;

  /** Tasa de IVA del renglón (16 %, 8 % frontera o 0 %/exento). Sin valor se registra sin IVA. */
  @IsOptional() @IsIn([0, 0.08, 0.16]) tasaIva?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagenes?: string[];
}

export class CreateCompraDto {
  @IsOptional() @IsIn(['Efectivo', 'Transferencia']) formaPago?: string;
  @IsUUID()
  @IsOptional()
  requestId?: string;

  @IsInt() @Min(1) idProveedor: number;

  @IsString()
  @IsOptional()
  folioFactura: string;

  // --- NUEVO CAMPO ---
  @IsBoolean()
  esCredito: boolean;

  /** Total con IVA (subtotal + IVA de los renglones). */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) total: number;

  @IsString()
  @IsOptional()
  observaciones: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DetalleCompraDto)
  conceptos: DetalleCompraDto[];
}
