// backend/src/pago-proveedor/pago-proveedor.dto.ts
import {
  IsNumber,
  IsString,
  IsOptional,
  IsNotEmpty,
  Min,
  IsInt,
} from 'class-validator';

export class RegistrarPagoProveedorDto {
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  idCompra: number;

  @IsNumber({ maxDecimalPlaces: 2 })
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
