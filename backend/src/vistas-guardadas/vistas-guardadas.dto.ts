import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/** Listados que sincronizan sus filtros en la URL (Q04.3/Q04.4) y por eso pueden guardarse como vista. */
export const RUTAS_VISTA = ['/cliente', '/proveedor', '/producto', '/facturas', '/cotizacion/historial', '/compra/historial'] as const;
export type RutaVista = (typeof RUTAS_VISTA)[number];

export class RutaVistaDto {
  @IsIn(RUTAS_VISTA) ruta!: RutaVista;
}

export class CreateVistaGuardadaDto {
  @IsIn(RUTAS_VISTA) ruta!: RutaVista;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nombre!: string;

  /** Query string del listado (sin "?"); el servidor conserva sólo los parámetros permitidos. */
  @IsString() @MaxLength(1000) consulta!: string;
}
