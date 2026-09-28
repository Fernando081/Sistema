import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsInt,
  IsIn,
  Matches,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsDateString,
  IsBoolean,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateGastoDto {
  @IsString()
  @IsNotEmpty()
  concepto: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @IsNotEmpty()
  monto: number;

  @IsString()
  @IsNotEmpty()
  categoria: string;

  @IsString()
  @IsNotEmpty()
  metodoPago: string;

  @IsNumber()
  @IsOptional()
  idCompra?: number;
}

export class CorteFinancieroQueryDto {
  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PolizaDetalleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  idCuenta: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  idCentroCosto?: number;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @IsOptional()
  concepto?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  referencia?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debe = 0;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  haber = 0;
}

export class CreatePolizaDto {
  @IsDateString()
  fecha: string;

  @IsIn(['Diario', 'Ingreso', 'Egreso'])
  tipo: 'Diario' | 'Ingreso' | 'Egreso';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  concepto: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PolizaDetalleDto)
  partidas: PolizaDetalleDto[];
}

export class ContabilidadQueryDto {
  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class BalanceQueryDto {
  @IsDateString()
  @IsOptional()
  fecha?: string;
}

export class CreateCuentaTesoreriaDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) nombre: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) banco: string;
  @Transform(trim) @IsString() @Matches(/^[A-Z]{3}$/) moneda = 'MXN';
  @Transform(trim) @IsString() @Matches(/^\d{4}$/) @IsOptional() ultimosCuatro?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() saldoInicial = 0;
}

export class CreateMovimientoTesoreriaDto {
  @Type(() => Number) @IsInt() @Min(1) idCuenta: number;
  @IsDateString() fecha: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) descripcion: string;
  @Transform(trim) @IsString() @MaxLength(120) @IsOptional() referencia?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) monto: number;
}

export class ConciliarMovimientoDto {
  @Type(() => Number) @IsInt() @Min(1) idCajaMovimiento: number;
}

export class ImportBankStatementDto {
  @Type(() => Number) @IsInt() @Min(1) idCuenta: number;
  @IsUUID() requestId: string;
  @Transform(({value})=>value===true||value==='true') @IsBoolean() autoConciliar = true;
}

export class ReviewBankMovementDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) motivo: string;
}

export class CreateBankReconciliationDto {
  @IsUUID() requestId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsInt({each:true}) @Min(1,{each:true}) movimientosBanco: number[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsInt({each:true}) @Min(1,{each:true}) movimientosSistema: number[];
  @IsIn(['Comision','Redondeo','TipoCambio','Otro']) @IsOptional() tipoAjuste?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) @IsOptional() motivo?: string;
}

export class CreateTreasuryTransferDto {
  @IsUUID() requestId: string;
  @Type(()=>Number) @IsInt() @Min(1) idMovimientoSalida: number;
  @Type(()=>Number) @IsInt() @Min(1) idMovimientoEntrada: number;
  @Transform(trim) @IsString() @MaxLength(120) @IsOptional() referencia?: string;
}

export class CloseTreasuryPeriodDto {
  @Type(()=>Number) @IsInt() @Min(1) idCuenta: number;
  @Type(()=>Number) @IsInt() @Min(2000) @Max(2200) anio: number;
  @Type(()=>Number) @IsInt() @Min(1) @Max(12) mes: number;
  @Type(()=>Number) @IsNumber({maxDecimalPlaces:2}) saldoEstadoCuenta: number;
}

export class CreatePeriodoDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2200) anio: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) mes: number;
}

export class PresupuestoQueryDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2200) anio: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) mes: number;
}

export class UpsertPresupuestoDto extends PresupuestoQueryDto {
  @Type(() => Number) @IsInt() @Min(1) idCuenta: number;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() idCentroCosto?: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monto: number;
  @Transform(trim) @IsString() @MaxLength(500) @IsOptional() notas?: string;
}

export class ExportarContabilidadDto extends ContabilidadQueryDto {
  @IsIn(['balanza','resultados','balance','flujo']) reporte: 'balanza'|'resultados'|'balance'|'flujo';
}
