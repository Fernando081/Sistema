// backend/src/cotizacion/cotizacion.dto.ts
import { IsArray, IsNumber, IsString, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ConceptoCotizacionDto {
  @IsNumber() idProducto: number;
  @IsString() descripcion: string;
  @IsString() unidadDescripcion: string;
  @IsNumber() cantidad: number;
  @IsNumber() valorUnitario: number;
  @IsNumber() importe: number;
  @IsNumber() importeIva: number;
  @IsNumber() importeRetIsr: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagenes?: string[];
}

export class CreateCotizacionDto {
  @IsNumber() idCliente: number;
  @IsString() nombreReceptor: string;
  @IsString() rfcReceptor: string;

  @IsNumber() subtotal: number;
  @IsNumber() totalImpuestos: number;
  @IsNumber() totalRetenciones: number;
  @IsNumber() total: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConceptoCotizacionDto)
  conceptos: ConceptoCotizacionDto[];
}

export class ArticuloAceptadoDto {
  @IsNumber() idConcepto: number;
  @IsNumber() precioCierre: number;
}

export class ArticuloRechazadoDto {
  @IsNumber() idConcepto: number;
  @IsString() motivoRechazo: string;
}

export class ConvertirCotizacionDto {
  @IsNumber() idFormaPago: number;
  @IsNumber() idMetodoPago: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArticuloAceptadoDto)
  articulosAceptados: ArticuloAceptadoDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArticuloRechazadoDto)
  articulosRechazados: ArticuloRechazadoDto[];
}
