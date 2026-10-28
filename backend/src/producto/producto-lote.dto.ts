import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateIf, ValidateNested,
} from 'class-validator';

export const MAX_PRODUCTOS_LOTE = 200;

/** U02.3 · Cambio en lote: precio por porcentaje o categoría. */
export class ProductoLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCTOS_LOTE)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];

  @IsIn(['precio', 'categoria']) accion!: 'precio' | 'categoria';

  /** Porcentaje a aplicar al precio actual: 10 sube 10 %, -5 baja 5 %. */
  @ValidateIf((dto: ProductoLoteDto) => dto.accion === 'precio')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-90)
  @Max(500)
  porcentaje?: number;

  /** centavos: 2 decimales; pesos: entero más cercano. */
  @ValidateIf((dto: ProductoLoteDto) => dto.accion === 'precio')
  @IsIn(['centavos', 'pesos'])
  redondeo?: 'centavos' | 'pesos';

  @ValidateIf((dto: ProductoLoteDto) => dto.accion === 'categoria')
  @IsInt()
  @Min(1)
  idCategoria?: number;
}

/** Valor que el usuario vio en la vista previa; si cambió antes de aplicar, se rechaza el lote completo. */
export class ProductoLoteEsperadoDto {
  @IsInt() @Min(1) idProducto!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) precio!: number;
  @IsOptional() @IsInt() idCategoria?: number | null;
}

export class AplicarProductoLoteDto extends ProductoLoteDto {
  @IsUUID() requestId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCTOS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => ProductoLoteEsperadoDto)
  esperados!: ProductoLoteEsperadoDto[];
}
