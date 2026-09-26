import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class FacturaProveedorLineaDto {
  @IsInt() @Min(1) idOrdenDetalle: number;
  @Transform(trim) @IsString() @MaxLength(500) descripcion: string;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) cantidad: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) costoUnitario: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) tasaIva = 0.16;
}

export class CreateFacturaProveedorDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) idProveedor: number;
  @IsInt() @Min(1) idOrden: number;
  @Transform(trim) @IsString() @MaxLength(30) @IsOptional() serie?: string;
  @Transform(trim) @IsString() @MaxLength(80) folio: string;
  @IsUUID() @IsOptional() uuid?: string;
  @IsDateString() fechaEmision: string;
  @IsDateString() fechaVencimiento: string;
  @IsIn(['MXN', 'USD', 'EUR']) moneda = 'MXN';
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) tipoCambio = 1;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) subtotal: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) impuestos = 0;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) retenciones = 0;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) total: number;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() observaciones?: string;
  @IsString() @MaxLength(5_000_000) @IsOptional() xml?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => FacturaProveedorLineaDto)
  partidas: FacturaProveedorLineaDto[];
}

export class ResolveDiscrepancyDto {
  @IsIn(['Aprobada', 'Rechazada']) estado: 'Aprobada' | 'Rechazada';
  @Transform(trim) @IsString() @MaxLength(1000) justificacion: string;
}

export class CreateSupplierCreditDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) idProveedor: number;
  @IsInt() @Min(1) @IsOptional() idFacturaProveedor?: number;
  @IsUUID() @IsOptional() uuid?: string;
  @Transform(trim) @IsString() @MaxLength(80) folio: string;
  @IsDateString() fecha: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) total: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @IsOptional() montoAplicar?: number;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() notas?: string;
}

export class CreateSupplierAdvanceDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) idProveedor: number;
  @IsInt() @Min(1) @IsOptional() idFacturaProveedor?: number;
  @IsDateString() fecha: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @IsOptional() montoAplicar?: number;
  @Transform(trim) @IsString() @MaxLength(40) formaPago: string;
  @Transform(trim) @IsString() @MaxLength(120) @IsOptional() referencia?: string;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() notas?: string;
}

export class ScheduleSupplierPaymentDto {
  @IsDateString() fechaProgramada: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto: number;
  @Transform(trim) @IsString() @MaxLength(500) @IsOptional() notas?: string;
}

export class PaySupplierInvoiceDto {
  @IsUUID() requestId: string;
  @IsInt() @Min(1) @IsOptional() idProgramacion?: number;
  @IsDateString() fecha: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) monto: number;
  @Transform(trim) @IsString() @MaxLength(40) formaPago: string;
  @Transform(trim) @IsString() @MaxLength(120) @IsOptional() referencia?: string;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() notas?: string;
}
