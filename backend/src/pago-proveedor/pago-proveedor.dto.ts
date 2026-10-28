// backend/src/pago-proveedor/pago-proveedor.dto.ts
import {
  IsNumber,
  IsString,
  IsOptional,
  IsNotEmpty,
  Min,
  IsInt,
  IsUUID,
} from 'class-validator';

export class RegistrarPagoProveedorDto {
  // Opcional para conservar clientes anteriores; el frontend lo envía en cada intento.
  @IsUUID()
  @IsOptional()
  requestId?: string;

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
