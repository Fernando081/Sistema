import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional,
  IsString, IsUrl, MaxLength, Min,
} from 'class-validator';

export const ESTADOS_GARANTIA = [
  'Recibida', 'En revision', 'Enviada proveedor', 'Aprobada', 'Rechazada', 'Cerrada',
] as const;
export const DESTINOS_GARANTIA = ['Vendible', 'Revision', 'Proveedor', 'Merma'] as const;

export class CreateGarantiaDto {
  @Type(() => Number) @IsInt() @Min(1) idFactura: number;
  @Type(() => Number) @IsInt() @Min(1) idConcepto: number;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() idProveedor?: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) cantidad: number;
  @IsString() @MaxLength(255) motivo: string;
  @IsString() @IsIn(DESTINOS_GARANTIA) destinoProducto: string;
  @IsArray() @ArrayMaxSize(10) @IsUrl({}, { each: true }) @IsOptional() evidencias?: string[];
  @IsDateString() @IsOptional() fechaCompromiso?: string;
}

export class UpdateGarantiaDto {
  @IsString() @IsIn(ESTADOS_GARANTIA) @IsOptional() estado?: string;
  @IsString() @MaxLength(2000) @IsOptional() resolucion?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() idProveedor?: number;
  @IsString() @IsIn(DESTINOS_GARANTIA) @IsOptional() destinoProducto?: string;
  @IsArray() @ArrayMaxSize(10) @IsUrl({}, { each: true }) @IsOptional() evidencias?: string[];
  @IsDateString() @IsOptional() fechaCompromiso?: string;
}
