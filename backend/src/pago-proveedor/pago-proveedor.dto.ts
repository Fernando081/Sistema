// backend/src/pago-proveedor/pago-proveedor.dto.ts
import {
  IsNumber,
  IsString,
  IsOptional,
  IsNotEmpty,
  Min,
} from 'class-validator';

export class RegistrarPagoProveedorDto {
  @IsNumber()
  @IsNotEmpty()
  idCompra: number;

  @IsNumber()
  @Min(0.01)
  monto: number;

  @IsString()
  @IsNotEmpty()
  formaPago: string;

  @IsString()
  @IsOptional()
  referencia?: string;

  @IsString()
  @IsOptional()
  notas?: string;
}
