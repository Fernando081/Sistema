import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class PedidoDetalleDto {
  @IsInt() @Min(1) idProducto: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) cantidad: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) valorUnitario: number;
}

export class CreatePedidoDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) idCliente: number;
  @IsInt() @Min(1) @IsOptional() idUnidad?: number | null;
  @IsInt() @Min(1) @IsOptional() idCotizacion?: number | null;
  @Transform(trim) @IsString() @MaxLength(2000) @IsOptional() notas?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PedidoDetalleDto)
  partidas: PedidoDetalleDto[];
}

export class CreatePedidoFromCotizacionDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) @IsOptional() idUnidad?: number | null;
  @Transform(trim) @IsString() @MaxLength(2000) @IsOptional() notas?: string;
}

export class PedidoQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @Transform(trim) @IsString() @MaxLength(100) @IsOptional() q?: string;
  @Transform(trim)
  @IsString()
  @IsIn(['Borrador', 'Confirmado', 'En espera', 'Parcialmente surtido', 'Surtido', 'Entregado', 'Facturado', 'Cancelado'])
  @IsOptional()
  estado?: string;
}

export class SurtirPartidaDto {
  @IsInt() @Min(1) idDetalle: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) cantidad: number;
}

export class SurtirPedidoDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SurtirPartidaDto)
  partidas: SurtirPartidaDto[];
}

export class EntregarPedidoDto {
  @Transform(trim) @IsString() @MaxLength(200) @IsOptional() recibidoPor?: string;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() notas?: string;
}

export class FacturarPedidoDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) @IsOptional() idFormaPago?: number;
  @IsInt() @Min(1) @IsOptional() idMetodoPago?: number;
}
