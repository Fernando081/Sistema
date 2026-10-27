import { Equals, IsInt, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
export class SalidaQuery { @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1; }
export class SalidaPrepararDto {
  @IsUUID('4') requestId!: string;
  @Matches(/^[a-f0-9]{64}$/) evaluacionSha256!: string;
  @Equals(true) confirmacion!: boolean;
}
export class SalidaCerrarDto {
  @IsUUID('4') requestId!: string;
  @Equals(true) confirmacion!: boolean;
}
export class SalidaCancelarDto extends SalidaCerrarDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(300) motivo!: string;
}
