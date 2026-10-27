import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Min,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  ValidateNested,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
export class ApproveWebCandidateDto {
  @IsInt() @Min(1) version: number;
  @IsBoolean() confirmed: boolean;
}
export class RevokeWebApprovalDto {
  @IsBoolean() confirmed: boolean;
}
export class WebBatchMemberDto {
  @IsInt() @Min(1) productId: number;
  @IsInt() @Min(1) version: number;
}
export class ApproveWebBatchDto {
  @IsString() @Length(1, 200000) raw: string;
  @IsBoolean() confirmed: boolean;
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => WebBatchMemberDto)
  members: WebBatchMemberDto[];
}

export class WebSpecificationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 80)
  @Matches(/^[^<>]+$/)
  nombre: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 160)
  @Matches(/^[^<>]+$/)
  valor: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 30)
  @Matches(/^[^<>]+$/)
  unidad: string;
}

export class SaveWebProductDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  equivalencias?: number[];
  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Matches(/^[^<>]*$/)
  fuenteCompatibilidad?: string;
  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Matches(/^[^<>]*$/)
  fuenteReferencias?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 160)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(8, 160)
  @Matches(/^[^<>]+$/)
  titulo: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(30, 6000)
  @Matches(/^[^<>]+$/)
  descripcion: string;
  @IsIn(['borrador', 'listo', 'retirado'])
  estado: 'borrador' | 'listo' | 'retirado';
  @IsBoolean() datosRealesConfirmados: boolean;
  @IsBoolean() derechosImagenConfirmados: boolean;
  @IsBoolean() compatibilidadVerificada: boolean;
  @IsInt() @Min(0) version: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^\/uploads\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i, {
    each: true,
  })
  imagenes?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => WebSpecificationDto)
  especificaciones?: WebSpecificationDto[];
}

export class WebCatalogListDto {
  @IsOptional() @IsIn(['todos', 'con_pendientes', 'sin_pendientes']) revision =
    'todos';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @Length(0, 100) term = '';
  @IsOptional()
  @IsIn(['todos', 'sin_ficha', 'borrador', 'listo', 'retirado'])
  estado = 'todos';
}
