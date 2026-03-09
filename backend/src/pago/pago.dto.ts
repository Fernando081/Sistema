// backend/src/pago/pago.dto.ts
import {
  IsNumber,
  IsString,
  IsOptional,
  IsNotEmpty,
  Min,
  IsArray,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { MetodoPago } from '../common/enums/app.enums';

export class RegistrarPagoDto {
  @IsNumber()
  @IsNotEmpty()
  idFactura: number;

  @IsNumber()
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
  @IsNumber()
  idFactura: number;

  @IsNumber()
  montoSaldado: number;
}

export class RegistrarRepDto {
  @IsNumber()
  idCliente: number;

  @IsString()
  @IsNotEmpty()
  fechaPago: string;

  @IsString()
  @IsNotEmpty()
  formaPago: string;

  @IsString()
  moneda: string;

  @IsNumber()
  @Min(0.01)
  montoTotal: number;

  @IsString()
  @IsOptional()
  cuentaBeneficiario?: string;

  @IsString()
  @IsOptional()
  rfcBeneficiario?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepFacturaDto)
  facturas: RepFacturaDto[];
}
