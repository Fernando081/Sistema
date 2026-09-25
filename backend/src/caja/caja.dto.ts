import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ConteoCajaDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999)
  contado!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string;
}
