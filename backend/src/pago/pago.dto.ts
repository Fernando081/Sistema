// backend/src/pago/pago.dto.ts
import {
  IsNumber,
  IsString,
  IsOptional,
  IsNotEmpty,
  Min,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
  IsDateString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RegistrarPagoDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  idFactura: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  monto: number;

  @IsString()
  @IsNotEmpty()
  formaPago: string; // MetodoPago

  @IsString()
  @IsOptional()
  referencia?: string;

  @IsString()
  @IsOptional()
  notas?: string;
}

export class RepFacturaDto {
  @IsInt()
  @Min(1)
  idFactura: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montoSaldado: number;
}

export class RegistrarRepDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsInt()
  @Min(1)
  idCliente: number;

  @IsDateString({ strict: true })
  @IsNotEmpty()
  fechaPago: string;

  @IsString()
  @IsNotEmpty()
  formaPago: string;

  @IsString()
  moneda: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montoTotal: number;

  @IsString()
  @IsOptional()
  cuentaBeneficiario?: string;

  @IsString()
  @IsOptional()
  rfcBeneficiario?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RepFacturaDto)
  facturas: RepFacturaDto[];
}
