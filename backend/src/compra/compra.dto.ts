// backend/src/compra/compra.dto.ts
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DetalleCompraDto {
  @IsNumber() idProducto: number;

  @IsString()
  @IsOptional()
  codigo: string;

  @IsString() descripcion: string;
  @IsNumber() cantidad: number;
  @IsNumber() costoUnitario: number;
  @IsNumber() importe: number;
}

export class CreateCompraDto {
  @IsNumber() idProveedor: number;

  @IsString()
  @IsOptional()
  folioFactura: string;

  // --- NUEVO CAMPO ---
  @IsBoolean()
  esCredito: boolean;

  @IsNumber() total: number;

  @IsString()
  @IsOptional()
  observaciones: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetalleCompraDto)
  conceptos: DetalleCompraDto[];
}
