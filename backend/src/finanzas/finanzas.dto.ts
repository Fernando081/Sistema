import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateGastoDto {
  @IsString()
  @IsNotEmpty()
  concepto: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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
  idUsuario?: number;

  @IsNumber()
  @IsOptional()
  idCompra?: number;
}
