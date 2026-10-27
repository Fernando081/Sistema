import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateBy } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
// class-validator maxDecimalPlaces can throw for scientific notation; count expanded decimals safely.
const sixDecimals = () => ValidateBy({name: 'pieceQuantityPrecision', validator: {
 validate: (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const [mantissa, exponent] = value.toString().toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent ?? 0)) <= 6;
 }, defaultMessage: () => 'cantidad admite hasta seis decimales',
}});
export class PiezasQuery {
 @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
 @IsOptional() @Transform(trim) @IsString() @MaxLength(100) term = '';
}
export class RevisionPiezaDto {
 @IsInt() @Min(1) version: number;
 @IsIn(['Pendiente', 'Verificada', 'Incompatible']) compatibilidad: 'Pendiente' | 'Verificada' | 'Incompatible';
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) referencia: string;
}
export class CrearPiezaDto {
 @IsUUID() requestId: string;
 @IsInt() @Min(1) idConcepto: number;
 @IsNumber() @sixDecimals() @Min(0.000001) @Max(999999999999) cantidad: number;
 @IsDateString({strict: true}) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) fecha: string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) detalle: string;
 @IsIn(['Pendiente', 'Verificada', 'Incompatible']) compatibilidad: 'Pendiente' | 'Verificada' | 'Incompatible';
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) referencia: string;
}
export class VincularGarantiaPiezaDto {
 @IsUUID() requestId: string;
 @IsInt() @Min(1) idGarantia: number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) motivo: string;
}
