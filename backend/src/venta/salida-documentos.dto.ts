import {
  IsIn,
  IsOptional,
  Equals,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
export class SalidaQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}
export class SalidaPrepararDto {
  @IsUUID('4') requestId!: string;
  @Matches(/^[a-f0-9]{64}$/) evaluacionSha256!: string;
  @Equals(true) confirmacion!: boolean;
  /** O01.2b: "Correo" encola un envío real (sólo con configuración SMTP válida); por defecto "Local". */
  @IsOptional() @IsIn(['Local', 'Correo']) modo?: 'Local' | 'Correo';
}
export class SalidaCerrarDto {
  @IsUUID('4') requestId!: string;
  @Equals(true) confirmacion!: boolean;
}
export class SalidaCancelarDto extends SalidaCerrarDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motivo!: string;
}

/** O01.2b · Decisión humana sobre un envío Incierto (se perdió la respuesta del servidor). */
export class SalidaConciliarDto extends SalidaCerrarDto {
  @IsIn(['ConfirmarAceptado', 'Reintentar', 'DarPorFallido'])
  accion!: 'ConfirmarAceptado' | 'Reintentar' | 'DarPorFallido';

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motivo!: string;
}
