// backend/src/cotizacion/cotizacion.dto.ts
import { ArrayMinSize, ArrayMaxSize, IsInt, MaxLength, IsArray, IsNumber, IsString, Min, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { DecimalPlaces } from '../common/decimal-places';

export class ConceptoCotizacionDto {
  @IsInt() @Min(1) idProducto: number;
  @IsString() descripcion: string;
  @IsString() unidadDescripcion: string;
  @IsNumber() @DecimalPlaces(6) @Min(0.000001) cantidad: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) valorUnitario: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) importe: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) importeIva: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) importeRetIsr: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  imagenes?: string[];
}

export class CreateCotizacionDto {
  @IsInt() @Min(1) idCliente: number;
  @IsString() nombreReceptor: string;
  @IsString() rfcReceptor: string;

  @IsNumber() @DecimalPlaces(2) @Min(0) subtotal: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) totalImpuestos: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) totalRetenciones: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) total: number;

  @IsArray()
  @ArrayMaxSize(500)
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConceptoCotizacionDto)
  conceptos: ConceptoCotizacionDto[];
}

export class ArticuloAceptadoDto {
  @IsInt() @Min(1) idConcepto: number;
  @IsNumber() @DecimalPlaces(2) @Min(0) precioCierre: number;
}

export class ArticuloRechazadoDto {
  @IsInt() @Min(1) idConcepto: number;
  @IsString() @MaxLength(100) motivoRechazo: string;
}

export class ConvertirCotizacionDto {
  @IsInt() @Min(1) idFormaPago: number;
  @IsInt() @Min(1) idMetodoPago: number;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ArticuloAceptadoDto)
  articulosAceptados: ArticuloAceptadoDto[];

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ArticuloRechazadoDto)
  articulosRechazados: ArticuloRechazadoDto[];
}
