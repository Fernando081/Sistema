// backend/src/pago/pago.dto.ts
import {
  IsNumber,
  IsString,
  IsOptional,
  IsNotEmpty,
  Min,
} from 'class-validator';
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
